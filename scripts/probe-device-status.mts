// One LAN get_status to the router (default) or dish (`dish` arg) — identical
// to the poll already running — to check which ping-drop fields the anonymous
// LAN reply carries and which alert booleans are currently set.
// Run: npx tsx scripts/probe-device-status.mts [dish|router]
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall } from "../core/grpcWeb.ts";

const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync("public/dish.protoset")),
);
const responseSchema = registry.getMessage("SpaceX.API.Device.Response")!;

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return bytes;
}

const target = process.argv[2] === "dish" ? "http://192.168.100.1:9201" : "http://192.168.1.1:9001";
const request = new Uint8Array([...encodeVarint((1004 << 3) | 2), 0]);
const bytes = await grpcWebUnaryCall(`${target}/SpaceX.API.Device.Device/Handle`, request);
const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as {
  wifiGetStatus?: Record<string, unknown>;
  dishGetStatus?: Record<string, unknown>;
};
const status = json.wifiGetStatus ?? json.dishGetStatus ?? {};
const pingFields = Object.fromEntries(Object.entries(status).filter(([key]) => /ping/i.test(key)));
console.log("ping-related fields:", JSON.stringify(pingFields, null, 2));
console.log("alerts:", JSON.stringify(status.alerts ?? {}));
console.log("all top-level keys:", Object.keys(status).join(", "));
