// The extension's history store: per-minute buckets plus the drain cursor, the
// second storage engine behind the collector's ndjson files. Both persist the
// same MinuteBucket shape; only the medium differs, so the store is an interface
// with two implementations — IndexedDB in the service worker, in-memory in tests.
//
// commit() is the no-double-count guarantee. It merges the fresh minute deltas
// and advances the cursor in a single transaction: either both land or neither
// does. A teardown between the two would leave the cursor behind its data, and
// the next wake would re-drain and re-add the same samples.

import {
  addMinuteBucket,
  addMonthBucket,
  foldMinutesToMonths,
  startOfYearSec,
  type MinuteBucket,
  type MonthBucket,
} from "@core/energyBuckets";
import { planDrain, type DishWindow } from "@core/drain";
import type { AlertTransition } from "@core/alertEngine";
import {
  selectFreshSamples,
  type OutageEvent,
  type RadioStatReading,
  type SampleCursor,
  type TelemetrySample,
} from "@core/telemetry";
import type { Snapshot as TotalsSnapshot } from "@core/clientTotals";
import { restoredRule, type MeterRule } from "@core/dataMeter";
import type { DevicePause } from "@core/devicePause";
import type { DeviceGroup } from "@core/deviceGroup";
import type { AlertSeverity } from "@core/alertDefinitions";

/** One device's aggregated throughput for a closed minute — the row /api/clients
 *  serves as `history` behind the 6-hour chart. Recorded once a minute by the
 *  drain from the router's own 1-minute average, so `downMbps`/`upMbps` already
 *  are that minute's rate; the byte counters ride along for the odometer's seed. */
export interface ClientMinuteRow {
  /** Epoch seconds at the minute's start. */
  minute: number;
  /** Device key: the router's clientId (or MAC when it reports none). */
  key: string;
  macAddress: string;
  name?: string;
  downMbps: number;
  upMbps: number;
  rxBytes: number;
  txBytes: number;
}

/** One raw 1 Hz sample behind the 15-minute detail chart — written by the open
 *  dashboard, which polls the router far faster than the once-a-minute drain can. */
export interface ClientSampleRow {
  key: string;
  macAddress: string;
  atMs: number;
  downMbps: number;
  upMbps: number;
}

const EMPTY_CURSOR: SampleCursor = { counter: 0, newestSampleMs: 0 };

/** The latest live radio readings, so /api/radio can answer `current`. */
export interface RadioCurrent {
  readings: RadioStatReading[];
  atMs: number;
}

/** One hourly obstruction-map snapshot for the time-lapse, cells packed 2 bits
 *  each as base64 — the shape the client's unpack path reads. */
export interface ObstructionSnapshot {
  takenAtMs: number;
  gridSize: number;
  packedCells: string;
  maxThetaDeg?: number;
}

/** Which device raised an alert — plus "system" for conditions observed about a
 *  device (e.g. it not answering) rather than read off it. */
export type AlertSource = "dish" | "router" | "system";

/** One alert/thermal episode: a boolean flag from open (false→true) to close. */
export interface AlertEpisode {
  /** `${source}:${key}:${startMs}`, unique per episode — the store key. */
  id: string;
  source: AlertSource;
  key: string;
  startMs: number;
  /** null while the flag is still set. */
  endMs: number | null;
  /** What was announced. Absent where the wording is a constant the UI looks up. */
  label?: string;
  severity?: AlertSeverity;
}

