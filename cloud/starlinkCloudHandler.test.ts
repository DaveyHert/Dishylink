// The session-healing path is the one the extension leans on hardest: its cookie
// rides a declarativeNetRequest rule that lands a beat after it is set, so the
// first auth/user after connect or a worker wake can go out before the cookie is
// attached and come back 401. That must self-heal into a loaded account, not a
// hard "not connected".

import { describe, expect, it } from "vitest";
import { createCloudHandler } from "./starlinkCloudHandler";

const AUTH_URL = "https://api.starlink.com/auth-rp/auth/user";
const SESSION = "Starlink.Com.Sso=sso-value; Starlink.Com.Access.V1=old-token";

/** Minimal stand-in for a fetch Response, carrying only what the handler reads —
 *  no dependence on the runtime's global Response or its set-cookie handling. */
function res(status: number, body: unknown = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** A starlink.com backend whose auth/user refusal is scripted: `authFailures`
 *  token refreshes 401 before it starts answering (the late-cookie window), or
 *  every refresh 401s (a dead session). `idFailures` / `idAlwaysFail` do the same
 *  for the identity read specifically — the case where the token authorizes the
 *  service-line call but the auth host still refuses the profile, blanking
 *  Name/Email. Counts refreshes and identity reads so a test can prove a retry did
 *  or didn't happen. */
function backend({ authFailures = 0, authAlwaysFail = false, idFailures = 0, idAlwaysFail = false } = {}) {
  let refreshCalls = 0;
  let idCalls = 0;
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const accept = (init?.headers as Record<string, string> | undefined)?.accept;
    if (url === AUTH_URL) {
      // The token refresh sends no Accept; the identity read asks for JSON.
      if (!accept) {
        refreshCalls++;
        if (authAlwaysFail || refreshCalls <= authFailures) return res(401);
        return res(200);
      }
      idCalls++;
      if (idAlwaysFail || idCalls <= idFailures) return res(401);
      return res(200, { name: "Ada", email: "ada@example.com", accountId: "ACC-1" });
    }
    if (url.includes("/webagg/v2/accounts/service-lines")) {
      return res(200, { content: { results: [{ serviceLineNumber: "SL-1", accountReferenceId: "ACC-1" }] } });
    }
    if (url.includes("/webagg/v2/accounts/service-line/")) {
      return res(200, { content: { serviceLineNumber: "SL-1" } });
    }
    if (url.includes("/device-data/cache/v1/telemetry")) {
      return res(200, { data: {} });
    }
    return res(404);
  }) as typeof fetch;
  return { doFetch, refreshCalls: () => refreshCalls, idCalls: () => idCalls };
}

function handlerFor(net: ReturnType<typeof backend>) {
  return createCloudHandler({
    fetch: net.doFetch,
    readCookie: () => SESSION,
    retryDelayMs: 0, // retry without the settle pause
  });
}

describe("createCloudHandler token refresh", () => {
  it("recovers a first auth/user that 401s because the cookie landed late", async () => {
    const net = backend({ authFailures: 1 });
    const result = await handlerFor(net).handle("/cloud/account");

    expect(result.status).toBe(200);
    expect((result.body as { identity: { name: string } }).identity.name).toBe("Ada");
    // The initial refresh 401'd; the delayed retry forced a second one, which is
    // what turned the miss into a loaded account.
    expect(net.refreshCalls()).toBe(2);
  });

  it("reports not-connected (428) when every refresh 401s — a dead session", async () => {
    const net = backend({ authAlwaysFail: true });
    const result = await handlerFor(net).handle("/cloud/account");

    expect(result.status).toBe(428);
    // One initial attempt, one retry, then it gives up rather than looping.
    expect(net.refreshCalls()).toBe(2);
  });

  it("does not retry when the first attempt succeeds", async () => {
    const net = backend();
    const result = await handlerFor(net).handle("/cloud/account");

    expect(result.status).toBe(200);
    expect(net.refreshCalls()).toBe(1);
  });

  it("recovers an identity read that 401s while the service line loads fine", async () => {
    // The token is good enough for the service-line call, so the request does not
    // fail — but the auth host refuses the first profile read. Without the identity
    // heal this lands a 200 with identity null (Name/Email blank); with it, the one
    // retry fills them in.
    const net = backend({ idFailures: 1 });
    const result = await handlerFor(net).handle("/cloud/account");

    expect(result.status).toBe(200);
    expect((result.body as { identity: { name: string } | null }).identity?.name).toBe("Ada");
    expect(net.idCalls()).toBe(2);
  });

  it("serves the panel with identity null when the profile stays refused", async () => {
    // A dead auth host must not blank plan and address too: identity degrades to
    // null, the rest of the account still loads.
    const net = backend({ idAlwaysFail: true });
    const result = await handlerFor(net).handle("/cloud/account");

    expect(result.status).toBe(200);
    expect((result.body as { identity: unknown }).identity).toBeNull();
    expect((result.body as { serviceLine: unknown }).serviceLine).not.toBeNull();
  });
});
