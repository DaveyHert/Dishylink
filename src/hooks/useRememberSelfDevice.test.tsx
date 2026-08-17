// The id is learned from a LAN roster and only from a LAN roster, because that is
// the only reading where this machine's own addresses mean anything.

import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useRememberSelfDevice } from "./useRememberSelfDevice";
import type { SelfIdentity } from "../lib/selfIdentity";

const bridgeHost = globalThis as { dishlink?: unknown };
afterEach(() => {
  delete bridgeHost.dishlink;
});

function remembered(): number[] {
  const calls: number[] = [];
  bridgeHost.dishlink = {
    rememberSelfDevice: (clientId: number) => {
      calls.push(clientId);
      return Promise.resolve();
    },
  };
  return calls;
}

const roster = [
  { clientId: 7, macAddress: "aa:bb:cc:XX:XX:XX", ipAddress: "192.168.1.5" },
  { clientId: 8, macAddress: "dd:ee:ff:XX:XX:XX", ipAddress: "192.168.1.6" },
];

const self: SelfIdentity = { ips: ["192.168.1.6"], macs: [], describesHost: true };

function Probe({ source }: { source: "lan" | "cloud" }) {
  useRememberSelfDevice(roster, source, self);
  return <span>probe</span>;
}

test("given: a LAN roster carrying this machine, should: hand its id to the host", async () => {
  const calls = remembered();

  await render(<Probe source='lan' />);

  await vi.waitFor(() => expect(calls).toEqual([8]));
});

test("given: the same roster read through the account, should: record nothing", async () => {
  const calls = remembered();

  await render(<Probe source='cloud' />);

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toEqual([]);
});

test("given: no host to tell, should: leave the roster alone rather than throw", async () => {
  await render(<Probe source='lan' />);

  expect(document.body.textContent).toContain("probe");
});
