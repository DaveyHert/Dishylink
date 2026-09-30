// Runs in the node project, which has no DOM, so storage and the desktop bridge
// are stubs: what is under test is what the formatters print for each unit and
// how the store follows the main process, not the browser's localStorage.

import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { readThroughputUnit, setThroughputUnit, subscribeToThroughputUnit } =
  await import("./throughputUnit");
const { formatThroughputIn, formatThroughputLabel, formatThroughputTick } =
  await import("./format");

beforeEach(() => store.clear());

describe("formatThroughputIn", () => {
  test("bits keep the dish's own unit", () => {
    expect(formatThroughputIn(268_000, "bits")).toEqual({ value: "268", unit: "kbps" });
    expect(formatThroughputIn(1_500_000, "bits")).toEqual({ value: "1.5", unit: "Mbps" });
    expect(formatThroughputIn(2_000_000_000, "bits")).toEqual({ value: "2.00", unit: "Gbps" });
  });

  test("bytes divide by 8 before choosing the scale", () => {
    // 1.5 Mbps is 187.5 KB/s — under the M threshold once divided.
    expect(formatThroughputIn(1_500_000, "bytes")).toEqual({ value: "188", unit: "KB/s" });
    expect(formatThroughputIn(8_000_000, "bytes")).toEqual({ value: "1.0", unit: "MB/s" });
    expect(formatThroughputIn(200_000_000, "bytes")).toEqual({ value: "25.0", unit: "MB/s" });
    expect(formatThroughputIn(16_000_000_000, "bytes")).toEqual({ value: "2.00", unit: "GB/s" });
  });
});

describe("the chosen unit", () => {
  test("a fresh install reads in bits", () => {
    expect(readThroughputUnit()).toBe("bits");
    expect(formatThroughputLabel(1_500_000)).toBe("1.5 Mbps");
  });

  test("anything but an exact 'bytes' on disk reads as bits", () => {
    store.set("dishylink-throughput-unit", "BYTES");
    expect(readThroughputUnit()).toBe("bits");
  });

  test("the callback formatters follow the choice", () => {
    setThroughputUnit("bytes");
    expect(formatThroughputLabel(200_000_000)).toBe("25.0 MB/s");
    expect(formatThroughputTick(200_000_000)).toBe("25M");
    // A chart tick formatter passes (value, index); the index must not matter.
    const tick = formatThroughputTick as (value: number, index: number) => string;
    expect(tick(200_000_000, 3)).toBe("25M");
  });

  test("subscribers hear a change, and not a repeat of the same unit", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThroughputUnit(listener);
    setThroughputUnit("bytes");
    setThroughputUnit("bytes");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
