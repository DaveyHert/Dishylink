// Typed client for the user's own starlink.com account data and session lifecycle.
// Supported router mutations use the same optional session through cloudHost,
// while their request payloads are prepared by the trusted host from LAN state.
//
// The UI only ever talks to /cloud/* (served by the host's cloud binding — the
// Vite dev proxy, Electron main, the extension background worker later). It
// never touches starlink.com directly, and it never picks a host: cloudHost.ts
// decides how a /cloud/* call is carried. Transport is deliberately separate
// from the historian: this needs internet + the account session, nothing about
// the local dish.

import type { WifiClientJson, WifiNetworkConfigJson } from "@core/dishClient";
import { cloudRequest, noteCloudSessionChanged } from "./cloudHost";

// ---- response shapes (only the fields the UI reads) ----

export interface CloudIdentity {
  name?: string;
  givenName?: string;
  email?: string;
  accountId?: string;
}

export interface CloudRouter {
  routerId?: string;
  isBypassed?: boolean;
  lastConnected?: string;
}

export interface CloudTerminal {
  userTerminalId?: string;
  serialNumber?: string;
  dishSerialNumber?: string;
  /** Provisioning/subscription-active — true for every terminal. NOT online
   *  status; use isOffline / lastConnected for that. */
  active?: boolean;
  /** Real online flag when the API populates it; often null on residential. */
  isOffline?: boolean | null;
  lastConnected?: string | null;
  routers?: CloudRouter[];
}

export interface CloudServiceLine {
  serviceLineNumber?: string;
  nickname?: string | null;
  accountReferenceId?: string;
  serviceAddress?: {
    formattedAddress?: string;
    locality?: string;
    administrativeArea?: string;
    region?: string;
    postalCode?: string;
    geoLocation?: { latitude?: number; longitude?: number };
  };
  subscription?: {
    productDescription?: string;
    active?: boolean;
    startDate?: string;
  };
  userTerminals?: CloudTerminal[];
}

export interface CloudPayment {
  amount?: number;
  isoCurrencyCode?: string;
  status?: string;
  paymentMethod?: string;
  description?: string;
  paidDate?: string | null;
  paymentDate?: string | null;
}

export interface DishTelemetry {
  kind: "dish";
  timestampMs: number;
  softwareVersion?: string;
  uptimeS?: number;
  obstructionPct?: number;
  signalQuality?: number;
}

export interface RouterTelemetry {
  kind: "router";
  timestampMs: number;
  hardwareVersion?: string;
  softwareVersion?: string;
  uptimeS?: number;
  clients?: number;
  hops?: number;
  isRepeater?: boolean;
  isBypassed?: boolean;
}

export type DeviceTelemetry = DishTelemetry | RouterTelemetry;

export interface CloudAccount {
  identity: CloudIdentity | null;
  serviceLine: { content?: CloudServiceLine } | null;
  /** Full DeviceId ("ut<uuid>" | "Router-<hex>") → live stats + freshness. */
  deviceTelemetry?: Record<string, DeviceTelemetry>;
}

export type DeviceStatus = "online" | "offline" | "inactive";

// How long a device may go unheard-of in the cloud before its dot goes red.
//
// This is a staleness threshold, NOT a poll interval: polling the cache more
// often does not make a device report sooner. Devices upload to Starlink on
// their own ~2-minute schedule, so the age of the newest row sawtooths from 0
// up to the upload interval and resets. Any threshold below that interval
// therefore reds a perfectly healthy device for the back half of every cycle.
//
// Measured 2026-07-29 over one 109s window, per device, via /cloud/telemetry:
// the dish's row advanced 105s and the router's 120s — each emitted exactly one
// new row, with UtcTimestampNs and Uptime advancing in lockstep with wall clock.
// So the cadence is ~2 minutes, not the ~15-45s an earlier note here assumed.
// Five minutes clears that cadence plus jitter and tolerates one missed upload
// before crying wolf.
//
// The payload carries no connection-state field to read instead — the legend is
// 16 columns for a dish and 42 for a router, and none of them is online/offline
// (dumped 2026-07-29). Freshness is the only signal the cloud offers, which is
// why devices reachable on this LAN are judged by lanOnline below instead.
const FRESH_MS = 5 * 60 * 1000;
const INACTIVE_MS = 30 * 24 * 60 * 60 * 1000; // not connected in a month = decommissioned