export interface HistoryStore {
  readCursor(): Promise<SampleCursor>;
  /** Additively merge these minute deltas and advance the cursor, atomically. */
  commit(deltas: MinuteBucket[], cursor: SampleCursor): Promise<void>;
  /** Buckets whose minute (epoch seconds) falls within [startSec, endSec]. */
  readMinutes(startSec: number, endSec: number): Promise<MinuteBucket[]>;
  /** Fold minutes older than the current calendar year into monthly archive
   *  rows, then drop them from the minute store — the same trade the historian's
   *  server-side EnergyStore makes, so an install that runs for years doesn't
   *  keep one row per minute forever. Returns how many minutes were archived. */
  compactEnergy(nowMs?: number): Promise<number>;
  /** Archived monthly summaries, oldest first. */
  readMonths(): Promise<MonthBucket[]>;
  /** Upsert outage episodes keyed by start, so a re-seen one updates rather than
   *  duplicates — the dish's ring buffer replays the same episodes each drain —
   *  and drop any past the retention window on the same write. */
  putOutages(events: OutageEvent[], nowMs?: number): Promise<void>;
  /** Outages within the retention window, newest first. */
  readOutages(nowMs?: number): Promise<OutageEvent[]>;
  /** Remember the latest radio poll as the current live reading. */
  putRadio(readings: RadioStatReading[], nowMs: number): Promise<void>;
  /** The current readings and when they were read. */
  readRadio(): Promise<{ current: RadioStatReading[]; atMs: number | null }>;
  /** Write down the transitions core/alertEngine reported: an episode opens for
   *  each alert that started firing, closes for each that stopped. This store
   *  records edges, it does not look for them — every host runs the same engine
   *  over the same readings, and a store with its own opinion would be a second
   *  one. */
  applyAlertTransitions(transitions: AlertTransition[], nowMs: number): Promise<void>;
  /** All alert episodes within the retention window, newest first. */
  readAlerts(nowMs?: number): Promise<AlertEpisode[]>;
  /** Append an hourly obstruction snapshot, dropping any past retention. */
  putObstruction(snapshot: ObstructionSnapshot): Promise<void>;
  /** Snapshots within retention, oldest first — the order the scrubber expects. */
  readObstructionSnapshots(nowMs?: number): Promise<ObstructionSnapshot[]>;
  /** Record this drain's per-device minute rows, dropping any past the 6h window. */
  putClientMinutes(rows: ClientMinuteRow[], nowMs?: number): Promise<void>;
  /** Per-device minute rows within the last `hours`, oldest first; one device by key. */
  readClientMinutes(hours: number, key?: string, nowMs?: number): Promise<ClientMinuteRow[]>;
  /** Append raw 1 Hz samples (from the open dashboard), dropping any past the window. */
  putClientSamples(rows: ClientSampleRow[], nowMs?: number): Promise<void>;
  /** Raw samples newer than `sinceMs` (0 = the whole window), oldest first; one device. */
  readClientSamples(sinceMs?: number, key?: string, nowMs?: number): Promise<ClientSampleRow[]>;
  /** The odometer's persisted state, or null before its first write. */
  readTotalsSnapshot(): Promise<TotalsSnapshot | null>;
  /** Persist the odometer's state so the next drain resumes it across teardown. */
  writeTotalsSnapshot(snapshot: TotalsSnapshot): Promise<void>;
  /** Every data-limit rule. Durable rather than in-memory because the worker is
   *  torn down between alarms, and a latch that did not survive would re-pause a
   *  device the user had released by hand. */
  readMeterRules(): Promise<MeterRule[]>;
  writeMeterRules(rules: MeterRule[]): Promise<void>;
  /** What the router was last told about each device. Apart from the rules for
   *  the reason it is: several rules can hold one device, so the block belongs to
   *  the device and outlives any one of them being edited away. */
  readDevicePauses(): Promise<DevicePause[]>;
  writeDevicePauses(pauses: DevicePause[]): Promise<void>;
  /** Every allowance set across several devices. Held apart from the rules it
   *  projects, so a pooled allowance keeps the membership it was divided across. */
  readDeviceGroups(): Promise<DeviceGroup[]>;
  writeDeviceGroups(groups: DeviceGroup[]): Promise<void>;
  /** Retain the dish's raw 1 Hz telemetry samples, dropping any past the window.
   *  Keyed by timestamp, so a re-drained overlap updates rather than duplicates. */
  putSamples(samples: TelemetrySample[], nowMs?: number): Promise<void>;
  /** Raw samples from the last `minutes`, oldest first — the main charts' backfill. */
  readSamples(minutes: number, nowMs?: number): Promise<TelemetrySample[]>;
}

const OBSTRUCTION_RETENTION_MS = 7 * 24 * 3_600_000;

// Alerts, thermal (a filtered view of alerts), and outages all share one
// 48-hour window — the "recently" the events panel reads.
const ALERT_RETENTION_MS = 48 * 3_600_000;
const OUTAGE_RETENTION_MS = 48 * 3_600_000;

// Per-device minute rows back the 6h chart, the longest per-device view. Raw
// samples back only the 15-minute detail chart, so a shorter window holds them —
// wide enough that the chart opens filled from a recently-open dashboard.
const CLIENT_MINUTE_RETENTION_MS = 6 * 3_600_000;
const CLIENT_SAMPLE_RETENTION_MS = 20 * 60_000;

