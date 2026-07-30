// The alert definitions have to match what the devices actually send.
//
// Every entry is matched against the live payload by key (`alerts[key] === true`),
// so a key that does not exist on the wire renders as permanently healthy — a
// green tick that can never fire. Nothing catches that by eye, because a working
// dish reports every alert false. These tests pin the definitions against the
// protoset we decode with, so a firmware rename or a new alert fails here rather
// than silently going missing from the panel.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFileRegistry, fromBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  DISH_ALERTS,
  ROUTER_ALERTS,
  resolveAlerts,
  sortBySeverity,
  type AlertSpec,
} from "./alertDefinitions";

const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync(resolve("public/dish.protoset"))),
);

/** The JSON names proto3 emits — exactly the keys our code reads at runtime. */
function wireKeys(typeName: string): string[] {
  const message = registry.getMessage(typeName);
  if (!message) throw new Error(`${typeName} missing from protoset`);
  return message.fields.map((field) => field.jsonName);
}

describe.each([
  ["dish", "SpaceX.API.Device.DishAlerts", DISH_ALERTS],
  ["router", "SpaceX.API.Device.WifiAlerts", ROUTER_ALERTS],
] as const)("%s alert definitions", (_label, typeName, definitions: AlertSpec[]) => {
  const keys = wireKeys(typeName);

  it("has no key the device never sends (would render permanently healthy)", () => {
    expect(definitions.map((spec) => spec.key).filter((key) => !keys.includes(key))).toEqual([]);
  });

  it("covers every alert the device can send", () => {
    const covered = definitions.map((spec) => spec.key);
    expect(keys.filter((key) => !covered.includes(key))).toEqual([]);
  });

  it("gives every alert both a clear and a firing phrasing", () => {
    for (const spec of definitions) {
      expect(spec.ok, `${spec.key} clear wording`).toBeTruthy();
      expect(spec.firing, `${spec.key} firing wording`).toBeTruthy();
      expect(spec.ok).not.toBe(spec.firing);
    }
  });

  it("has unique keys", () => {
    const keysInDefinitions = definitions.map((spec) => spec.key);
    expect(new Set(keysInDefinitions).size).toBe(keysInDefinitions.length);
  });
});

describe("resolveAlerts", () => {
  it("treats an absent key as clear — proto3 omits false", () => {
    const resolved = resolveAlerts(DISH_ALERTS, {}, "dish");
    expect(resolved.every((alert) => !alert.active)).toBe(true);
    expect(resolved).toHaveLength(DISH_ALERTS.length);
  });

  it("marks only the set flag active", () => {
    const resolved = resolveAlerts(DISH_ALERTS, { dishWaterDetected: true }, "dish");
    expect(resolved.filter((alert) => alert.active).map((alert) => alert.key)).toEqual([
      "dishWaterDetected",
    ]);
  });

  it("does not treat a false flag as active", () => {
    const resolved = resolveAlerts(DISH_ALERTS, { dishWaterDetected: false }, "dish");
    expect(resolved.some((alert) => alert.active)).toBe(false);
  });

  it("tags the source, so overlapping keys stay distinct", () => {
    const dish = resolveAlerts(DISH_ALERTS, { thermalThrottle: true }, "dish");
    const router = resolveAlerts(ROUTER_ALERTS, { thermalThrottle: true }, "router");
    expect(dish.find((a) => a.key === "thermalThrottle")?.source).toBe("dish");
    expect(router.find((a) => a.key === "thermalThrottle")?.source).toBe("router");
  });
});

describe("sortBySeverity", () => {
  it("puts the worst first", () => {
    const states = resolveAlerts(DISH_ALERTS, {}, "dish");
    const severities = sortBySeverity(states).map((alert) => alert.severity);
    const rank = { critical: 0, warning: 1, advisory: 2 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
  });
});
