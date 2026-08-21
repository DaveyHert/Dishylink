// Data limits, checked and enforced for the extension recorder.
//
// Separate from the drain so it reaches no dish, no router, and no browser API:
// the verdict is the same pure core the desktop recorder uses, and what is left
// here is one store and one account.

import {
  announcementSubject,
  announcesAsGroup,
  collapseGroupAnnouncements,
  evaluateMeters,
  listChanged,
  resolveRuleKeys,
  ruleKey,
  type MeterRule,
  type MeterTransition,
} from "@core/dataMeter";
import {
  blocksLanded,
  clearSettledOverrides,
  forgetSettled,
  notePause,
  pausesOwed,
  releasedByHand,
  releasesOwed,
  type DevicePause,
  type DevicePauses,
  type PauseState,
} from "@core/devicePause";
import { projectGroupRules, resolveGroupMembers, type DeviceGroup } from "@core/deviceGroup";
import type { AlertState } from "@core/alertDefinitions";
import { CONNECT_ACCOUNT_ADVICE, dataLimitAlertSpec } from "@core/dataMeterAlert";
import type { AlertTransition } from "@core/alertEngine";
import type { ClientTotalsCore } from "@core/clientTotals";
import type { HistoryStore } from "./history";
import type { MeterHost } from "./meterHost";

/** Matches the desktop recorder's window, so a limit is retried at the same rate
 *  wherever it is enforced. The drain alarm runs every 30 s, so this spaces the
 *  attempts rather than following the tick. */
const PAUSE_RETRY_MS = 60_000;

/** How one pause write went. */
interface PauseOutcome {
  clientKey: string;
  state: PauseState;
  error?: string;
}

/**
 * Check every rule against the counters the odometer holds.
 *
 * Enforcement here lands on the next alarm and only while the browser runs, which
 * is the one thing that differs from the desktop recorder. Whether a device is
 * over is decided by the same functions on both.
 */
export async function runMeters(
  store: HistoryStore,
  odometer: ClientTotalsCore,
  host: MeterHost,
  now: number,
  blocked: ReadonlyMap<string, boolean> = new Map(),
): Promise<{ transitions: AlertTransition[]; active: AlertState[] }> {
  const stored = await store.readMeterRules();
  const storedGroups = await store.readDeviceGroups();
  const storedPauses = await store.readDevicePauses();
  if (stored.length === 0 && storedGroups.length === 0 && storedPauses.length === 0)
    return { transitions: [], active: [] };
  const lifetimes = odometer.lifetimes();
  const roster = {
    keys: lifetimes.map((entry) => entry.clientKey),
    resolveKey: (key: string) => odometer.resolveKey(key),
  };
  const groups = resolveGroupMembers(storedGroups, roster);
  if (listChanged(groups, storedGroups)) await store.writeDeviceGroups(groups);
  const resolved = resolveRuleKeys(stored, roster);
  const onLiveKeys = projectGroupRules({
    groups,
    rules: resolved,
    counters: lifetimes,
    nowMs: now,
  });
  await retireProjectedOut(store, odometer, groups, resolved, onLiveKeys, now);
  const { rules, transitions } = evaluateMeters(onLiveKeys, lifetimes, now);
  const signedIn = host.signedIn();
  const groupById = new Map(groups.map((group) => [group.groupId, group]));
  // Members of a shared allowance are every one of them held, and the group
  // announces once.
  const announcements = collapseGroupAnnouncements(transitions).map((transition) =>
    meterAlert(transition, deviceName(odometer, transition.clientKey), signedIn, groupById),
  );

  // Before anything is written: a device someone already unpaused owes no write,
  // and this record of holding it is the stale half.
  let pauses: DevicePauses = new Map(storedPauses.map((pause) => [pause.clientKey, pause]));
  // First, because until a block is known to have landed the reading below cannot
  // be read at all: a roster that has not caught up with the write yet and one
  // that has caught up with a person's release look exactly alike.
  for (const clientKey of blocksLanded(pauses, blocked)) {
    const held = pauses.get(clientKey)!;
    const { clientKey: _key, ...rest } = held;
    pauses = notePause(pauses, clientKey, { ...rest, confirmedMs: now });
  }
  for (const clientKey of releasedByHand(pauses, blocked))
    // Overruled, not merely unblocked: the rules go on holding it, and the next
    // drain would otherwise pause it straight back.
    pauses = notePause(pauses, clientKey, {
      state: "none",
      attempted: "release",
      checkedMs: now,
      overridden: true,
    });
  // An override outlives nothing: once the rules behind it have let go, the next
  // limit this device reaches is enforced as normal.
  pauses = clearSettledOverrides(pauses, rules);
  pauses = await settleDeviceBlocks(host, rules, pauses, signedIn, now);

  await store.writeMeterRules(rules);
  await store.writeDevicePauses([...forgetSettled(pauses, rules).values()]);
  if (announcements.length > 0) await store.applyAlertTransitions(announcements, now);
  const announcing = rules.filter((rule) => rule.reachedAtMs !== undefined);
  const seen = new Set<string>();
  const active = announcing.flatMap((rule) => {
    const subject = announcementSubject(rule);
    if (seen.has(subject)) return [];
    seen.add(subject);
    return [meterAlertState(rule, deviceName(odometer, rule.clientKey), signedIn, groupById)];
  });
  return { transitions: announcements, active };
}

