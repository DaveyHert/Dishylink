# DishyLink

A local dashboard plus an always-on history recorder for a Starlink kit. It
talks to the dish and router directly over their LAN gRPC API — no cloud
required for any of the core dashboard, and nothing you record ever leaves
the machine. An optional, read-only "connect account" feature can pull your
own Starlink billing/usage data from `starlink.com` if you choose to sign in.

![status: prototype](https://img.shields.io/badge/status-prototype-blue)

## What it shows

- **Stat tiles** — live downlink/uplink, pop-ping latency, power draw (watts),
  60s ping-drop rate, sky-obstruction fraction, each with a sparkline.
- **Throughput chart** — down + up over 15m/1h/6h/day/week/month windows,
  backed by recorded history (not just what's in the current tab).
- **Latency chart** — bucketed _max_ so spikes survive downsampling; outages
  drawn as red bands.
- **Energy / power chart** — the dish's actual draw over time with kWh
  totals per day/week/month, honest about any recording gaps.
- **Sky obstruction map** — the dish's 123×123 SNR grid rendered as a polar
  sky dome; obstructed cells escalate through a status palette.
- **Network** — router radio temps, client list, per-client throughput, and
  the router's own event log.
- **Outage + thermal event log**, terminal panel — firmware, GPS, alignment,
  mesh routers, alerts.
- **Speed test**, in-app **notifications**, light/dark instrument themes.
- **Cloud account tab** (optional, opt-in) — your Starlink plan, billing
  cycles, and authoritative monthly data usage, read-only.

## Three ways to run it

DishyLink ships as three independent products from one codebase — pick
whichever fits:

```bash
npm install

npm run dev             # web dev harness — requires being on the Starlink LAN
npm run dev:electron    # desktop app (Mac/Windows), packaged via electron-builder
npm run dev:extension   # browser extension (Chromium + Firefox, via WXT)
```

They don't talk to each other or share a runtime — each independently polls
the dish/router and records its own history. Packaging:

```bash
npm run pack:mac        # signed Mac build
npm run pack:win        # Windows build
npm run build:extension # Chromium extension bundle
npm run build:extension:firefox
```

Dev workflow:

```bash
npm test                # vitest
npm run typecheck       # tsc -b
npm run lint            # eslint
```

Diagnostics:

```bash
node scripts/debug-decode.mjs <captured-body.bin>   # decode a captured response
node scripts/debug-browser.mjs                      # probe fetch path in headless Chrome
node scripts/screenshot.mjs <output-dir>             # light/dark/tooltip screenshots
```

## How it talks to the dish and router

The dish serves its API at `192.168.100.1` on two ports; the router answers
a matching API on its own LAN address:

| Port | Protocol                | Notes                               |
| ---- | ----------------------- | ------------------------------------ |
| 9200 | native gRPC (HTTP/2)    | used by `grpcurl`, has reflection    |
| 9201 | **grpc-web** (HTTP/1.1) | what this app uses from the browser  |

Two quirks discovered while building (both handled by the Vite proxy in dev,
and by the host's own transport in Electron/the extension):

1. **CORS allowlist** — port 9201 only answers CORS preflights for the dish's
   own origin, so a third-party web page cannot call it cross-origin.
2. **Referer guard** — requests carrying an unrecognized `Referer` header get
   an empty 200 back; the transport strips `Referer`/`Origin` before forwarding.

Protobuf schema is **not guessed**: `schema/dish.protoset` was dumped from the
dish's own gRPC reflection service and is decoded at runtime with
`@bufbuild/protobuf` (`core/dishClient.ts`). To refresh the schema after a
firmware update:

```bash
grpcurl -plaintext -protoset-out schema/dish.protoset \
  192.168.100.1:9200 describe SpaceX.API.Device.Device
cp schema/dish.protoset public/dish.protoset
```

The dish's history ring buffer (900 samples @ 1 Hz) is unrolled via its
absolute sample counter (`core/telemetry.ts`); note it reports `outages[]`
timestamps in the **GPS epoch** while `eventLog` uses Unix — the converter
accounts for the 18 leap seconds. See `LOCAL-API.md` for the full set of
measured behaviours, quirks, and dead-end fields on this firmware.

## Recorded history

The dish and router only hold a few minutes to a few hours locally. An
always-on **history recorder** (`collector/`, the "historian") polls
continuously and writes append-only local records so day/week/month views
have real data behind them — never anything invented across a gap; every
range reports what fraction of it was actually sampled. See
`collector/README.md` for how it runs and its on-disk format.

## Roadmap

Everything above is local-only by design: your telemetry, your history, your
storage, never transmitted. The one planned exception is an opt-in,
anonymous **congestion map** — collective by nature, so it needs a small
shared service — which is scoped to anonymous writes and public reads only,
and is not yet built. Licensing/store packaging for the desktop app and
extension are also still ahead.
