// The session-healing path is the one the extension leans on hardest: its cookie
// rides a declarativeNetRequest rule that lands a beat after it is set, so the
// first auth/user after connect or a worker wake can go out before the cookie is
// attached and come back 401. That must self-heal into a loaded account, not a
// hard "not connected".

import { describe, expect, it, vi } from "vitest";
import { createCloudHandler } from "./starlinkCloudHandler";
import { GrpcWebError } from "../core/grpcWeb";

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
    const handler = createCloudHandler({
      fetch: gateway(async (init, url) => {
        captured.url = url ?? "";
        captured.init = init;
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => responseFrame.buffer,
        } as unknown as Response;
      }),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareDeviceUpdate: async (update, targetId) => {
        expect(update).toEqual({ kind: "pause", clientId: 7, paused: true });
        // Named by the account, not by anything read off the local network.
        expect(targetId).toBe(TARGET);
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
    const doFetch = gateway(
      async () => {
        deviceCalls++;
        if (deviceCalls === 1) return res(401);
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => responseFrame.buffer,
        } as unknown as Response;
      },
      () => authCalls++,
    );
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
    const doFetch = gateway(async () => {
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
    });
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

describe("createCloudHandler updateDishConfig", () => {
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
      prepareDishConfigUpdate: async (changes) => {
        expect(changes).toEqual({ swupdateRebootHour: 15 });
        return request;
      },
    });

    await expect(handler.updateDishConfig({ swupdateRebootHour: 15 })).resolves.toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(captured.url).toBe("https://starlink.com/api/SpaceX.API.Device.Device/Handle");
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.cookie).toBe(SESSION);
    expect(new Uint8Array(captured.init?.body as ArrayBufferLike)).toEqual(
      new Uint8Array([0, 0, 0, 0, request.length, ...request]),
    );
  });

  it("given: no session, should: return the reconnect response without preparing a request", async () => {
    let prepared = false;
    const handler = createCloudHandler({
      readCookie: () => null,
      prepareDishConfigUpdate: async () => {
        prepared = true;
        return new Uint8Array();
      },
    });

    await expect(
      handler.updateDishConfig({ swupdateThreeDayDeferralEnabled: true }),
    ).resolves.toMatchObject({ status: 428 });
    expect(prepared).toBe(false);
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
      prepareDishConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateDishConfig({ powerSaveMode: true })).resolves.toEqual({
      status: 504,
      body: {
        error: "device_call_timeout",
        message: "Starlink did not answer the config change in time. Try again.",
      },
    });
  });

  it("given: invalid or empty renderer input, should: reject it before preparing a request", async () => {
    let prepared = false;
    const handler = createCloudHandler({
      readCookie: () => SESSION,
      prepareDishConfigUpdate: async () => {
        prepared = true;
        return new Uint8Array();
      },
    });

    await expect(handler.updateDishConfig({})).resolves.toMatchObject({ status: 400 });
    await expect(handler.updateDishConfig({ swupdateRebootHour: 4 })).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      handler.updateDishConfig({ snowMeltMode: "MOSTLY" as never }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(handler.updateDishConfig({ powerSaveDurationMinutes: -5 })).resolves.toMatchObject(
      { status: 400 },
    );
    expect(prepared).toBe(false);
  });
});

const TARGET = "Router-010000000000000001B31340";

/** Answers everything the controller lookup needs, then defers the device
 *  gateway to `onDevice`. `onAuth` counts token refreshes for the tests that
 *  care how many there were. */
function gateway(
  onDevice: (init?: RequestInit, url?: string) => Promise<Response>,
  onAuth?: () => void,
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === AUTH_URL) {
      onAuth?.();
      return res(200);
    }
    if (url.includes("service-lines"))
      return res(200, {
        content: { results: [{ serviceLineNumber: "SL-1", accountReferenceId: "ACC-1" }] },
      });
    if (url.includes("/device-data/cache/v1/telemetry"))
      return res(200, {
        data: {
          // The legend covers the whole row, kind column included — so DeviceId
          // is the second entry, as it is on the wire.
          columnNamesByDeviceType: { r: ["DeviceType", "DeviceId", "WifiHopsFromController"] },
          values: [["r", TARGET, 0]],
        },
      });
    return onDevice(init, url);
  }) as typeof fetch;
}

