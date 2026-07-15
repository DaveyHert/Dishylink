# Dishboard

Live telemetry dashboard for a Starlink dish, rendered in the browser straight
from the terminal's local gRPC API. No cloud, no account — if you're on the
Starlink network, `npm run dev` and you have instruments.

![status: prototype](https://img.shields.io/badge/status-prototype-blue)

## What it shows

- **Stat tiles** — live downlink/uplink, pop-ping latency, power draw (watts),
  60s ping-drop rate, sky-obstruction fraction, each with a 90s sparkline.
- **Throughput chart** — down + up, 15m/1h/6h windows (the dish only keeps
  15 minutes; Dishboard accumulates up to 6 hours while the tab is open).
- **Latency chart** — bucketed *max* so spikes survive downsampling; outages
  drawn as red bands.
- **Power chart** — the dish's actual draw over time with a kWh/day estimate.
- **Sky obstruction map** — the dish's 123×123 SNR grid rendered as a polar
  sky dome; obstructed cells escalate through a status palette.
- **Outage log + terminal panel** — event history, firmware, GPS, alignment,
  mesh routers, alerts.

Crosshair tooltips on every chart. Light (default) and dark instrument themes.

## How it talks to the dish

The dish serves its API at `192.168.100.1` on two ports:

| Port | Protocol | Notes |
|------|----------|-------|
| 9200 | native gRPC (HTTP/2) | used by `grpcurl`, has reflection |
| 9201 | **grpc-web** (HTTP/1.1) | what this app uses from the browser |

Two quirks discovered while building (both handled by the Vite proxy):

1. **CORS allowlist** — port 9201 only answers CORS preflights for the dish's
   own origin, so a third-party web page cannot call it cross-origin. The dev
   server proxies `/dishy/*` → `192.168.100.1:9201` same-origin instead.
2. **Referer guard** — requests carrying an unrecognized `Referer` header get
   an empty 200 back. The proxy strips `Referer`/`Origin` before forwarding.

Protobuf schema is **not guessed**: `schema/dish.protoset` was dumped from the
dish's own gRPC reflection service and is decoded at runtime with
`@bufbuild/protobuf` (`src/lib/dishClient.ts`). Requests are tiny (an empty
oneof selection) and are hand-encoded. To refresh the schema after a firmware
update:

```bash
grpcurl -plaintext -protoset-out schema/dish.protoset \
  192.168.100.1:9200 describe SpaceX.API.Device.Device
cp schema/dish.protoset public/dish.protoset
```

The history ring buffer (900 samples @ 1 Hz) is unrolled via its absolute
sample counter (`src/lib/telemetry.ts`); note the dish reports `outages[]`
timestamps in the **GPS epoch** while `eventLog` uses Unix — the converter
accounts for the 18 leap seconds.

## Run it

```bash
npm install
npm run dev        # requires being on the Starlink LAN
```

Diagnostics:

```bash
node scripts/debug-decode.mjs <captured-body.bin>   # decode a captured response
node scripts/debug-browser.mjs                      # probe fetch path in headless Chrome
node scripts/screenshot.mjs <output-dir>            # light/dark/tooltip screenshots
```
