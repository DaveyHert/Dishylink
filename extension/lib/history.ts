// The extension's history store: per-minute buckets plus the drain cursor, the
// second storage engine behind the collector's ndjson files. Both persist the
// same MinuteBucket shape; only the medium differs, so the store is an interface
// with two implementations — IndexedDB in the service worker, in-memory in tests.
//
// commit() is the no-double-count guarantee. It merges the fresh minute deltas
// and advances the cursor in a single transaction: either both land or neither
// does. A teardown between the two would leave the cursor behind its data, and
// the next wake would re-drain and re-add the same samples.

import { addMinuteBucket, type MinuteBucket } from "@core/energyBuckets";
import { planDrain, type DishWindow } from "@core/drain";
import type { OutageEvent, RadioStatReading, SampleCursor } from "@core/telemetry";

const EMPTY_CURSOR: SampleCursor = { counter: 0, newestSampleMs: 0 };

/** One closed minute of a radio's temperature (averaged) and its lowest duty
 *  cycle that minute — the shape /api/radio serves as history. */
export interface RadioMinute extends RadioStatReading {
  minute: number;
}

/** The latest live radio readings, so /api/radio can answer `current` too. */
export interface RadioCurrent {
  readings: RadioStatReading[];
  atMs: number;
}

/** Per-(minute, band) accumulator, upserted each poll so a torn-down worker never
 *  loses the minute in progress; the average and duty-cycle floor are computed on read. */
interface RadioAccumulator {
  key: string;
  minute: number;
  band: string;
  sum: number;
  count: number;
  dutyMin: number;
}

export interface HistoryStore {
  readCursor(): Promise<SampleCursor>;
  /** Additively merge these minute deltas and advance the cursor, atomically. */
  commit(deltas: MinuteBucket[], cursor: SampleCursor): Promise<void>;
  /** Buckets whose minute (epoch seconds) falls within [startSec, endSec]. */
  readMinutes(startSec: number, endSec: number): Promise<MinuteBucket[]>;
  /** Upsert outage episodes keyed by start, so a re-seen one updates rather than
   *  duplicates — the dish's ring buffer replays the same episodes each drain. */
  putOutages(events: OutageEvent[]): Promise<void>;
  /** All recorded outages, newest first. */
  readOutages(): Promise<OutageEvent[]>;
  /** Fold a radio poll into the per-minute accumulators and remember it as the
   *  current live reading. */
  putRadio(readings: RadioStatReading[], nowMs: number): Promise<void>;
  /** The current readings plus per-minute history over the last `hours`. */
  readRadio(hours: number, nowMs?: number): Promise<{
    current: RadioStatReading[];
    atMs: number | null;
    history: RadioMinute[];
  }>;
}

/** Average a radio accumulator into its closed-minute reading. */
function radioMinuteOf(acc: RadioAccumulator): RadioMinute {
  return {
    minute: acc.minute,
    band: acc.band,
    tempC: Math.round((acc.sum / Math.max(acc.count, 1)) * 10) / 10,
    dutyCycle: acc.dutyMin,
  };
}

/** Fold one reading into its (minute, band) accumulator — averaged temperature,
 *  lowest duty cycle, so a brief airtime cut is remembered rather than smoothed. */
function foldRadio(existing: RadioAccumulator | undefined, reading: RadioStatReading, minute: number): RadioAccumulator {
  const acc = existing ?? {
    key: `${minute}:${reading.band}`,
    minute,
    band: reading.band,
    sum: 0,
    count: 0,
    dutyMin: reading.dutyCycle,
  };
  acc.sum += reading.tempC;
  acc.count += 1;
  acc.dutyMin = Math.min(acc.dutyMin, reading.dutyCycle);
  return acc;
}

/** Read the cursor, drain the window past it, and commit — one wake's work. */
export async function applyDrain(store: HistoryStore, window: DishWindow): Promise<void> {
  const cursor = await store.readCursor();
  const plan = planDrain(window, cursor);
  await store.commit(plan.deltas, plan.cursor);
}

// --- IndexedDB (service worker) ---

