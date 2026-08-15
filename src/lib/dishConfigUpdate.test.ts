import { describe, expect, test, vi } from "vitest";
import { AccountRequiredError, applyDishConfigUpdate } from "./dishConfigUpdate";

describe("applyDishConfigUpdate", () => {
  test("given: a successful write, should: post the changes to /cloud/dish-config", async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });

    await applyDishConfigUpdate({ swupdateRebootHour: 15 }, request);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      path: "/cloud/dish-config",
      method: "POST",
      body: { swupdateRebootHour: 15 },
    });
  });

  test("given: Starlink rejects the change, should: surface its message", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 504,
      body: { message: "Starlink did not answer in time." },
    });

    await expect(applyDishConfigUpdate({ powerSaveMode: true }, request)).rejects.toThrow(
      "Starlink rejected the config change: Starlink did not answer in time.",
    );
  });

  test("given: 428, should: surface a sign-in prompt rather than a rejection", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 428,
      body: { error: "not_connected", message: "An authorized account is required." },
    });

    await expect(applyDishConfigUpdate({ powerSaveMode: true }, request)).rejects.toBeInstanceOf(
      AccountRequiredError,
    );
  });
});
