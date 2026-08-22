// The two decisions the address fallback turns on. Neither opens a socket, and
// both fail silently if they drift: a code missing from the set means a reset is
// re-raised to the caller with three working addresses never tried, and a method
// misread as a read sends the same write to every edge at once.

import { describe, expect, it, vi } from "vitest";
import { isConnectionFailure, isRead, resilientFetch } from "./resilientFetch";

// 0.0.0.1 is unroutable, so the connect fails the instant it is tried, which is
// what a kit switching into bypass leaves behind. 240.0.0.1 is reserved and
// black-holes instead, which is what a route that has gone away looks like: no
// reset ever arrives and the request simply waits.
const DEAD_ADDRESS = "0.0.0.1";
const SILENT_ADDRESS = "240.0.0.1";

let resolvesTo = [DEAD_ADDRESS];

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (_hostname: string, options?: { all?: boolean }) =>
      options?.all
        ? resolvesTo.map((address) => ({ address, family: 4 }))
        : { address: resolvesTo[0], family: 4 },
  },
}));

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

// The one case here that opens a socket. A pinned-address lookup answering inline
// connects inside net.connect's own frame, before undici attaches its error
// handler, so a route-less address reaches the process uncaught — a modal crash
// box in the desktop app. The suite exits non-zero on that even though the
// assertion below still passes.
describe("resilientFetch against an address with no route", () => {
  // Waited out past this module's own 12s walk ceiling rather than on how fast a
  // given OS refuses 0.0.0.1: what is held here is that the failure arrives as a
  // rejection at all. How quickly it arrives is the two cases below.
  it("rejects the request rather than raising on the process", async () => {
    let hung: ReturnType<typeof setTimeout>;
    const outcome = await Promise.race([
      resilientFetch("https://api.starlink.com/", { method: "POST" }).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => {
        hung = setTimeout(() => resolve("hung"), 20_000);
      }),
    ]).finally(() => clearTimeout(hung));
    expect(outcome).toBe("rejected");
  }, 30_000);

  // The failure that stranded the app: one silent pin took 26s, then 46s, while
  // a fresh process answered the same call in 1.4s.
  it("gives up on a silent pin rather than spending the caller's whole budget", async () => {
    resolvesTo = [SILENT_ADDRESS];
    try {
      const started = Date.now();
      await expect(
        resilientFetch("https://api.starlink.com/", { method: "POST" }),
      ).rejects.toThrow();
      // Undici's own connect timeout is 10s, so anything under that is this
      // module's bound firing rather than the default being waited out.
      expect(Date.now() - started).toBeLessThan(9_000);
    } finally {
      resolvesTo = [DEAD_ADDRESS];
    }
  }, 20_000);

  // A write walks its addresses one at a time, so the count behind a hostname
  // decides the total. Three silent ones at a full attempt each would be 18s,
  // past the 15s a device write is given.
  it("stops walking before the addresses behind a host outlast the caller", async () => {
    resolvesTo = [SILENT_ADDRESS, "240.0.0.2", "240.0.0.3"];
    try {
      const started = Date.now();
      await expect(
        resilientFetch("https://api.starlink.com/", { method: "POST" }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      resolvesTo = [DEAD_ADDRESS];
    }
  }, 30_000);
});
