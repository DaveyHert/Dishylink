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
import type { SampleCursor } from "@core/telemetry";

const EMPTY_CURSOR: SampleCursor = { counter: 0, newestSampleMs: 0 };

export interface HistoryStore {
  readCursor(): Promise<SampleCursor>;
  /** Additively merge these minute deltas and advance the cursor, atomically. */
  commit(deltas: MinuteBucket[], cursor: SampleCursor): Promise<void>;
  /** Buckets whose minute (epoch seconds) falls within [startSec, endSec]. */
  readMinutes(startSec: number, endSec: number): Promise<MinuteBucket[]>;
}

/** Read the cursor, drain the window past it, and commit — one wake's work. */
export async function applyDrain(store: HistoryStore, window: DishWindow): Promise<void> {
  const cursor = await store.readCursor();
  const plan = planDrain(window, cursor);
  await store.commit(plan.deltas, plan.cursor);
}

// --- IndexedDB (service worker) ---

const DB_NAME = "dishylink-history";
const MINUTES = "minutes";
const META = "meta";
const CURSOR_KEY = "cursor";

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
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      // minute is the key, so a re-drained minute updates its row instead of
      // appending a duplicate — the additive merge reads it back before writing.
      if (!db.objectStoreNames.contains(MINUTES)) db.createObjectStore(MINUTES, { keyPath: "minute" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
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
}

// --- In-memory (tests) ---

export class InMemoryHistory implements HistoryStore {
  private readonly minutes = new Map<number, MinuteBucket>();
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
}