/** Full telemetry key for a dish/router as the feed reports it. */
export const dishTelemetryId = (terminal: CloudTerminal) => `ut${terminal.userTerminalId ?? ""}`;
export const routerTelemetryId = (routerId: string | undefined) => `Router-${routerId ?? ""}`;

/** True when this machine is talking to the device over the LAN right now.
 *
 *  Answering is proof of life, so it settles the dot on its own — no waiting on
 *  the cloud's ~2-minute upload cycle. Silence proves nothing, though: a dish
 *  that is down and a dish we are simply away from both fail to answer
 *  identically, so a false value never means "offline", only "no opinion", and
 *  the cloud's freshness decides. That keeps the panel correct on someone
 *  else's network, where nothing local answers and the cloud is all there is. */
type LanOnline = boolean;

/** Three states, like the portal's dot: gray (inactive — long gone), red
 *  (offline — should be up but its telemetry went stale), green (online). */
export function dishStatus(
  terminal: CloudTerminal,
  tel: DeviceTelemetry | undefined,
  lanOnline: LanOnline = false,
): DeviceStatus {
  // Checked ahead of lastConnected because a device on the LAN is by definition
  // still in service, whatever the account's records say about it.
  if (lanOnline) return "online";
  const last = terminal.lastConnected ? new Date(terminal.lastConnected).getTime() : 0;
  if (last && Date.now() - last > INACTIVE_MS) return "inactive";
  if (tel && Date.now() - tel.timestampMs < FRESH_MS) return "online";
  return "offline";
}

export function routerStatus(
  tel: DeviceTelemetry | undefined,
  parentInactive = false,
  lanOnline: LanOnline = false,
): DeviceStatus {
  if (lanOnline) return "online";
  // A router under a decommissioned dish is inactive too — not a red "offline"
  // alarm under a gray dish.
  if (parentInactive) return "inactive";
  if (tel && Date.now() - tel.timestampMs < FRESH_MS) return "online";
  return "offline";
}

/** Friendly dish name like the portal: "STARLINK 4C8BB9" (last 6 hex of the id). */
export function dishDisplayName(terminal: CloudTerminal): string {
  const tail = (terminal.userTerminalId ?? "").split("-").pop() ?? "";
  const hex = tail.slice(-6).toUpperCase();
  return hex ? `STARLINK ${hex}` : (terminal.serialNumber ?? "Starlink dish");
}

/** Friendly router name: the controller reads "Main Router", a repeater "MESH". */
export function routerDisplayName(
  routerId: string | undefined,
  tel: RouterTelemetry | undefined,
): string {
  const hex = (routerId ?? "").slice(-12).replace(/^0+/, "").toUpperCase();
  const isMesh = tel?.isRepeater === true || (tel?.hops ?? 0) > 0;
  const prefix = tel ? (isMesh ? "MESH" : "Main Router") : "Router";
  return hex ? `${prefix} ${hex}` : prefix;
}

/** "v3" → "Starlink Router 3", "v2" → "Starlink Router (Gen 2)". */
export function routerHardwareName(hw: string | undefined): string {
  if (hw === "v3") return "Starlink Router 3";
  if (hw === "v2") return "Starlink Router (Gen 2)";
  if (hw === "v1") return "Starlink Router (Gen 1)";
  return hw ? `Starlink Router (${hw})` : "—";
}

/** Hops → "Direct" / "Mesh (N hops)", the portal's "Connection to Starlink". */
export function connectionLabel(hops: number | undefined): string {
  if (!hops) return "Direct";
  return `Mesh (${hops} hop${hops === 1 ? "" : "s"})`;
}

/** Seconds → "11h 27m" / "4m 31s" / "88s". */
export function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export interface UsageSummaryLine {
  consumedAmountGB?: number;
  overageAmountGB?: number;
  isOptedIntoOverage?: boolean;
}

