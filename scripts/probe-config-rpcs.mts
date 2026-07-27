// One-shot reads of the RPCs behind both Settings tabs, to tell a device that
// answers from one that errors — the tab's catch-all wording can't.
//   dish   dish_get_config (2011)  → the Starlink tab
//   router wifi_get_clients (3002) + wifi_get_config (3009) → the Router tab
// Run: npx tsx scripts/probe-config-rpcs.mts
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

async function probe(label: string, url: string, field: number, branch: string) {
  const request = new Uint8Array([...encodeVarint((field << 3) | 2), 0]);
  try {
    const bytes = await grpcWebUnaryCall(url, request, AbortSignal.timeout(5_000));
    const json = toJson(responseSchema, fromBinary(responseSchema, bytes), { registry }) as Record<
      string,
      unknown
    >;
    const reply = json[branch];
    console.log(
      `${label}: OK — keys: ${reply ? Object.keys(reply as object).join(", ") : "(empty branch)"}`,
    );
  } catch (error) {
    console.log(`${label}: FAILED — ${(error as Error).message}`);
  }
}

const DISH = "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
const ROUTER = "http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle";

await probe("dish   get_config (2011)      ", DISH, 2011, "dishGetConfig");
await probe("router wifi_get_clients (3002)", ROUTER, 3002, "wifiGetClients");
await probe("router wifi_get_config (3009) ", ROUTER, 3009, "wifiGetConfig");
