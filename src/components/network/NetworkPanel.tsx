// Full client manager backed by the router's gRPC API. Two tabs (Devices /
// Nodes), and a drill-in for whichever row is selected.
//
// This file is the router: it owns the tab, resolves `selectedKey` to a node or
// a device, and hands off. The rows and both detail views live beside it.

import { useEffect, useMemo, useState } from "react";
import {
  CLIENTS_POLL_MS,
  CLOUD_CLIENTS_POLL_MS,
  type RouterNetwork,
} from "../../hooks/useRouterNetwork";
import { useRadioTemps } from "../../hooks/useRadioTemps";
import { useSelfIdentity } from "../../hooks/useSelfIdentity";
import { useRememberSelfDevice } from "../../hooks/useRememberSelfDevice";
import { matchesSelf, selfIdentified } from "../../lib/selfIdentity";
import { selfDeviceHost } from "../../lib/selfDeviceHost";
import {
  accountRosterNoticeDismissed,
  setAccountRosterNoticeDismissed,
} from "../../lib/accountRosterNotice";
import { requestPanel } from "../../hooks/usePanelRouting";
import { useCloudAccount } from "../../hooks/useCloudAccount";
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";
import { AccountRosterOffer } from "./AccountRosterOffer";
import { inlineLinkButton } from "../ui/action-button";
import type { RouterUnreachable } from "../../lib/routerDiagnosis";
import { DetailsModal } from "../ui/details-modal";
import { Loading } from "../ui/loading";
import { Callout } from "../ui/callout";
import { SegmentedControl } from "../ui/segmented-control";
import { RouterIcon } from "../../assets/icons/RouterIcon";
import { DeviceDetail } from "./DeviceDetail";
import { RulesTab } from "./rules/RulesTab";
import { NodeDetail } from "./NodeDetail";
import { DeviceRow, NetworkRow } from "./NetworkRow";
import { buildNodeRoster } from "./nodeRoster";
import { DeviceMergePrompt } from "../shared/DeviceMergePrompt";
import { useOuiRegistry } from "../../hooks/useOuiRegistry";
import { useClientTotals } from "../../hooks/useClientTotals";
import { useNow } from "../../hooks/useNow";
import { usageKey } from "@core/clientUsage";
import { clientEntryKey, isClientDevice, liveThroughputMbps } from "./networkFormat";

