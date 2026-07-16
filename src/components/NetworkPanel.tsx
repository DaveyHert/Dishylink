// Full client manager backed by the router's gRPC API. Two tabs (Devices /
// Nodes), rows with a signal icon on the left + band/chevron on the right, and
// a per-device drill-in showing everything the API exposes, with rename.

import { useEffect, useState } from "react";
import type { RouterNetwork } from "../hooks/useRouterNetwork";
import { useRadioTemps, type RadioReading } from "../hooks/useRadioTemps";
import { throughputMbps, type WifiClientJson, type WifiNetworkConfigJson } from "../lib/dishClient";
import type { TelemetrySample } from "../lib/telemetry";
import { vendorForMac, ensureOuiLoaded } from "../lib/macVendor";
import {
  formatUptime,
  formatBytes,
  formatThroughputLabel,
  formatThroughputTick,
} from "../lib/format";
import { THROUGHPUT_SERIES } from "../lib/statDetails";
import { TelemetryChart } from "./TelemetryChart";
import { Input } from "@/components/ui/input";
import { InfoDot } from "./InfoDot";

function bandLabel(client: WifiClientJson): string {
  const iface = client.iface ?? "";
  if (iface === "ETH") return "Ethernet";
  if (iface.startsWith("RF_"))
    return iface.replace("RF_", "").replace("GHZ", " GHz").replace("5 GHz_HIGH", "5 GHz");
  return iface || "—";
}

/** Radio-band code → readable name for the temperature readout. */
function radioBandLabel(band: string): string {
  if (band === "RF_2GHZ") return "2.4 GHz";
  if (band === "RF_5GHZ") return "5 GHz";
  if (band === "RF_5GHZ_HIGH") return "5 GHz high";
  return band;
}

/** Signal quality bucket from dBm (wifi). Ethernet has no RSSI. */
function signalQuality(
  client: WifiClientJson,
): { label: string; bars: number; colorVar: string } | null {
  if (client.iface === "ETH") return { label: "wired", bars: 4, colorVar: "--status-good" };
  const dbm = client.signalStrength;
  if (dbm === undefined || dbm === 0) return null;
  if (dbm > -55) return { label: "excellent", bars: 4, colorVar: "--status-good" };
  if (dbm > -67) return { label: "good", bars: 3, colorVar: "--status-good" };
  if (dbm > -75) return { label: "fair", bars: 2, colorVar: "--chart-warm" };
  return { label: "weak", bars: 1, colorVar: "--status-critical" };
}

/** Seeded per-device history is one point per minute, so only a stretch past a
 *  couple of minutes is a real hole — 30s would fracture a healthy line. */
const PER_DEVICE_GAP_MS = 150_000;

/** Silence past this reads as idle. Live polling shows noDataIdleS bouncing
 *  between 1s and 5s on devices doing nothing but background chatter. */
const IDLE_AFTER_S = 30;

function liveThroughputMbps(client: WifiClientJson): number {
  return throughputMbps(client.rxStats) + throughputMbps(client.txStats);
}

function displayName(client: WifiClientJson): string {
  return (
    client.givenName || client.name || client.ipAddress || client.macAddress || "Unnamed device"
  );
}

/** Subtitle line: hostname and/or derived vendor, de-duplicated. */
function deviceSubtitle(client: WifiClientJson): string {
  const parts: string[] = [];
  if (client.name && client.name !== client.givenName) parts.push(client.name);
  const vendor = vendorForMac(client.macAddress);
  if (vendor && vendor !== "Private" && !parts.includes(vendor)) parts.push(vendor);
  return parts.join(" · ") || "unknown device";
}

/** One row of the Nodes tab: the router itself plus every mesh node it has been
 *  paired with, connected or not. */
interface NodeEntry {
  key: string;
  name: string;
  status: string;
  connected: boolean;
  /** Present only while the node is up — the live client entry to drill into. */
  client?: WifiClientJson;
  deviceCount?: number;
}

/** Friendly name for a live node. The API only ever sends the raw role
 *  ("CONTROLLER"), so the router's human label is ours, as in the app; a mesh
 *  node prefers the name saved in its config over its bare hostname. */