// The dish's raw 1 Hz window, six hours deep — the span the main charts request
// to backfill on reload (/api/samples?minutes=360).
const SAMPLE_RETENTION_MS = 6 * 3_600_000;

/** The episodes a batch of transitions produces, against what is already on
 *  record. Pure, so both stores persist the same thing. An open that is already
 *  open and a close for nothing open are both no-ops: the engine only reports an
 *  edge once, but a worker restored from disk may replay one. */
function episodesForTransitions(
  existing: AlertEpisode[],
  transitions: AlertTransition[],
): AlertEpisode[] {
  const toPut: AlertEpisode[] = [];
  for (const transition of transitions) {
    const open = [...existing, ...toPut].find(
      (e) => e.source === transition.source && e.key === transition.key && e.endMs === null,
    );
    if (transition.kind === "fired") {
      if (!open)
        toPut.push({
          id: `${transition.source}:${transition.key}:${transition.atMs}`,
          source: transition.source,
          key: transition.key,
          startMs: transition.atMs,
          endMs: null,
          label: transition.spec.firing,
          severity: transition.spec.severity,
        });
    } else if (open) {
      toPut.push({ ...open, endMs: transition.atMs });
    }
  }
  return toPut;
}

/** Read the cursor, drain the window past it, and commit — one wake's work. The
 *  raw 1 Hz samples the charts backfill from are persisted here too, but only the
 *  ones past the cursor, exactly as the minute deltas are. Storing the whole window
 *  cannot dedup a re-drained overlap: decodeHistoryWindow stamps each sample from
 *  the drain's own nowMs, and consecutive wakes are never a whole second apart, so
 *  the same ring slot re-decodes to a different timestamp and lands under a new key
 *  instead of overwriting. Only what advanced past the cursor is genuinely new, so
 *  only that is written, and the sample store stays at true 1 Hz. */
export async function applyDrain(
  store: HistoryStore,
  window: DishWindow,
  nowMs: number = Date.now(),
): Promise<void> {
  const cursor = await store.readCursor();
  const plan = planDrain(window, cursor);
  await store.commit(plan.deltas, plan.cursor);
  // Samples after the commit, not before: a teardown between the two advances the
  // cursor and drops at most one drain's raw backfill, whereas the reverse order
  // would re-decode the overlap to new timestamps on the retry and re-grow the store.
  await store.putSamples(selectFreshSamples(window, cursor), nowMs);
}

// --- IndexedDB (service worker) ---

