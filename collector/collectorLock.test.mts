// The lock exists to stop two recorders writing one data directory, and the way
// it used to fail is worth pinning: liveness was a pid probe, and a pid means
// nothing across pid namespaces. Two containers sharing a volume are both pid 1,
// so each read the other's lock as its own and took it.
//
// That case cannot be staged in a unit test — there is one namespace here — but
// its mechanism can be, exactly: a lock recording *this* process's own pid is
// what a second container sees, and it must still be refused while its holder is
// touching it. The pid is a red herring; only the heartbeat decides.

import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollectorBusyError, claimDataDir, releaseDataDir } from "./collectorLock.mts";

let dir: string;
let lock: string;

beforeEach(() => {
  dir = join(tmpdir(), `collectorlock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  lock = join(dir, "historian.lock");
});

afterEach(() => {
  releaseDataDir();
  rmSync(dir, { recursive: true, force: true });
});

const FOREIGN_TOKEN = "00000000-0000-4000-8000-000000000000";

/** A lock held by someone else: our token is not in it, and it was touched at
 *  `agoMs`, which is the only thing the claim actually judges. */
function foreignLock(agoMs: number, pid: number = process.pid): void {
  writeFileSync(lock, `${FOREIGN_TOKEN} ${pid}`);
  const touchedAt = new Date(Date.now() - agoMs);
  utimesSync(lock, touchedAt, touchedAt);
}

const STALE_AFTER_MS = 30_000;

describe("claimDataDir", () => {
  it("takes a directory nobody holds", () => {
    claimDataDir(dir);
    expect(existsSync(lock)).toBe(true);
  });

  it("creates the data directory when it does not exist yet", () => {
    const fresh = join(dir, "nested", "data");
    claimDataDir(fresh);
    expect(existsSync(join(fresh, "historian.lock"))).toBe(true);
  });

  it("refuses a directory whose holder is still beating", () => {
    foreignLock(1_000);
    expect(() => claimDataDir(dir)).toThrow(CollectorBusyError);
  });

  // The regression this whole change is for. A pid probe would see this process's
  // own pid, conclude the lock was its own leftover, and take a live collector's
  // directory — which is precisely what two containers at pid 1 did to each other.
  it("refuses a beating holder that recorded this very pid", () => {
    foreignLock(1_000, process.pid);
    expect(() => claimDataDir(dir)).toThrow(CollectorBusyError);
    expect(readFileSync(lock, "utf8")).toContain(FOREIGN_TOKEN);
  });

  // The other half: a pid that is alive here must not wedge the directory shut
  // when the lock behind it went quiet. Under the old probe this was a permanent
  // refusal every time a dead container's pid happened to exist in the next one.
  it("reclaims a lock that stopped beating, whatever pid it names", () => {
    foreignLock(STALE_AFTER_MS + 5_000, process.pid);
    expect(() => claimDataDir(dir)).not.toThrow();
    expect(readFileSync(lock, "utf8")).not.toContain(FOREIGN_TOKEN);
  });

  it("refuses a second claim on a directory this process already holds", () => {
    claimDataDir(dir);
    expect(() => claimDataDir(dir)).toThrow(CollectorBusyError);
  });
});

describe("releaseDataDir", () => {
  it("removes a lock this process holds", () => {
    claimDataDir(dir);
    releaseDataDir();
    expect(existsSync(lock)).toBe(false);
  });

  it("is a no-op when nothing is held", () => {
    expect(() => releaseDataDir()).not.toThrow();
  });

  // A process stalled past the stale window has already had its lock reclaimed.
  // Releasing on the way out must not then delete the live collector's lock and
  // hand the directory to whoever starts next.
  it("leaves a lock alone once someone else has taken it", () => {
    claimDataDir(dir);
    foreignLock(1_000);
    releaseDataDir();
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, "utf8")).toContain(FOREIGN_TOKEN);
  });
});
