// Host-agnostic client for the user's own starlink.com account. It holds the
// session cookie, refreshes the short-lived Access.V1 token, and serves the
// /cloud/* routes the UI reads. The transport (fetch) and the cookie store are
// injected, so each host binds its own: the dev server a file + Node fetch, the
// Electron main process the OS keychain + net.fetch, the extension chrome.cookies.
//
// This is separate from the historian on purpose: cloud data needs only the
// internet and a cookie, and must not depend on the dish poller's health.

const AUTH_URL = "https://api.starlink.com/auth-rp/auth/user";
const API = "https://starlink.com/api";
const REFRESH_TTL_MS = 60_000; // the Access.V1 token is short-lived; refresh at most this often
const IDS_TTL_MS = 5 * 60_000; // account/service-line numbers change ~never; cache across routes

/** The account session is gone or expired — the UI must prompt a reconnect, NOT
 *  show a generic "check your internet". Distinct from a real upstream fault. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Starlink session expired or not connected");
    this.name = "SessionExpiredError";
  }
}

export interface CloudResult {
  status: number;
  body: unknown;
}

export interface CloudHandlerOptions {
  /** Injected for tests / non-Node hosts; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Cookie persistence — host-wired (dev: a file; Electron: the OS keychain).
   *  Absent readCookie means "no session", so the UI reads as not connected. */
  readCookie?: () => string | null;
  writeCookie?: (cookie: string) => void;
  clearCookie?: () => void;
}

/** The durable half of the session — without it a token refresh can't happen, so
 *  a session missing it is definitely not usable. */
const SSO_COOKIE_RE = /Starlink\.Com\.Sso=/;

const NOT_CONNECTED: CloudResult = {
  status: 428,
  body: {
    error: "not_connected",
    message: "No Starlink session — sign in to connect your account.",
  },
};

/** Finite number or undefined — a missing legend field yields Number(undefined)
 *  = NaN, which otherwise leaks to the UI as "NaN%"/"NaN". */
function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Per-device live stats from the telemetry feed, keyed by full DeviceId
 *  ("ut<uuid>" for dishes, "Router-<hex>" for routers). The service-line detail
 *  carries none of this (software/hardware version, uptime, clients, hops,
 *  bypass) nor the freshness timestamp the online/offline dot needs. Exported
 *  for direct testing of the missing-field / NaN-guard behaviour. */
export function deviceTelemetryFrom(telemetry: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const data = (
    telemetry as {
      data?: { columnNamesByDeviceType?: Record<string, string[]>; values?: unknown[][] };
    }
  )?.data;
  if (!data?.values || !data.columnNamesByDeviceType) return out;
  for (const row of data.values) {
    const kind = row[0];
    const legend: string[] | undefined = data.columnNamesByDeviceType[kind as string];
    if (!legend) continue;
    const get = (name: string): unknown => row[legend.indexOf(name)];
    const id = String(get("DeviceId") ?? "");
    if (!id) continue;
    const timestampMs = (num(get("UtcTimestampNs")) ?? 0) / 1e6;
    if (kind === "u") {
      out[id] = {
        kind: "dish",
        timestampMs,
        softwareVersion: get("RunningSoftwareVersion"),
        uptimeS: num(get("Uptime")),
        obstructionPct: num(get("ObstructionPercentTime")),
        signalQuality: num(get("SignalQuality")),
      };
    } else if (kind === "r") {
      out[id] = {
        kind: "router",
        timestampMs,
        hardwareVersion: get("WifiHardwareVersion"),
        softwareVersion: get("WifiSoftwareVersion"),
        uptimeS: num(get("WifiUptimeS")),
        clients: num(get("Clients")),
        hops: num(get("WifiHopsFromController")),
        isRepeater: get("WifiIsRepeater") === true,
        isBypassed: get("WifiIsBypassed") === true,
      };
    }
  }
  return out;
}

interface ServiceLineResult {
  serviceLineNumber?: string;
  accountReferenceId?: string;
}

/** Host-agnostic cloud client: holds the session cookie + short-lived-token
 *  refresh and serves the /cloud/* routes. State is per-instance so tests get a
 *  clean client each time. */
