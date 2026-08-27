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

/** How long one pinned attempt may take before the pin is treated as dead rather
 *  than slow. The account API answers in about 1.5s, so this is slack. */
const ATTEMPT_TIMEOUT_MS = 6_000;

/** A ceiling on the whole sequential walk, so the number of addresses behind a
 *  hostname cannot push a write past the caller's own deadline: four addresses
 *  at one attempt each would be 24s against the 15s a device write is given. */
const WALK_TIMEOUT_MS = 12_000;

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

/** A deadline expiring, whoever set it. Raised as a DOMException whose legacy
 *  numeric `code` is 23, which the string-keyed set above cannot match. */
export function isTimeout(error: unknown): boolean {
  const held = error as { name?: string; cause?: { name?: string } };
  return held?.name === "TimeoutError" || held?.cause?.name === "TimeoutError";
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
      // Deferred a tick because dns.lookup is always asynchronous and the
      // connect machinery is built on that. Answering inline runs internalConnect
      // inside net.connect's own frame, so an address that fails the moment it is
      // tried — no route at all, which is what a kit switching into bypass leaves
      // behind — emits before the caller has attached its error handler, and
      // lands as an uncaught exception in the main process instead of a rejected
      // request.
      lookup: ((_host: string, options: { all?: boolean }, callback: unknown) => {
        const done = callback as (
          error: Error | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void;
        setImmediate(() => {
          if (options?.all) done(null, [{ address, family }]);
          else done(null, address, family);
        });
      }) as never,
    },
  });
  agents.set(key, agent);
  return agent;
}

/** A pooled connection whose route has gone is never reset, so requests written
 *  into it wait and later ones queue behind: 26s then 46s in the app against
 *  1.4s from a process with no pool to inherit. */
function forgetHost(hostname: string): void {
  for (const key of agents.keys()) {
    if (key.startsWith(`${hostname}|`)) forgetPin(hostname, key.slice(hostname.length + 1));
  }
  lastGoodAddress.delete(hostname);
}

function forgetPin(hostname: string, address: string): void {
  const key = `${hostname}|${address}`;
  const agent = agents.get(key);
  if (!agent) return;
  agents.delete(key);
  if (lastGoodAddress.get(hostname)?.address === address) lastGoodAddress.delete(hostname);
  void agent.destroy().catch(() => {
    // Already torn down; the point is that nothing reuses it.
  });
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

/** Not `dns.resolve*`: that reads its nameservers once at startup, so a process
 *  outliving a network change keeps asking resolvers that no longer answer, 15s
 *  of pure lookup in the app against 46ms here. Resolution takes no signal, so
 *  the caller's is raced against it. */
async function addressesFor(hostname: string, signal?: AbortSignal | null): Promise<string[]> {
  const resolving = dns
    .lookup(hostname, { all: true })
    .then((found) => found.map((one) => one.address))
    .catch(() => [] as string[]);
  if (!signal) return resolving;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  return Promise.race([resolving, aborted]);
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
  try {
    return await sendTo(hostname, input, init);
  } catch (error) {
    // Only a transport fault condemns the pool. A refusal delivered over a
    // healthy connection says nothing about the socket, and tearing it down
    // would put a TLS handshake in front of every retry.
    if (isConnectionFailure(error) || isTimeout(error)) forgetHost(hostname);
    throw error;
  }
}) as unknown as typeof fetch;

async function sendTo(
  hostname: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
  // Bounds each pin as well as the caller's deadline, so one silent socket
  // cannot spend the whole budget.
  const ownDeadline = (withinMs = ATTEMPT_TIMEOUT_MS) => {
    const mine = AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, withinMs));
    return init?.signal ? AbortSignal.any([init.signal, mine]) : mine;
  };

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
      return await attempt(remembered, ownDeadline());
    } catch (error) {
      // The caller's own deadline is theirs to report; only our attempt bound
      // means "this pin is not worth waiting on".
      if (init?.signal?.aborted) throw error;
      if (!isConnectionFailure(error) && !isTimeout(error)) throw error;
      forgetPin(hostname, remembered);
    }
  }

  const addresses = (await addressesFor(hostname, init?.signal)).filter(
    (one) => one !== remembered,
  );
  // Nothing resolved — no addresses to choose between, so this is an ordinary
  // request and its failure is the honest one.
  if (addresses.length === 0) return await attempt();

  if (!isRead(init)) {
    let failure: unknown;
    const walkEndsAt = Date.now() + WALK_TIMEOUT_MS;
    for (const address of addresses) {
      const left = walkEndsAt - Date.now();
      if (left <= 0) break;
      try {
        const response = await attempt(address, ownDeadline(left));
        lastGoodAddress.set(hostname, { address, atMs: Date.now() });
        return response;
      } catch (error) {
        if (init?.signal?.aborted) throw error;
        forgetPin(hostname, address);
        if (!isConnectionFailure(error) && !isTimeout(error)) throw error;
        failure = error;
      }
    }
    throw failure;
  }

  const abandon = addresses.map(() => new AbortController());
  const tries = addresses.map((address, index) =>
    attempt(address, AbortSignal.any([ownDeadline(), abandon[index]!.signal])).then(
      (response) => ({ address, response, index }),
      (error: unknown) => {
        // A loser abandoned once another edge won is not a bad pin.
        if (!abandon[index]!.signal.aborted) forgetPin(hostname, address);
        throw error;
      },
    ),
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
}
