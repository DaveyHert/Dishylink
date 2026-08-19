// One slow reply is not an outage. The host that proxies the router request can
// stall for seconds — a garbage collection in the dev server the recorder lives
// inside was measured holding one past the 4s timeout while the router answered
// a direct call in 7ms — and calling that a dead router puts a red callout in
// front of a network that never went away.
//
// In real Chromium rather than the node project for the same reason as the
// sibling file: the poll, its timer and the state it publishes are the behaviour.

import { expect, test, vi, afterEach } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { useRouterNetwork, CLIENTS_POLL_MS } from "./useRouterNetwork";

/** Each poll takes the next entry, holding on the last once they run out. */
let replies: Array<"ok" | "miss"> = [];
let polls = 0;

vi.mock("@core/dishClient", () => ({
  DishClient: {
    load: async () => ({
      getWifiClients: async () => {
        const reply = replies[Math.min(polls, replies.length - 1)] ?? "miss";
        polls += 1;
        if (reply === "miss") throw new Error("router unreachable");
        return [];
      },
      getWifiConfig: async () => ({ countryCode: "US" }),
    }),
  },
}));

vi.mock("../lib/routerStatusFeed", () => ({ subscribeRouterStatus: () => () => {} }));

// The poll interval is registered only after the first sample tail returns, and
// that one really does reach the network: left unmocked it stalls on its own 4s
// timeout, which the fake clock does not govern, so the test can advance past
// polls that were never scheduled.
vi.mock("../lib/apiHost", () => ({
  apiRequest: async () => new Response("{}", { status: 200 }),
}));

function Probe() {
  const network = useRouterNetwork(true);
  return <span data-testid='reachable'>{String(network.routerReachable)}</span>;
}

const read = () => document.querySelector('[data-testid="reachable"]')?.textContent;

/** Let one poll finish: loading the client and asking it are separate awaits,
 *  and the state lands a render after that. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(0);
}

// Unmounted while the clock is still fake, so the poll's own cleanup clears the
// timers it made — switching back first would leave them running.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  polls = 0;
});

test("given: a router that answered and then misses one poll, should: hold it reachable until the misses stack up", async () => {
  replies = ["ok", "miss", "miss"];
  vi.useFakeTimers();

  render(<Probe />);
  await settle();
  expect(read()).toBe("true");

  // One miss is ridden out: the roster the panel is drawing is seconds old, not
  // wrong, and a callout here would be describing the proxy rather than the kit.
  await vi.advanceTimersByTimeAsync(CLIENTS_POLL_MS);
  await settle();
  expect(read()).toBe("true");

  // The second says the silence is the router's own.
  await vi.advanceTimersByTimeAsync(CLIENTS_POLL_MS);
  await settle();
  expect(read()).toBe("false");
});

test("given: a router that has never answered, should: say so on the first miss", async () => {
  // Nothing to ride out — the panel is open on a kit that is not there, and the
  // explanation is owed now rather than two polls from now.
  replies = ["miss"];
  vi.useFakeTimers();

  render(<Probe />);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(read()).toBe("false"));
  expect(polls).toBe(1);
});