function nodeName(client: WifiClientJson, wifiConfig: WifiNetworkConfigJson | null): string {
  if (client.role === "CONTROLLER") return "Main Router";
  const configured = client.deviceId
    ? wifiConfig?.meshConfigs?.[client.deviceId]?.displayName
    : undefined;
  return client.givenName || configured || client.name || "Mesh node";
}

/**
 * Builds the Nodes roster by joining two sources: live clients with a non-CLIENT
 * role (the router, plus any mesh node currently up) and `wifiConfig.meshConfigs`
 * (every paired node, keyed by deviceId). A config entry with no live client is a
 * node that is paired but down — invisible to the client list alone.
 */
function buildNodeRoster(
  clients: WifiClientJson[],
  wifiConfig: WifiNetworkConfigJson | null,
): NodeEntry[] {
  const infrastructure = clients.filter((client) => client.role && client.role !== "CLIENT");
  const liveDeviceIds = new Set(infrastructure.map((client) => client.deviceId).filter(Boolean));

  const nodes: NodeEntry[] = infrastructure.map((client, index) => ({
    key: client.deviceId ?? client.macAddress ?? `node-${index}`,
    name: nodeName(client, wifiConfig),
    status: client.role === "CONTROLLER" ? "Connected to Starlink" : "Connected",
    connected: true,
    client,
    deviceCount: clients.filter(
      (peer) => peer.role === "CLIENT" && peer.upstreamMacAddress === client.macAddress,
    ).length,
  }));

  for (const [deviceId, meshNode] of Object.entries(wifiConfig?.meshConfigs ?? {})) {
    if (liveDeviceIds.has(deviceId)) continue;
    nodes.push({
      key: deviceId,
      name: meshNode.displayName || "Mesh node",
      status: "Disconnected",
      connected: false,
    });
  }

  // Router first, then connected mesh nodes, then the ones that are down.
  return nodes.sort((a, b) => Number(b.connected) - Number(a.connected));
}

/** Concentric wifi-arc glyph (like the official app): white/ink arcs, with the
 *  weaker arcs dimmed by signal quality (`bars` 1–4 → dot + up to 3 arcs). */
function WifiArcIcon({ bars }: { bars: number }) {
  // inner → outer arc lights at bars ≥ 2/3/4; the base dot is the weakest level.
  const arcs: { d: string; litAt: number }[] = [
    { d: "M8.5 16.1a6 6 0 0 1 7 0", litAt: 2 },
    { d: "M5 12.5a11 11 0 0 1 14 0", litAt: 3 },
    { d: "M1.4 9a16 16 0 0 1 21.2 0", litAt: 4 },
  ];
  return (
    <svg width='20' height='16' viewBox='0 0 24 20' className='wifi-arc' aria-hidden='true'>
      {arcs.map((arc) => (
        <path
          key={arc.litAt}
          d={arc.d}
          fill='none'
          stroke='var(--ink)'
          strokeWidth={2}
          strokeLinecap='round'
          opacity={bars >= arc.litAt ? 1 : 0.28}
        />
      ))}
      <circle cx={12} cy={19.5} r={1.3} fill='var(--ink)' opacity={bars >= 1 ? 1 : 0.28} />
    </svg>
  );
}

/** Router/mesh-node glyph for the Nodes tab — the hardware itself, not a link
 *  quality, so it dims wholesale when the node is down. */
function RouterIcon({ dimmed }: { dimmed?: boolean }) {
  return (
    <svg
      width='20'
      height='16'
      viewBox='0 0 24 20'
      className='wifi-arc'
      aria-hidden='true'
      opacity={dimmed ? 0.35 : 1}
    >
      <rect
        x={3}
        y={11}
        width={18}
        height={7}
        rx={2}
        fill='none'
        stroke='var(--ink)'
        strokeWidth={2}
      />
      <circle cx={7} cy={14.5} r={1.1} fill='var(--ink)' />
      <path
        d='M8.5 7.4a5 5 0 0 1 7 0'
        fill='none'
        stroke='var(--ink)'
        strokeWidth={1.8}
        strokeLinecap='round'
      />
      <path
        d='M5.6 4.2a9 9 0 0 1 12.8 0'
        fill='none'
        stroke='var(--ink)'
        strokeWidth={1.8}
        strokeLinecap='round'
      />
    </svg>
  );
}