describe("updateRouterConfig", () => {
  const SUBNET = { kind: "subnet" as const, subnet: "192.168.2.1/24", password: "hunter2hunter2" };

  const stall = (init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });

  it("given: the write itself stalls, should: report the subnet change as applied", async () => {
    const handler = createCloudHandler({
      fetch: gateway(stall),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 200,
      body: { applied: true },
    });
  });

  it("given: the write dies with the network, should: report the subnet change as applied", async () => {
    // What a service worker sees. Its fetch rejects the instant the LAN goes,
    // rather than hanging until a deadline the way a desktop request does, so the
    // same successful write arrives as a TypeError instead of a timeout.
    const handler = createCloudHandler({
      fetch: gateway(() => Promise.reject(new TypeError("Failed to fetch"))),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 200,
      body: { applied: true },
    });
  });

  it("given: the far end refuses the write, should: report it as a failure", async () => {
    // The one case that is genuinely a refusal: something answered. A dropped
    // connection cannot say no, and this must not be swept up with it.
    const handler = createCloudHandler({
      fetch: gateway(() => Promise.reject(new GrpcWebError(3, "invalid argument"))),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 502,
      body: { error: "device_call_failed" },
    });
  });

  it("given: the network dies before the write goes out, should: NOT claim the subnet moved", async () => {
    const handler = createCloudHandler({
      fetch: gateway(() => Promise.reject(new TypeError("Failed to fetch"))),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      // Consumes the gateway call standing in for the read, so the write never
      // leaves and nothing has been asked of the router.
      prepareRouterConfigUpdate: async (_update, _targetId, callGateway) =>
        callGateway(new Uint8Array()),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 502,
      body: { error: "device_call_failed" },
    });
  });

  it("given: the read before the write stalls, should: NOT claim the subnet moved", async () => {
    const handler = createCloudHandler({
      fetch: gateway(stall),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      // Stands in for reading the current networks: it consumes the gateway call
      // and never reaches the write.
      prepareRouterConfigUpdate: async (_update, _targetId, send) => send(new Uint8Array()),
    });

    // Nothing was dispatched, so the router not answering describes no call made.
    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 504,
      body: { error: "prepare_call_timeout" },
    });
  });

  it("given: a slow preamble, should: leave the write a full window of its own", async () => {
    // Each phase fits the budget and the two together do not. DNS is the subject
    // because it does not sever its own reply, so a timeout is still reported.
    const PHASE_MS = 90;
    // Abortable, or the deadline under test has nothing to cut short.
    const wait = (signal?: AbortSignal | null) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, PHASE_MS);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    const accepted = () =>
      ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new Uint8Array([0, 0, 0, 0, 0]).buffer,
      }) as unknown as Response;
    const inner = gateway(async (init) => {
      await wait(init?.signal);
      return accepted();
    });

    const handler = createCloudHandler({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === AUTH_URL) await wait(init?.signal);
        return inner(input, init);
      }) as typeof fetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: PHASE_MS + 60,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateRouterConfig({ kind: "customDns", nameservers: ["1.1.1.1"] }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("given: a session miss and then a stalled retry, should: not report the router as silent", async () => {
    // The refused first attempt is retried whole, so how far that one got says
    // nothing about the second, which never reaches the router at all.
    let authCalls = 0;
    let deviceCalls = 0;
    const denied = () =>
      ({
        status: 200,
        ok: true,
        headers: { get: (name: string) => (name === "grpc-status" ? "16" : null) },
        arrayBuffer: async () => new Uint8Array().buffer,
      }) as unknown as Response;
    const inner = gateway(async () => {
      deviceCalls += 1;
      return denied();
    });

    const handler = createCloudHandler({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === AUTH_URL && ++authCalls > 1) return stall(init);
        return inner(input, init);
      }) as typeof fetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 20,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({
      status: 504,
      body: { error: "prepare_call_timeout" },
    });
    expect(deviceCalls).toBe(1);
  });

  it("given: the gateway briefly having no session to the router, should: try again", async () => {
    // Measured on hardware: the write that ends bypass is refused with
    // DEVICE_NOT_CONNECTED and accepted six seconds later, because a bypassed
    // router holds only an intermittent session with the gateway.
    let calls = 0;
    const handler = createCloudHandler({
      fetch: gateway(async () => {
        calls += 1;
        if (calls === 1)
          return {
            status: 200,
            ok: true,
            headers: {
              get: (name: string) =>
                name === "grpc-status"
                  ? "5"
                  : name === "grpc-message"
                    ? "DEVICE_NOT_CONNECTED"
                    : null,
            },
            arrayBuffer: async () => new Uint8Array().buffer,
          } as unknown as Response;
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new Uint8Array([0, 0, 0, 0, 0]).buffer,
        } as unknown as Response;
      }),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceRetryDelayMs: 0,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateRouterConfig({ kind: "bypass", enabled: false }),
    ).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);
  });

  it("given: a router the gateway never has a session to, should: stop rather than retry forever", async () => {
    let calls = 0;
    const handler = createCloudHandler({
      fetch: gateway(async () => {
        calls += 1;
        return {
          status: 200,
          ok: true,
          headers: { get: (name: string) => (name === "grpc-status" ? "5" : null) },
          arrayBuffer: async () => new Uint8Array().buffer,
        } as unknown as Response;
      }),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceRetryDelayMs: 0,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    // The far end refused, so this is not one of the writes that severs its own
    // reply: it never took effect and must not be reported as applied. Tried
    // exactly twice, the second time having thrown away everything learned,
    // because resending the same bytes could only earn the same refusal.
    await expect(
      handler.updateRouterConfig({ kind: "bypass", enabled: false }),
    ).resolves.toMatchObject({ status: 502 });
    expect(calls).toBe(2);
  });

  it("given: an account read that lists only a mesh node, should: not cache it as the target", async () => {
    // A bypass flip drops the controller out of telemetry for a moment. A lone
    // router left in that gap is the mesh node, which is never the controller
    // and answers DEVICE_NOT_CONNECTED to everything.
    const MESH = "Router-01000000000000000049375B";
    let listController = false;
    const handler = createCloudHandler({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/device-data/cache/v1/telemetry"))
          return res(200, {
            data: {
              columnNamesByDeviceType: {
                r: ["DeviceType", "DeviceId", "WifiHopsFromController"],
              },
              values: listController
                ? [
                    ["r", TARGET, 0],
                    ["r", MESH, 1],
                  ]
                : [["r", MESH, 1]],
            },
          });
        return gateway(async () => res(200))(input, init);
      }) as typeof fetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      readRouterConfig: async (targetId) => ({ countryCode: targetId }),
    });

    // A background account read landing in the gap. It may cache a controller
    // for later writes, but a lone mesh node is not one.
    await handler.handle("/cloud/account");
    listController = true;
    // The controller is back, and the read must go to it rather than to whatever
    // the gap left behind.
    await expect(handler.handle("/cloud/router-config")).resolves.toEqual({
      status: 200,
      body: { wifiConfig: { countryCode: TARGET } },
    });
  });

  it("given: a factory reset whose reply dies with the router, should: report it as applied", async () => {
    // A reset restarts the device it was sent to, so the reply is lost the same
    // way a bypass flip loses its own. Reporting that as a failure would send the
    // user to reset a router that is already wiping.
    const handler = createCloudHandler({
      fetch: gateway(stall),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig({ kind: "factoryReset" })).resolves.toMatchObject({
      status: 200,
      body: { applied: true },
    });
  });

  it("given: a target cached during a flip, should: re-derive it rather than write to it", async () => {
    // The snapshot taken mid-flip can omit the controller and leave only the mesh
    // node, which is never connected. Cached, that answer refuses every write
    // behind it for as long as it lives, which no amount of retrying survives.
    const MESH = "Router-01000000000000000049375B";
    let listController = false;
    const targets: string[] = [];
    const handler = createCloudHandler({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/device-data/cache/v1/telemetry"))
          return res(200, {
            data: {
              columnNamesByDeviceType: { r: ["DeviceType", "DeviceId", "WifiHopsFromController"] },
              values: listController
                ? [
                    ["r", TARGET, 0],
                    ["r", MESH, 1],
                  ]
                : [["r", MESH, 1]],
            },
          });
        return gateway(async () => res(200))(input, init);
      }) as typeof fetch,
      readCookie: () => SESSION,
      retryDelayMs: 0,
      readRouterConfig: async (targetId) => ({ countryCode: targetId }),
      prepareRouterConfigUpdate: async (_update, targetId) => {
        targets.push(targetId);
        return new Uint8Array();
      },
    });

    // A read during the gap caches the only router the account listed.
    await handler.handle("/cloud/router-config");
    listController = true;
    await handler.updateRouterConfig({ kind: "bypass", enabled: false });

    expect(targets).toEqual([TARGET]);
  });

  it("given: a refused subnet write, should: not repeat a networks block read before it", async () => {
    let calls = 0;
    const handler = createCloudHandler({
      fetch: gateway(async () => {
        calls += 1;
        return {
          status: 200,
          ok: true,
          headers: { get: (name: string) => (name === "grpc-status" ? "5" : null) },
          arrayBuffer: async () => new Uint8Array().buffer,
        } as unknown as Response;
      }),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceRetryDelayMs: 0,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(handler.updateRouterConfig(SUBNET)).resolves.toMatchObject({ status: 502 });
    expect(calls).toBe(1);
  });

  it("given: a DNS write that stalls, should: stay retryable rather than claim success", async () => {
    const handler = createCloudHandler({
      fetch: gateway(stall),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      deviceCallTimeoutMs: 5,
      prepareRouterConfigUpdate: async () => new Uint8Array(),
    });

    await expect(
      handler.updateRouterConfig({ kind: "customDns", nameservers: ["1.1.1.1"] }),
    ).resolves.toMatchObject({ status: 504 });
  });

  it("given: a passphrase outside WPA2's bounds, should: refuse before the account is touched", async () => {
    let prepared = false;
    const handler = createCloudHandler({
      readCookie: () => SESSION,
      prepareRouterConfigUpdate: async () => {
        prepared = true;
        return new Uint8Array();
      },
    });

    await expect(
      handler.updateRouterConfig({ ...SUBNET, password: "short" }),
    ).resolves.toMatchObject({ status: 400 });
    expect(prepared).toBe(false);
  });
});

