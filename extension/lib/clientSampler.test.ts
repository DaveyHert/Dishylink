import { describe, expect, it } from "vitest";
import { ThroughputTracker } from "@core/throughputTracker";
import type { WifiClientJson } from "@core/dishClient";
import { buildSamples } from "./clientSampler";

/** A roster entry with byte counters and a 15s fallback rate. */
function client(
  over: Partial<WifiClientJson> & { clientId: number; macAddress: string },
): WifiClientJson {
  return {
    rxStats: { bytes: "0", throughputMbpsLast15sAvg: 0 },
    txStats: { bytes: "0", throughputMbpsLast15sAvg: 0 },
    ...over,
  };
}

describe("buildSamples", () => {
  it("keys each sample by usageKey (clientId), one per live client", () => {
    const tracker = new ThroughputTracker();
    const clients = [
      client({ clientId: 42, macAddress: "aa" }),
      client({ clientId: 7, macAddress: "bb" }),
    ];
    const samples = buildSamples(clients, tracker, 1_000);
    expect(samples.map((s) => s.key)).toEqual(["42", "7"]);
  });

  it("measures the rate from the counter edge across two polls", () => {
    const tracker = new ThroughputTracker();
    const at = (rxBytes: string) =>
      client({
        clientId: 42,
        macAddress: "aa",
        rxStats: { bytes: rxBytes, throughputMbpsLast15sAvg: 0 },
      });
    // First poll seeds; nothing to subtract yet, so it reports the (zero) fallback.
    expect(buildSamples([at("0")], tracker, 0)[0]!.downMbps).toBe(0);
    // One refresh period later, 1_005_000 bytes moved → 8 Mbps down.
    const second = buildSamples([at("1005000")], tracker, 1_005);
    expect(second[0]!.downMbps).toBeCloseTo(8, 5);
  });

  it("drops a device that is no longer a CLIENT / has no MAC", () => {
    const tracker = new ThroughputTracker();
    const clients = [
      client({ clientId: 42, macAddress: "aa" }),
      client({ clientId: 9, macAddress: "cc", role: "ROUTER" }),
    ];
    expect(buildSamples(clients, tracker, 1_000).map((s) => s.key)).toEqual(["42"]);
  });
});
