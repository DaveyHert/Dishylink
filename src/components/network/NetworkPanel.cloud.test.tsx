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
