import { describe, it, expect } from "vitest";
import { createCloudHandler, deviceTelemetryFrom } from "../cloud/starlinkCloudHandler.ts";

// A minimal Response stand-in for the injected fetch.
function jsonResponse(status: number, body: unknown, setCookie?: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === "set-cookie" ? (setCookie ?? null) : null),
    },
    json: async () => body,
  } as unknown as Response;
}

const SL = { serviceLineNumber: "AST-1", accountReferenceId: "ACC-1" };
const SERVICE_LINES = { content: { results: [SL] } };
const SERVICE_LINE_DETAIL = { content: { userTerminals: [] } };
const USAGE = { content: { billingCyclesAnnotated: [], servicePlan: {} } };

/** Route each upstream URL to a canned response; `on401` lets a test make the
 *  data calls fail once to exercise the mid-flight-expiry retry. */
function makeFetch(opts: { authStatus?: number; failDataCallsUntil?: { count: number } } = {}) {
  const calls: string[] = [];
  const doFetch = async (url: string | URL | Request): Promise<Response> => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/auth-rp/auth/user")) {
      if (opts.authStatus && opts.authStatus !== 200) return jsonResponse(opts.authStatus, {});
      return jsonResponse(
        200,
        { name: "Ada", email: "a@b.co" },
        "Starlink.Com.Access.V1=NEW; Path=/",
      );
    }
    // Data calls: optionally 401 for the first N to force a refresh+retry.
    if (opts.failDataCallsUntil && opts.failDataCallsUntil.count > 0) {
      opts.failDataCallsUntil.count -= 1;
      return jsonResponse(401, {});
    }
    if (u.includes("/accounts/service-lines")) return jsonResponse(200, SERVICE_LINES);
    if (u.includes("/accounts/service-line/")) return jsonResponse(200, SERVICE_LINE_DETAIL);
    if (u.includes("/data-usage/")) return jsonResponse(200, USAGE);
    if (u.includes("/device-data/cache/v1/telemetry")) return jsonResponse(200, { data: null });
    return jsonResponse(404, {});
  };
  return { doFetch: doFetch as unknown as typeof fetch, calls };
}

const CONNECTED = () => "Starlink.Com.Sso=abc; Starlink.Com.Access.V1=old";

describe("createCloudHandler", () => {
  it("returns 428 not-connected when there is no cookie", async () => {
    const { doFetch } = makeFetch();
    const handler = createCloudHandler({ fetch: doFetch, readCookie: () => null });
    const result = await handler.handle("/cloud/account");
    expect(result.status).toBe(428);
  });

  it("maps an expired session (auth 401) to 428, not a 502 network error", async () => {
    const { doFetch } = makeFetch({ authStatus: 401 });
    const handler = createCloudHandler({ fetch: doFetch, readCookie: CONNECTED });
    const result = await handler.handle("/cloud/account");
    expect(result.status).toBe(428); // reconnect prompt, not "check your internet"
  });

  it("serves the account on a valid session", async () => {
    const { doFetch } = makeFetch();
    const handler = createCloudHandler({ fetch: doFetch, readCookie: CONNECTED });
    const result = await handler.handle("/cloud/account");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ serviceLine: SERVICE_LINE_DETAIL });
  });

  it("retries once when the token expires mid-flight (401 then 200)", async () => {
    // Fail the very first data call (the service-lines list) with 401; the
    // handler must force-refresh and retry, then succeed.
    const { doFetch } = makeFetch({ failDataCallsUntil: { count: 1 } });
    const handler = createCloudHandler({ fetch: doFetch, readCookie: CONNECTED });
    const result = await handler.handle("/cloud/usage"); // usage: one un-caught call, clean retry check
    expect(result.status).toBe(200);
  });

  it("surfaces a genuine upstream failure as 502, not 428", async () => {
    const doFetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/auth-rp/auth/user"))
        return jsonResponse(200, {}, "Starlink.Com.Access.V1=NEW");
      return jsonResponse(500, {}); // service-lines list explodes
    }) as unknown as typeof fetch;
    const handler = createCloudHandler({ fetch: doFetch, readCookie: CONNECTED });
    const result = await handler.handle("/cloud/usage");
    expect(result.status).toBe(502);
  });

  describe("connect", () => {
    it("rejects a paste missing the Sso cookie with 400", async () => {
      const { doFetch } = makeFetch();
      let written: string | null = null;
      const handler = createCloudHandler({
        fetch: doFetch,
        readCookie: () => written,
        writeCookie: (c) => (written = c),
      });
      const result = await handler.connect("Starlink.Com.Access.V1=only");
      expect(result.status).toBe(400);
      expect(written).toBeNull(); // never persisted a bad paste
    });

    it("persists and confirms a valid session", async () => {
      const { doFetch } = makeFetch();
      let written: string | null = null;
      const handler = createCloudHandler({
        fetch: doFetch,
        readCookie: () => written,
        writeCookie: (c) => (written = c),
      });
      const result = await handler.connect("Starlink.Com.Sso=abc; x=y");
      expect(result.status).toBe(200);
      expect(written).toContain("Starlink.Com.Sso=abc");
    });

    it("rejects a well-formed but unauthenticated paste with 428", async () => {
      const { doFetch } = makeFetch({ authStatus: 401 });
      let written: string | null = null;
      const handler = createCloudHandler({
        fetch: doFetch,
        readCookie: () => written,
        writeCookie: (c) => (written = c),
      });
      const result = await handler.connect("Starlink.Com.Sso=stale");
      expect(result.status).toBe(428); // wrote it, but told the user it didn't authenticate
    });

    it("clears the session on disconnect", () => {
      let written: string | null = "Starlink.Com.Sso=abc";
      const { doFetch } = makeFetch();
      const handler = createCloudHandler({
        fetch: doFetch,
        readCookie: () => written,
        clearCookie: () => (written = null),
      });
      expect(handler.disconnect().status).toBe(200);
      expect(written).toBeNull();
    });
  });
});

describe("deviceTelemetryFrom", () => {
  const legend = {
    u: ["DeviceType", "UtcTimestampNs", "DeviceId", "ObstructionPercentTime", "Uptime"],
  };

  it("decodes a dish row", () => {
    const out = deviceTelemetryFrom({
      data: {
        columnNamesByDeviceType: legend,
        values: [["u", 1_700_000_000_000_000, "ut1", 0.05, 3600]],
      },
    });
    expect(out.ut1).toMatchObject({ kind: "dish", obstructionPct: 0.05, uptimeS: 3600 });
    expect(out.ut1.timestampMs).toBe(1_700_000_000); // UtcTimestampNs / 1e6
  });

  it("yields undefined (never NaN) for a missing legend field", () => {
    // Legend without ObstructionPercentTime — the field the UI would render "NaN%".
    const out = deviceTelemetryFrom({
      data: {
        columnNamesByDeviceType: { u: ["DeviceType", "UtcTimestampNs", "DeviceId", "Uptime"] },
        values: [["u", 1_700_000_000_000_000, "ut1", 3600]],
      },
    });
    expect(out.ut1.obstructionPct).toBeUndefined();
    expect(Number.isNaN(out.ut1.obstructionPct as number)).toBe(false);
  });
});
