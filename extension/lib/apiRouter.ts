// Answers /api/* for the extension, reading from the IndexedDB history store —
// the counterpart to the historian's HTTP handler and the desktop app's app://
// handler. The renderer reaches this over runtime messaging (it has no origin
// serving /api), but the routing itself is a plain function over a store, so it
// is exercised in tests with the in-memory store rather than only through a live
// service worker.
//
// Energy and usage ride the same per-minute buckets, so one summary answers
// both. Feeds the extension does not record yet answer 503, which the dashboard
// renders as its "history unavailable" state — the same thing it shows when the
// desktop historian isn't running.

import { energyRangeBounds, RANGES, summarizeEnergy, type Range } from "@core/energySummary";
import { ClientTotalsCore, migrateSnapshot } from "@core/clientTotals";
import {
  announcementSubject,
  announcesAsGroup,
  chargedBytes,
  cycleFromParams,
  MAX_COUNTDOWN_MS,
  restartCycle,
  ruleHoldsDevice,
  ruleKey,
  ruleSpent,
  sharedUsageByGroup,
  upsertRule,
  usageBytes,
  type MeterRule,
} from "@core/dataMeter";
import type { DevicePauses, PauseState } from "@core/devicePause";
import { usageKey } from "@core/clientUsage";
import { newGroupId, projectGroupRules, type DeviceGroup } from "@core/deviceGroup";
import { parseScheduleParam } from "@core/schedule";
import { NO_METER_HOST, type MeterHost } from "./meterHost";
import { retireMeterAlert, retireProjectedOut } from "./meterEnforcement";
import { resolveRows, foldMinuteCollisions } from "@core/clientHistory";
import type { ClientSampleRow, HistoryStore } from "./history";

// The alert keys the dish raises for heat; /api/thermal is the alert log narrowed
// to these. Matches the historian's THERMAL_ALERT_KEYS.
const THERMAL_ALERT_KEYS = ["thermalThrottle", "thermalShutdown", "powerSupplyThermalThrottle"];

export interface ApiReply {
  status: number;
  body: unknown;
}

