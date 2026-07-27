// One-shot probe: which optional RPCs does this dish's firmware actually
// implement, and what do they return? Prints grpc status for failures.
// Run: npx tsx scripts/probe-rpcs.mts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall, GrpcWebError } from "../core/grpcWeb.ts";

const DISH_URL = "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync(resolve("public/dish.protoset"))),
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

const PROBES: Array<[string, number]> = [
  ["get_connections", 1023],
  ["get_persistent_stats", 1022],
  ["get_radio_stats", 1036],
  ["dish_get_context", 2003],
  ["get_diagnostics", 6000],
  ["get_speedtest_status", 1028],
  ["start_speedtest", 1027],
  ["get_ping", 1009],
  ["get_network_interfaces", 1015],
  ["dish_get_config", 2011],
];

for (const [name, field] of PROBES) {
  const request = new Uint8Array([...encodeVarint((field << 3) | 2), 0]);
  try {
    const bytes = await grpcWebUnaryCall(DISH_URL, request);
    const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry });
    const text = JSON.stringify(json);
    console.log(`\n=== ${name}: OK (${text.length} bytes) ===`);
    console.log(text.length > 2400 ? text.slice(0, 2400) + " …[truncated]" : text);
  } catch (error) {
    const status = error instanceof GrpcWebError ? ` grpc-status=${error.grpcStatus}` : "";
    console.log(`\n=== ${name}: FAILED${status} — ${(error as Error).message} ===`);
  }
}