const DB_NAME = "dishylink-history";
const DB_VERSION = 1;
const MINUTES = "minutes";
const MONTHS = "months";
const META = "meta";
const OUTAGES = "outages";
const ALERTS = "alerts";
const OBSTRUCTION = "obstruction";
const SAMPLES = "samples";
const CLIENT_MINUTES = "clientMinutes";
const CLIENT_SAMPLES = "clientSamples";
const CURSOR_KEY = "cursor";
const RADIO_CURRENT_KEY = "radioCurrent";
const CLIENT_TOTALS_KEY = "clientTotals";
const METER_RULES_KEY = "meterRules";
const DEVICE_PAUSES_KEY = "devicePauses";
const DEVICE_GROUPS_KEY = "deviceGroups";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      // minute is the key, so a re-drained minute updates its row instead of
      // appending a duplicate — the additive merge reads it back before writing.
      if (!db.objectStoreNames.contains(MINUTES))
        db.createObjectStore(MINUTES, { keyPath: "minute" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      // startMs is the key, so an outage the ring buffer replays each drain
      // updates its row rather than appending a duplicate.
      if (!db.objectStoreNames.contains(OUTAGES))
        db.createObjectStore(OUTAGES, { keyPath: "startMs" });
      // One row per alert episode, keyed by `${source}:${key}:${startMs}`.
      if (!db.objectStoreNames.contains(ALERTS)) db.createObjectStore(ALERTS, { keyPath: "id" });
      // One row per hourly snapshot, keyed by capture time.
      if (!db.objectStoreNames.contains(OBSTRUCTION))
        db.createObjectStore(OBSTRUCTION, { keyPath: "takenAtMs" });
      // Raw dish samples keyed by timestamp, so a re-drained overlap of the dish's
      // ring updates its row rather than duplicating; the numeric key ranges for
      // the window prune and the backfill read.
      if (!db.objectStoreNames.contains(SAMPLES))
        db.createObjectStore(SAMPLES, { keyPath: "timestampMs" });
      // Keyed by `id` = a zero-free fixed-width epoch prefix + the device key
      // (`${minute}:${key}`, `${atMs}:${key}`). Epoch seconds are 10 digits and
      // ms 13 through year 2286, so lexical order is chronological order — one
      // range delete prunes the window, and a `since` read is a lower bound, with
      // no secondary index to maintain. A re-drained minute updates its own row.
      if (!db.objectStoreNames.contains(CLIENT_MINUTES))
        db.createObjectStore(CLIENT_MINUTES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CLIENT_SAMPLES))
        db.createObjectStore(CLIENT_SAMPLES, { keyPath: "id" });
      // One row per archived calendar month, keyed by its start — matches the
      // historian's server-side EnergyStore, whose per-minute detail is capped
      // to the current year with older months folded in the same shape.
      if (!db.objectStoreNames.contains(MONTHS)) db.createObjectStore(MONTHS, { keyPath: "month" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export class IndexedDbHistory implements HistoryStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string = DB_NAME): Promise<IndexedDbHistory> {
    return new IndexedDbHistory(await openDatabase(name));
  }

  async readCursor(): Promise<SampleCursor> {
    const tx = this.db.transaction(META, "readonly");
    const stored = await request<SampleCursor | undefined>(tx.objectStore(META).get(CURSOR_KEY));
    return stored ?? EMPTY_CURSOR;
  }

  async commit(deltas: MinuteBucket[], cursor: SampleCursor): Promise<void> {
    const tx = this.db.transaction([MINUTES, META], "readwrite");
    const minutes = tx.objectStore(MINUTES);
    for (const delta of deltas) {
      // Each get resolves inside the transaction, so the following put stays in
      // it — the read-add-write for one minute is a single atomic step.
      const existing = await request<MinuteBucket | undefined>(minutes.get(delta.minute));
      minutes.put(addMinuteBucket(existing, delta));
    }
    tx.objectStore(META).put(cursor, CURSOR_KEY);
    await transactionDone(tx);
  }

  async readMinutes(startSec: number, endSec: number): Promise<MinuteBucket[]> {
    const tx = this.db.transaction(MINUTES, "readonly");
    return request<MinuteBucket[]>(
      tx.objectStore(MINUTES).getAll(IDBKeyRange.bound(startSec, endSec)),
    );
  }

  async compactEnergy(nowMs: number = Date.now()): Promise<number> {
    const cutoffSec = startOfYearSec(new Date(nowMs));
    const tx = this.db.transaction([MINUTES, MONTHS], "readwrite");
    const minutes = tx.objectStore(MINUTES);
    const months = tx.objectStore(MONTHS);
    const expired = await request<MinuteBucket[]>(
      minutes.getAll(IDBKeyRange.upperBound(cutoffSec, true)),
    );
    if (expired.length > 0) {
      for (const [month, delta] of foldMinutesToMonths(expired)) {
        // month is the key, so a re-fold of an already-archived month (a very
        // late-arriving minute) adds onto its row instead of overwriting it.
        const existing = await request<MonthBucket | undefined>(months.get(month));
        months.put(addMonthBucket(existing, delta));
      }
      minutes.delete(IDBKeyRange.upperBound(cutoffSec, true));
    }
    await transactionDone(tx);
    return expired.length;
  }

  async readMonths(): Promise<MonthBucket[]> {
    const tx = this.db.transaction(MONTHS, "readonly");
    const all = await request<MonthBucket[]>(tx.objectStore(MONTHS).getAll());
    return all.sort((a, b) => a.month - b.month);
  }

  async putOutages(events: OutageEvent[], nowMs: number = Date.now()): Promise<void> {
    const tx = this.db.transaction(OUTAGES, "readwrite");
    const store = tx.objectStore(OUTAGES);
    for (const event of events) store.put(event);
    // startMs is the key, so a single ranged delete drops everything older.
    store.delete(IDBKeyRange.upperBound(nowMs - OUTAGE_RETENTION_MS, true));
    await transactionDone(tx);
  }

  async readOutages(nowMs: number = Date.now()): Promise<OutageEvent[]> {
    const tx = this.db.transaction(OUTAGES, "readonly");
    const all = await request<OutageEvent[]>(tx.objectStore(OUTAGES).getAll());
    const cutoff = nowMs - OUTAGE_RETENTION_MS;
    return all.filter((e) => e.startMs >= cutoff).sort((a, b) => b.startMs - a.startMs);
  }

  async putRadio(readings: RadioStatReading[], nowMs: number): Promise<void> {
    if (readings.length === 0) return;
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put({ readings, atMs: nowMs } satisfies RadioCurrent, RADIO_CURRENT_KEY);
    await transactionDone(tx);
  }

  async readRadio() {
    const tx = this.db.transaction(META, "readonly");
    const current = await request<RadioCurrent | undefined>(
      tx.objectStore(META).get(RADIO_CURRENT_KEY),
    );
    return { current: current?.readings ?? [], atMs: current?.atMs ?? null };
  }

  async applyAlertTransitions(transitions: AlertTransition[], nowMs: number): Promise<void> {
    const tx = this.db.transaction(ALERTS, "readwrite");
    const store = tx.objectStore(ALERTS);
    const existing = await request<AlertEpisode[]>(store.getAll());
    for (const episode of episodesForTransitions(existing, transitions)) store.put(episode);
    // Drop closed episodes past the window; an open one is kept however old.
    const cutoff = nowMs - ALERT_RETENTION_MS;
    for (const e of existing) if (e.endMs !== null && e.startMs < cutoff) store.delete(e.id);
    await transactionDone(tx);
  }

  async readAlerts(nowMs: number = Date.now()): Promise<AlertEpisode[]> {
    const tx = this.db.transaction(ALERTS, "readonly");
    const all = await request<AlertEpisode[]>(tx.objectStore(ALERTS).getAll());
    const cutoffMs = nowMs - ALERT_RETENTION_MS;
    return all
      .filter((e) => e.endMs === null || e.startMs >= cutoffMs)
      .sort((a, b) => b.startMs - a.startMs);
  }

  async putObstruction(snapshot: ObstructionSnapshot): Promise<void> {
    const tx = this.db.transaction(OBSTRUCTION, "readwrite");
    const store = tx.objectStore(OBSTRUCTION);
    store.put(snapshot);
    // Prune anything past the retention window on the same write.
    const cutoff = snapshot.takenAtMs - OBSTRUCTION_RETENTION_MS;
    store.delete(IDBKeyRange.upperBound(cutoff, true));
    await transactionDone(tx);
  }

  async readObstructionSnapshots(nowMs: number = Date.now()): Promise<ObstructionSnapshot[]> {
    const tx = this.db.transaction(OBSTRUCTION, "readonly");
    const all = await request<ObstructionSnapshot[]>(tx.objectStore(OBSTRUCTION).getAll());
    const cutoff = nowMs - OBSTRUCTION_RETENTION_MS;
    return all.filter((s) => s.takenAtMs >= cutoff).sort((a, b) => a.takenAtMs - b.takenAtMs);
  }

  async putClientMinutes(rows: ClientMinuteRow[], nowMs: number = Date.now()): Promise<void> {
    const tx = this.db.transaction(CLIENT_MINUTES, "readwrite");
    const store = tx.objectStore(CLIENT_MINUTES);
    for (const row of rows) store.put({ id: `${row.minute}:${row.key}`, ...row });
    const cutoffMinute = Math.floor((nowMs - CLIENT_MINUTE_RETENTION_MS) / 1000);
    store.delete(IDBKeyRange.upperBound(`${cutoffMinute}:`, true));
    await transactionDone(tx);
  }

  async readClientMinutes(
    hours: number,
    key?: string,
    nowMs: number = Date.now(),
  ): Promise<ClientMinuteRow[]> {
    const cutoff = Math.floor(nowMs / 1000) - hours * 3_600;
    const tx = this.db.transaction(CLIENT_MINUTES, "readonly");
    const rows = await request<(ClientMinuteRow & { id: string })[]>(
      tx.objectStore(CLIENT_MINUTES).getAll(IDBKeyRange.lowerBound(`${cutoff}:`)),
    );
    return rows
      .filter((r) => r.minute >= cutoff && (!key || r.key === key))
      .map(withoutId)
      .sort((a, b) => a.minute - b.minute);
  }

  async putClientSamples(rows: ClientSampleRow[], nowMs: number = Date.now()): Promise<void> {
    const tx = this.db.transaction(CLIENT_SAMPLES, "readwrite");
    const store = tx.objectStore(CLIENT_SAMPLES);
    for (const row of rows) store.put({ id: `${row.atMs}:${row.key}`, ...row });
    store.delete(IDBKeyRange.upperBound(`${nowMs - CLIENT_SAMPLE_RETENTION_MS}:`, true));
    await transactionDone(tx);
  }

  async readClientSamples(
    sinceMs: number = 0,
    key?: string,
    nowMs: number = Date.now(),
  ): Promise<ClientSampleRow[]> {
    const floor = Math.max(sinceMs, nowMs - CLIENT_SAMPLE_RETENTION_MS);
    const tx = this.db.transaction(CLIENT_SAMPLES, "readonly");
    const rows = await request<(ClientSampleRow & { id: string })[]>(
      tx.objectStore(CLIENT_SAMPLES).getAll(IDBKeyRange.lowerBound(`${floor}:`)),
    );
    return rows
      .filter((r) => r.atMs > sinceMs && (!key || r.key === key))
      .map(withoutId)
      .sort((a, b) => a.atMs - b.atMs);
  }

  async readTotalsSnapshot(): Promise<TotalsSnapshot | null> {
    const tx = this.db.transaction(META, "readonly");
    const snap = await request<TotalsSnapshot | undefined>(
      tx.objectStore(META).get(CLIENT_TOTALS_KEY),
    );
    return snap ?? null;
  }

  async writeTotalsSnapshot(snapshot: TotalsSnapshot): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(snapshot, CLIENT_TOTALS_KEY);
    await transactionDone(tx);
  }

  async readMeterRules(): Promise<MeterRule[]> {
    const tx = this.db.transaction(META, "readonly");
    const rules = await request<MeterRule[] | undefined>(tx.objectStore(META).get(METER_RULES_KEY));
    // A structured clone keeps Infinity where JSON cannot, but a rule written
    // before the countdown had a clock of its own still needs one.
    return (rules ?? []).map(restoredRule);
  }

  async writeMeterRules(rules: MeterRule[]): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(rules, METER_RULES_KEY);
    await transactionDone(tx);
  }

  async readDevicePauses(): Promise<DevicePause[]> {
    const tx = this.db.transaction(META, "readonly");
    const pauses = await request<DevicePause[] | undefined>(
      tx.objectStore(META).get(DEVICE_PAUSES_KEY),
    );
    if (pauses) return pauses;
    // Before the block moved onto the device it was a field on each rule, and a
    // device held by one of those must not be forgotten on the upgrade: nothing
    // else knows the router is still holding it.
    const stored = (await this.readMeterRules()) as (MeterRule & {
      pauseState?: DevicePause["state"];
      pauseCheckedMs?: number;
      pauseError?: string;
    })[];
    return stored.flatMap((rule) =>
      rule.pauseState === undefined || rule.pauseState === "none"
        ? []
        : [
            {
              clientKey: rule.clientKey,
              state: rule.pauseState,
              ...(rule.pauseCheckedMs === undefined ? {} : { checkedMs: rule.pauseCheckedMs }),
              ...(rule.pauseError === undefined ? {} : { error: rule.pauseError }),
            },
          ],
    );
  }

  async writeDevicePauses(pauses: DevicePause[]): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(pauses, DEVICE_PAUSES_KEY);
    await transactionDone(tx);
  }

  async readDeviceGroups(): Promise<DeviceGroup[]> {
    const tx = this.db.transaction(META, "readonly");
    const groups = await request<DeviceGroup[] | undefined>(
      tx.objectStore(META).get(DEVICE_GROUPS_KEY),
    );
    return groups ?? [];
  }

  async writeDeviceGroups(groups: DeviceGroup[]): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(groups, DEVICE_GROUPS_KEY);
    await transactionDone(tx);
  }

  async putSamples(samples: TelemetrySample[], nowMs: number = Date.now()): Promise<void> {
    const tx = this.db.transaction(SAMPLES, "readwrite");
    const store = tx.objectStore(SAMPLES);
    for (const sample of samples) store.put(sample);
    store.delete(IDBKeyRange.upperBound(nowMs - SAMPLE_RETENTION_MS, true));
    await transactionDone(tx);
  }

  async readSamples(minutes: number, nowMs: number = Date.now()): Promise<TelemetrySample[]> {
    const floor = nowMs - minutes * 60_000;
    const tx = this.db.transaction(SAMPLES, "readonly");
    const rows = await request<TelemetrySample[]>(
      tx.objectStore(SAMPLES).getAll(IDBKeyRange.lowerBound(floor)),
    );
    return rows.sort((a, b) => a.timestampMs - b.timestampMs);
  }
}