// The roster and the config read the same way the writes are sent: named by the
// account, carried over the gateway. That is what makes them answer for a router
// this machine cannot reach — a kit in bypass, or a viewer somewhere else.
describe("router reads over the gateway", () => {
  /** An empty grpc-web frame — enough for a reader that only needs its bytes. */
  const emptyFrame = () =>
    ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([0, 0, 0, 0, 0]).buffer,
    }) as unknown as Response;

  it("given: a roster read, should: ask the account's controller and serve what it reports", async () => {
    const asked: string[] = [];
    const handler = createCloudHandler({
      fetch: gateway(async () => emptyFrame()),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      readRouterClients: async (targetId, callGateway) => {
        asked.push(targetId);
        await callGateway(new Uint8Array([1]));
        return [{ clientId: 7, macAddress: "aa:bb:cc:00:00:00" }];
      },
    });

    await expect(handler.handle("/cloud/router-clients")).resolves.toEqual({
      status: 200,
      body: { clients: [{ clientId: 7, macAddress: "aa:bb:cc:00:00:00" }] },
    });
    expect(asked).toEqual([TARGET]);
  });

  it("given: a config read, should: serve the block the router reports", async () => {
    const handler = createCloudHandler({
      fetch: gateway(async () => res(200)),
      readCookie: () => SESSION,
      retryDelayMs: 0,
      readRouterConfig: async () => ({ countryCode: "US" }),
    });

    await expect(handler.handle("/cloud/router-config")).resolves.toEqual({
      status: 200,
      body: { wifiConfig: { countryCode: "US" } },
    });
  });

  it("given: a host that binds no reader, should: say so rather than answer emptily", async () => {
    const handler = createCloudHandler({
      fetch: gateway(async () => res(200)),
      readCookie: () => SESSION,
    });

    await expect(handler.handle("/cloud/router-clients")).resolves.toMatchObject({ status: 503 });
    await expect(handler.handle("/cloud/router-config")).resolves.toMatchObject({ status: 503 });
  });

  it("given: no session, should: prompt a reconnect without reading anything", async () => {
    let read = false;
    const handler = createCloudHandler({
      fetch: gateway(async () => res(200)),
      readCookie: () => null,
      readRouterClients: async () => {
        read = true;
        return [];
      },
    });

    await expect(handler.handle("/cloud/router-clients")).resolves.toMatchObject({ status: 428 });
    expect(read).toBe(false);
  });
});
