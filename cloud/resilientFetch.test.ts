// The two decisions the address fallback turns on. Neither opens a socket, and
// both fail silently if they drift: a code missing from the set means a reset is
// re-raised to the caller with three working addresses never tried, and a method
// misread as a read sends the same write to every edge at once.

import { describe, expect, it } from "vitest";
import { isConnectionFailure, isRead } from "./resilientFetch";

/** Shaped as undici raises it: a TypeError whose `cause` carries the code. */
function fetchFailure(code: string): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(code), { code }),
  });
}

describe("isConnectionFailure", () => {
  it("recognises the codes a dead edge raises", () => {
    // ECONNRESET is the one this whole module exists for.
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"])
      expect(isConnectionFailure(fetchFailure(code))).toBe(true);
  });

  it("reads a code off the error itself as well as off its cause", () => {
    expect(isConnectionFailure(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(
      true,
    );
  });

  it("leaves anything that is not a transport fault to the caller", () => {
    // An abort is the caller's own doing, and retrying it against three more
    // addresses would ignore what they asked for.
    expect(isConnectionFailure(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }))).toBe(
      false,
    );
    expect(isConnectionFailure(new Error("Starlink answered 502"))).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
  });
});

describe("isRead", () => {
  it("races only the methods that change nothing", () => {
    expect(isRead()).toBe(true);
    expect(isRead({})).toBe(true);
    expect(isRead({ method: "get" })).toBe(true);
    expect(isRead({ method: "HEAD" })).toBe(true);
  });

  it("walks a write, so one is never sent to every edge at once", () => {
    for (const method of ["POST", "post", "PUT", "DELETE", "PATCH"])
      expect(isRead({ method })).toBe(false);
  });
});