/** Ethernet-port glyph for wired clients (no RSSI to show as arcs). */
function WiredIcon() {
  return (
    <svg width='20' height='16' viewBox='0 0 24 20' className='wifi-arc' aria-hidden='true'>
      <rect
        x={4}
        y={5}
        width={16}
        height={9}
        rx={1.5}
        fill='none'
        stroke='var(--ink)'
        strokeWidth={2}
      />
      {[8, 12, 16].map((x) => (
        <line
          key={x}
          x1={x}
          y1={14}
          x2={x}
          y2={17}
          stroke='var(--ink)'
          strokeWidth={2}
          strokeLinecap='round'
        />
      ))}
    </svg>
  );
}

/** Picks the wired glyph for Ethernet, else the wifi-arc glyph. */
function DeviceSignalIcon({
  client,
  quality,
}: {
  client: WifiClientJson;
  quality: ReturnType<typeof signalQuality>;
}) {
  if (client.iface === "ETH") return <WiredIcon />;
  return <WifiArcIcon bars={quality?.bars ?? 0} />;
}

function PencilIcon() {
  return (
    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path
        d='M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinejoin='round'
      />
    </svg>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='devdetail-row'>
      <span className='stat-caption'>{label}</span>
      <span className='mono-value devdetail-value'>{value}</span>
    </div>
  );
}

/**
 * Per-radio temperature readout. The router states no unit for the sensor, so
 * the number is shown bare with a degree mark, never "°C". Duty cycle sits
 * beside it because the two together are the signal: a radio below 100% while
 * warming is the router throttling Wi-Fi to cool itself — highlighted so it
 * reads as the event it is.
 */
