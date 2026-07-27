// One-shot probe: how deep is the router's per-client throughput ring buffer,
// and at what sample interval? Neither is in the schema — the response carries
// a `current` write counter and bare arrays, so depth is the array length and
// the interval only shows up as the counter's advance over wall-clock time.
//
// Run: npx tsx scripts/probe-client-history.mts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create, createFileRegistry, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { grpcWebUnaryCall, GrpcWebError } from "../core/grpcWeb.ts";

const ROUTER_URL =
  process.env.ROUTER_URL ?? "http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle";
const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync(resolve("public/dish.protoset"))),
);
const requestSchema = registry.getMessage("SpaceX.API.Device.Request")!;
const responseSchema = registry.getMessage("SpaceX.API.Device.Response")!;

const SPACING_MS = 20_000;

// The RPC selector is a oneof named `request`, so it must be set as
// {case, value} — passing the field name directly is silently dropped, and the
// router answers an empty Request with Unimplemented.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(caseName: string, value: Record<string, unknown> = {}): Promise<any> {
  const request = create(requestSchema, { request: { case: caseName, value } } as never);
  const bytes = await grpcWebUnaryCall(ROUTER_URL, toBinary(requestSchema, request));
  return toJson(responseSchema, fromBinary(responseSchema, bytes), { registry });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarize(label: string, history: any): void {
  const arrays = ["txThroughputMbps", "rxThroughputMbps", "rxRateMbps", "throughputLimited"];
  console.log(`  ${label}: current=${history.current ?? "(absent)"}`);
  for (const key of arrays) {
    const value = history[key];
    if (Array.isArray(value)) console.log(`    ${key}: length ${value.length}`);
  }
  if (history.rssi !== undefined) {
    // proto `bytes` arrives base64 in JSON; one signed byte per sample.
    const raw = typeof history.rssi === "string" ? Buffer.from(history.rssi, "base64") : null;
    console.log(`    rssi: ${raw ? `${raw.length} bytes` : typeof history.rssi}`);
  }
}

const clients = await call("wifiGetClients");
const list = clients.wifiGetClients?.clients ?? [];
console.log(`wifi_get_clients: ${list.length} client(s)`);

const target = list.find((client: { macAddress?: string }) => client.macAddress);
if (!target) {
  console.log("No client with a MAC address to probe. Is anything connected?");
  process.exit(0);
}
console.log(`Probing ${target.name ?? "(unnamed)"} — ${target.macAddress}\n`);

try {
  const first = await call("wifiGetClientHistory", { macAddress: target.macAddress });
  const firstHistory = first.wifiGetClientHistory ?? {};
  const firstAtMs = Date.now();
  console.log("=== first call ===");
  summarize("shape", firstHistory);

  console.log(`\nwaiting ${SPACING_MS / 1000}s to measure the counter's advance…`);
  await new Promise((resolve) => setTimeout(resolve, SPACING_MS));

  const second = await call("wifiGetClientHistory", { macAddress: target.macAddress });
  const secondHistory = second.wifiGetClientHistory ?? {};
  const elapsedMs = Date.now() - firstAtMs;
  console.log("\n=== second call ===");
  summarize("shape", secondHistory);

  const advance = Number(secondHistory.current ?? 0) - Number(firstHistory.current ?? 0);
  const depth = (secondHistory.rxThroughputMbps ?? []).length;
  console.log("\n=== VERDICT ===");
  console.log(`counter advanced ${advance} over ${(elapsedMs / 1000).toFixed(1)}s`);
  if (advance > 0) {
    const intervalSec = elapsedMs / 1000 / advance;
    console.log(`→ sample interval ≈ ${intervalSec.toFixed(2)}s`);
    if (depth > 0) {
      const spanSec = depth * intervalSec;
      console.log(
        `→ buffer depth ${depth} samples ≈ ${(spanSec / 60).toFixed(1)} minutes of history`,
      );
    }
  } else {
    console.log("→ counter did not advance: buffer may be idle-gated or updated on a longer cycle");
  }
} catch (error) {
  const status = error instanceof GrpcWebError ? ` grpc-status=${error.grpcStatus}` : "";
  console.log(`wifi_get_client_history FAILED${status} — ${(error as Error).message}`);
}