export interface UsageCycle {
  startDate: string;
  endDate: string;
  totalAmountGB: number;
  /** One entry per day; each is [gb] (array because multi-bucket plans exist). */
  dailyData: number[][];
  dataUsageSummaryLines?: UsageSummaryLine[];
}

export interface UsageServicePlan {
  productId?: string;
  usageLimitGB?: number;
  isMobilePlan?: boolean;
  isoCurrencyCode?: string;
}

export interface CloudUsage {
  content: {
    dataBuckets?: { name?: string }[];
    billingCyclesAnnotated: UsageCycle[];
    servicePlan: UsageServicePlan;
  };
}

/** Raised when the host has no account session yet (HTTP 428). */
export class CloudNotConnectedError extends Error {
  constructor() {
    super("No Starlink account connected");
    this.name = "CloudNotConnectedError";
  }
}

async function cloudGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const { status, body } = await cloudRequest({ path, signal });
  if (status === 428) throw new CloudNotConnectedError();
  if (status < 200 || status >= 300) throw new Error(`${path} → HTTP ${status}`);
  return body as T;
}

export function fetchCloudAccount(signal?: AbortSignal): Promise<CloudAccount> {
  return cloudGet<CloudAccount>("/cloud/account", signal);
}

export function fetchCloudUsage(signal?: AbortSignal): Promise<CloudUsage> {
  return cloudGet<CloudUsage>("/cloud/usage", signal);
}

/** The subnet the router reports, asked of the account rather than the LAN — the
 *  only reader that still answers for a router this network cannot see. */
export async function fetchCloudRouterSubnet(signal?: AbortSignal): Promise<string | null> {
  const { subnet } = await cloudGet<{ subnet: string | null }>("/cloud/router-subnet", signal);
  return subnet;
}

/** The connected devices the router reports, asked of the account rather than
 *  the LAN. The same roster, from the one path that still answers when this
 *  machine is not on that network — or cannot see the router at all. */
export async function fetchCloudRouterClients(signal?: AbortSignal): Promise<WifiClientJson[]> {
  const { clients } = await cloudGet<{ clients: WifiClientJson[] | null }>(
    "/cloud/router-clients",
    signal,
  );
  return clients ?? [];
}

/** The router's WiFi config over the same path — SSIDs, mesh nodes, and the
 *  saved per-device entries a roster is read alongside. */
export async function fetchCloudRouterConfig(
  signal?: AbortSignal,
): Promise<WifiNetworkConfigJson | null> {
  const { wifiConfig } = await cloudGet<{ wifiConfig: WifiNetworkConfigJson | null }>(
    "/cloud/router-config",
    signal,
  );
  return wifiConfig;
}

/** Persist a pasted session via the host binding. The host validates it against
 *  starlink.com and rejects a bad paste, whose message we surface to the user. */
export async function connectCloud(cookie: string): Promise<void> {
  const { status, body } = await cloudRequest({
    path: "/cloud/session",
    method: "POST",
    body: { cookie },
  });
  if (status < 200 || status >= 300) {
    const { message } = (body ?? {}) as { message?: string };
    throw new Error(message ?? `Couldn’t connect (HTTP ${status}).`);
  }
  noteCloudSessionChanged();
}

export async function disconnectCloud(): Promise<void> {
  await cloudRequest({ path: "/cloud/session", method: "DELETE" });
  noteCloudSessionChanged();
}

// ---- derived helpers the UI leans on ----

/** 100000 GB (100 TB) is the residential "unlimited" sentinel. */
export const UNLIMITED_SENTINEL_GB = 100_000;

export function isUnlimited(plan: UsageServicePlan | undefined): boolean {
  return (plan?.usageLimitGB ?? 0) >= UNLIMITED_SENTINEL_GB;
}

/** "100 TB" from a GB figure, trimming trailing zeros. */
export function formatAllowance(usageLimitGB: number | undefined): string {
  if (!usageLimitGB) return "—";
  const tb = usageLimitGB / 1000;
  return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
}

/** Minor-unit currency amount (57000 = ₦57,000) → localized string. */
export function formatMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount == null || !currency) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}
