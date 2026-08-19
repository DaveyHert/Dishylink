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
  allowanceSpent,
  announcementSubject,
  announcesAsGroup,
  chargedBytes,
  cycleFromParams,
  MAX_COUNTDOWN_MS,
  restartCycle,
  sharedUsageByGroup,
  upsertRule,
  type MeterRule,
} from "@core/dataMeter";
import { usageKey } from "@core/clientUsage";
import { projectGroupRules, type DeviceGroup } from "@core/deviceGroup";
import { NO_METER_HOST, type MeterHost } from "./meterHost";
import { retireMeterAlert, standDownMeterRule } from "./meterEnforcement";
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
      const going = rules.find((rule) => rule.clientKey === client);
      const kept = rules.filter((rule) => rule.clientKey !== client);
      const removed = kept.length !== rules.length;
      if (removed) await store.writeMeterRules(kept);
      // A member's rule is the group's, and the projection would write it straight
      // back on the next drain. Unmetering the device means leaving the group.
      if (client && going?.groupId !== undefined) {
        const groups = await store.readDeviceGroups();
        await store.writeDeviceGroups(
          groups
            .map((group) =>
              group.groupId === going.groupId
                ? { ...group, memberKeys: group.memberKeys.filter((key) => key !== client) }
                : group,
            )
            // A group left with no members covers nothing, the same as on the
            // record-deleted route.
            .filter((group) => group.memberKeys.length > 0),
        );
      }
      await standDownMeterRule(host, going, undefined);
      if (going?.reachedAtMs !== undefined)
        await retireMeterAlert(
          store,
          going,
          meterDeviceName(await meterNames(store), going.clientKey),
          now.getTime(),
          new Map((await store.readDeviceGroups()).map((group) => [group.groupId, group])),
        );
      return { status: 200, body: { removed } };
    }
    if (method === "POST") {
      const cycle = cycleFromParams(url.searchParams, now.getTime());
      const allocationBytes = Number(url.searchParams.get("allocation"));
      const countdownMs = countdownFromParams(url.searchParams);
      if (!client || !cycle) return { status: 400, body: { error: "bad_request" } };
      // A countdown measures the clock, so it needs no allowance behind it.
      if (countdownMs === null && (!Number.isFinite(allocationBytes) || allocationBytes <= 0))
        return { status: 400, body: { error: "bad_request" } };
      const odometer = await loadOdometer(store);
      const counters = odometer.lifetimes().find((entry) => entry.clientKey === client);
      const existing = rules.find((other) => other.clientKey === client);
      const rule = upsertRule(existing, {
        clientKey: client,
        allocationBytes: Number.isFinite(allocationBytes) ? Math.max(0, allocationBytes) : 0,
        autoPause: url.searchParams.get("autoPause") !== "0",
        cycle,
        lifetimeRx: counters?.lifetimeRx ?? 0,
        lifetimeTx: counters?.lifetimeTx ?? 0,
        nowMs: now.getTime(),
        ...(countdownMs === null ? {} : { countdownMs }),
      });
      const written = [...rules.filter((o) => o.clientKey !== client), rule];
      await store.writeMeterRules(written);
      await standDownMeterRule(host, existing, rule);
      return {
        status: 200,
        body: {
          rule: withUsage(
            rule,
            await meterNames(store),
            sharedUsageByGroup(written),
            now.getTime(),
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
    return {
      status: 200,
      body: {
        rules: mine.map((rule) => withUsage(rule, names, sharedUsage, now.getTime(), groups)),
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
      await standDownGroup(store, host, going, now.getTime());
      return { status: 200, body: { removed: true } };
    }
    if (method === "POST") {
      const group = groupFromParams(url.searchParams, groups, now.getTime());
      if (!group) return { status: 400, body: { error: "bad_request" } };
      const kept = [...groups.filter((other) => other.groupId !== group.groupId), group];
      await store.writeDeviceGroups(kept);
      // The drain is 30 s away, and until it runs the members would read as
      // carrying no limit at all.
      const odometer = await loadOdometer(store);
      await store.writeMeterRules(
        projectGroupRules({
          groups: kept,
          rules: await store.readMeterRules(),
          counters: odometer.lifetimes(),
          nowMs: now.getTime(),
        }),
      );
      return { status: 200, body: { group } };
    }
    return { status: 200, body: { groups, pauseEnforceable: host.signedIn() } };
  }

  // Start one rule's allowance over, leaving the device's own usage standing.
  if (url.pathname === "/api/clients/meters/reset" && method === "POST") {
    const client = url.searchParams.get("client");
    const rules = await store.readMeterRules();
    const existing = rules.find((rule) => rule.clientKey === client);
    if (!existing) return { status: 200, body: { rule: null } };
    // A member's allowance is the group's, so starting it over starts the group
    // over. Leaving the others where they were would have them sharing a cycle
    // from different anchors.
    const restarting = rules.filter(
      (rule) =>
        rule === existing || (existing.groupId !== undefined && rule.groupId === existing.groupId),
    );
    const restartedByKey = new Map(
      restarting.map((rule) => [rule.clientKey, restartCycle(rule, now.getTime())]),
    );
    const written = rules.map((rule) => restartedByKey.get(rule.clientKey) ?? rule);
    await store.writeMeterRules(written);
    for (const rule of restarting)
      await standDownMeterRule(host, rule, restartedByKey.get(rule.clientKey));
    const restarted = restartedByKey.get(existing.clientKey)!;
    return {
      status: 200,
      body: {
        rule: withUsage(
          restarted,
          await meterNames(store),
          sharedUsageByGroup(written),
          now.getTime(),
        ),
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
  if (!cycle || !name || memberKeys.length === 0) return null;
  if (countdownMs === null && (!Number.isFinite(allocationBytes) || allocationBytes <= 0))
    return null;
  const groupId = params.get("group");
  return {
    groupId:
      existing.find((group) => group.groupId === groupId)?.groupId ??
      groupId ??
      `group-${nowMs.toString(36)}`,
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
    ...(countdownMs === null ? {} : { countdownMs }),
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
  for (const rule of going) await standDownMeterRule(host, rule, undefined);
}

/** A group's members are unmetered the moment it is gone, so any pause it holds
 *  is released here rather than waiting for a cycle that never rolls. */
async function standDownGroup(
  store: HistoryStore,
  host: MeterHost,
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
  for (const rule of members) await standDownMeterRule(host, rule, undefined);
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
): MeterRule & {
  usageBytes: number;
  deviceName: string;
  reached: boolean;
  groupName?: string;
} {
  const group = groups.find((other) => other.groupId === rule.groupId);
  return {
    ...rule,
    usageBytes: chargedBytes(rule, sharedUsage),
    // Decided here, where the group's sum and the countdown's clock both are. A
    // surface re-deriving it from the two figures below gets a timer wrong.
    reached: allowanceSpent(rule, nowMs, sharedUsage),
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
