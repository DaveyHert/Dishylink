# Energy historian

A small always-on Node service that records the dish's power draw over time so
the dashboard can show **day / week / month** energy totals — data neither the
dish (≈15 min ring buffer) nor the browser tab (≤6 h, wiped on reload) retains.

## What it does

- Polls the dish's history ring buffer every 5 s, reusing the frontend's
  grpc-web transport (`src/lib/grpcWeb.ts`) and decoder (`src/lib/telemetry.ts`)
  so the two never drift.
- Folds new per-second power readings into per-minute energy buckets and appends
  each completed minute to `collector/data/energy.ndjson` (one JSON line per
  minute: `{ minute, wattSeconds, samples }`).
- Serves totals over HTTP on `:8088` — the dev server proxies `/api` to it.

## Honesty about gaps

Energy is integrated **only over minutes actually sampled**. If the historian is
down (sleep, restart, Wi‑Fi drop) those minutes simply have no data — the total
never invents "last known watts" across a gap. Every response includes a
`coverage` fraction, and the UI shows e.g. _"collected 82% of this period"_.

Short gaps (≤15 min) are backfilled losslessly on the next poll from the dish's
own ring buffer; longer gaps show as reduced coverage.

## Run it

Foreground (dies on terminal close / sleep):

```
npm run historian
```

Always-on (survives logout, relaunches after sleep/crash) via launchd:

```
cp collector/com.dishylink.historian.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dishylink.historian.plist
```

Stop / uninstall:

```
launchctl unload ~/Library/LaunchAgents/com.dishylink.historian.plist
```

The plist paths are absolute for this machine — update them if the repo moves or
the Node version changes.

## API

- `GET /api/energy?range=day|week|month` →
  `{ range, totalKWh, coverage: { sampledSeconds, expectedSeconds, fraction }, buckets: [{ t, kWh, sampledSeconds }] }`
  Ranges are aligned to **local midnight** (system timezone). `day` returns
  hourly buckets; `week`/`month` return daily buckets.
- `GET /api/health` → `{ ok, lastWrittenMinute }`