/** Drop the storage-only `id` prefix from a stored client row. */
function withoutId<T>(row: T & { id: string }): T {
  const { id: _, ...rest } = row;
  return rest as unknown as T;
}

// --- In-memory (tests) ---

export class InMemoryHistory implements HistoryStore {
  private readonly minutes = new Map<number, MinuteBucket>();
  private readonly months = new Map<number, MonthBucket>();
  private readonly outages = new Map<number, OutageEvent>();
  private radioCurrent: RadioCurrent | null = null;
  private readonly alerts = new Map<string, AlertEpisode>();
  private readonly obstruction = new Map<number, ObstructionSnapshot>();
  private readonly clientMinutes = new Map<string, ClientMinuteRow>();
  private readonly clientSamples = new Map<string, ClientSampleRow>();
  private readonly samples = new Map<number, TelemetrySample>();
  private totalsSnapshot: TotalsSnapshot | null = null;
  private meterRules: MeterRule[] = [];
  private devicePauses: DevicePause[] = [];
  private deviceGroups: DeviceGroup[] = [];
  private cursor: SampleCursor = EMPTY_CURSOR;

  async readCursor(): Promise<SampleCursor> {
    return this.cursor;
  }

  async commit(deltas: MinuteBucket[], cursor: SampleCursor): Promise<void> {
    for (const delta of deltas)
      this.minutes.set(delta.minute, addMinuteBucket(this.minutes.get(delta.minute), delta));
    this.cursor = cursor;
  }

