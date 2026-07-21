// Typed client for the user's own starlink.com account data, read-only.
//
// The UI only ever talks to /cloud/* (served by the host's cloud binding — the
// Vite dev proxy today, Electron main / the extension background worker later,
// see CLOUD-ACCOUNT.md). It never touches starlink.com directly. Transport is
// deliberately separate from the historian: this needs internet + the account
// session, nothing about the local dish.

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

const FRESH_MS = 60 * 60 * 1000; // telemetry newer than this = reporting now
const INACTIVE_MS = 30 * 24 * 60 * 60 * 1000; // not connected in a month = decommissioned

/** Full telemetry key for a dish/router as the feed reports it. */
export const dishTelemetryId = (terminal: CloudTerminal) => `ut${terminal.userTerminalId ?? ""}`;
export const routerTelemetryId = (routerId: string | undefined) => `Router-${routerId ?? ""}`;

/** Three states, like the portal's dot: gray (inactive — long gone), red
 *  (offline — should be up but its telemetry went stale), green (online). */
export function dishStatus(terminal: CloudTerminal, tel: DeviceTelemetry | undefined): DeviceStatus {
  const last = terminal.lastConnected ? new Date(terminal.lastConnected).getTime() : 0;
  if (last && Date.now() - last > INACTIVE_MS) return "inactive";
  if (tel && Date.now() - tel.timestampMs < FRESH_MS) return "online";
  return "offline";
}

export function routerStatus(
  tel: DeviceTelemetry | undefined,
  parentInactive = false,
): DeviceStatus {
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
export function routerDisplayName(routerId: string | undefined, tel: RouterTelemetry | undefined): string {
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
  const response = await fetch(path, { signal });
  if (response.status === 428) throw new CloudNotConnectedError();
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function fetchCloudAccount(signal?: AbortSignal): Promise<CloudAccount> {
  return cloudGet<CloudAccount>("/cloud/account", signal);
}

export function fetchCloudUsage(signal?: AbortSignal): Promise<CloudUsage> {
  return cloudGet<CloudUsage>("/cloud/usage", signal);
}

/** Persist a pasted session via the host binding. The host validates it against
 *  starlink.com and rejects a bad paste, whose message we surface to the user. */
export async function connectCloud(cookie: string): Promise<void> {
  const response = await fetch("/cloud/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cookie }),
  });
  if (!response.ok) {
    const info = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(info.message ?? `Couldn’t connect (HTTP ${response.status}).`);
  }
}

export async function disconnectCloud(): Promise<void> {
  await fetch("/cloud/session", { method: "DELETE" });
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
