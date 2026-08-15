import { describe, expect, test, vi } from "vitest";
import { applyRouterClientPaused, clientPauseControlAvailable } from "./routerPause";

const available = {
  clientId: 7 as number | undefined,
  isThisDevice: false,
  viewerIdentified: true,
  cloudConnected: true,
  hostSupportsPause: true,
};

describe("clientPauseControlAvailable", () => {
  test("given: no Starlink session, should: hide the device control", () => {
    expect(clientPauseControlAvailable({ ...available, cloudConnected: false })).toBe(false);
  });

  test("given: a host cannot identify its own client, should: hide the device control", () => {
    expect(clientPauseControlAvailable({ ...available, hostSupportsPause: false })).toBe(false);
  });

  test("given: an unresolved viewer identity, should: hide the control on every device", () => {
    expect(clientPauseControlAvailable({ ...available, viewerIdentified: false })).toBe(false);
  });

  test("given: a connected account, should: show only for another identified device", () => {
    expect(clientPauseControlAvailable(available)).toBe(true);
    expect(clientPauseControlAvailable({ ...available, isThisDevice: true })).toBe(false);
    expect(clientPauseControlAvailable({ ...available, clientId: undefined })).toBe(false);
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
