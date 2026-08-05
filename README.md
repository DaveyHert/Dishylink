# Dishylink

A local dashboard plus an always-on history recorder for a Starlink kit. It
talks to the dish and router directly over their LAN gRPC API — no cloud
required for any of the core dashboard, and nothing you record ever leaves
the machine. An optional, read-only "connect account" feature can pull your
own Starlink billing/usage data from `starlink.com` if you choose to sign in.

![status: prototype](https://img.shields.io/badge/status-prototype-blue)

## What it shows

- **Stat tiles** — live downlink/uplink, pop-ping latency, power draw (watts),
  60s ping-success rate, sky-obstruction fraction, each with a sparkline and an
  expandable detail panel.
- **Throughput chart** — down + up over 15m/1h/6h windows on the dashboard, and
  day/week/month from recorded history (not just what's in the current tab).
- **Latency chart** — bucketed _max_ so spikes survive downsampling; outages
  drawn as red bands.
- **Energy / power chart** — the dish's actual draw over time with kWh
  totals per day/week/month, honest about any recording gaps.
- **Sky obstruction map** — the dish's 123×123 SNR grid rendered as a polar
  sky dome; obstructed cells escalate through a status palette.
- **Obstruction time-lapse** — scrub back through hourly snapshots of the sky
  survey, with LIVE as the last stop.
- **Sky view** — a full-viewport scene of the dome, this dish, and the live
  satellite constellation overhead; click a satellite for its pass details.
- **Alignment dials** — rotation and tilt against the desired azimuth/elevation
  band, ported from the dish's own web app.
- **Data usage** — self-measured download/upload volume by day/week/month, plus
  **per-device usage** for the billing month from the router's own per-client
  counters: name your devices, see vendor and device type, last-seen times.
- **Network** — router radio temps, client list, per-client throughput, and
  the router's own event log.
- **Outage + thermal event log**, terminal panel — firmware, GPS, alignment,
  mesh routers, alerts.
- **Speed test**, **alerts** with severity and an in-app bell, light/dark/system
  instrument themes.
- **Cloud account tab** (optional, opt-in) — your Starlink plan, billing
  cycles, and authoritative monthly data usage, read-only.

## What it controls

Monitoring is only half of it — the settings sheet writes to the dish over the
same LAN API:

- **Snow melt** — automatic, always on, or off.
- **Sleep schedule** — power the dish down for a set number of hours each day.
- **Software updates** — pick the reboot window, or defer updates for 3 days.
- **Maintenance** — reboot the dish, reset the learned obstruction map, and
  stow/unstow motorized kits.
- **Router** — SSIDs and their bands, mesh node trust, firmware and country, and
  a router reboot.
- **Copy debug data** — diagnostics + status + config as JSON, for bug reports.

Custom DNS, bypass mode, and content filtering are deliberately _not_ exposed: a
bad write there can take the WiFi down until a physical reset.

## Three ways to run it

Dishylink ships as three independent products from one codebase — pick
whichever fits:

```bash
npm install

npm run dev             # web dev harness — requires being on the Starlink LAN
npm run dev:electron    # desktop app (Mac/Windows), packaged via electron-builder
npm run dev:extension   # browser extension (Chrome, Edge, Firefox, via WXT)
```

They don't talk to each other or share a runtime — each independently polls
the dish/router and records its own history. Packaging:

```bash
npm run pack:mac        # signed Mac build
npm run pack:win        # Windows build
npm run build:extension # Chromium extension bundle
npm run build:extension:firefox
npm run build:extension:edge
```

### Desktop app (Mac, Windows)

- Lives in the tray / menu bar and **keeps recording after its window is
  closed**; it quits only from the tray's Quit.
- **Live throughput readout** — ↓/↑ rates in the macOS menu bar, or a draggable
  always-on-top pill on Windows. Whichever surface, the open window feeds it
  when there is one and the recorder takes over when there isn't, so the dish is
  never polled twice.
- **Start at Login**, launching hidden, so collection covers the outages that
  happen while nobody is looking.
- Native OS notifications for alerts when the window isn't in front, throttled
  so a flapping link can't spam.
- Auto-updates, and remembers its window position across runs and displays.

### Browser extension (Chrome, Edge, Firefox)

- The toolbar icon opens the dashboard as a chromeless window (default) or an
  ordinary tab — never a cramped toolbar popup.
- **Toolbar badge** — the number of alerts firing right now, tinted by the worst
  one's severity, so it reads the same outside the app as the bell does inside.
- Collects on a 30s `chrome.alarms` tick that survives service-worker teardown,
  into IndexedDB, and shows honest coverage gaps for stretches the browser was
  closed. Always-on collection is the desktop app's job.
- Chrome 144+ — below that a Local Network Access bug makes the worker silently
  collect nothing.

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

Everything above is local-only by design: your telemetry, your history, your
storage, never transmitted.
