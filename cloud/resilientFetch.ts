// Reaching starlink.com when some of the addresses behind it will not answer.
//
// api.starlink.com and starlink.com are anycast behind a CDN: one hostname, four
// addresses, each a different edge. The route to one edge can break while the
// others are fine — and it breaks late. The connection opens, TLS completes and
// the certificate verifies; the reset arrives only once the request is written.
//
// Every client has committed to one address by then. Automatic address fallback
// covers connection failures, and this is not one, so nothing retries: Node's
// fetch, Chromium's net.fetch and curl all give up with a working edge one
// address away. Measured on a broken route (2026-08-19): three of four edges
// reset every attempt, the fourth answered every attempt, and a plain request
// succeeded 7% of the time — the rate at which DNS happened to hand out the good
// one first.
//
// Node-only, so it is injected by the hosts that run on Node rather than
// imported by the handler: the extension's worker has no sockets to steer.

import dns from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";

/** Long enough to carry a burst of calls, short enough that an edge coming back
 *  is picked up the same session. */
const GOOD_ADDRESS_TTL_MS = 5 * 60_000;

/** Errors that mean "this address did not serve us", as against a reply we
 *  dislike. Anything else — an abort, a 500, a malformed body — belongs to the
 *  caller and is never retried here. */
const CONNECTION_FAILURES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function isConnectionFailure(error: unknown): boolean {
  const held = error as { code?: string; cause?: { code?: string } };
  const code = held?.cause?.code ?? held?.code;
  return code !== undefined && CONNECTION_FAILURES.has(code);
}

const agents = new Map<string, Agent>();
const lastGoodAddress = new Map<string, { address: string; atMs: number }>();

/** A dispatcher pinned to one address, with the hostname kept for SNI and
 *  certificate validation so pinning never weakens the TLS check. */
function agentFor(hostname: string, address: string): Agent {
  const key = `${hostname}|${address}`;
  const held = agents.get(key);
  if (held) return held;
  const family = address.includes(":") ? 6 : 4;
  const agent = new Agent({
    connect: {
      servername: hostname,
      lookup: ((_host: string, options: { all?: boolean }, callback: unknown) => {
        const done = callback as (
          error: Error | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void;
        if (options?.all) done(null, [{ address, family }]);
        else done(null, address, family);
      }) as never,
    },
  });
  agents.set(key, agent);
  return agent;
}

function rememberedAddress(hostname: string): string | null {
  const held = lastGoodAddress.get(hostname);
  if (!held) return null;
  if (Date.now() - held.atMs >= GOOD_ADDRESS_TTL_MS) {
    lastGoodAddress.delete(hostname);
    return null;
  }
  return held.address;
}

async function addressesFor(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}

/** Whether trying every address at once is acceptable for this request. A read
 *  can go to all of them and take whichever answers; a write goes to one at a
 *  time, because four identical writes arriving together is rude to the account
 *  API even when applying them twice would change nothing. */
export function isRead(init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

/**
 * fetch, with the other addresses tried when one edge will not serve.
 *
 * Reads race every address and take the first answer — walking them one at a
 * time costs a couple of seconds per dead edge, which on a hostname with four is
 * long enough for a panel to give up. Writes walk, and every method retries: a
 * reset can arrive after the far side acted, so a retried write may apply twice,
 * and every write behind this sets a value (pause on or off, a config field)
 * rather than accumulating one.
 */
export const resilientFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const { hostname } = new URL(input instanceof Request ? input.url : String(input));
  const attempt = (address?: string, signal?: AbortSignal) => {
    const options: Record<string, unknown> = { ...(init ?? {}) };
    if (signal) options.signal = signal;
    if (address) options.dispatcher = agentFor(hostname, address);
    return undiciFetch(input as never, options as never);
  };

  // The address that served last time, before anything is resolved: the common
  // case is one request against a host already known to answer.
  const remembered = rememberedAddress(hostname);
  if (remembered) {
    try {
      return await attempt(remembered);
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
      lastGoodAddress.delete(hostname);
    }
  }

  const addresses = (await addressesFor(hostname)).filter((one) => one !== remembered);
  // Nothing resolved — no addresses to choose between, so this is an ordinary
  // request and its failure is the honest one.
  if (addresses.length === 0) return await attempt();

  if (!isRead(init)) {
    let failure: unknown;
    for (const address of addresses) {
      try {
        const response = await attempt(address);
        lastGoodAddress.set(hostname, { address, atMs: Date.now() });
        return response;
      } catch (error) {
        if (!isConnectionFailure(error)) throw error;
        failure = error;
      }
    }
    throw failure;
  }

  const abandon = addresses.map(() => new AbortController());
  const tries = addresses.map((address, index) =>
    attempt(
      address,
      init?.signal
        ? AbortSignal.any([init.signal, abandon[index]!.signal])
        : abandon[index]!.signal,
    ).then((response) => ({ address, response, index })),
  );
  try {
    const won = await Promise.any(tries);
    for (const [index, controller] of abandon.entries())
      if (index !== won.index) controller.abort();
    lastGoodAddress.set(hostname, { address: won.address, atMs: Date.now() });
    return won.response;
  } catch (error) {
    // Every address failed. Raise what one of them said rather than the
    // AggregateError wrapper, so the caller sees a reason it can read.
    const [first] = (error as AggregateError).errors ?? [];
    throw first ?? error;
  }
}) as unknown as typeof fetch;
