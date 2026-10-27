// The lock a collector holds on its data directory.
//
// A single collector must own a data dir: two writing the same files duplicate
// appended rows and clobber each other's snapshots. Every store here reads a
// whole file and writes a whole file, so a second writer does not interleave
// badly — it silently erases whatever the first one appended since it last read.
//
// Its own module so a host can catch CollectorBusyError without importing the
// recorder whose loading is what raises it — a module that throws while
// evaluating never exposes its exports — and so the mechanism can be tested
// without starting a recorder.
//
// ## Why liveness is a heartbeat and not a pid
//
// The obvious lock records the owner's pid and lets the next starter probe it
// with kill(pid, 0). That reads as sound and is not, because a pid only means
// something inside the pid namespace that issued it. The deployment this
// project ships — `compose.yaml`, a named volume mounted at /data — is exactly
// the case where that breaks: the Dockerfile's exec-form CMD makes node pid 1 in
// every container, so two containers sharing one volume both record `1` and
// both read `1` back. Each concludes the lock is its own, takes it, and the two
// recorders proceed to overwrite each other's history. The check is not merely
// weak across namespaces, it is arbitrary: a pid left by a dead container can
// equally well name some live process in the next one, and the lock wedges shut
// instead.
//
// So the holder proves it is alive directly, by touching the lock file every
// HEARTBEAT_MS. A lock that has gone quiet longer than STALE_AFTER_MS had its
// holder die — killed, crashed, container stopped — and the next starter takes
// it. Nothing about that reasoning depends on which namespace anybody's pid came
// from, and a crash still cannot wedge the directory shut, which is the property
// the pid probe was there to provide.
//
// The pid is still written alongside, for the operator reading the error message
// and reaching for `ps`. Nothing decides anything by it.

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/**
 * Raised when a live collector already owns the data directory.
 */
export class CollectorBusyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CollectorBusyError";
  }
}

/** How often the holder proves it is still alive. One utimes call, so the cost
 *  of a tighter beat is not what sets this — STALE_AFTER_MS is. */
const HEARTBEAT_MS = 5_000;

/**
 * How quiet a lock must go before another starter may take it.
 *
 * Six missed beats. The recorder writes its stores synchronously and folds a
 * year of minutes into monthly summaries on one of them, so the event loop can
 * legitimately stall for seconds at a time; a margin this wide means a busy
 * recorder is never mistaken for a dead one. The cost is paid only after an
 * actual crash, where a restart waits out the remainder of the window before
 * reclaiming — and `restart: unless-stopped` covers that on its own.
 */
const STALE_AFTER_MS = 30_000;

const LOCK_FILE_NAME = "historian.lock";

interface HeldLock {
  dir: string;
  file: string;
  /** What makes the lock ours to release. A pid cannot: see the note above. */
  token: string;
  heartbeat: ReturnType<typeof setInterval>;
}

// globalThis, not module-scope state: Vite's SSR restart can re-evaluate this
// module within one process, and a claim must survive that.
const HELD = Symbol.for("dishylink.collectorLock.held");

function heldLock(): HeldLock | undefined {
  return (globalThis as Record<symbol, unknown>)[HELD] as HeldLock | undefined;
}

/** Milliseconds since the lock was last touched, or null if it is not there. */
function quietFor(file: string): number | null {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    // Gone between our failed create and this stat — another starter reclaimed
    // it first. Not an error: the retry finds it either free or freshly held.
    return null;
  }
}

/** The owner's pid, for the error message only. Absent if the lock is gone or
 *  its contents are not what we write. */
function recordedPid(file: string): string {
  try {
    const pid = readFileSync(file, "utf8").trim().split(" ")[1];
    return pid ? `pid ${pid}` : "unknown owner";
  } catch {
    return "unknown owner";
  }
}

function startHeartbeat(file: string): ReturnType<typeof setInterval> {
  const heartbeat = setInterval(() => {
    const now = new Date();
    try {
      utimesSync(file, now, now);
    } catch {
      // The lock was taken from under us, which only happens if this process
      // stalled past the whole stale window. Nothing to do from a timer: the
      // release below will find the token no longer ours and leave it alone.
    }
  }, HEARTBEAT_MS);
  // A held lock is never a reason to keep a process alive: a recorder with
  // nothing else scheduled is a recorder that has stopped recording.
  heartbeat.unref();
  return heartbeat;
}

/**
 * Take the data directory, or raise saying who has it.
 *
 * Raises rather than exits so the caller decides what a busy directory means to
 * it — the standalone recorder ends the process, an embedded one carries on
 * without a recorder.
 *
 * @throws {CollectorBusyError} when a live collector holds it
 */
export function claimDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, LOCK_FILE_NAME);
  if (heldLock()?.dir === dataDir) {
    throw new CollectorBusyError(
      `this process already owns ${dataDir} — refusing to start a second writer in the same process`,
    );
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(file, "wx");
      const token = randomUUID();
      writeSync(fd, `${token} ${process.pid}`);
      closeSync(fd);
      (globalThis as Record<symbol, unknown>)[HELD] = {
        dir: dataDir,
        file,
        token,
        heartbeat: startHeartbeat(file),
      } satisfies HeldLock;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const quietMs = quietFor(file);
      if (quietMs !== null && quietMs < STALE_AFTER_MS) {
        throw new CollectorBusyError(
          `another collector (${recordedPid(file)}, last seen ${Math.round(quietMs / 1000)}s ago) ` +
            `already owns ${dataDir} — refusing to start a second writer`,
        );
      }
      // Its holder stopped proving it was alive, or the lock vanished as we
      // looked at it. Drop it and race for it again.
      try {
        unlinkSync(file);
      } catch {
        // Another starter reclaimed it first; the next attempt finds it held.
      }
    }
  }
  throw new Error(`could not claim ${dataDir} — refusing to start`);
}

/**
 * Give the directory back, if this process still holds it.
 *
 * The token check is what makes that "if" real: a process stalled past the stale
 * window has already had its lock reclaimed by someone else, and removing the
 * file then would hand a live collector's directory to the next starter.
 */
export function releaseDataDir(): void {
  const held = heldLock();
  if (!held) return;
  clearInterval(held.heartbeat);
  (globalThis as Record<symbol, unknown>)[HELD] = undefined;
  try {
    if (readFileSync(held.file, "utf8").trim().split(" ")[0] === held.token) unlinkSync(held.file);
  } catch {
    // Already gone, or no longer ours to remove.
  }
}