function RadioTempsSection({ radios }: { radios: RadioReading[] }) {
  if (radios.length === 0) return null;
  return (
    <>
      <div className='devdetail-section-head'>
        <span className='devdetail-section-title'>Radio temperatures</span>
        <InfoDot tip="How warm each of the router's Wi-Fi radios is running. If one gets too hot, the router slows that band's Wi-Fi down to cool off — you'll see that noted here when it happens." />
      </div>
      <div className='devdetail-grid'>
        {radios.map((radio) => {
          const throttling = radio.dutyCycle < 100;
          return (
            <DataRow
              key={radio.band}
              label={radioBandLabel(radio.band)}
              value={
                <>
                  {radio.tempC}°
                  <span
                    className='devdetail-note'
                    style={throttling ? { color: "var(--status-critical)" } : undefined}
                  >
                    {" · "}
                    {radio.dutyCycle}% airtime{throttling ? " · throttling" : ""}
                  </span>
                </>
              }
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * Drill-in for a node. A node is not a client of the network — it *is* the
 * network — so the router reports no per-node throughput or signal (its rxStats
 * / txStats come back empty). This shows what a node actually has: what it
 * serves, and what it is.
 */
function NodeDetail({
  node,
  wifiConfig,
  radios,
}: {
  node: NodeEntry;
  wifiConfig: WifiNetworkConfigJson | null;
  /** Live radio temps from the collector — router node only. */
  radios: RadioReading[];
}) {
  const client = node.client;
  const meshConfig = node.key ? wifiConfig?.meshConfigs?.[node.key] : undefined;
  const isRouter = client?.role === "CONTROLLER";
  // Only the main router's own firmware is in wifiConfig.boot; a mesh node
  // reports just its hardware revision in its config entry.
  const firmware = isRouter ? wifiConfig?.boot?.evenSideSoftwareVersion : undefined;

  return (
    <div className='devdetail'>
      <div className='devdetail-head'>
        <RouterIcon dimmed={!node.connected} />
        <div className='devdetail-headtext'>
          <div className='devdetail-nameline'>
            <span className='devdetail-name'>{node.name}</span>
          </div>
          <div className='stat-caption'>{node.status}</div>
        </div>
      </div>

      <div className='devdetail-grid'>
        {client?.role && <DataRow label='Role' value={client.role} />}
        {node.connected ? (
          <DataRow label='Devices connected' value={node.deviceCount ?? 0} />
        ) : (
          <DataRow
            label='Devices connected'
            value={<span className='devdetail-note'>none — node is down</span>}
          />
        )}
        {client && <DataRow label='Connection' value={bandLabel(client)} />}
        {client?.iface && <DataRow label='Interface' value={client.iface} />}
        {isRouter && <DataRow label='Uplink' value='Starlink dish' />}
        {client?.macAddress && <DataRow label='MAC address' value={client.macAddress} />}
        {client?.deviceId && <DataRow label='Device ID' value={client.deviceId} />}
        {firmware && <DataRow label='Firmware' value={firmware} />}
        {meshConfig?.hardwareVersion && (
          <DataRow label='Hardware' value={meshConfig.hardwareVersion} />
        )}
        {wifiConfig?.countryCode && isRouter && (
          <DataRow label='Region' value={wifiConfig.countryCode} />
        )}
      </div>

      {isRouter && <RadioTempsSection radios={radios} />}

      {!node.connected && (
        <div className='stat-caption devdetail-collecting'>
          This node is paired with your network but not currently reachable. Power it on, or move it
          closer to the router, and it will reappear here.
        </div>
      )}
    </div>
  );
}

function DeviceDetail({
  client,
  history,
  upstreamName,
  onRename,
}: {
  client: WifiClientJson;
  history: TelemetrySample[];
  /** Resolved name of the node this client is attached to (via upstreamMacAddress). */
  upstreamName?: string;
  onRename: (macAddress: string, givenName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(client.givenName ?? client.name ?? "");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameState, setRenameState] = useState<"idle" | "saved" | "error">("idle");

  const quality = signalQuality(client);
  const linkRx = client.rxStats?.rateMbps;
  const linkTx = client.txStats?.rateMbps;
  const vendor = vendorForMac(client.macAddress);
  const downMbps = throughputMbps(client.rxStats);
  const upMbps = throughputMbps(client.txStats);
  const idleSeconds = client.noDataIdleS ?? 0;
  // Cumulative counters since the client associated. uploadMb/downloadMb are
  // misdecoded by the router, so these are the only trustworthy totals.
  const rxBytes = Number(client.rxStats?.bytes ?? 0);
  const txBytes = Number(client.txStats?.bytes ?? 0);

  const commitRename = async () => {
    if (!client.macAddress || draftName.trim() === "" || draftName === displayName(client)) {
      setEditing(false);
      return;
    }
    setRenameBusy(true);
    setRenameState("idle");
    try {
      await onRename(client.macAddress, draftName.trim());
      setRenameState("saved");
      setEditing(false);
    } catch {
      setRenameState("error");
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <div className='devdetail'>
      <div className='devdetail-head'>
        <DeviceSignalIcon client={client} quality={quality} />
        <div className='devdetail-headtext'>
          <div className='devdetail-nameline'>
            <span className='devdetail-name'>{displayName(client)}</span>
            {!editing && (
              <button
                className='devdetail-pencil'
                aria-label='Rename device'
                onClick={() => {
                  setDraftName(client.givenName ?? client.name ?? "");
                  setRenameState("idle");
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </button>
            )}
          </div>
          <div className='stat-caption'>{deviceSubtitle(client)}</div>
        </div>
      </div>

      {editing && (
        <div className='devdetail-rename'>
          <Input
            className='h-8 text-sm'
            autoFocus
            value={draftName}
            disabled={renameBusy}
            placeholder='Device name'
            onChange={(event) => {
              setDraftName(event.target.value);
              setRenameState("idle");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename();
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <button
            className='device-action-button'
            disabled={renameBusy}
            onClick={() => void commitRename()}
          >
            {renameBusy ? "Saving…" : "Save"}
          </button>
          <button
            className='device-action-button subtle'
            disabled={renameBusy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      )}
      {renameState === "error" && (
        <div className='settings-error'>The router refused the rename.</div>
      )}

      <div className='devdetail-grid'>
        {/* noDataIdleS is the router's own "seconds since this device last passed
            traffic"; proto3 omits it at zero, so absent means traffic right now.
            Observed live, it oscillates a few seconds on devices with background
            chatter, so the threshold sits well clear of that rather than flapping
            between active and idle every poll. */}
        <DataRow
          label='Status'
          value={idleSeconds < IDLE_AFTER_S ? "active" : `idle · ${formatUptime(idleSeconds)}`}
        />
        {client.role && <DataRow label='Role' value={client.role} />}
        {upstreamName && <DataRow label='Connected to' value={upstreamName} />}
        {/* Always shown. A randomized MAC carries no vendor, so the row reads
            "Private" as the app's does — an absent row just looks broken. */}
        <DataRow label='Manufacturer' value={vendor ?? "Unknown"} />
        <DataRow label='Connection' value={bandLabel(client)} />
        {quality && (
          <DataRow
            label='Signal'
            value={
              <span style={{ color: `var(${quality.colorVar})` }}>
                {client.iface === "ETH"
                  ? "wired"
                  : `${client.signalStrength} dBm · ${quality.label}`}
              </span>
            }
          />
        )}
        {client.snr !== undefined && client.snr > 0 && (
          <DataRow label='Signal-to-noise' value={`${client.snr} dB`} />
        )}
        {client.channelWidth ? (
          <DataRow label='Bandwidth' value={`${client.channelWidth} MHz`} />
        ) : null}
        {client.rxStats?.mcs !== undefined && (
          <DataRow label='MCS index' value={client.rxStats.mcs} />
        )}
        {client.rxStats?.nss !== undefined && (
          <DataRow label='Spatial streams' value={client.rxStats.nss} />
        )}
        {linkRx ? <DataRow label='Rx rate' value={`${linkRx} Mbps`} /> : null}
        {linkTx ? <DataRow label='Tx rate' value={`${linkTx} Mbps`} /> : null}
        {client.ipAddress && <DataRow label='IPv4' value={client.ipAddress} />}
        {client.ipv6Addresses && client.ipv6Addresses.length > 0 && (
          <DataRow
            label='IPv6'
            value={<span className='devdetail-ipv6'>{client.ipv6Addresses[0]}</span>}
          />
        )}
        {client.macAddress && <DataRow label='MAC address' value={client.macAddress} />}
        {client.associatedTimeS ? (
          <DataRow label='Connected for' value={formatUptime(client.associatedTimeS)} />
        ) : null}
        {(rxBytes > 0 || txBytes > 0) && (
          <DataRow
            label='Data usage (session)'
            value={`${formatBytes(rxBytes)} ↓ / ${formatBytes(txBytes)} ↑`}
          />
        )}
      </div>

      <div className='devdetail-section-head'>
        <span className='devdetail-section-title'>Throughput</span>
        <InfoDot tip='How much data this device is transferring right now. Stream a video and watch it jump.' />
      </div>
      {history.length < 2 ? (
        <div className='stat-caption devdetail-collecting'>
          Collecting live throughput… charts fill in as the router is polled (every 5 s).
        </div>
      ) : (
        <>
          <div className='devdetail-chart'>
            <div className='devdetail-chart-head'>
              <span className='stat-caption'>Download</span>
              <span className='mono-value devdetail-value'>
                {formatThroughputLabel(downMbps * 1_000_000)}
              </span>
            </div>
            <TelemetryChart
              samples={history}
              series={[THROUGHPUT_SERIES[0]]}
              windowMinutes={15}
              formatValue={formatThroughputLabel}
              formatTick={formatThroughputTick}
              minGapMs={PER_DEVICE_GAP_MS}
              height={140}
            />
          </div>
          <div className='devdetail-chart'>
            <div className='devdetail-chart-head'>
              <span className='stat-caption'>Upload</span>
              <span className='mono-value devdetail-value'>
                {formatThroughputLabel(upMbps * 1_000_000)}
              </span>
            </div>
            <TelemetryChart
              samples={history}
              series={[THROUGHPUT_SERIES[1]]}
              windowMinutes={15}
              formatValue={formatThroughputLabel}
              formatTick={formatThroughputTick}
              minGapMs={PER_DEVICE_GAP_MS}
              height={140}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function NetworkPanel({
  network,
  selectedMac,
  onSelect,
}: {
  network: RouterNetwork;
  /** Selection is owned by the sheet, which renders the back chevron + title. */
  selectedMac: string | null;
  onSelect: (macAddress: string | null) => void;
}) {
  const [tab, setTab] = useState<"devices" | "nodes">("devices");
  // Load the OUI registry once, then bump state so vendor lookups re-render.
  const [, setOuiReady] = useState(false);
  useEffect(() => {
    void ensureOuiLoaded().then(() => setOuiReady(true));
  }, []);
  // Radio temps come from the collector, not the router directly. Poll only
  // while the panel is mounted (i.e. the Network sheet is open).
  const radio = useRadioTemps(true);

  if (network.routerReachable === null) {
    return <div className='empty-note'>contacting the router…</div>;
  }
  if (network.routerReachable === false) {
    return (
      <div className='empty-note'>
        Couldn't reach the Starlink router at 192.168.1.1 — it may be in bypass mode or on a
        different subnet.
      </div>
    );
  }

  const devices = network.clients.filter((client) => !client.role || client.role === "CLIENT");
  const nodes = buildNodeRoster(network.clients, network.wifiConfig);
  const sortedDevices = [...devices].sort((a, b) => liveThroughputMbps(b) - liveThroughputMbps(a));

  const selectedNode = selectedMac
    ? nodes.find((node) => node.client?.macAddress === selectedMac)
    : null;
  if (selectedNode) {
    return <NodeDetail node={selectedNode} wifiConfig={network.wifiConfig} radios={radio.current} />;
  }

  const selected = selectedMac
    ? network.clients.find((client) => client.macAddress === selectedMac)
    : null;
  if (selected) {
    return (
      <DeviceDetail
        client={selected}
        history={(selected.macAddress && network.throughputHistory.get(selected.macAddress)) || []}
        upstreamName={
          nodes.find((node) => node.client?.macAddress === selected.upstreamMacAddress)?.name
        }
        onRename={network.renameClient}
      />
    );
  }

  return (
    <div>
      <div
        className='settings-segment'
        role='tablist'
        style={{ maxWidth: 260, margin: "0 auto 14px" }}
      >
        <span
          className={`settings-segment-glider ${tab === "nodes" ? "right" : ""}`}
          aria-hidden='true'
        />
        <button
          role='tab'
          className={tab === "devices" ? "active" : ""}
          onClick={() => setTab("devices")}
        >
          Devices <span className='settings-segment-count'>{devices.length}</span>
        </button>
        <button
          role='tab'
          className={tab === "nodes" ? "active" : ""}
          onClick={() => setTab("nodes")}
        >
          Nodes <span className='settings-segment-count'>{nodes.length}</span>
        </button>
      </div>

      {tab === "devices" && (
        <>
          <div className='stat-caption' style={{ marginBottom: 8 }}>
            {devices.length} device{devices.length === 1 ? "" : "s"} · live from the router,
            refreshed every 5 s
          </div>
          <div className='netlist'>
            {sortedDevices.map((client, index) => {
              const quality = signalQuality(client);
              return (
                <button
                  className='netrow'
                  key={client.macAddress ?? index}
                  onClick={() => client.macAddress && onSelect(client.macAddress)}
                >
                  <span className='netrow-signal'>
                    <DeviceSignalIcon client={client} quality={quality} />
                  </span>
                  <span className='netrow-main'>
                    <span className='netrow-name'>{displayName(client)}</span>
                    <span className='netrow-sub'>{deviceSubtitle(client)}</span>
                  </span>
                  <span className='netrow-band mono-value'>{bandLabel(client)}</span>
                  <span className='netrow-chevron'>›</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {tab === "nodes" && (
        <>
          <div className='stat-caption' style={{ marginBottom: 8 }}>
            Router and mesh nodes
          </div>
          <div className='netlist'>
            {nodes.map((node) => (
              <button
                className={`netrow ${node.connected ? "" : "netrow-offline"}`}
                key={node.key}
                disabled={!node.connected}
                onClick={() => node.client?.macAddress && onSelect(node.client.macAddress)}
              >
                <span className='netrow-signal'>
                  <RouterIcon dimmed={!node.connected} />
                </span>
                <span className='netrow-main'>
                  <span className='netrow-name'>{node.name}</span>
                  <span className='netrow-sub'>{node.status}</span>
                </span>
                {node.deviceCount ? (
                  <span className='netrow-band mono-value'>
                    {node.deviceCount} device{node.deviceCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {node.connected && <span className='netrow-chevron'>›</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
