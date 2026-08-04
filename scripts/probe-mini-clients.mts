// TEMPORARY diagnostic (Starlink Mini): the Mini is one integrated box, so the
// "router" RPCs may be served by the DISH endpoint as well as by 192.168.1.1:9001.
// If they are, a kit sitting behind another router that has taken 192.168.1.1 can
// still be read in full — 192.168.100.1 stays reachable through that NAT.
//
// Safe read-only RPCs only. NEVER add 1009 (get_ping) here; it reboots the router.
// Run: npx tsx scripts/probe-mini-clients.mts
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

const FIELDS = [
  ["wifi_get_clients", 3002, "wifiGetClients"],
  ["wifi_get_config", 3009, "wifiGetConfig"],
  ["wifi_get_status", 3005, "wifiGetStatus"],
  ["get_status", 1004, "dishGetStatus"],
] as const;

const TARGETS = [
  ["dish   9201", "http://192.168.100.1:9201"],
  ["router 9001", "http://192.168.1.1:9001"],
] as const;

for (const [label, origin] of TARGETS) {
  console.log(`\n===== ${label}  (${origin}) =====`);
  for (const [name, field, branch] of FIELDS) {
    const request = new Uint8Array([...encodeVarint((field << 3) | 2), 0]);
    try {
      const bytes = await grpcWebUnaryCall(
        `${origin}/SpaceX.API.Device.Device/Handle`,
        request,
        AbortSignal.timeout(5_000),
      );
      const json = toJson(responseSchema, fromBinary(responseSchema, bytes), {
        registry,
      }) as Record<string, unknown>;
      const reply = json[branch] as Record<string, unknown> | undefined;
      const keys = reply ? Object.keys(reply).join(", ") : "(empty branch)";
      // The Mini has no separate router box, so whether its dish still lists one
      // downstream decides whether "no router" is a safe reading of an empty map.
      if (name === "get_status" && reply) {
        console.log(
          `  ${" ".repeat(17)}     downstreamRouters: ${JSON.stringify(reply.downstreamRouters)}`,
        );
        console.log(
          `  ${" ".repeat(17)}     connectedRouters:  ${JSON.stringify(reply.connectedRouters)}`,
        );
      }
      const clients = (reply?.clients as unknown[] | undefined)?.length;
      console.log(
        `  ${name.padEnd(17)} OK  ${clients === undefined ? "" : `${clients} client(s)  `}keys: ${keys}`,
      );
    } catch (error) {
      console.log(`  ${name.padEnd(17)} FAIL ${(error as Error).message.slice(0, 90)}`);
    }
  }
}
