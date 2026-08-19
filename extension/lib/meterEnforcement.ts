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
  releasedByHand,
  stalledPauses,
  stalledReleases,
  type MeterRule,
  type MeterTransition,
} from "@core/dataMeter";
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

/** How one pause write went, applied to the rules in a single pass rather than
 *  re-reading the whole set per device. */
interface PauseOutcome {
  clientKey: string;
  state: MeterRule["pauseState"];
  error?: string;
}

/**
 * Check every allowance against the counters the odometer holds.
 *
 * Enforcement here lands on the next alarm and only while the browser runs, which
 * is the one thing that differs from the desktop recorder. Whether a device is
 * over is decided by the same function on both.
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
  if (stored.length === 0 && storedGroups.length === 0) return { transitions: [], active: [] };
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
  await standDownProjectedOut(store, host, odometer, groups, resolved, onLiveKeys, now);
  // Before anything is retried: a device someone already unpaused owes no write,
  // and the rule's own record of pausing it is the stale half.
  const alreadyUnpaused = new Set(
    releasedByHand(onLiveKeys, blocked).map((rule) => rule.clientKey),
  );
  const reconciled = onLiveKeys.map((rule) =>
    alreadyUnpaused.has(rule.clientKey) ? { ...rule, pauseState: "none" as const } : rule,
  );
  const { rules, transitions } = evaluateMeters(reconciled, lifetimes, now);
  const signedIn = host.signedIn();
  const groupById = new Map(groups.map((group) => [group.groupId, group]));
  // A release is a router write, not news: the announcement it would once have
  // cleared retired a minute after it was raised. Members of a shared allowance
  // are every one of them paused, and the group announces once.
  const announcements = collapseGroupAnnouncements(transitions).flatMap((transition) =>
    transition.kind === "released"
      ? []
      : [meterAlert(transition, deviceName(odometer, transition.clientKey), signedIn, groupById)],
  );

  const outcomes = signedIn
    ? await sendPauses(host, rules, transitions, now)
    : transitions.flatMap((transition): PauseOutcome[] => {
        const unreachable = "No Starlink account connected";
        // The cycle rolled on a device this rule is holding, and the release
        // cannot be sent. It stays recorded as held so the retry has something to
        // find; forgetting it leaves the device blocked at the router with
        // nothing left that knows to free it.
        if (transition.kind === "released")
          return [{ clientKey: transition.clientKey, state: "applied", error: unreachable }];
        if (transition.kind === "reached" && transition.rule.autoPause)
          return [{ clientKey: transition.clientKey, state: "failed", error: unreachable }];
        return [];
      });

  applyPauseOutcomes(rules, outcomes, now);
  await store.writeMeterRules(rules);
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
 * Settle the rules the projection took away.
 *
 * A device dropped from a group is no longer metered by anything, so the pause
 * its rule was holding has nothing left that knows to lift it. A rule whose
 * announcement moved to its group owes the device key a clearing, since nothing
 * filed under the group can close an episode opened under the device.
 */
async function standDownProjectedOut(
  store: HistoryStore,
  host: MeterHost,
  odometer: ClientTotalsCore,
  groups: readonly DeviceGroup[],
  before: readonly MeterRule[],
  after: readonly MeterRule[],
  nowMs: number,
): Promise<void> {
  const byKey = new Map(after.map((rule) => [rule.clientKey, rule]));
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
    const still = byKey.get(rule.clientKey);
    if (still && announcementSubject(still) === announcementSubject(rule)) continue;
    if (!stillAnnouncing(rule))
      await retireMeterAlert(store, rule, deviceName(odometer, rule.clientKey), nowMs, groupsById);
    if (!still) await standDownMeterRule(host, rule, undefined);
  }
}

async function sendPauses(
  host: MeterHost,
  rules: readonly MeterRule[],
  transitions: readonly MeterTransition[],
  now: number,
): Promise<PauseOutcome[]> {
  const outcomes: PauseOutcome[] = [];
  // Stamped before the write, not after it: a failure that repeats word for word
  // reports no change, and a rule left holding its old timestamp would be asked
  // for the same write again on the next drain rather than after the window.
  const attempt = async (clientKey: string, paused: boolean) => {
    const rule = rules.find((other) => other.clientKey === clientKey);
    if (rule) rule.pauseCheckedMs = now;
    const outcome = await sendMeterPause(host, clientKey, paused);
    if (outcome) outcomes.push(outcome);
  };
  for (const transition of transitions) {
    // Retiring an announcement reaches no router.
    if (transition.kind === "expired") continue;
    const reached = transition.kind === "reached";
    // A release is raised only for a pause this rule applied, so it is owed
    // whether or not the rule still enforces.
    if (!reached || transition.rule.autoPause) await attempt(transition.clientKey, reached);
  }
  // A write that failed or never came back is owed another try. The transition
  // that raised it has already latched, so nothing else returns to that rule.
  const latched = new Set(
    transitions.filter((t) => t.kind !== "expired").map((transition) => transition.clientKey),
  );
  for (const rule of stalledPauses(rules, now, PAUSE_RETRY_MS))
    if (!latched.has(rule.clientKey)) await attempt(rule.clientKey, true);
  for (const rule of stalledReleases(rules, now, PAUSE_RETRY_MS))
    if (!latched.has(rule.clientKey)) await attempt(rule.clientKey, false);
  return outcomes;
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

/** Every route that removes, restarts or rewrites a rule goes through here: a
 *  rule that stops pausing a device is the last thing that could release it. */
export async function standDownMeterRule(
  host: MeterHost,
  before: MeterRule | undefined,
  after: MeterRule | undefined,
): Promise<void> {
  if (before?.pauseState !== "applied" || after?.pauseState === "applied") return;
  const clientId = Number(before.clientKey);
  if (!Number.isInteger(clientId)) return;
  await host.setPaused(clientId, false).catch(() => {});
}

/**
 * Pause or release the device through the account rather than the LAN — current
 * firmware refuses a LAN write. A release that does not land is left unrecorded:
 * the rule already says the device is held, which stays true until one does.
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
    // A release that did not land leaves the device held, and the rule is the
    // only record of that. Saying "none" here would lose the device behind a rule
    // claiming nothing is wrong.
    return { clientKey, state: paused ? "failed" : "applied", error: (error as Error).message };
  }
}

function applyPauseOutcomes(
  rules: MeterRule[],
  outcomes: readonly PauseOutcome[],
  nowMs: number,
): void {
  for (const outcome of outcomes) {
    const rule = rules.find((other) => other.clientKey === outcome.clientKey);
    if (!rule) continue;
    if (rule.pauseState === outcome.state && rule.pauseError === outcome.error) continue;
    rule.pauseState = outcome.state;
    rule.pauseCheckedMs = nowMs;
    if (outcome.error === undefined) delete rule.pauseError;
    else rule.pauseError = outcome.error;
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
