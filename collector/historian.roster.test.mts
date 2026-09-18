// Which devices the recorder treats as existing, driven through a real client
// poll against a stubbed router.
//
// Its own data directory and its own file: the module claims a directory and
// registers its timers when it is evaluated, and HISTORIAN_DATA_DIR is
// process-wide, so a file that drives the recorder cannot share one with
// another that does. Fake timers installed before the import keep every
// interval start() registers from firing on its own.

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const DATA_DIR = mkdtempSync(join(tmpdir(), "historian-roster-"));
const NOW = Date.now();
/** Answers with byte counters, as any Wi-Fi client does. */
const COUNTED = 111;
/** Answers with empty stats blocks and no counters, as every wired client does.
 *  Nothing is ever folded into the odometer for it, so it exists only here. */
const UNCOUNTED = 555;

const registry = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, readFileSync(resolve("public/dish.protoset"))),
);
const responseSchema = registry.getMessage("SpaceX.API.Device.Response")!;

const MESSAGE_FRAME = 0x00;
const TRAILERS_FRAME = 0x80;

function frame(flag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

/** Flipped to unplug the wired device, which then leaves the roster the way any
 *  absent device does. */
let wiredPluggedIn = true;

function clientsReply(): Uint8Array {
  const wired = [
    {
      macAddress: "aa:bb:cc:00:00:02",
      clientId: UNCOUNTED,
      givenName: "Uncounted",
      iface: "ETH",
      rxStats: {},
      txStats: {},
    },
  ];
  const message = fromJson(
    responseSchema,
    {
      wifiGetClients: {
        clients: [
          {
            macAddress: "aa:bb:cc:00:00:01",
            clientId: COUNTED,
            givenName: "Counted",
            iface: "RF_5GHZ",
            rxStats: { bytes: "5000", throughputMbpsLast15sAvg: 1 },
            txStats: { bytes: "2000", throughputMbpsLast15sAvg: 1 },
            rxStatsValid: true,
            txStatsValid: true,
          },
          ...(wiredPluggedIn ? wired : []),
        ],
      },
    },
    { registry },
  );
  const body = toBinary(responseSchema, message);
  const trailers = new TextEncoder().encode("grpc-status:0\r\n");
  const messageFrame = frame(MESSAGE_FRAME, body);
  const trailerFrame = frame(TRAILERS_FRAME, trailers);
  const out = new Uint8Array(messageFrame.length + trailerFrame.length);
  out.set(messageFrame);
  out.set(trailerFrame, messageFrame.length);
  return out;
}

/** The field number a request asks for, read back off the grpc-web frame it is
 *  sent as: five bytes of framing, then the varint tag whose top bits are it. */
function requestedField(body: Uint8Array): number {
  let shift = 0;
  let tag = 0;
  for (let index = 5; index < body.length; index++) {
    tag |= (body[index] & 0x7f) << shift;
    if ((body[index] & 0x80) === 0) break;
    shift += 7;
  }
  return tag >>> 3;
}

const WIFI_GET_CLIENTS_FIELD = 3002;

// Only the roster call is answered. Everything else fails the way an unreachable
// dish already does, which every poll here is written to carry.
vi.stubGlobal("fetch", async (_url: string, init: { body: Uint8Array }) => {
  if (requestedField(init.body) !== WIFI_GET_CLIENTS_FIELD)
    return new Response(null, { headers: { "grpc-status": "14", "grpc-message": "unavailable" } });
  return new Response(clientsReply() as unknown as BodyInit, {
    headers: { "content-type": "application/grpc-web+proto" },
  });
});

/** One rule per device, written before the import because the store reads its
 *  file as the module is evaluated. */
writeFileSync(
  join(DATA_DIR, "meters.json"),
  JSON.stringify({
    version: 2,
    rules: [COUNTED, UNCOUNTED].map((clientId) => ({
      clientKey: String(clientId),
      allocationBytes: 10_000_000_000,
      autoPause: false,
      cycle: { kind: "daily" },
      anchorRx: 0,
      anchorTx: 0,
      observedRx: 0,
      observedTx: 0,
      periodStartMs: NOW - 1_000,
      periodEndMs: NOW + 86_400_000,
      updatedMs: NOW - 1_000,
    })),
    pauses: [],
  }),
);

process.env.HISTORIAN_DATA_DIR = DATA_DIR;
process.env.HISTORIAN_EMBED = "1";
// Pins the roster call to one address so it never walks the real discovery list.
process.env.ROUTER_URL = "http://127.0.0.1:9001/x";

vi.useFakeTimers();
const historian = await import("./historian.mts");

function rules(): { clientKey: string }[] {
  return JSON.parse(readFileSync(join(DATA_DIR, "meters.json"), "utf8")).rules;
}

describe("what the recorder's reconciliation does to a rule", () => {
  it("keeps a rule on a device the router lists but nothing has been counted for", async () => {
    historian.start();
    // Let the poll that start() kicked settle, and the meters run behind it.
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(rules().length).toBeGreaterThan(0));

    const keys = rules().map((rule) => rule.clientKey);
    expect(keys).toContain(String(COUNTED));
    // The one this is really about: off the odometer alone it is absent, and the
    // rule on it used to be dropped and written away on the first poll.
    expect(keys).toContain(String(UNCOUNTED));
  });

  // Runs on the recorder the case above started, so the rule under test is one
  // that has already survived a poll that listed the device.
  it("keeps it after the device is unplugged, poll after poll", async () => {
    wiredPluggedIn = false;
    // Several polls, because the drop this guards against was written to disk on
    // whichever poll first missed the device.
    await vi.advanceTimersByTimeAsync(1_000);

    const keys = rules().map((rule) => rule.clientKey);
    expect(keys).toContain(String(UNCOUNTED));
    expect(keys).toContain(String(COUNTED));
  });
});
