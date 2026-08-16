import { describe, expect, test, vi } from "vitest";
import {
  AccountRequiredError,
  applyRouterClientUpdate,
  clientPauseControlAvailable,
} from "./routerClientUpdate";

const available = {
  clientId: 7 as number | undefined,
  isThisDevice: false,
  viewerIdentified: true,
  cloudConnected: true,
};

describe("clientPauseControlAvailable", () => {
  test("given: no Starlink session, should: hide the device control", () => {
    expect(clientPauseControlAvailable({ ...available, cloudConnected: false })).toBe(false);
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

    await applyRouterClientUpdate({ kind: "pause", clientId: 7, paused: true }, request);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      path: "/cloud/device",
      method: "POST",
      body: { kind: "pause", clientId: 7, paused: true },
    });
  });

  test("given: Starlink rejects the update, should: surface its message", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 504,
      body: { message: "Starlink did not answer in time." },
    });

    await expect(
      applyRouterClientUpdate({ kind: "pause", clientId: 7, paused: false }, request),
    ).rejects.toThrow("Starlink rejected the device update: Starlink did not answer in time.");
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("applyRouterClientUpdate refused by the host", () => {
  test("given: 409, should: surface the refusal as its own, not as Starlink's", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 409,
      body: {
        error: "self_pause_refused",
        message: "This is the device you are using, so it cannot be paused from here.",
      },
    });

    await expect(
      applyRouterClientUpdate({ kind: "pause", clientId: 7, paused: true }, request),
    ).rejects.toThrow("This is the device you are using, so it cannot be paused from here.");
  });
});

describe("applyRouterClientUpdate without a session", () => {
  test("given: 428, should: surface a sign-in prompt rather than a rejection", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 428,
      body: { error: "not_connected", message: "An authorized account is required." },
    });

    // Nothing was sent, so reporting it as a Starlink rejection would be wrong.
    await expect(
      applyRouterClientUpdate({ kind: "pause", clientId: 7, paused: true }, request),
    ).rejects.toBeInstanceOf(AccountRequiredError);
  });
});
