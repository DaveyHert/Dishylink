import { describe, expect, it } from "vitest";
import { applyRouterConfigUpdate, AccountRequiredError } from "./routerConfigUpdate";
import type { CloudReply } from "./cloudHost";

const UPDATE = { kind: "bypass", enabled: false } as const;

function replying(reply: CloudReply) {
  return () => Promise.resolve(reply);
}

describe("applyRouterConfigUpdate", () => {
  it("resolves when the gateway accepted it", async () => {
    await expect(
      applyRouterConfigUpdate(UPDATE, replying({ status: 200, body: { ok: true } })),
    ).resolves.toBeUndefined();
  });

  it("does not call a timeout a refusal", async () => {
    // Undoing bypass runs over the network bypass just reconfigured, so this is
    // the failure the user is most likely to meet, and "rejected" would send
    // them looking for a refusal that never happened.
    const message = "Starlink did not answer the router change in time. Try again.";
    await expect(
      applyRouterConfigUpdate(
        UPDATE,
        replying({ status: 504, body: { error: "device_call_timeout", message } }),
      ),
    ).rejects.toThrow(message);
    await expect(
      applyRouterConfigUpdate(
        UPDATE,
        replying({ status: 504, body: { error: "device_call_timeout", message } }),
      ),
    ).rejects.not.toThrow(/rejected/);
  });

  it("asks for an account when none is connected", async () => {
    await expect(
      applyRouterConfigUpdate(UPDATE, replying({ status: 428, body: { error: "not_connected" } })),
    ).rejects.toBeInstanceOf(AccountRequiredError);
  });

  it("reports a failed call without claiming it was refused", async () => {
    await expect(
      applyRouterConfigUpdate(
        UPDATE,
        replying({ status: 502, body: { error: "device_call_failed", message: "socket hang up" } }),
      ),
    ).rejects.toThrow("Starlink couldn't apply the change: socket hang up");
  });

  it("falls back to the status when the body carries no message", async () => {
    await expect(
      applyRouterConfigUpdate(UPDATE, replying({ status: 503, body: {} })),
    ).rejects.toThrow("HTTP 503");
  });
});
