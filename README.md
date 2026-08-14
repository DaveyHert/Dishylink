# <img src="docs/logo.svg" alt="" width="34" height="34" align="top"> Dishylink

[![Downloads](https://img.shields.io/github/downloads/DaveyHert/dishylink/total.svg)](https://github.com/DaveyHert/dishylink/releases)
[![macOS](https://img.shields.io/badge/macOS-12.0+-black.svg)](https://github.com/DaveyHert/dishylink/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10+-0078D4.svg)](https://github.com/DaveyHert/dishylink/releases/latest)
[![Browsers](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Firefox-extension-FF6F00.svg)](#browser-extension-chrome-edge-firefox)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![X](https://img.shields.io/badge/X-%23000000.svg?style=flat&logo=X&logoColor=white)](https://x.com/daveyhert)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%23FFDD00.svg?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/daveyhert)

An open-source Starlink desktop app for macOS, Windows and browsers to monitor
the performance and health of your Starlink.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="landing/src/assets/shots/dashboard-dark.png">
  <img alt="The Dishylink dashboard: download, upload, latency, power draw, ping success and sky-obstruction tiles above live throughput, latency and power charts, with the 3D obstruction dome and an events and outages log alongside." src="landing/src/assets/shots/dashboard-light.png">
</picture>

It reads your dish and router directly over your local network, so it keeps
working during an outage — which is exactly when you want to see what happened.
No account, no cloud, no telemetry: everything it records is written to your own
machine and stays there. Connecting a Starlink account is optional. It adds
your plan and billing figures and enables supported router controls such as
pausing connected devices. Your session remains stored locally and is sent
only to Starlink.

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
  cycles, and authoritative monthly data usage, plus authenticated controls
  supported by the connected router.

## What it controls

Monitoring is only half of it. Most settings write to the dish or router over
the same LAN API; controls that current firmware rejects locally are identified
below as requiring an optional Starlink account connection:

- **Snow melt** — automatic, always on, or off.
- **Sleep schedule** — power the dish down for a set number of hours each day.
- **Software updates** — pick the reboot window, or defer updates for 3 days.
- **Maintenance** — reboot the dish, reset the learned obstruction map, and
  stow/unstow motorized kits.
- **Router** — SSIDs and their bands, mesh node trust, firmware and country, and
  a router reboot.
- **Connected devices** — pause or unpause another device while it is connected.
  Available in the desktop app and web development harness, this control requires
  an optional Starlink account sign-in: Dishylink reads the router configuration
  locally, prepares the smallest accepted client update on the trusted host, and
  sends it only to Starlink's authenticated device endpoint. The device running
  Dishylink cannot pause itself. The browser extension does not expose this control
  because ordinary desktop extensions cannot reliably read the host computer's LAN
  IP or MAC address. Although the extension can send the update, it cannot prove
  which router client is itself and therefore cannot safely prevent self-pausing.
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

Install it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/dishylink/pljgamnkfokhbchiiommnblkjffffnna)
or [Firefox Add-ons](https://addons.mozilla.org/addon/dishylink/).

- The toolbar icon opens the dashboard as a chromeless window (default) or an
  ordinary tab — never a cramped toolbar popup.
- **Toolbar badge** — the number of alerts firing right now, tinted by the worst
  one's severity, so it reads the same outside the app as the bell does inside.
- **Recording** — its own history store in IndexedDB, filled by a 30s
  `chrome.alarms` tick that survives service-worker teardown, with honest
  coverage gaps for stretches when the browser was closed.
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
| ---- | ----------------------- | ----------------------------------- |
| 9200 | native gRPC (HTTP/2)    | used by `grpcurl`, has reflection   |
| 9201 | **grpc-web** (HTTP/1.1) | what this app uses from the browser |

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

## License

MIT. See [LICENSE](LICENSE).

Dishylink is an unofficial, independent project with no affiliation to SpaceX or
Starlink. Starlink is a trademark of Space Exploration Technologies Corp.
