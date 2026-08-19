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
  cycleFromParams,
  restartCycle,
  upsertRule,
  usageBytes,
  type MeterRule,
} from "@core/dataMeter";
import { usageKey } from "@core/clientUsage";
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
      await standDownMeterRule(host, going, undefined);
      if (going?.reachedAtMs !== undefined)
        await retireMeterAlert(
          store,
          going,
          meterDeviceName(await meterNames(store), going.clientKey),
          now.getTime(),
        );
      return { status: 200, body: { removed } };
    }
    if (method === "POST") {
      const cycle = cycleFromParams(url.searchParams, now.getTime());
      const allocationBytes = Number(url.searchParams.get("allocation"));
      if (!client || !cycle || !Number.isFinite(allocationBytes) || allocationBytes <= 0)
        return { status: 400, body: { error: "bad_request" } };
      const odometer = await loadOdometer(store);
      const counters = odometer.lifetimes().find((entry) => entry.clientKey === client);
      const existing = rules.find((other) => other.clientKey === client);
      const rule = upsertRule(existing, {
        clientKey: client,
        allocationBytes,
        autoPause: url.searchParams.get("autoPause") !== "0",
        cycle,
        lifetimeRx: counters?.lifetimeRx ?? 0,
        lifetimeTx: counters?.lifetimeTx ?? 0,
        nowMs: now.getTime(),
      });
      await store.writeMeterRules([...rules.filter((o) => o.clientKey !== client), rule]);
      await standDownMeterRule(host, existing, rule);
      return { status: 200, body: { rule: withUsage(rule, await meterNames(store)) } };
    }
    const mine = client ? rules.filter((rule) => rule.clientKey === client) : rules;
    const names = await meterNames(store);
    return {
      status: 200,
      body: {
        rules: mine.map((rule) => withUsage(rule, names)),
        // Enforcement here lands on the next alarm rather than within a poll, but
        // whether it lands at all is the same question: is there an account.
        pauseEnforceable: host.signedIn(),
      },
    };
  }

  // Start one rule's allowance over, leaving the device's own usage standing.
  if (url.pathname === "/api/clients/meters/reset" && method === "POST") {
    const client = url.searchParams.get("client");
    const rules = await store.readMeterRules();
    const existing = rules.find((rule) => rule.clientKey === client);
    if (!existing) return { status: 200, body: { rule: null } };
    const restarted = restartCycle(existing, now.getTime());
    await store.writeMeterRules(rules.map((rule) => (rule === existing ? restarted : rule)));
    await standDownMeterRule(host, existing, restarted);
    return { status: 200, body: { rule: withUsage(restarted, await meterNames(store)) } };
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

function withUsage(
  rule: MeterRule,
  names: Map<string, string>,
): MeterRule & { usageBytes: number; deviceName: string } {
  return {
    ...rule,
    usageBytes: usageBytes(rule),
    deviceName: meterDeviceName(names, rule.clientKey),
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