/**
 * Retire the announcements the projection took away.
 *
 * A rule being dropped, or having its announcement move to its group, takes its
 * stamp with it, and nothing filed under the new key can close an episode opened
 * under the old one. The device's block is not settled here: it is held on the
 * device, and the scan below releases it once no rule holds it.
 */
export async function retireProjectedOut(
  store: HistoryStore,
  odometer: ClientTotalsCore,
  groups: readonly DeviceGroup[],
  before: readonly MeterRule[],
  after: readonly MeterRule[],
  nowMs: number,
): Promise<void> {
  const byKey = new Map(after.map((rule) => [ruleKey(rule), rule]));
  const groupsById = new Map(groups.map((group) => [group.groupId, group]));
  const stillAnnouncing = (rule: MeterRule) =>
    announcesAsGroup(rule) &&
    after.some(
      (other) =>
        other.groupId === rule.groupId &&
        other.clientKey !== rule.clientKey &&
        other.reachedAtMs !== undefined,
    );
  for (const rule of before) {
    const still = byKey.get(ruleKey(rule));
    if (still && announcementSubject(still) === announcementSubject(rule)) continue;
    if (!stillAnnouncing(rule))
      await retireMeterAlert(store, rule, deviceName(odometer, rule.clientKey), nowMs, groupsById);
  }
}

/**
 * Bring the router's view of every device in line with the rules.
 *
 * Asked of the rules rather than remembered from an edge, so every way a rule can
 * end — rolled, edited, deleted, its group emptied — settles here rather than in
 * whichever path made the change. One write per device, however many rules are
 * holding it.
 */
async function settleDeviceBlocks(
  host: MeterHost,
  rules: readonly MeterRule[],
  pauses: DevicePauses,
  signedIn: boolean,
  now: number,
): Promise<DevicePauses> {
  const owedPause = pausesOwed(rules, pauses, now, PAUSE_RETRY_MS);
  const owedRelease = releasesOwed(rules, pauses, now, PAUSE_RETRY_MS);
  let settled = pauses;
  const note = (clientKey: string, next: Omit<DevicePause, "clientKey">) => {
    settled = notePause(settled, clientKey, next);
  };
  // The confirmation belongs to the block, so a record staying "applied" — a
  // release that would not go through — keeps it: it is the same block the router
  // was seen holding, not a new write still on its way to the roster.
  const stillLanded = (clientKey: string) => {
    const confirmedMs = settled.get(clientKey)?.confirmedMs;
    return confirmedMs === undefined ? {} : { confirmedMs };
  };

  if (!signedIn) {
    const error = "No Starlink account connected";
    // Recorded as still held rather than forgotten: the device is blocked at the
    // router and this record is the only thing that knows to free it.
    for (const clientKey of owedPause)
      note(clientKey, { state: "failed", error, attempted: "pause", checkedMs: now });
    for (const clientKey of owedRelease)
      note(clientKey, {
        state: "applied",
        error,
        ...stillLanded(clientKey),
        attempted: "release",
        checkedMs: now,
      });
    return settled;
  }

  for (const clientKey of owedPause) {
    // Stamped before the write: a failure that repeats word for word records no
    // change, and a device left holding its old stamp would be asked for the same
    // write on the next drain rather than after the window.
    note(clientKey, {
      state: pauses.get(clientKey)?.state ?? "none",
      attempted: "pause",
      checkedMs: now,
    });
    const outcome = await sendMeterPause(host, clientKey, true);
    if (outcome)
      note(clientKey, {
        state: outcome.state,
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        attempted: "pause",
        checkedMs: now,
      });
  }
  for (const clientKey of owedRelease) {
    note(clientKey, {
      state: "applied",
      ...stillLanded(clientKey),
      attempted: "release",
      checkedMs: now,
    });
    const outcome = await sendMeterPause(host, clientKey, false);
    if (outcome)
      note(clientKey, {
        state: outcome.state,
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        ...(outcome.state === "applied" ? stillLanded(clientKey) : {}),
        attempted: "release",
        checkedMs: now,
      });
  }
  return settled;
}