const DB_NAME = "dishylink-history";
const DB_VERSION = 3;
const MINUTES = "minutes";
const META = "meta";
const OUTAGES = "outages";
const RADIO = "radio";
const CURSOR_KEY = "cursor";
const RADIO_CURRENT_KEY = "radioCurrent";

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
      if (!db.objectStoreNames.contains(MINUTES)) db.createObjectStore(MINUTES, { keyPath: "minute" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      // startMs is the key, so an outage the ring buffer replays each drain
      // updates its row rather than appending a duplicate.
      if (!db.objectStoreNames.contains(OUTAGES)) db.createObjectStore(OUTAGES, { keyPath: "startMs" });
      // `${minute}:${band}` is the key, so each poll folds into the minute in
      // progress rather than appending — the minute survives a worker teardown.
      if (!db.objectStoreNames.contains(RADIO)) db.createObjectStore(RADIO, { keyPath: "key" });
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
    return request<MinuteBucket[]>(tx.objectStore(MINUTES).getAll(IDBKeyRange.bound(startSec, endSec)));
  }

  async putOutages(events: OutageEvent[]): Promise<void> {
    if (events.length === 0) return;
    const tx = this.db.transaction(OUTAGES, "readwrite");
    const store = tx.objectStore(OUTAGES);
    for (const event of events) store.put(event);
    await transactionDone(tx);
  }

  async readOutages(): Promise<OutageEvent[]> {
    const tx = this.db.transaction(OUTAGES, "readonly");
    const all = await request<OutageEvent[]>(tx.objectStore(OUTAGES).getAll());
    return all.sort((a, b) => b.startMs - a.startMs);
  }

  async putRadio(readings: RadioStatReading[], nowMs: number): Promise<void> {
    if (readings.length === 0) return;
    const minute = Math.floor(nowMs / 60_000) * 60;
    const tx = this.db.transaction([RADIO, META], "readwrite");
    const store = tx.objectStore(RADIO);
    for (const reading of readings) {
      const key = `${minute}:${reading.band}`;
      const existing = await request<RadioAccumulator | undefined>(store.get(key));
      store.put(foldRadio(existing, reading, minute));
    }
    tx.objectStore(META).put({ readings, atMs: nowMs } satisfies RadioCurrent, RADIO_CURRENT_KEY);
    await transactionDone(tx);
  }

  async readRadio(hours: number, nowMs: number = Date.now()) {
    const cutoffSec = Math.floor(nowMs / 1000) - hours * 3_600;
    const tx = this.db.transaction([RADIO, META], "readonly");
    const accumulators = await request<RadioAccumulator[]>(tx.objectStore(RADIO).getAll());
    const current = await request<RadioCurrent | undefined>(
      tx.objectStore(META).get(RADIO_CURRENT_KEY),
    );
    const history = accumulators
      .filter((acc) => acc.minute >= cutoffSec)
      .map(radioMinuteOf)
      .sort((a, b) => a.minute - b.minute);
    return { current: current?.readings ?? [], atMs: current?.atMs ?? null, history };
  }
}

// --- In-memory (tests) ---

export class InMemoryHistory implements HistoryStore {
  private readonly minutes = new Map<number, MinuteBucket>();
  private readonly outages = new Map<number, OutageEvent>();
  private readonly radio = new Map<string, RadioAccumulator>();
  private radioCurrent: RadioCurrent | null = null;
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

  async putOutages(events: OutageEvent[]): Promise<void> {
    for (const event of events) this.outages.set(event.startMs, event);
  }

  async readOutages(): Promise<OutageEvent[]> {
    return [...this.outages.values()].sort((a, b) => b.startMs - a.startMs);
  }

  async putRadio(readings: RadioStatReading[], nowMs: number): Promise<void> {
    if (readings.length === 0) return;
    const minute = Math.floor(nowMs / 60_000) * 60;
    for (const reading of readings) {
      const key = `${minute}:${reading.band}`;
      this.radio.set(key, foldRadio(this.radio.get(key), reading, minute));
    }
    this.radioCurrent = { readings, atMs: nowMs };
  }

  async readRadio(hours: number, nowMs: number = Date.now()) {
    const cutoffSec = Math.floor(nowMs / 1000) - hours * 3_600;
    const history = [...this.radio.values()]
      .filter((acc) => acc.minute >= cutoffSec)
      .map(radioMinuteOf)
      .sort((a, b) => a.minute - b.minute);
    return {
      current: this.radioCurrent?.readings ?? [],
      atMs: this.radioCurrent?.atMs ?? null,
      history,
    };
  }
}