  async readMinutes(startSec: number, endSec: number): Promise<MinuteBucket[]> {
    return [...this.minutes.values()]
      .filter((bucket) => bucket.minute >= startSec && bucket.minute <= endSec)
      .sort((a, b) => a.minute - b.minute);
  }

  async compactEnergy(nowMs: number = Date.now()): Promise<number> {
    const cutoffSec = startOfYearSec(new Date(nowMs));
    const expired = [...this.minutes.values()].filter((bucket) => bucket.minute < cutoffSec);
    if (expired.length === 0) return 0;
    for (const [month, delta] of foldMinutesToMonths(expired)) {
      this.months.set(month, addMonthBucket(this.months.get(month), delta));
    }
    for (const [minute, bucket] of this.minutes)
      if (bucket.minute < cutoffSec) this.minutes.delete(minute);
    return expired.length;
  }

  async readMonths(): Promise<MonthBucket[]> {
    return [...this.months.values()].sort((a, b) => a.month - b.month);
  }

  async putOutages(events: OutageEvent[], nowMs: number = Date.now()): Promise<void> {
    for (const event of events) this.outages.set(event.startMs, event);
    const cutoff = nowMs - OUTAGE_RETENTION_MS;
    for (const [startMs] of this.outages) if (startMs < cutoff) this.outages.delete(startMs);
  }