export function createCloudHandler(options: CloudHandlerOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const readCookie = options.readCookie ?? (() => null);
  const writeCookie = options.writeCookie ?? (() => {});
  const clearCookie = options.clearCookie ?? (() => {});

  let cachedCookie: string | null = null;
  let cachedAt = 0;
  let refreshInFlight: Promise<string | null> | null = null;
  let cachedIds: { acc: string; sl: string } | null = null;
  let cachedIdsAt = 0;

  function forgetSession() {
    cachedCookie = null;
    cachedAt = 0;
    cachedIds = null;
    cachedIdsAt = 0;
  }

  /** Swap in a freshly-minted Access.V1 (the webagg/telemetryagg calls 401
   *  without it). `force` busts the 60s cache after a mid-flight token expiry.
   *  Concurrent callers share one in-flight refresh so opening a surface fires
   *  one auth/user. */
  async function freshCookie(force = false): Promise<string | null> {
    const base = readCookie();
    if (!base) return null;
    if (!force && cachedCookie && Date.now() - cachedAt < REFRESH_TTL_MS) return cachedCookie;
    if (!force && refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      try {
        const authResponse = await doFetch(AUTH_URL, { headers: { cookie: base } });
        // A dead SSO session answers the refresh itself with 401/403 — that's a
        // reconnect, not an upstream failure. Surface it as such.
        if (authResponse.status === 401 || authResponse.status === 403) {
          forgetSession();
          throw new SessionExpiredError();
        }
        const setCookie = authResponse.headers.get("set-cookie") ?? "";
        const match = setCookie.match(/Starlink\.Com\.Access\.V1=([^;]+)/);
        const withoutOld = base.replace(/Starlink\.Com\.Access\.V1=[^;]*;?/g, "").trim();
        cachedCookie = match ? `Starlink.Com.Access.V1=${match[1]};${withoutOld}` : base;
        cachedAt = Date.now();
        return cachedCookie;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  /** Run a sequence of cloud calls with a valid token; if the short-lived token
   *  aged out mid-flight (401), force one refresh and retry once before giving
   *  up. A truly dead session makes the forced refresh throw. */
  async function withFreshCookie<T>(run: (cookie: string) => Promise<T>): Promise<T> {
    const cookie = await freshCookie();
    if (!cookie) throw new SessionExpiredError();
    try {
      return await run(cookie);
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) throw error;
      const retried = await freshCookie(true);
      if (!retried) throw new SessionExpiredError();
      return await run(retried);
    }
  }

  async function apiGet(path: string, cookie: string): Promise<unknown> {
    const response = await doFetch(`${API}${path}`, {
      headers: { cookie, accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
    if (!response.ok) throw new Error(`GET ${path} → HTTP ${response.status}`);
    return response.json();
  }

  async function apiPost(path: string, cookie: string, body: unknown): Promise<unknown> {
    const response = await doFetch(`${API}${path}`, {
      method: "POST",
      headers: { cookie, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
    if (!response.ok) throw new Error(`POST ${path} → HTTP ${response.status}`);
    return response.json();
  }

  /** Account identity lives on the auth host, not the /api proxy. */
  async function fetchIdentity(cookie: string): Promise<unknown> {
    const response = await doFetch(AUTH_URL, { headers: { cookie, accept: "application/json" } });
    if (response.status === 401 || response.status === 403) throw new SessionExpiredError();
    if (!response.ok) throw new Error(`auth/user → HTTP ${response.status}`);
    return response.json();
  }

  /** Resolve the account number + primary service line the UI hangs everything
   *  off. Cached briefly so /cloud/account and /cloud/usage don't each re-list. */
  async function resolveIds(cookie: string): Promise<{ acc: string; sl: string }> {
    if (cachedIds && Date.now() - cachedIdsAt < IDS_TTL_MS) return cachedIds;
    const list = (await apiGet(
      "/webagg/v2/accounts/service-lines?limit=100&page=0&isConverting=false&serviceAddressId=&onlyActive=false&searchString=&onlyNoUts=false",
      cookie,
    )) as { content?: { results?: ServiceLineResult[] } };
    const first = list.content?.results?.[0];
    if (!first?.serviceLineNumber || !first?.accountReferenceId) {
      throw new Error("no service line on this account");
    }
    cachedIds = { acc: first.accountReferenceId, sl: first.serviceLineNumber };
    cachedIdsAt = Date.now();
    return cachedIds;
  }

  /** `route` is the path without query, e.g. "/cloud/account". */
  async function handle(route: string): Promise<CloudResult> {
    if (!readCookie()) return NOT_CONNECTED;
    try {
      if (route === "/cloud/account") {
        const body = await withFreshCookie(async (cookie) => {
          const { acc, sl } = await resolveIds(cookie);
          const [identity, serviceLine, telemetry] = await Promise.all([
            fetchIdentity(cookie).catch(() => null),
            apiGet(`/webagg/v2/accounts/service-line/${sl}`, cookie),
            apiPost("/device-data/cache/v1/telemetry", cookie, { accountNumber: acc }).catch(
              () => null,
            ),
          ]);
          return { identity, serviceLine, deviceTelemetry: deviceTelemetryFrom(telemetry) };
        });
        return { status: 200, body };
      }
      if (route === "/cloud/usage") {
        const body = await withFreshCookie(async (cookie) => {
          const { acc, sl } = await resolveIds(cookie);
          return apiGet(
            `/telemetryagg/v1/data-usage/account/${acc}/service-line/${sl}/annotated`,
            cookie,
          );
        });
        return { status: 200, body };
      }
      if (route === "/cloud/telemetry") {
        const body = await withFreshCookie(async (cookie) => {
          const { acc } = await resolveIds(cookie);
          return apiPost("/device-data/cache/v1/telemetry", cookie, { accountNumber: acc });
        });
        return { status: 200, body };
      }
      return { status: 404, body: { error: "unknown_cloud_route", route } };
    } catch (error) {
      // A dead session is a reconnect prompt (428), not a network fault (502).
      if (error instanceof SessionExpiredError) return NOT_CONNECTED;
      return { status: 502, body: { error: "upstream_failed", message: (error as Error).message } };
    }
  }

  /** Persist a session and confirm it actually authenticates, so a bad one gets
   *  immediate feedback rather than a broken-looking account later. */
  async function connect(cookie: string): Promise<CloudResult> {
    const trimmed = (cookie ?? "").trim();
    if (!SSO_COOKIE_RE.test(trimmed)) {
      return {
        status: 400,
        body: {
          error: "bad_cookie",
          message: "That doesn't look like a Starlink session — it must include Starlink.Com.Sso.",
        },
      };
    }
    writeCookie(trimmed);
    forgetSession();
    try {
      await withFreshCookie((c) => resolveIds(c));
      return { status: 200, body: { ok: true } };
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        return {
          status: 428,
          body: {
            error: "not_connected",
            message: "That session didn't authenticate — sign in at starlink.com again.",
          },
        };
      }
      return { status: 502, body: { error: "upstream_failed", message: (error as Error).message } };
    }
  }

  function disconnect(): CloudResult {
    clearCookie();
    forgetSession();
    return { status: 200, body: { ok: true } };
  }

  return { handle, connect, disconnect };
}
