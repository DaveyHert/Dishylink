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

const { handleCloudRequest } = await import("./cloudHandler");

describe("handleCloudRequest /cloud/device", () => {
  it("refuses a pause without reaching the cloud handler", async () => {
    const reply = await handleCloudRequest({
      path: "/cloud/device",
      method: "POST",
      body: { kind: "pause", clientId: 42, paused: true },
    });

    expect(reply).toEqual({ status: 501, body: { error: "unsupported_on_extension" } });
    expect(updateClient).not.toHaveBeenCalled();
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
