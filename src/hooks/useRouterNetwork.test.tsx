// The fallback the user actually sees: the LAN router says nothing, and the
// roster arrives from the account instead — labelled as such, with the live
// per-device rates withheld because nothing is feeding them.
//
// In real Chromium rather than the node project because the hook renders: the
// effects, their cleanup, and the state they publish are the behaviour under
// test, and only a real commit exercises them in order.

import { useEffect } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useRouterNetwork } from "./useRouterNetwork";
import { setCloudHost } from "../lib/cloudHost";

// A router that answers nothing, which is what a bypassed kit — or a viewer on
// another network — has in front of it.
vi.mock("@core/dishClient", () => ({
  DishClient: {
    load: async () => ({
      getWifiClients: async () => {
        throw new Error("router unreachable");
      },
      getWifiConfig: async () => {
        throw new Error("router unreachable");
      },
    }),
  },
}));

// The shared status poll is a separate feed with its own timer; it has nothing
// to say about where the roster came from.
vi.mock("../lib/routerStatusFeed", () => ({ subscribeRouterStatus: () => () => {} }));

const CLOUD_ROSTER = [
  {
    clientId: 7,
    macAddress: "aa:bb:cc:XX:XX:XX",
    givenName: "Nanoleaf",
    ipAddress: "192.168.1.57",
  },
];

function Probe({ askForAccountRoster = true }: { askForAccountRoster?: boolean } = {}) {
  const network = useRouterNetwork(true);
  const { readRosterViaAccount } = network;
  useEffect(() => {
    if (askForAccountRoster) readRosterViaAccount();
  }, [askForAccountRoster, readRosterViaAccount]);
  return (
    <div>
      <span data-testid='source'>{network.clientsSource ?? "none"}</span>
      <span data-testid='reachable'>{String(network.routerReachable)}</span>
      <span data-testid='names'>{network.clients.map((c) => c.givenName).join(",")}</span>
      <span data-testid='country'>{network.wifiConfig?.countryCode ?? "-"}</span>
    </div>
  );
}

const read = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;

test("given: a silent LAN router and a connected account, should: serve the roster from the account", async () => {
  const asked: string[] = [];
  setCloudHost({
    transport: async ({ path }) => {
      asked.push(path);
      if (path === "/cloud/router-clients") return { status: 200, body: { clients: CLOUD_ROSTER } };
      if (path === "/cloud/router-config")
        return { status: 200, body: { wifiConfig: { countryCode: "US" } } };
      return { status: 404, body: {} };
    },
  });

  render(<Probe />);

  await vi.waitFor(() => expect(read("source")).toBe("cloud"), { timeout: 8_000 });
  // The LAN verdict stays honest — the roster is standing in for it, not
  // pretending the router came back.
  expect(read("reachable")).toBe("false");
  expect(read("names")).toBe("Nanoleaf");
  // Config rides along, so the names and mesh the panels read are not left empty.
  await vi.waitFor(() => expect(read("country")).toBe("US"), { timeout: 8_000 });
  // Once per stretch of fallback, not once per roster poll.
  expect(asked.filter((path) => path === "/cloud/router-config")).toHaveLength(1);
});

test("given: a silent LAN nobody has asked to work around, should: read the config but not the roster", async () => {
  const asked: string[] = [];
  setCloudHost({
    transport: async ({ path }) => {
      asked.push(path);
      if (path === "/cloud/router-clients") return { status: 200, body: { clients: CLOUD_ROSTER } };
      if (path === "/cloud/router-config")
        return { status: 200, body: { wifiConfig: { countryCode: "US" } } };
      return { status: 404, body: {} };
    },
  });

  render(<Probe askForAccountRoster={false} />);

  // The settings reading these never asked for anything and must not go dark.
  await vi.waitFor(() => expect(read("country")).toBe("US"), { timeout: 8_000 });
  expect(asked).not.toContain("/cloud/router-clients");
  expect(read("source")).toBe("none");
  expect(read("names")).toBe("");
});

test("given: no account session, should: leave the roster empty rather than retry blindly", async () => {
  let asks = 0;
  setCloudHost({
    transport: async () => {
      asks++;
      return { status: 428, body: { error: "not_connected" } };
    },
  });

  render(<Probe />);

  await vi.waitFor(() => expect(read("reachable")).toBe("false"), { timeout: 8_000 });
  await vi.waitFor(() => expect(asks).toBeGreaterThan(0), { timeout: 8_000 });
  expect(read("source")).toBe("none");
  expect(read("names")).toBe("");
});