export async function routeApiRequest(
  store: HistoryStore,
  path: string,
  now: Date = new Date(),
  method: string = "GET",
  body?: string,
  host: MeterHost = NO_METER_HOST,
): Promise<ApiReply> {
  const url = new URL(path, "http://extension.invalid");

  if (url.pathname === "/api/energy" || url.pathname === "/api/usage") {
    const requested = url.searchParams.get("range") as Range | null;
    const range: Range = requested && RANGES.includes(requested) ? requested : "today";
    const { startSec, endSec } = energyRangeBounds(range, now);
    const buckets = await store.readMinutes(startSec, endSec);
    return { status: 200, body: summarizeEnergy(buckets, range, now) };
  }

  if (url.pathname === "/api/outages") {
    return { status: 200, body: { events: await store.readOutages(now.getTime()) } };
  }

  if (url.pathname === "/api/radio") {
    return { status: 200, body: await store.readRadio() };
  }

  // The dish's raw 1 Hz window, so the main charts backfill on reload.
  if (url.pathname === "/api/samples") {
    const minutes = Math.min(360, Math.max(1, Number(url.searchParams.get("minutes") ?? 360)));
    return { status: 200, body: { samples: await store.readSamples(minutes, now.getTime()) } };
  }

  if (url.pathname === "/api/alerts") {
    return { status: 200, body: { episodes: await store.readAlerts(now.getTime()) } };
  }

  if (url.pathname === "/api/thermal") {
    // Thermal is the alert log filtered to the thermal keys, in the source-less
    // shape the historian's thermal store serves.
    const episodes = (await store.readAlerts(now.getTime()))
      .filter((e) => THERMAL_ALERT_KEYS.includes(e.key))
      .map((e) => ({ alertKey: e.key, startMs: e.startMs, endMs: e.endMs }));
    return { status: 200, body: { episodes } };
  }

  if (url.pathname === "/api/obstruction/snapshots") {
    return {
      status: 200,
      body: { snapshots: await store.readObstructionSnapshots(now.getTime()) },
    };
  }

  // The rules, each with what it has counted, so a card needs one request. Same
  // routes the desktop recorder serves, so the card is host-agnostic.
  if (url.pathname === "/api/clients/meters") {
    const client = url.searchParams.get("client");
    const rules = await store.readMeterRules();
    if (method === "DELETE") {
      // `own` drops only the rule the device carries itself, for a surface deleting
      // one rule of the several a device can answer to. Without it the device is
      // unmetered outright, which is what a card offering to stop metering it means.
      const ownOnly = url.searchParams.get("scope") === "own";
      const isGoing = (rule: MeterRule) =>
        rule.clientKey === client && (!ownOnly || rule.groupId === undefined);
      const going = rules.filter(isGoing);
      const kept = rules.filter((rule) => !isGoing(rule));
      const removed = kept.length !== rules.length;
      if (removed) await store.writeMeterRules(kept);
      // A member's rule is the group's, and the projection would write it straight
      // back on the next drain. Unmetering the device means leaving every group
      // that names it, not only the one whose rule was read first.
      if (client && !ownOnly && going.some((rule) => rule.groupId !== undefined)) {
        const groups = await store.readDeviceGroups();
        await store.writeDeviceGroups(
          groups
            .map((group) =>
              group.memberKeys.includes(client)
                ? { ...group, memberKeys: group.memberKeys.filter((key) => key !== client) }
                : group,
            )
            // A group left with no members covers nothing, the same as on the
            // record-deleted route.
            .filter((group) => group.memberKeys.length > 0),
        );
      }
      // The block the device is under is lifted by the next drain, which finds it
      // with no rule holding it.
      const names = await meterNames(store);
      const groupsById = new Map(
        (await store.readDeviceGroups()).map((group) => [group.groupId, group]),
      );
      for (const rule of going)
        await retireMeterAlert(
          store,
          rule,
          meterDeviceName(names, rule.clientKey),
          now.getTime(),
          groupsById,
        );
      return { status: 200, body: { removed } };
    }
    if (method === "POST") {
      const cycle = cycleFromParams(url.searchParams, now.getTime());
      const allocationBytes = Number(url.searchParams.get("allocation"));
      const countdownMs = countdownFromParams(url.searchParams);
      const schedule = parseScheduleParam(url.searchParams.get("schedule"));
      if (!client || !cycle) return { status: 400, body: { error: "bad_request" } };
      // A countdown measures the clock and a timetable measures it too, so
      // neither needs an allowance behind it.
      if (
        countdownMs === null &&
        schedule === null &&
        (!Number.isFinite(allocationBytes) || allocationBytes <= 0)
      )
        return { status: 400, body: { error: "bad_request" } };
      const odometer = await loadOdometer(store);
      const counters = odometer.lifetimes().find((entry) => entry.clientKey === client);
      // The device's own rule, never one a group is keeping for it: a card setting
      // a limit here has no group behind it, and the next projection would put the
      // group's terms back anyway.
      const key = ruleKey({ clientKey: client });
      const existing = rules.find((other) => ruleKey(other) === key);
      const rule = upsertRule(existing, {
        clientKey: client,
        allocationBytes: Number.isFinite(allocationBytes) ? Math.max(0, allocationBytes) : 0,
        autoPause: url.searchParams.get("autoPause") !== "0",
        cycle,
        lifetimeRx: counters?.lifetimeRx ?? 0,
        lifetimeTx: counters?.lifetimeTx ?? 0,
        nowMs: now.getTime(),
        ...(countdownMs === null ? {} : { countdownMs }),
        ...(schedule === null ? {} : { schedule }),
      });
      const index = rules.findIndex((other) => ruleKey(other) === key);
      const written =
        index === -1
          ? [...rules, rule]
          : rules.map((other, position) => (position === index ? rule : other));
      await store.writeMeterRules(written);
      return {
        status: 200,
        body: {
          rule: withUsage(
            rule,
            await meterNames(store),
            sharedUsageByGroup(written),
            now.getTime(),
            await store.readDeviceGroups(),
            new Map((await store.readDevicePauses()).map((pause) => [pause.clientKey, pause])),
          ),
        },
      };
    }
    const mine = client ? rules.filter((rule) => rule.clientKey === client) : rules;
    const names = await meterNames(store);
    const groups = await store.readDeviceGroups();
    // One sum for the whole answer: a shared allowance is read off every member,
    // and asking a single-device request for it costs nothing.
    const sharedUsage = sharedUsageByGroup(rules);
    const pauses = new Map(
      (await store.readDevicePauses()).map((pause) => [pause.clientKey, pause]),
    );
    return {
      status: 200,
      body: {
        rules: mine.map((rule) =>
          withUsage(rule, names, sharedUsage, now.getTime(), groups, pauses),
        ),
        // Enforcement here lands on the next alarm rather than within a poll, but
        // whether it lands at all is the same question: is there an account.
        pauseEnforceable: host.signedIn(),
      },
    };
  }

  // Allowances set across several devices. Members are projected into the rules
  // above on the next drain, so nothing is written to them here.
  if (url.pathname === "/api/clients/groups") {
    const groups = await store.readDeviceGroups();
    if (method === "DELETE") {
      const groupId = url.searchParams.get("group");
      const going = groups.find((group) => group.groupId === groupId);
      if (!going) return { status: 200, body: { removed: false } };
      await store.writeDeviceGroups(groups.filter((group) => group !== going));
      await standDownGroup(store, going, now.getTime());
      return { status: 200, body: { removed: true } };
    }
    if (method === "POST") {
      const group = groupFromParams(url.searchParams, groups, now.getTime());
      if (!group) return { status: 400, body: { error: "bad_request" } };
      const index = groups.findIndex((other) => other.groupId === group.groupId);
      const kept =
        index === -1
          ? [...groups, group]
          : groups.map((other, position) => (position === index ? group : other));
      await store.writeDeviceGroups(kept);
      // The drain is 30 s away, and until it runs the members would read as
      // carrying no limit at all.
      const odometer = await loadOdometer(store);
      const before = await store.readMeterRules();
      const projected = projectGroupRules({
        groups: kept,
        rules: before,
        counters: odometer.lifetimes(),
        nowMs: now.getTime(),
      });
      await store.writeMeterRules(projected);
      // A rule this write drops takes its announcement's stamp with it, and
      // nothing else can close that episode. Any block its device is under is
      // lifted by the next drain, which finds no rule holding it.
      await retireProjectedOut(store, odometer, kept, before, projected, now.getTime());
      return { status: 200, body: { group } };
    }
    return { status: 200, body: { groups, pauseEnforceable: host.signedIn() } };
  }

  // Start one rule over, leaving the device's own usage standing.
  if (url.pathname === "/api/clients/meters/reset" && method === "POST") {
    const client = url.searchParams.get("client");
    const group = url.searchParams.get("group");
    const rules = await store.readMeterRules();
    // Named the way a rule is: its group, or the device carrying its own. A
    // device answers to as many rules as name it, so restarting by device alone
    // starts over every one of them — including other devices' months, through a
    // group this device happens to share.
    const named = (rule: MeterRule) =>
      group === null
        ? rule.groupId === undefined && rule.clientKey === client
        : rule.groupId === group;
    const restarting = new Set(rules.filter(named));
    if (restarting.size === 0) return { status: 200, body: { rules: [] } };
    const written = rules.map((rule) =>
      restarting.has(rule) ? restartCycle(rule, now.getTime()) : rule,
    );
    await store.writeMeterRules(written);
    // The block is lifted by the next drain: a restarted rule holds nothing, and
    // a device no rule holds is owed a release.
    const names = await meterNames(store);
    const sharedUsage = sharedUsageByGroup(written);
    const held = await store.readDeviceGroups();
    const pauses = new Map((await store.readDevicePauses()).map((p) => [p.clientKey, p]));
    return {
      status: 200,
      body: {
        rules: written
          .filter((rule) => named(rule) && (client === null || rule.clientKey === client))
          .map((rule) => withUsage(rule, names, sharedUsage, now.getTime(), held, pauses)),
      },
    };
  }

  // Zero one device's total but keep it listed — a reset, distinct from delete.
  if (url.pathname === "/api/clients/totals/reset" && method === "POST") {
    const key = url.searchParams.get("client");
    const odometer = await loadOdometer(store);
    const reset = key ? odometer.reset(key, now.getTime()) : false;
    if (reset) await store.writeTotalsSnapshot(odometer.toSnapshot());
    return { status: 200, body: { reset } };
  }

  // Join two buckets the router issued separate identities to, or record that they
  // are different devices. Both answer a question the router's data cannot, and
  // both are written through at once: an unsaved merge loses a total, an unsaved
  // rejection asks again on the next refresh.
  if (url.pathname === "/api/clients/totals/merge" && method === "POST") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const distinct = url.searchParams.get("distinct") === "1";
    const odometer = await loadOdometer(store);
    const applied =
      from && to ? (distinct ? odometer.rejectMerge(from, to) : odometer.merge(from, to)) : false;
    if (applied) await store.writeTotalsSnapshot(odometer.toSnapshot());
    return { status: 200, body: distinct ? { rejected: applied } : { merged: applied } };
  }

  // The monthly usage odometer: read the list, or delete one device's record
  // (?client=) or all of them (no id). Deleting removes the entry; /reset zeroes
  // a device while keeping it listed.
  if (url.pathname === "/api/clients/totals") {
    if (method === "DELETE") {
      const key = url.searchParams.get("client");
      const odometer = await loadOdometer(store);
      const result = key
        ? { removed: odometer.remove(key) }
        : (odometer.clear(), { cleared: true });
      await store.writeTotalsSnapshot(odometer.toSnapshot());
      // A rule on a record that no longer exists can never be reached, and would
      // meter again unannounced if the device came back. The desktop recorder
      // does the same on this route.
      await forgetMetering(store, host, key, now.getTime());
      return { status: 200, body: result };
    }
    // Rows and candidates come from one read of one odometer: a candidate naming
    // a row absent from `totals` cannot be shown, so two reads risk a prompt that
    // never appears rather than one that is merely stale.
    const odometer = await loadOdometer(store);
    return {
      status: 200,
      body: {
        totals: odometer.totals(),
        mergeCandidates: odometer.mergeCandidates(now.getTime()),
      },
    };
  }

  // The open dashboard persists its own 1 Hz client samples (the drain is far too
  // coarse), so the 15-minute detail chart opens filled rather than live-building.
  if (url.pathname === "/api/clients/samples" && method === "POST") {
    const samples = parseSamples(body);
    await store.putClientSamples(samples, now.getTime());
    return { status: 200, body: { stored: samples.length } };
  }

  // Per-device history in the two tiers the live hook seeds from: `history` is the
  // per-minute rows (6h chart), `samples` the raw 1 Hz window (15-minute chart)
  // the open dashboard writes. `since` callers are tailing the live window and
  // already hold the minute rows, so those get only samples; `totals` ride the
  // slower beat, sent when asked or on a fresh (no-`since`) read.
  if (url.pathname === "/api/clients") {
    const hours = Math.min(6, Math.max(1, Number(url.searchParams.get("hours") ?? 6)));
    const key = url.searchParams.get("client") ?? undefined;
    const wantSamples = url.searchParams.get("samples") === "1";
    const sinceMs = Number(url.searchParams.get("since") ?? 0) || undefined;
    const wantTotals = url.searchParams.get("totals") === "1" || !sinceMs;
    // Rows are read unfiltered and resolved through the odometer's aliases before
    // the device filter, so a merge carries a device's history onto the surviving
    // identity, the same way it carries the total. The 1 Hz sample tail (`since`,
    // no totals) carries only live keys, which resolve to themselves, so it skips
    // the snapshot load entirely rather than reading it every second.
    const odometer = !sinceMs || wantTotals ? await loadOdometer(store) : undefined;
    const resolveRowKey = (row: { key?: string }) =>
      row.key ? (odometer ? odometer.resolveKey(row.key) : row.key) : undefined;
    return {
      status: 200,
      body: {
        history: sinceMs
          ? []
          : foldMinuteCollisions(
              resolveRows(
                await store.readClientMinutes(hours, undefined, now.getTime()),
                resolveRowKey,
                key,
              ),
            ),
        ...(wantSamples
          ? {
              samples: resolveRows(
                await store.readClientSamples(sinceMs ?? 0, undefined, now.getTime()),
                resolveRowKey,
                key,
              ),
            }
          : {}),
        ...(wantTotals ? { totals: odometer!.totals(key) } : {}),
      },
    };
  }

  return { status: 503, body: { error: `no extension history for ${url.pathname}` } };
}

