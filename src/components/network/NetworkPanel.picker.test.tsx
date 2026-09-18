// Which devices the rule picker offers.
//
// The odometer holds only devices it has counted bytes for, and the router keeps
// no counters for a wired client — so a picker fed from the odometer alone shows
// a shorter network than the one the person is looking at.

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { NetworkPanel } from "./NetworkPanel";
import { TooltipProvider } from "../ui/tooltip";
import type { RouterNetwork } from "../../hooks/useRouterNetwork";
import type { ClientUsageTotal } from "@core/clientUsage";
import { setApiHost } from "../../lib/apiHost";

/** Every /api path the panel asks for, so a card can be checked on the key it
 *  asks under rather than on what it manages to render from an empty answer. */
const asked: string[] = [];
setApiHost({
  transport: async (path) => {
    asked.push(path);
    return new Response(JSON.stringify({ rules: [], pauseEnforceable: false }), {
      headers: { "content-type": "application/json" },
    });
  },
});

vi.mock("../../lib/routerStatusFeed", () => ({ subscribeRouterStatus: () => () => {} }));
// What the odometer holds, set per case: nothing at all for a device it has
// never been able to count, and a merged pair where one device wears two ids.
let totals: ClientUsageTotal[] = [];
let aliases = new Map<string, string>();
vi.mock("../../hooks/useClientTotals", () => ({
  useClientTotals: () => ({
    totals,
    aliases,
    mergeCandidates: [],
    writeError: null,
    answerMerge: () => {},
    unavailable: false,
    selfDeviceIdentified: true,
    remove: async () => {},
    clear: async () => {},
  }),
}));

const network: RouterNetwork = {
  clients: [
    {
      clientId: 7,
      macAddress: "aa:bb:cc:XX:XX:XX",
      givenName: "Nanoleaf",
      ipAddress: "192.168.1.57",
      role: "CLIENT",
      iface: "RF_5GHZ",
      rxStats: { bytes: "5000" },
      txStats: { bytes: "2000" },
      rxStatsValid: true,
      txStatsValid: true,
    },
    // The shape a wired client actually arrives in, probed off the router on
    // 2026-08-30 and again on 2026-09-18 with a console on the cable: listed like
    // any other, carrying a clientId, with empty stats blocks and no valid flags.
    {
      clientId: 8,
      macAddress: "dd:ee:ff:XX:XX:XX",
      givenName: "PS5",
      ipAddress: "192.168.1.67",
      role: "CLIENT",
      iface: "ETH",
      rxStats: {},
      txStats: {},
    },
  ],
  wifiConfig: null,
  routerReachable: true,
  clientsSource: "lan",
  historianAnswering: true,
  readRosterViaAccount: () => {},
  accountRosterStatus: "idle",
  accountRosterError: null,
  wifiConfigViaAccount: false,
  renameClient: async () => {},
  renameMeshNode: async () => {},
  throughputHistory: new Map(),
  rates: new Map(),
  ratesAtRoster: new Map(),
  totals: new Map(),
  routerStatus: null,
  refreshConfig: () => {},
};

/** The picker's rows: one label carrying a checkbox per device offered. */
function pickerRows(name: string): HTMLLabelElement[] {
  return [...document.querySelectorAll("label")].filter(
    (label) =>
      label.querySelector('input[type="checkbox"]') !== null &&
      (label.textContent ?? "").includes(name),
  );
}

async function openNewRule() {
  await page.getByText("Rules").click();
  await page.getByText("New rule").click();
}

test("given: a device the odometer has never counted, should: still offer it in the rule picker", async () => {
  totals = [];
  aliases = new Map();
  render(
    <TooltipProvider>
      <NetworkPanel network={network} unreachable={null} onClose={() => {}} />
    </TooltipProvider>,
  );

  await openNewRule();

  // Both devices, from a roster the odometer contributed nothing to.
  await vi.waitFor(() => {
    const text = document.body.textContent ?? "";
    expect(text).toContain("Nanoleaf");
    expect(text).toContain("PS5");
  });
  // And the wired one says why an allowance would measure nothing on it.
  expect(document.body.textContent).toContain("no usage data");
});

// The recorder folds a device's old identity into its newer one and keeps a note
// saying so. The router goes on reporting the device under whichever id it holds,
// so without that note the picker has the live entry and the stored record down
// as two devices, and a rule can be set on the half that measures nothing.
test("given: a device the recorder merged onto a newer id, should: offer it once", async () => {
  totals = [
    {
      clientId: 9,
      macAddress: "aa:bb:cc:XX:XX:XX",
      name: "Nanoleaf",
      rxBytes: 5_000,
      txBytes: 2_000,
      sinceMs: 0,
      lastSeenMs: 0,
    },
  ];
  aliases = new Map([["7", "9"]]);
  render(
    <TooltipProvider>
      <NetworkPanel network={network} unreachable={null} onClose={() => {}} />
    </TooltipProvider>,
  );

  await openNewRule();

  await vi.waitFor(() => expect(pickerRows("Nanoleaf")).toHaveLength(1));
  expect(pickerRows("Nanoleaf")[0].textContent).toContain("ACTIVE NOW");
});

// The other half of the same note: the card has to ask for the device's rules
// under the key the recorder keeps them on. Asking under the id the router
// happens to be reporting reads an empty card for a device that is metered.
test("given: a merged device's card, should: ask for its rules under the recorder's key", async () => {
  totals = [];
  aliases = new Map([["7", "9"]]);
  asked.length = 0;
  render(
    <TooltipProvider>
      <NetworkPanel network={network} unreachable={null} onClose={() => {}} />
    </TooltipProvider>,
  );

  await page.getByText("Nanoleaf").click();

  await vi.waitFor(() => expect(asked.some((path) => path.includes("client=9"))).toBe(true));
  expect(asked.some((path) => path.includes("meters?client=7"))).toBe(false);
});
