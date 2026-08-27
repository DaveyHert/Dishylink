// What the panel shows when the roster came from the account: the devices, said
// plainly to be from there — not the unreachable-router error that would
// otherwise stand in their place.

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { NetworkPanel } from "./NetworkPanel";
import type { RouterNetwork } from "../../hooks/useRouterNetwork";
import { setCloudHost } from "../../lib/cloudHost";

vi.mock("../../lib/routerStatusFeed", () => ({ subscribeRouterStatus: () => () => {} }));

const network: RouterNetwork = {
  clients: [
    {
      clientId: 7,
      macAddress: "aa:bb:cc:XX:XX:XX",
      givenName: "Nanoleaf",
      ipAddress: "192.168.1.57",
      role: "CLIENT",
    },
  ],
  wifiConfig: null,
  routerReachable: false,
  clientsSource: "cloud",
  historianAnswering: true,
  readRosterViaAccount: () => {},
  accountRosterStatus: "idle",
  accountRosterError: null,
  wifiConfigViaAccount: false,
  renameClient: async () => {},
  throughputHistory: new Map(),
  rates: new Map(),
  ratesAtRoster: new Map(),
  totals: new Map(),
  routerStatus: null,
  refreshConfig: () => {},
};

const unreachable = {
  cause: "differentNetwork" as const,
  message: "The router isn't answering on this network.",
};

test("given: a roster from the account, should: show the devices and name where they came from", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  render(<NetworkPanel network={network} unreachable={unreachable} onClose={() => {}} />);

  await vi.waitFor(() => expect(document.body.textContent).toContain("Nanoleaf"), {
    timeout: 8_000,
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain("come from your Starlink account");
  expect(text).toContain("via your Starlink account");
  // The diagnosis is carried into that note rather than replacing the list.
  expect(text).toContain("The router isn't answering on this network.");
  expect(document.querySelector('[data-slot="callout"][data-tone="error"]')).toBeNull();
});

test("given: a device with no recorded series, should: name what is silent rather than promise a chart", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  const renderedPanel = await render(
    <NetworkPanel
      network={{ ...network, historianAnswering: false }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  await renderedPanel.getByText("Nanoleaf").click();

  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("The history recorder isn't running"),
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain("the router on your network can't be reached");
  expect(text).not.toContain("Collecting live throughput");
});

test("given: recorded readings older than the window, should: say so rather than draw a blank chart", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });
  const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
  const sample = (timestampMs: number) => ({
    timestampMs,
    latencyMs: null,
    dropRate: 0,
    downlinkBps: 2_000_000,
    uplinkBps: 100_000,
    powerW: 0,
    routerLatencyMs: null,
    routerPingSuccessPercent: null,
  });

  const renderedPanel = await render(
    <NetworkPanel
      network={{
        ...network,
        historianAnswering: true,
        throughputHistory: new Map([["7", [sample(twoHoursAgo), sample(twoHoursAgo + 1_000)]]]),
      }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  await renderedPanel.getByText("Nanoleaf").click();

  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Nothing recorded for this device"),
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain("a longer window still has them");
  expect(text).not.toContain("Collecting live throughput");
  // The window picker is what acts on that, so it has to still be there.
  expect(document.body.textContent).toContain("6H");
});

test("given: a live router whose recorder is down, should: blame the recorder alone", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  const renderedPanel = await render(
    <NetworkPanel
      network={{
        ...network,
        clientsSource: "lan",
        routerReachable: true,
        historianAnswering: false,
      }}
      unreachable={null}
      onClose={() => {}}
    />,
  );

  await renderedPanel.getByText("Nanoleaf").click();

  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("so nothing is being recorded"),
  );
  expect(document.body.textContent ?? "").not.toContain("can't be reached");
});

