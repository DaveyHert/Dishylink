// The session-healing path is the one the extension leans on hardest: its cookie
// rides a declarativeNetRequest rule that lands a beat after it is set, so the
// first auth/user after connect or a worker wake can go out before the cookie is
// attached and come back 401. That must self-heal into a loaded account, not a
// hard "not connected".

import { describe, expect, it, vi } from "vitest";
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
function backend({
  authFailures = 0,
  authAlwaysFail = false,
  idFailures = 0,
  idAlwaysFail = false,
} = {}) {
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
      return res(200, {
        content: { results: [{ serviceLineNumber: "SL-1", accountReferenceId: "ACC-1" }] },
      });
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

describe("createCloudHandler pauseClient", () => {
  it("given: a trusted host request, should: send framed protobuf with its cookie", async () => {
    const request = new Uint8Array([8, 1, 18, 0]);
    const responseMessage = new Uint8Array([10, 0]);
    const responseFrame = new Uint8Array([0, 0, 0, 0, responseMessage.length, ...responseMessage]);
    const captured: { url: string; init?: RequestInit } = { url: "" };
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === AUTH_URL) return res(200);
      captured.url = url;
      captured.init = init;
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => responseFrame.buffer,
      } as unknown as Response;
    }) as typeof fetch;
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareDeviceUpdate: async (update) => {
        expect(update).toEqual({ kind: "pause", clientId: 7, paused: true });
        return request;
      },
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: true }),
    ).resolves.toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(captured.url).toBe("https://starlink.com/api/SpaceX.API.Device.Device/Handle");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.cookie).toBe(SESSION);
    expect(headers["Content-Type"]).toBe("application/grpc-web+proto");
    expect(new Uint8Array(captured.init?.body as ArrayBufferLike)).toEqual(
      new Uint8Array([0, 0, 0, 0, request.length, ...request]),
    );
  });

  it("given: the gateway rejects an expired token, should: refresh once and retry", async () => {
    let authCalls = 0;
    let deviceCalls = 0;
    const responseFrame = new Uint8Array([0, 0, 0, 0, 0]);
    const doFetch = (async (input: RequestInfo | URL) => {
      if (String(input) === AUTH_URL) {
        authCalls++;
        return res(200);
      }
      deviceCalls++;
      if (deviceCalls === 1) return res(401);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => responseFrame.buffer,
      } as unknown as Response;
    }) as typeof fetch;
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareDeviceUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: false }),
    ).resolves.toMatchObject({ status: 200 });
    expect(deviceCalls).toBe(2);
    expect(authCalls).toBe(2);
  });

  it("given: an expired session after retry, should: return the reconnect response", async () => {
    const doFetch = (async () => res(401)) as typeof fetch;
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareDeviceUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: true }),
    ).resolves.toMatchObject({
      status: 428,
      body: { error: "not_connected" },
    });
  });

  it("given: the device gateway stalls, should: abort and return a retryable timeout", async () => {
    const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === AUTH_URL) return res(200);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      prepareDeviceUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: true }),
    ).resolves.toEqual({
      status: 504,
      body: {
        error: "device_call_timeout",
        message: "Starlink did not answer the device update in time. Try again.",
      },
    });
  });

  it("given: token refresh stalls, should: abort the complete device operation", async () => {
    const doFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      prepareDeviceUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: true }),
    ).resolves.toMatchObject({
      status: 504,
      body: { error: "device_call_timeout" },
    });
  });

  it("given: two device updates overlap, should: prepare the second after the first write", async () => {
    const responseFrame = new Uint8Array([0, 0, 0, 0, 0]);
    let releaseFirstWrite: (() => void) | undefined;
    let deviceCalls = 0;
    const doFetch = (async (input: RequestInfo | URL) => {
      if (String(input) === AUTH_URL) return res(200);
      deviceCalls++;
      if (deviceCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => responseFrame.buffer,
      } as unknown as Response;
    }) as typeof fetch;
    const prepared: number[] = [];
    const handler = createCloudHandler({
      fetch: doFetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareDeviceUpdate: async (update) => {
        if (update.kind === "pause") prepared.push(update.clientId);
        return new Uint8Array();
      },
    });

    const first = handler.updateClient({ kind: "pause", clientId: 7, paused: true });
    const second = handler.updateClient({ kind: "pause", clientId: 8, paused: true });
    await vi.waitFor(() => expect(deviceCalls).toBe(1));
    expect(prepared).toEqual([7]);

    releaseFirstWrite?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true } },
    ]);
    expect(prepared).toEqual([7, 8]);
  });

  it("given: invalid renderer input, should: reject it before preparing a request", async () => {
    let prepared = false;
    const handler = createCloudHandler({
      readCookie: () => SESSION,
      prepareDeviceUpdate: async () => {
        prepared = true;
        return new Uint8Array();
      },
    });

    await expect(
      handler.updateClient({ kind: "pause", clientId: Number.NaN, paused: true }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      handler.updateClient({ kind: "pause", clientId: 7, paused: "yes" as unknown as boolean }),
    ).resolves.toMatchObject({
      status: 400,
    });
    expect(prepared).toBe(false);
  });
});
