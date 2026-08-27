import { describe, expect, it, vi } from "vitest";
import type { CloudResult } from "../../cloud/starlinkCloudHandler";

// createCloudHandler is real elsewhere (cloud/starlinkCloudHandler.test.ts); here we
// stub it so these tests exercise only handleCloudRequest's own routing — whether a
// device update reaches updateClient at all, not what updateClient then does with it.
const updateClient = vi.fn<(update: unknown) => Promise<CloudResult>>();
const updateDishConfig = vi.fn<(changes: unknown) => Promise<CloudResult>>();
vi.mock("../../cloud/starlinkCloudHandler", () => ({
  createCloudHandler: () => ({
    handle: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    updateClient,
    updateDishConfig,
  }),
}));

const loadSelfDeviceClientId = vi.fn<() => Promise<number | null>>();
vi.mock("./selfDevice", () => ({ loadSelfDeviceClientId: () => loadSelfDeviceClientId() }));

const { handleCloudRequest } = await import("./cloudHandler");

const pause = (clientId: number) => ({
  path: "/cloud/device",
  method: "POST",
  body: { kind: "pause", clientId, paused: true },
});

describe("handleCloudRequest /cloud/device", () => {
  it("refuses a pause while no device has been named as this one", async () => {
    loadSelfDeviceClientId.mockResolvedValueOnce(null);

    const reply = await handleCloudRequest(pause(42));

    expect(reply).toMatchObject({ status: 409, body: { error: "self_device_unknown" } });
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("refuses a pause aimed at the named device, whatever the control shows", async () => {
    loadSelfDeviceClientId.mockResolvedValueOnce(42);

    const reply = await handleCloudRequest(pause(42));

    expect(reply).toMatchObject({ status: 409, body: { error: "self_pause_refused" } });
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("forwards a pause aimed at another device", async () => {
    loadSelfDeviceClientId.mockResolvedValueOnce(42);
    updateClient.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    const reply = await handleCloudRequest(pause(7));

    expect(updateClient).toHaveBeenCalledWith({ kind: "pause", clientId: 7, paused: true });
    expect(reply).toEqual({ status: 200, body: { ok: true } });
  });

  it("forwards a rename to the cloud handler and returns its reply", async () => {
    updateClient.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const update = { kind: "rename", clientId: 42, givenName: "Laptop" };

    const reply = await handleCloudRequest({ path: "/cloud/device", method: "POST", body: update });

    expect(updateClient).toHaveBeenCalledWith(update);
    expect(reply).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("handleCloudRequest /cloud/dish-config", () => {
  it("forwards the change to the cloud handler, unlike a pause", async () => {
    updateDishConfig.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const changes = { swupdateRebootHour: 15 };

    const reply = await handleCloudRequest({
      path: "/cloud/dish-config",
      method: "POST",
      body: changes,
    });

    expect(updateDishConfig).toHaveBeenCalledWith(changes);
    expect(reply).toEqual({ status: 200, body: { ok: true } });
  });
});
