// Full client manager backed by the router's gRPC API. Two tabs (Devices /
// Nodes), and a drill-in for whichever row is selected.
//
// This file is the router: it owns the tab, resolves `selectedKey` to a node or
// a device, and hands off. The rows and both detail views live beside it.

import { useEffect, useMemo, useState } from "react";
import type { RouterNetwork } from "../../hooks/useRouterNetwork";
import { useRadioTemps } from "../../hooks/useRadioTemps";
import { useSelfIdentity } from "../../hooks/useSelfIdentity";
import { matchesSelf } from "../../lib/selfIdentity";
import { ROUTER_UNREACHABLE_MESSAGE } from "../../lib/dishClient";
import { ensureOuiLoaded } from "../../lib/macVendor";
import { Loading } from "../ui/loading";
import { Callout } from "../ui/callout";
import { SegmentedControl } from "../ui/segmented-control";
import { RouterIcon } from "../../assets/icons/RouterIcon";
import { DeviceDetail } from "./DeviceDetail";
import { NodeDetail } from "./NodeDetail";
import { DeviceRow, NetworkRow } from "./NetworkRow";
import { buildNodeRoster } from "./nodeRoster";
import { clientEntryKey, liveThroughputMbps } from "./networkFormat";

export function NetworkPanel({
  network,
  selectedKey,
  onSelect,
}: {
  network: RouterNetwork;
  /** Selection is owned by the sheet, which renders the back chevron + title.
   *  Devices select by `clientEntryKey` (MAC alone is not unique — cloned-MAC
   *  devices share one); nodes select by their MAC. */
  selectedKey: string | null;
  onSelect: (entryKey: string | null) => void;
}) {
  const [tab, setTab] = useState<"devices" | "nodes">("devices");
  // Load the OUI registry once, then bump state so vendor lookups re-render.
  const [, setOuiReady] = useState(false);
  useEffect(() => {
    void ensureOuiLoaded().then(() => setOuiReady(true));
  }, []);
  // Radio temps come from the historian, not the router directly. Poll only
  // while the panel is mounted (i.e. the Network sheet is open).
  const radio = useRadioTemps(true);
  // The viewer's own address(es), to flag "This device" in the list.
  const self = useSelfIdentity(true);

  const devices = useMemo(
    () => network.clients.filter((client) => !client.role || client.role === "CLIENT"),
    [network.clients],
  );
  // The viewer's own device pins to the top (like the app), then by throughput.
  //
  // Deliberately not keyed on `network.rates`: the sort key is live throughput, and
  // recomputing it on every 1 Hz rate tick reordered the list once a second while
  // the header promised a 5 s one. The order is decided from whatever rates were
  // current when the roster last landed, and holds until the next roster.
  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const selfDelta = Number(matchesSelf(b, self)) - Number(matchesSelf(a, self));
      if (selfDelta !== 0) return selfDelta;
      return liveThroughputMbps(b, network.rates) - liveThroughputMbps(a, network.rates);
    });
  }, [devices, self]);

  if (network.routerReachable === null) {
    return <Loading message='Contacting the router…' />;
  }
  if (network.routerReachable === false) {
    return <Callout tone='error'>{ROUTER_UNREACHABLE_MESSAGE}</Callout>;
  }

  const nodes = buildNodeRoster(network.clients, network.wifiConfig);

  const selectedNode = selectedKey
    ? nodes.find((node) => node.client?.macAddress === selectedKey)
    : null;
  if (selectedNode) {
    return (
      <NodeDetail
        node={selectedNode}
        wifiConfig={network.wifiConfig}
        radios={radio.current}
        self={self}
        onSelect={onSelect}
      />
    );
  }

  const selected = selectedKey
    ? network.clients.find((client) => clientEntryKey(client) === selectedKey)
    : null;
  if (selected) {
    return (
      <DeviceDetail
        client={selected}
        rates={network.rates}
        total={selected.macAddress ? network.totals.get(selected.macAddress) : undefined}
        history={(selected.macAddress && network.throughputHistory.get(selected.macAddress)) || []}
        upstreamName={
          nodes.find((node) => node.client?.macAddress === selected.upstreamMacAddress)?.name
        }
        isThisDevice={matchesSelf(selected, self)}
        onRename={network.renameClient}
      />
    );
  }

  return (
    <div>
      <SegmentedControl
        variant='glider'
        label='Network view'
        className='mb-3.5'
        value={tab}
        onChange={setTab}
        options={[
          { value: "devices", label: <TabLabel text='Devices' count={devices.length} /> },
          { value: "nodes", label: <TabLabel text='Nodes' count={nodes.length} /> },
        ]}
      />

      {tab === "devices" && (
        <ListSection
          caption={`${devices.length} device${devices.length === 1 ? "" : "s"} · live from the router, refreshed every 5 s`}
        >
          {sortedDevices.map((client, index) => (
            <DeviceRow
              key={clientEntryKey(client) ?? index}
              client={client}
              self={self}
              onSelect={onSelect}
            />
          ))}
        </ListSection>
      )}

      {tab === "nodes" && (
        <ListSection caption='Router and mesh nodes'>
          {nodes.map((node) => (
            <NetworkRow
              key={node.key}
              icon={<RouterIcon size={20} className={!node.connected ? "opacity-35" : undefined} />}
              name={node.name}
              sub={node.status}
              band={
                node.devices.length
                  ? `${node.devices.length} device${node.devices.length === 1 ? "" : "s"}`
                  : undefined
              }
              showChevron={node.connected}
              disabled={!node.connected}
              onClick={() => node.client?.macAddress && onSelect(node.client.macAddress)}
            />
          ))}
        </ListSection>
      )}
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <>
      {text} <span className='ml-[3px] font-mono text-[11px] tabular-nums opacity-60'>{count}</span>
    </>
  );
}

/** Caption line plus the scrolling row list — identical framing on both tabs. */
function ListSection({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <>
      <div className='text-[11.5px] font-medium text-muted-foreground' style={{ marginBottom: 8 }}>
        {caption}
      </div>
      <div className='thin-scroll flex max-h-[460px] flex-col gap-1.5 overflow-y-auto'>
        {children}
      </div>
    </>
  );
}
