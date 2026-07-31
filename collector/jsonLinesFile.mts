// The durability primitives every store on disk shares.
//
// Each store here keeps a JSON Lines log: one JSON object per line, appended as
// facts arrive and rewritten whole when rows expire. (The files carry the older
// `.ndjson` extension for the same format — newline-delimited JSON — and keep it,
// because renaming them would orphan the history the historian has recorded.)
//
// Duplicating this per store risks the failure mode where a torn-write fix in
// one store silently leaves the others broken.
//
// So the *mechanism* lives here and the *policy* stays with each store. What to
// retain, when to compact, whether a row is still current — those differ per
// store and are the interesting part. Reading lines and not losing them is not.
//
// Deliberately functions rather than a base class. The stores share no state
// shape: some hold every row in memory (alerts, events, thermal), some read
// through to disk on every query (client, radio, energy), and two keep a pending
// accumulator for the minute in progress. Inheritance would force one lifecycle
// onto all three and buy nothing.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/** Create the directory a store's file lives in. Called from constructors, so a
 *  first run on a clean machine writes into a path that already exists. */
export function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Every parseable row of a JSON Lines log, in file order.
 *
 * A missing file is an empty log, not an error: that is simply a store which has
 * not recorded anything yet. A line that does not parse is skipped rather than
 * fatal — a process killed mid-append leaves a torn final line, and discarding a
 * whole history over one bad tail would turn a crash into data loss.
 *
 * `isValidRow` is an optional guard for stores that can recognise a row too
 * malformed to use even though it parsed as JSON.
 */
export function readJsonLines<Row>(filePath: string, isValidRow?: (row: Row) => boolean): Row[] {
  if (!existsSync(filePath)) return [];
  const rows: Row[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Row;
      if (!isValidRow || isValidRow(parsed)) rows.push(parsed);
    } catch {
      // Torn final line from a crash mid-write — skip it, keep the rest.
    }
  }
  return rows;
}

/**
 * Replace a log with exactly these rows, atomically.
 *
 * The write goes to a sibling `.tmp` and is renamed over the target, because
 * rename within a filesystem is atomic: a reader sees either the whole old file
 * or the whole new one, never a half-written log. The historian is killed by
 * launchd on every restart, so this is not a theoretical concern.
 *
 * An empty log is written as an empty file rather than a lone newline — readers
 * skip blank lines either way, but zero bytes is the honest representation of
 * "nothing recorded".
 */
export function writeJsonLinesAtomically<Row>(filePath: string, rows: readonly Row[]): void {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  replaceFileAtomically(filePath, body ? body + "\n" : "");
}

/** Add rows to the end of a log. Nothing to add is not a write: an idle poll
 *  should not touch the disk at all. */
export function appendJsonLines<Row>(filePath: string, rows: readonly Row[]): void {
  if (rows.length === 0) return;
  appendFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

/**
 * The same atomic replace for stores holding one JSON document rather than a
 * row-per-line log — the telemetry snapshot and the two client odometers. They
 * need the crash safety for the same reason and should not carry their own copy
 * of the dance.
 */
export function writeJsonAtomically(filePath: string, value: unknown): void {
  replaceFileAtomically(filePath, JSON.stringify(value));
}

/** Write to a sibling temp file, then rename it over the target. */
function replaceFileAtomically(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, contents);
  renameSync(temporaryPath, filePath);
}