export function NetworkPanel({
  network,
  unreachable,
  onClose,
}: {
  network: RouterNetwork;
  /** Why the router is silent, when it is. Null while it is answering. */
  unreachable: RouterUnreachable | null;
  onClose: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  return (
    <DetailsModal
      title='Network'
      size='wide'
      onClose={onClose}
      onBack={selectedKey ? () => setSelectedKey(null) : undefined}
    >
      <NetworkPanelBody
        network={network}
        unreachable={unreachable}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />
    </DetailsModal>
  );
}

function NetworkPanelBody({
  network,
  unreachable,
  selectedKey,
  onSelect,
}: {
  network: RouterNetwork;
  unreachable: RouterUnreachable | null;
  /** Devices select by `clientEntryKey` (MAC alone is not unique — cloned-MAC
   *  devices share one); nodes select by their MAC. */
  selectedKey: string | null;
  onSelect: (entryKey: string | null) => void;
}) {
  const [tab, setTab] = useState<"connected" | "nodes" | "rules">("connected");
  useOuiRegistry();
  // Radio temps come from the historian, not the router directly. Poll only
  // while the panel is mounted (i.e. the Network panel is open).
  const radio = useRadioTemps();
  // The viewer's own address(es), to flag "This device" in the list.
  const { self, resolved: selfResolved } = useSelfIdentity();
  useRememberSelfDevice(network.clients, network.clientsSource, self);
  // The odometer's records, for the split-record question below the device list.
  // The rows themselves come from the router and know nothing about stored totals.
  const { totals, mergeCandidates, writeError, answerMerge } = useClientTotals();
  const nowMs = useNow(30_000);
  // Both halves of what pausing needs, so the list can name whichever is missing.
  const { status: cloudStatus } = useCloudAccount(true);
  // Two different questions. Whether pausing works at all is the same condition
  // the control itself uses, so the list explains exactly what it hides. Whether
  // to say "sign in" is narrower: a session that is held but unreachable is a
  // connection fault, and sending someone to sign in over one is a dead end.
  const accountUnavailable = cloudStatus !== "loading" && cloudStatus !== "ready";
  const needsAccount = cloudStatus === "not-connected";
  const needsSelfDevice = selfDeviceHost() !== null && selfResolved && !selfIdentified(self);

  /** The LAN is silent and the account is answering in its place. */
  const viaCloud = network.clientsSource === "cloud";
  const [noticeDismissed, setNoticeDismissed] = useState(accountRosterNoticeDismissed);
  // The router answering again retires the dismissal, so the next outage is
  // surfaced as the fresh event it is rather than inheriting an older answer.
  if (noticeDismissed && network.clientsSource === "lan") setNoticeDismissed(false);
  useEffect(() => {
    if (network.clientsSource === "lan") setAccountRosterNoticeDismissed(false);
  }, [network.clientsSource]);

  const devices = useMemo(() => network.clients.filter(isClientDevice), [network.clients]);
  // The viewer's own device pins to the top (like the app), then by throughput.
  //
  // Ordered on the rates captured with the roster rather than the live ones: the
  // sort key is throughput, and re-sorting on every 1 Hz rate tick reorders the
  // list once a second under a header promising 5 s. This holds the order until
  // there is a new roster to order.
  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const selfDelta = Number(matchesSelf(b, self)) - Number(matchesSelf(a, self));
      if (selfDelta !== 0) return selfDelta;
      return (
        liveThroughputMbps(b, network.ratesAtRoster) - liveThroughputMbps(a, network.ratesAtRoster)
      );
    });
  }, [devices, self, network.ratesAtRoster]);

  // A limit can be set on any device the recorder holds a record for, not only
  // the ones answering right now: an absent device's cycle still rolls and its
  // pause still releases. Live is a tag on the row, decided here because only
  // this view knows which devices the router is currently reporting.
  const liveKeys = new Set(devices.map((client) => usageKey(client.clientId, client.macAddress)));
  const meterCandidates = (totals ?? []).map((total) => {
    const clientKey = usageKey(total.clientId, total.macAddress);
    return {
      clientKey,
      name: total.name?.trim() || total.macAddress,
      macAddress: total.macAddress,
      active: liveKeys.has(clientKey),
      lastSeenMs: total.lastSeenMs,
    };
  });

  if (network.routerReachable === null) {
    return <Loading message='Contacting the router…' />;
  }
  // Branch on the diagnosis rather than on `routerReachable` again: it is
  // derived from that same flag, so this cannot render an empty callout.
  //
  // A roster read through the account is not a degraded stand-in for this list —
  // it IS this list, from the one reader that still reaches the router. So the
  // silence is explained above the devices rather than shown instead of them.
  if (unreachable && !viaCloud) {
    return (
      <div>
        <Callout tone='error'>{unreachable.message}</Callout>
        {needsAccount ? (
          <div className='mt-3 text-[12.5px] text-muted-foreground'>
            <AccountRequiredNotice />
          </div>
        ) : (
          <AccountRosterOffer
            status={network.accountRosterStatus}
            error={network.accountRosterError}
            onConnect={network.readRosterViaAccount}
          />
        )}
      </div>
    );
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
        routerStatus={network.routerStatus}
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
        liveRatesAvailable={!viaCloud}
        historianAnswering={network.historianAnswering}
        routerReachable={network.routerReachable}
        rosterRefreshMs={viaCloud ? CLOUD_CLIENTS_POLL_MS : CLIENTS_POLL_MS}
        total={network.totals.get(usageKey(selected.clientId, selected.macAddress))}
        history={
          network.throughputHistory.get(usageKey(selected.clientId, selected.macAddress)) || []
        }
        upstreamName={
          nodes.find((node) => node.client?.macAddress === selected.upstreamMacAddress)?.name
        }
        isThisDevice={matchesSelf(selected, self)}
        viewerIdentified={selfIdentified(self)}
        meterCandidates={meterCandidates}
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
          { value: "connected", label: <TabLabel text='Connected' count={devices.length} /> },
          { value: "nodes", label: <TabLabel text='Nodes' count={nodes.length} /> },
          { value: "rules", label: <TabLabel text='Rules' /> },
        ]}
      />

      {/* Above both tabs: everything under them is coming from the account, not
          from the router on this network. */}
      {viaCloud && !noticeDismissed && (
        <Callout
          tone='info'
          className='mb-2.5'
          dismissLabel='Dismiss this note'
          onDismiss={() => {
            setAccountRosterNoticeDismissed(true);
            setNoticeDismissed(true);
          }}
        >
          {unreachable ? `${unreachable.message} ` : ""}These devices come from your Starlink
          account, so they refresh every {CLOUD_CLIENTS_POLL_MS / 1000}&nbsp;s and carry no live
          throughput.
        </Callout>
      )}

      {tab === "connected" && (
        <>
          {viaCloud && network.accountRosterError && (
            <div className='mb-2 text-[11.5px] text-destructive'>{network.accountRosterError}</div>
          )}
          <ListSection
            caption={`${devices.length} device${devices.length === 1 ? "" : "s"} · ${
              viaCloud
                ? network.accountRosterError
                  ? "via your Starlink account, no longer refreshing"
                  : `via your Starlink account, refreshed every ${CLOUD_CLIENTS_POLL_MS / 1000} s`
                : `live from the router, refreshed every ${CLIENTS_POLL_MS / 1000} s`
            }`}
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
          {(accountUnavailable || needsSelfDevice) && (
            <Callout tone='info' iconSeverity='warn' className='mt-2.5'>
              Pause feature disabled! To enable,{" "}
              {accountUnavailable && (
                <>
                  <button
                    type='button'
                    className={inlineLinkButton}
                    onClick={() => requestPanel("account")}
                  >
                    {needsAccount ? "sign in" : "reconnect"}
                  </button>{" "}
                  to your Starlink account
                </>
              )}
              {accountUnavailable && needsSelfDevice && " and "}
              {needsSelfDevice && (
                <>
                  pick the current device you are using under app&rsquo;s{" "}
                  <button
                    type='button'
                    className={inlineLinkButton}
                    onClick={() => requestPanel("settings", "app")}
                  >
                    settings
                  </button>
                </>
              )}
              .
              {needsSelfDevice &&
                " That keeps your own device off the list of things this app can cut off."}
            </Callout>
          )}
          {/* The device list is where a split record is noticed — one name on two
              entries — so the question belongs here as well as on the usage panel.
              Outside ListSection, whose rows scroll within a fixed height: a
              question placed among them would sit below the fold on a busy network.
              Both surfaces read the same candidate list, so answering in one closes
              it in the other on the next refresh. */}
          <DeviceMergePrompt
            candidates={mergeCandidates}
            totals={totals ?? []}
            nowMs={nowMs}
            onAnswer={(candidate, same) => void answerMerge(candidate, same)}
          />
          {/* A refused write removes the prompt optimistically, so without this the
              answer would appear to have been taken until the next reload. */}
          {writeError && <div className='py-2.5 text-[12.5px] text-destructive'>{writeError}</div>}
        </>
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

      {tab === "rules" && <RulesTab candidates={meterCandidates} />}
    </div>
  );
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  if (count === undefined) return text;
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
      <div className='thin-scroll flex max-h-[660px] flex-col gap-1.5 overflow-y-auto'>
        {children}
      </div>
    </>
  );
}