test("given: a silent router and a connected account, should: offer the account read rather than take it", async () => {
  setCloudHost({
    transport: async ({ path }) =>
      path === "/cloud/account"
        ? { status: 200, body: { accountNumber: "ACC-1", serviceLines: [] } }
        : { status: 404, body: {} },
  });
  const asked: number[] = [];

  const renderedPanel = await render(
    <NetworkPanel
      network={{
        ...network,
        clients: [],
        clientsSource: null,
        readRosterViaAccount: () => asked.push(1),
      }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  const offer = renderedPanel.getByText("Connect through Cloud");
  await vi.waitFor(() => expect(offer.query()).not.toBeNull(), { timeout: 8_000 });
  await offer.click();

  expect(asked).toHaveLength(1);
});

test("given: the router still being checked, should: say so at once rather than wait out the silence", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  await render(
    <NetworkPanel
      network={{ ...network, clients: [], clientsSource: null }}
      unreachable={{ cause: "checking", message: "Checking the router…" }}
      onClose={() => {}}
    />,
  );

  await vi.waitFor(() => expect(document.body.textContent).toContain("Checking the router"), {
    timeout: 8_000,
  });
});

test("given: a reader done with the account note, should: keep it dismissed across openings", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  const first = await render(
    <NetworkPanel network={network} unreachable={unreachable} onClose={() => {}} />,
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("come from your Starlink"), {
    timeout: 8_000,
  });
  await first.getByRole("button", { name: "Dismiss this note" }).click();
  expect(document.body.textContent ?? "").not.toContain("come from your Starlink account");

  await first.unmount();
  await render(<NetworkPanel network={network} unreachable={unreachable} onClose={() => {}} />);

  await vi.waitFor(() => expect(document.body.textContent).toContain("Nanoleaf"), {
    timeout: 8_000,
  });
  expect(document.body.textContent ?? "").not.toContain("come from your Starlink account");
  // The devices themselves are not what was waved away.
  expect(document.body.textContent).toContain("via your Starlink account");
});

test("given: the router answering again, should: bring the note back for the next outage", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  const onLan = await render(
    <NetworkPanel
      network={{ ...network, clientsSource: "lan", routerReachable: true }}
      unreachable={null}
      onClose={() => {}}
    />,
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("Nanoleaf"), {
    timeout: 8_000,
  });
  await onLan.unmount();

  await render(<NetworkPanel network={network} unreachable={unreachable} onClose={() => {}} />);

  await vi.waitFor(() => expect(document.body.textContent).toContain("come from your Starlink"), {
    timeout: 8_000,
  });
});

test("given: a roster on screen that has stopped refreshing, should: say so over the list", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  await render(
    <NetworkPanel
      network={{
        ...network,
        accountRosterStatus: "failed",
        accountRosterError: "Couldn't reach your Starlink account.",
      }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  await vi.waitFor(() => expect(document.body.textContent).toContain("Nanoleaf"), {
    timeout: 8_000,
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain("Couldn't reach your Starlink account.");
  // The caption must not keep promising a refresh that is not happening.
  expect(text).toContain("no longer refreshing");
  expect(text).not.toContain("refreshed every");
});

test("given: an account read that cannot leave this device, should: say so rather than sit there", async () => {
  setCloudHost({
    transport: async ({ path }) =>
      path === "/cloud/account"
        ? { status: 200, body: { accountNumber: "ACC-1", serviceLines: [] } }
        : { status: 404, body: {} },
  });

  await render(
    <NetworkPanel
      network={{
        ...network,
        clients: [],
        clientsSource: null,
        accountRosterStatus: "failed",
        accountRosterError: "Couldn't reach your Starlink account.",
      }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Couldn't reach your Starlink account."),
  );
});

test("given: an account read in flight, should: hold the control and show it working", async () => {
  setCloudHost({
    transport: async ({ path }) =>
      path === "/cloud/account"
        ? { status: 200, body: { accountNumber: "ACC-1", serviceLines: [] } }
        : { status: 404, body: {} },
  });

  const renderedPanel = await render(
    <NetworkPanel
      network={{
        ...network,
        clients: [],
        clientsSource: null,
        accountRosterStatus: "loading",
      }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  const working = renderedPanel.getByRole("status", { name: "Connecting" });
  await vi.waitFor(() => expect(working.query()).not.toBeNull(), { timeout: 8_000 });
  expect(renderedPanel.getByRole("button", { name: /Connecting/ }).query()).toBeDisabled();
});

test("given: the same silence with no account roster, should: show the error instead", async () => {
  setCloudHost({ transport: async () => ({ status: 428, body: {} }) });

  render(
    <NetworkPanel
      network={{ ...network, clients: [], clientsSource: null }}
      unreachable={unreachable}
      onClose={() => {}}
    />,
  );

  await vi.waitFor(
    () => expect(document.querySelector('[data-slot="callout"][data-tone="error"]')).not.toBeNull(),
    { timeout: 8_000 },
  );
});