  async readOutages(nowMs: number = Date.now()): Promise<OutageEvent[]> {
    const cutoff = nowMs - OUTAGE_RETENTION_MS;
    return [...this.outages.values()]
      .filter((e) => e.startMs >= cutoff)
      .sort((a, b) => b.startMs - a.startMs);
  }

  async putRadio(readings: RadioStatReading[], nowMs: number): Promise<void> {
    if (readings.length === 0) return;
    this.radioCurrent = { readings, atMs: nowMs };
  }

  async readRadio() {
    return {
      current: this.radioCurrent?.readings ?? [],
      atMs: this.radioCurrent?.atMs ?? null,
    };
  }

  async applyAlertTransitions(transitions: AlertTransition[], nowMs: number): Promise<void> {
    for (const episode of episodesForTransitions([...this.alerts.values()], transitions))
      this.alerts.set(episode.id, episode);
    const cutoff = nowMs - ALERT_RETENTION_MS;
    for (const [id, e] of this.alerts)
      if (e.endMs !== null && e.startMs < cutoff) this.alerts.delete(id);
  }

  async readAlerts(nowMs: number = Date.now()): Promise<AlertEpisode[]> {
    const cutoffMs = nowMs - ALERT_RETENTION_MS;
    return [...this.alerts.values()]
      .filter((e) => e.endMs === null || e.startMs >= cutoffMs)
      .sort((a, b) => b.startMs - a.startMs);
  }

