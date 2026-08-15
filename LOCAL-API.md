# Starlink local API — measured behaviour

There is no official documentation for the dish's or router's local gRPC API.
`public/dish.protoset` is dumped from the device's own gRPC **reflection**
service, which gives field names and wire types and nothing else — no units,
no update rates, and **no indication of which fields the firmware actually
fills in**.

That last point is the expensive one. Reflection describes the _interface_; it
says nothing about the _implementation_. A field can be present, correctly
typed, and permanently empty.

Everything below was measured against live hardware, not read from a spec.

Hardware at time of measurement: `rev4_panda_prod2`, firmware `2026.07.06.mr81950`.
Re-measure after a firmware update before trusting any of it.

## Sample clocks — the floor on resolution

| Source                         | Rate                                                   | Depth                |
| ------------------------------ | ------------------------------------------------------ | -------------------- |
| `dish_get_history` ring buffer | **1.00 s/sample** (counter advanced 10 over 10.1s)     | 900 samples = 15 min |
| `dish_get_status`              | sub-second (49 distinct readings in 50 polls at 200ms) | instantaneous only   |
| `wifi_get_clients`             | instantaneous only — **no buffer**                     | —                    |

**Polling faster than the sample clock buys nothing.** For the dish this
matters less than it sounds: every `dish_get_history` call returns the whole
900-sample ring, so a 5s poll still captures every 1 Hz sample. Poll rate
there controls _freshness_ (how old the newest point is), not _resolution_.

For the router the opposite holds. There is no working buffer, so the poll
rate **is** the resolution — whatever isn't sampled is gone for good.

## Poll costs

| RPC                       | Payload             | Median RTT | Cost at 1 Hz |
| ------------------------- | ------------------- | ---------- | ------------ |
| `dish_get_history` (1007) | 18,128 B            | 66 ms      | 17.7 kB/s    |
| `dish_get_status` (1004)  | 523 B               | 86 ms      | 0.5 kB/s     |
| `wifi_get_clients` (3002) | 1,611 B (5 clients) | 7 ms       | 1.6 kB/s     |

`wifi_get_clients` at 1 Hz occupies the router ~0.7% of each second, 0
failures over 30 consecutive calls. One call covers every client — there is
no per-device fan-out.

## Fields that exist but are never populated

Present in the schema, always empty on this firmware. Do not build on these without re-probing first.

### `wifi_get_client_history` (3015) — entirely empty

The most convincing dead end in the API. It returns a ring buffer shaped exactly
like the dish's — `current` advancing at a genuine 1 Hz, 900-float arrays — and
**every sample is zero, on every client, always**.

Verified under 65 Mbps of sustained load, with one client the router itself
reported at 106.58 Mbps live:

```
Controller   live=   0.00 Mbps  maxRx=0.0000 maxTx=0.0000  nonZeroOfAll=0/1800
(unnamed)    live= 106.58 Mbps  maxRx=0.0000 maxTx=0.0000  nonZeroOfAll=0/1800
iPhone       live=   1.78 Mbps  maxRx=0.0000 maxTx=0.0000  nonZeroOfAll=0/1800
```

Its `rssi`, `throughput_limited` and `rx_rate_mbps` fields are absent entirely.

The counter ticking at 1 Hz makes this look alive on a shallow probe. It is
not. Re-check with `scripts/probe-client-history.mts`.

### Others

| RPC                    | Field                | Reality                                              |
| ---------------------- | -------------------- | ---------------------------------------------------- |
| `dish_get_status`      | `popPingDropRate`    | absent — history only                                |
| `dish_get_status`      | `powerIn`            | absent — history only                                |
| `get_radio_stats`      | `thermalStatus.temp` | absent; only `temp2` is filled                       |
| `TransceiverGetStatus` | all                  | `Unimplemented` — no numeric dish temperatures exist |

The `dish_get_status` gaps matter more than they look: building chart samples
from status alone silently zeroes `dropRate` and `powerW`, which flat-lines the
power chart **and disables outage detection**, since that fires only when every
recent sample shows total packet loss.