/**
 * Retire a going rule's announcement, if one still stands.
 *
 * Every other announcement retires off its own stamp on a later drain. A deleted
 * rule takes its stamp with it, so this is the only thing that can close the
 * episode — and an episode left open outlives the retention sweep.
 */
export async function retireMeterAlert(
  store: HistoryStore,
  rule: MeterRule | undefined,
  deviceName: string,
  nowMs: number,
  groups?: GroupsById,
): Promise<void> {
  if (rule?.reachedAtMs === undefined) return;
  // Signed-in only shapes the advice, which a clearing does not carry.
  const spec = meterSpec(rule, deviceName, false, groups);
  await store.applyAlertTransitions(
    [{ kind: "cleared", source: "system", key: spec.key, atMs: nowMs, spec }],
    nowMs,
  );
}

/**
 * Pause or release the device through the account rather than the LAN — current
 * firmware refuses a LAN write. A release that does not land is left recorded as
 * held: the device is still blocked, and this record is what knows to retry.
 */
async function sendMeterPause(
  host: MeterHost,
  clientKey: string,
  paused: boolean,
): Promise<PauseOutcome | null> {
  const clientId = Number(clientKey);
  if (!Number.isInteger(clientId))
    return paused
      ? { clientKey, state: "failed", error: "this device has no router id to pause by" }
      : null;
  try {
    await host.setPaused(clientId, paused);
    return { clientKey, state: paused ? "applied" : "none" };
  } catch (error) {
    return { clientKey, state: paused ? "failed" : "applied", error: (error as Error).message };
  }
}

/** Falls back to the key, the wording the desktop recorder uses for the same case. */
function deviceName(odometer: ClientTotalsCore, clientKey: string): string {
  return odometer.totals(clientKey)[0]?.name?.trim() || `device ${clientKey}`;
}

type GroupsById = ReadonlyMap<string, DeviceGroup>;

function meterSpec(rule: MeterRule, name: string, signedIn: boolean, groups?: GroupsById) {
  const group = announcesAsGroup(rule) ? groups?.get(rule.groupId!) : undefined;
  return dataLimitAlertSpec(rule, name, {
    advice: rule.autoPause && !signedIn ? CONNECT_ACCOUNT_ADVICE : undefined,
    // A group down to this one device is just this device, and reads as it.
    groupName: group && group.memberKeys.length > 1 ? group.name : undefined,
  });
}

function meterAlert(
  transition: MeterTransition,
  name: string,
  signedIn: boolean,
  groups?: GroupsById,
): AlertTransition {
  const spec = meterSpec(transition.rule, name, signedIn, groups);
  return {
    kind: transition.kind === "reached" ? "fired" : "cleared",
    source: "system",
    key: spec.key,
    atMs: transition.atMs,
    spec,
  };
}

function meterAlertState(
  rule: MeterRule,
  name: string,
  signedIn: boolean,
  groups?: GroupsById,
): AlertState {
  return { ...meterSpec(rule, name, signedIn, groups), source: "system", active: true };
}