  async putObstruction(snapshot: ObstructionSnapshot): Promise<void> {
    this.obstruction.set(snapshot.takenAtMs, snapshot);
    const cutoff = snapshot.takenAtMs - OBSTRUCTION_RETENTION_MS;
    for (const [at] of this.obstruction) if (at < cutoff) this.obstruction.delete(at);
  }

  async readObstructionSnapshots(nowMs: number = Date.now()): Promise<ObstructionSnapshot[]> {
    const cutoff = nowMs - OBSTRUCTION_RETENTION_MS;
    return [...this.obstruction.values()]
      .filter((s) => s.takenAtMs >= cutoff)
      .sort((a, b) => a.takenAtMs - b.takenAtMs);
  }

  async putClientMinutes(rows: ClientMinuteRow[], nowMs: number = Date.now()): Promise<void> {
    for (const row of rows) this.clientMinutes.set(`${row.minute}:${row.key}`, row);
    const cutoff = Math.floor((nowMs - CLIENT_MINUTE_RETENTION_MS) / 1000);
    for (const [id, row] of this.clientMinutes)
      if (row.minute < cutoff) this.clientMinutes.delete(id);
  }

  async readClientMinutes(
    hours: number,
    key?: string,
    nowMs: number = Date.now(),
  ): Promise<ClientMinuteRow[]> {
    const cutoff = Math.floor(nowMs / 1000) - hours * 3_600;
    return [...this.clientMinutes.values()]
      .filter((r) => r.minute >= cutoff && (!key || r.key === key))
      .sort((a, b) => a.minute - b.minute);
  }

  async putClientSamples(rows: ClientSampleRow[], nowMs: number = Date.now()): Promise<void> {
    for (const row of rows) this.clientSamples.set(`${row.atMs}:${row.key}`, row);
    const cutoff = nowMs - CLIENT_SAMPLE_RETENTION_MS;
    for (const [id, row] of this.clientSamples)
      if (row.atMs < cutoff) this.clientSamples.delete(id);
  }

  async readClientSamples(
    sinceMs: number = 0,
    key?: string,
    nowMs: number = Date.now(),
  ): Promise<ClientSampleRow[]> {
    const floor = Math.max(sinceMs, nowMs - CLIENT_SAMPLE_RETENTION_MS);
    return [...this.clientSamples.values()]
      .filter((r) => r.atMs > sinceMs && r.atMs >= floor && (!key || r.key === key))
      .sort((a, b) => a.atMs - b.atMs);
  }

  async readTotalsSnapshot(): Promise<TotalsSnapshot | null> {
    return this.totalsSnapshot;
  }

  async writeTotalsSnapshot(snapshot: TotalsSnapshot): Promise<void> {
    this.totalsSnapshot = snapshot;
  }

  async readMeterRules(): Promise<MeterRule[]> {
    return this.meterRules.map(restoredRule);
  }

  async writeMeterRules(rules: MeterRule[]): Promise<void> {
    this.meterRules = rules;
  }

  async readDevicePauses(): Promise<DevicePause[]> {
    return this.devicePauses;
  }

  async writeDevicePauses(pauses: DevicePause[]): Promise<void> {
    this.devicePauses = pauses;
  }

  async readDeviceGroups(): Promise<DeviceGroup[]> {
    return this.deviceGroups;
  }

  async writeDeviceGroups(groups: DeviceGroup[]): Promise<void> {
    this.deviceGroups = groups;
  }

  async putSamples(samples: TelemetrySample[], nowMs: number = Date.now()): Promise<void> {
    for (const sample of samples) this.samples.set(sample.timestampMs, sample);
    const cutoff = nowMs - SAMPLE_RETENTION_MS;
    for (const [ts] of this.samples) if (ts < cutoff) this.samples.delete(ts);
  }

  async readSamples(minutes: number, nowMs: number = Date.now()): Promise<TelemetrySample[]> {
    const floor = nowMs - minutes * 60_000;
    return [...this.samples.values()]
      .filter((s) => s.timestampMs >= floor)
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }
}
