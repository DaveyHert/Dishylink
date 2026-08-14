import { describe, expect, test, vi } from "vitest";
import { applyRouterClientPaused, clientPauseControlAvailable } from "./routerPause";

describe("clientPauseControlAvailable", () => {
  test("given: no Starlink session, should: hide the device control", () => {
    expect(clientPauseControlAvailable(7, false, false)).toBe(false);
  });

  test("given: a host cannot identify its own client, should: hide the device control", () => {
    expect(clientPauseControlAvailable(7, false, true, false)).toBe(false);
  });

  test("given: a connected account, should: show only for another identified device", () => {
    expect(clientPauseControlAvailable(7, false, true)).toBe(true);
    expect(clientPauseControlAvailable(7, true, true)).toBe(false);
    expect(clientPauseControlAvailable(undefined, false, true)).toBe(false);
  });
});

describe("applyRouterClientPaused", () => {
  test("given: Starlink accepts the update, should: make one cloud request without polling", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });

    await applyRouterClientPaused(7, true, request);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      path: "/cloud/device",
      method: "POST",
      body: { clientId: 7, paused: true },
    });
  });

  test("given: Starlink rejects the update, should: surface its message", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 504,
      body: { message: "Starlink did not answer in time." },
    });

    await expect(applyRouterClientPaused(7, false, request)).rejects.toThrow(
      "Starlink rejected the device update: Starlink did not answer in time.",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