## Where the data actually comes from

| Series                            | Source                                   | Why                                    |
| --------------------------------- | ---------------------------------------- | -------------------------------------- |
| Dish throughput / latency / power | `dish_get_history` @ 1s                  | full 1 Hz ring; poll rate is freshness |
| Live stat tiles                   | `dish_get_status` @ 1s                   | sub-second, tiny payload               |
| Per-device throughput             | `wifi_get_clients` @ 1s → `ClientWindow` | only source; no buffer to fall back on |
| Per-device 6h view                | same → `ClientStore` (per-minute)        | aggregate tier                         |
| Router event log                  | `wifi_get_history` (1007 to the router)  | same `UXEvent` shape as the dish       |
| Wi-Fi radio temps                 | `get_radio_stats` (1036, router only)    | dish answers `Unimplemented`           |

## LAN writes are blocked

July 2026 firmware rejects **all** LAN write RPCs — rename, `set_config` —
with grpc status 7. The official app performs writes via Starlink's cloud,
not over the LAN. No local elevation path exists.

## Authenticated cloud router writes

Two things learned the hard way, both measured 2026-08-15:

1. **Key client writes on `clientId`, never `macAddress`.** This firmware masks
   the low three octets of every MAC it reports (`60:74:f4:XX:XX:XX`), so devices
   behind one vendor share an address. A MAC-keyed rename renamed four devices.
2. **The dish accepts writes on this path too** — `dishSetConfig` with the dish's
   `ut…` targetId, not just `wifiSetConfig` with `Router-…`. Confirmed by setting
   `swupdateRebootHour` and reading it back in the official app.

Pause and unpause were measured through Starlink's authenticated grpc-web
`SpaceX.API.Device.Device/Handle` endpoint. This is an unofficial, observed
interface rather than a published API and may change with Starlink firmware or
service updates. The behavior was verified on the same installation described
at the top of this document; record the router hardware and firmware from
**Copy debug data** when reporting or re-testing it.

The accepted request uses `wifiSetConfig.wifiConfig.clientConfigs` with
`applyClientConfigs: true`. A permanently paused client has a
`weeklyBlockSchedules` entry whose `groupId` is `_permanent` and whose single
range covers the full week (`0` through `10080` minutes). Unpausing removes
only that entry so unrelated schedules remain intact.

This is a whole-list update, not a single-client patch. Dishylink therefore
reads the current router configuration over the LAN immediately before each
write, preserves every client and unrelated schedule, changes only the selected
client, and serializes mutations so concurrent writes cannot overwrite one
another. The encoded request is built by the trusted host; renderer-provided
protobuf is never accepted.

The write requires a current Starlink account session and is available only for
a device present in the router's live client list. Dishylink does not expose the
control for the device it is running on, avoiding a self-inflicted disconnect.
The browser extension disables the control entirely because it cannot reliably
identify its own LAN client; desktop and the web development host can establish
that identity before offering the write. Electron reads the host's network
interfaces, while the web development server answers `/api/whoami` from its local
host or caller address. The extension has neither path: its `/api/*` requests are
messages to an internal service worker/IndexedDB router, and ordinary desktop
Chrome extensions do not expose a reliable host LAN IP or MAC. The cloud mutation
itself works, but enabling it without self-identity could let a user pause the
computer running Dishylink, so both the extension UI capability and background
mutation route are disabled.
Use `scripts/probe-client-pause-state.mts` for a read-only snapshot of persisted
block schedules and effective connected-client state.

## Probing

`scripts/probe-rpcs.mts` — which optional RPCs this firmware implements.
`scripts/probe-client-history.mts` — buffer depth and sample interval for
the per-client history RPC.
`scripts/probe-client-pause-state.mts` — read-only persisted pause schedules
and effective state for connected clients.

Two lessons worth keeping, both learned the hard way:

1. **A field being present says nothing about it being filled.** Check `max()` across the whole array, not the newest few values.
2. **Probe under load.** Zeros on an idle network are indistinguishable from zeros that are always zero.
