import { describe, expect, it } from "vitest";
import { pauseSettleTimeoutMs } from "./networkFormat";
import { CLIENTS_POLL_MS, CLOUD_CLIENTS_POLL_MS } from "../../hooks/useRouterNetwork";

describe("pauseSettleTimeoutMs", () => {
  it("outlasts two reads of the roster that has to confirm the write", () => {
    expect(pauseSettleTimeoutMs(CLOUD_CLIENTS_POLL_MS)).toBeGreaterThan(CLOUD_CLIENTS_POLL_MS * 2);
  });

  it("holds the floor where the roster is fast enough not to need it", () => {
    expect(pauseSettleTimeoutMs(CLIENTS_POLL_MS)).toBe(20_000);
  });
});