/** A countdown in milliseconds, or null when the write names none. Anything past
 *  a day is capped rather than taken at its word. */
function countdownFromParams(params: URLSearchParams): number | null {
  const raw = params.get("countdown");
  if (raw === null || raw.trim() === "") return null;
  const countdownMs = Number(raw);
  if (!Number.isFinite(countdownMs) || countdownMs <= 0) return null;
  return Math.min(MAX_COUNTDOWN_MS, countdownMs);
}

function groupFromParams(
  params: URLSearchParams,
  existing: readonly DeviceGroup[],
  nowMs: number,
): DeviceGroup | null {
  const cycle = cycleFromParams(params, nowMs);
  const allocationBytes = Number(params.get("allocation"));
  const countdownMs = countdownFromParams(params);
  const name = params.get("name")?.trim();
  const memberKeys = [
    ...new Set(
      (params.get("members") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter((key) => key !== ""),
    ),
  ];
  const schedule = parseScheduleParam(params.get("schedule"));
  if (!cycle || !name || memberKeys.length === 0) return null;
  if (
    countdownMs === null &&
    schedule === null &&
    (!Number.isFinite(allocationBytes) || allocationBytes <= 0)
  )
    return null;
  const groupId = params.get("group");
  const existingGroup = existing.find((group) => group.groupId === groupId);
  return {
    // A write naming a group this store does not hold is a new group, not that id:
    // ids are the store's to mint, and honouring one from the wire lets a caller
    // land on a key it chose — including one a later group would collide with.
    groupId: existingGroup?.groupId ?? newGroupId(existing, nowMs),
    name,
    memberKeys,
    allocationBytes: Number.isFinite(allocationBytes) ? Math.max(0, allocationBytes) : 0,
    autoPause: params.get("autoPause") !== "0",
    // A countdown runs from its own start, so the cycle it is written on is one
    // that does not move that start under it. Matched to what the projected rules
    // carry, or their terms would read as changed on every drain.
    cycle: countdownMs === null ? cycle : { kind: "once" },
    // Matches the form's own default, so a write naming no mode never means one
    // thing here and another on the card that sent it.
    mode: params.get("mode") === "pooled" ? "pooled" : "perMember",
    updatedMs: nowMs,
    createdMs: existingGroup?.createdMs ?? nowMs,
    ...(countdownMs === null ? {} : { countdownMs }),
    ...(schedule === null ? {} : { schedule }),
  };
}

/**
 * Drop the metering behind a device whose record has been deleted, or behind
 * every device when the whole list has been.
 *
 * The rule goes, its announcement is retired, and it leaves any group it was in
 * so the projection cannot write it back. A pause it was holding is released,
 * since nothing is left that knows the device is blocked.
 */
async function forgetMetering(
  store: HistoryStore,
  host: MeterHost,
  clientKey: string | null,
  nowMs: number,
): Promise<void> {
  const rules = await store.readMeterRules();
  const groups = await store.readDeviceGroups();
  const going = clientKey === null ? rules : rules.filter((rule) => rule.clientKey === clientKey);
  if (going.length === 0 && groups.length === 0) return;
  await store.writeMeterRules(
    clientKey === null ? [] : rules.filter((rule) => !going.includes(rule)),
  );
  await store.writeDeviceGroups(
    clientKey === null
      ? []
      : groups
          .map((group) => ({
            ...group,
            memberKeys: group.memberKeys.filter((key) => key !== clientKey),
          }))
          .filter((group) => group.memberKeys.length > 0),
  );
  const names = await meterNames(store);
  const groupsById = new Map(groups.map((group) => [group.groupId, group]));
  const retired = new Set<string>();
  for (const rule of going) {
    const subject = announcementSubject(rule);
    if (retired.has(subject)) continue;
    retired.add(subject);
    await retireMeterAlert(store, rule, meterDeviceName(names, rule.clientKey), nowMs, groupsById);
  }
}

/** A group's members are unmetered the moment it is gone. Any block they were
 *  under is lifted by the next drain, which finds them with no rule holding
 *  them. */
async function standDownGroup(
  store: HistoryStore,
  group: DeviceGroup,
  nowMs: number,
): Promise<void> {
  const rules = await store.readMeterRules();
  const members = rules.filter((rule) => rule.groupId === group.groupId);
  if (members.length === 0) return;
  await store.writeMeterRules(rules.filter((rule) => rule.groupId !== group.groupId));
  const names = await meterNames(store);
  const announced = members.filter((rule) => rule.reachedAtMs !== undefined);
  const shared = members.some(announcesAsGroup);
  const groupsById = new Map([[group.groupId, group]]);
  for (const rule of shared ? announced.slice(0, 1) : announced)
    await retireMeterAlert(store, rule, meterDeviceName(names, rule.clientKey), nowMs, groupsById);
}

/** One odometer read for the whole answer, and a device with no name falls back
 *  to `device <key>`, the wording the desktop recorder uses for the same case. */
async function meterNames(store: HistoryStore): Promise<Map<string, string>> {
  const odometer = await loadOdometer(store);
  return new Map(
    odometer
      .totals()
      .map((total) => [usageKey(total.clientId, total.macAddress), total.name ?? ""] as const)
      .filter(([, name]) => name.length > 0),
  );
}

function meterDeviceName(names: Map<string, string>, clientKey: string): string {
  return names.get(clientKey) ?? `device ${clientKey}`;
}

/**
 * A rule as a surface draws it.
 *
 * `usageBytes` is what the rule is judged against, not what the one device spent:
 * a member of a shared allowance is over when the group is, and a card drawing
 * its own figure against the group's allowance would call it under.
 */
function withUsage(
  rule: MeterRule,
  names: Map<string, string>,
  sharedUsage: ReadonlyMap<string, number>,
  nowMs: number,
  groups: readonly DeviceGroup[] = [],
  pauses: DevicePauses = new Map(),
): MeterRule & {
  usageBytes: number;
  ownUsageBytes: number;
  deviceName: string;
  reached: boolean;
  pauseState: PauseState;
  holding: boolean;
  pauseError?: string;
  groupName?: string;
} {
  const group = groups.find((other) => other.groupId === rule.groupId);
  const pause = pauses.get(rule.clientKey);
  return {
    ...rule,
    usageBytes: chargedBytes(rule, sharedUsage),
    // What this device itself put through, which on a pooled member is not what
    // the rule charges it. A card listing the members reads this.
    ownUsageBytes: usageBytes(rule),
    // Decided here, where the group's sum and the countdown's clock both are. A
    // surface re-deriving it from the two figures below gets a timer wrong.
    reached: ruleSpent(rule, nowMs, sharedUsage),
    // The device's block, carried on each of its rules: a card has a rule in hand
    // and needs to say whether the device is actually off the network, and
    // whether this rule is one of the reasons.
    pauseState: pause?.state ?? "none",
    holding: ruleHoldsDevice(rule),
    ...(pause?.error === undefined ? {} : { pauseError: pause.error }),
    deviceName: meterDeviceName(names, rule.clientKey),
    // A group down to one device covers nothing but that device, so the card has
    // nothing to say about others.
    ...(group && group.memberKeys.length > 1 ? { groupName: group.name } : {}),
  };
}

/** Rehydrate the odometer from its stored snapshot. The gap window only governs
 *  recording, never a read or a reset/delete, so the default is fine here. */
async function loadOdometer(store: HistoryStore): Promise<ClientTotalsCore> {
  const odometer = new ClientTotalsCore();
  const snapshot = migrateSnapshot(await store.readTotalsSnapshot());
  if (snapshot) odometer.loadSnapshot(snapshot);
  return odometer;
}

/** Parse a posted sample batch, tolerating a malformed body as an empty write. */
function parseSamples(body?: string): ClientSampleRow[] {
  if (!body) return [];
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) ? (parsed as ClientSampleRow[]) : [];
  } catch {
    return [];
  }
}
