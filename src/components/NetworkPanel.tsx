// Full client manager backed by the router's gRPC API. Two tabs (Devices /
// Nodes), rows with a signal icon on the left + band/chevron on the right, and
// a per-device drill-in showing everything the API exposes, with rename.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { RouterNetwork } from "../hooks/useRouterNetwork";
import { useRadioTemps, type RadioReading } from "../hooks/useRadioTemps";
import { useSelfIdentity } from "../hooks/useSelfIdentity";
import { matchesSelf } from "../lib/selfIdentity";
import {
  ROUTER_UNREACHABLE_MESSAGE,
  throughputMbps,
  type WifiClientJson,
  type WifiNetworkConfigJson,
} from "../lib/dishClient";
import { GrpcWebError } from "../lib/grpcWeb";
import { Loading } from "./ui/loading";
import { Callout } from "./ui/callout";
import { SegmentedControl } from "./ui/segmented-control";
import type { TelemetrySample } from "../lib/telemetry";
import type { ThroughputRates } from "../lib/throughputTracker";
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
import { actionButton } from "./ui/action-button";
import { InfoDot } from "./InfoDot";
import { RouterIcon } from "./icons/RouterIcon";

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

/** Combined live rate for sorting. Reads the tracker's byte-delta rate where the
 *  hook has one; a device seen for the first time this poll has none yet, so it
 *  sorts on the router's average until its second reading lands. */
function liveThroughputMbps(client: WifiClientJson, rates: Map<string, ThroughputRates>): number {
  const rate = client.macAddress ? rates.get(client.macAddress) : undefined;
  if (rate) return rate.downMbps + rate.upMbps;
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
  // "Private" is a meaningful subtitle, not a missing brand — a device behind a
  // randomized MAC. Show it like the official app does rather than hiding it.
  if (vendor && !parts.includes(vendor)) parts.push(vendor);
  return parts.join(" · ") || "unknown device";
}

/** Subtitle with a leading "This device" for the viewer's own machine, as the
 *  official app shows it ("This device · Apple"). "This device" is brighter and
 *  semibold to stand out from the muted vendor. Drops the "unknown device"
 *  filler so it never reads "This device · unknown device". */
function deviceRowSubtitle(client: WifiClientJson, isSelf: boolean): React.ReactNode {
  const base = deviceSubtitle(client);
  if (!isSelf) return base;
  const rest = base === "unknown device" ? "" : ` · ${base}`;
  return (
    <>
      <span className='font-semibold text-foreground/60'>This device</span>
      {rest}
    </>
  );
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
    <svg width='20' height='16' viewBox='0 0 24 20' className='block' aria-hidden='true'>
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

/** Ethernet-port glyph for wired clients (no RSSI to show as arcs). */
function WiredIcon() {
  return (
    <svg width='20' height='16' viewBox='0 0 24 20' className='block' aria-hidden='true'>
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
    <div className='flex items-baseline justify-between gap-4 border-t border-t-[var(--hairline)] py-[9px]'>
      <span className='text-[11.5px] font-medium text-muted-foreground'>{label}</span>
      <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
        {value}
      </span>
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
      <div className='mt-5 mb-2.5 flex items-center gap-[7px]'>
        <span className='text-[14px] font-semibold tracking-[0.01em] text-foreground'>
          Radio temperatures
        </span>
        <InfoDot tip="How warm each of the router's Wi-Fi radios is running. If one gets too hot, the router slows that band's Wi-Fi down to cool off — you'll see that noted here when it happens." />
      </div>
      <div className='flex flex-col'>
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
                    className='text-muted-foreground'
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
  const signal = client ? signalQuality(client) : null;
  // The rate the link negotiated, not throughput — the same number the app shows
  // as "Rx rate". The controller reports empty stats for itself, so this is
  // absent there rather than zero.
  const linkRxMbps = client?.rxStats?.rateMbps;
  // Only the main router's own firmware is in wifiConfig.boot; a mesh node
  // reports just its hardware revision in its config entry.
  const firmware = isRouter ? wifiConfig?.boot?.evenSideSoftwareVersion : undefined;

  return (
    <div>
      <div className='mb-3.5 flex items-center gap-2.5'>
        <RouterIcon size={20} className={!node.connected ? "opacity-35" : undefined} />
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-[18px] font-bold text-foreground'>{node.name}</span>
          </div>
          <div className='text-[11.5px] font-medium text-muted-foreground'>{node.status}</div>
        </div>
      </div>

      <div className='flex flex-col'>
        {client?.role && <DataRow label='Role' value={client.role} />}
        {node.connected ? (
          <DataRow label='Devices connected' value={node.deviceCount ?? 0} />
        ) : (
          <DataRow
            label='Devices connected'
            value={<span className='text-muted-foreground'>none — node is down</span>}
          />
        )}
        {/* A mesh node is a client entry like any other, so it carries the same
            radio detail — the app's node screen leads with these two, and they
            are what a "move it closer" prompt is actually asking you to fix. */}
        {signal && (
          <DataRow
            label='Signal strength'
            value={
              <span style={{ color: `var(${signal.colorVar})` }}>
                {client?.iface === "ETH" ? "wired" : `${client?.signalStrength} dBm · ${signal.label}`}
              </span>
            }
          />
        )}
        {linkRxMbps !== undefined && <DataRow label='Rx rate' value={`${Math.round(linkRxMbps)} Mbps`} />}
        {client && <DataRow label='Connection' value={bandLabel(client)} />}
        {client?.iface && <DataRow label='Interface' value={client.iface} />}
        {isRouter && <DataRow label='Uplink' value='Starlink dish' />}
        {client?.macAddress && <DataRow label='MAC address' value={client.macAddress} />}
        {client?.deviceId && <DataRow label='Device ID' value={client.deviceId} />}
        {client?.ipAddress && <DataRow label='IP address' value={client.ipAddress} />}
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
        <div className='text-[11.5px] font-medium text-muted-foreground py-3.5'>
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
  rates,
  upstreamName,
  isThisDevice,
  onRename,
}: {
  client: WifiClientJson;
  /** Live per-MAC rates from the hook's byte-delta tracker. */
  rates: Map<string, ThroughputRates>;
  history: TelemetrySample[];
  /** Resolved name of the node this client is attached to (via upstreamMacAddress). */
  upstreamName?: string;
  /** True when this is the device viewing the dashboard. */
  isThisDevice: boolean;
  onRename: (macAddress: string, givenName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(client.givenName ?? client.name ?? "");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameState, setRenameState] = useState<"idle" | "saved" | "error">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);
  // The facts list runs ~17 rows; only the identity + link summary stays open,
  // the rest sit behind a toggle so Throughput isn't pushed off-screen.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const reduceMotion = useReducedMotion();

  const quality = signalQuality(client);
  const linkRx = client.rxStats?.rateMbps;
  const linkTx = client.txStats?.rateMbps;
  const vendor = vendorForMac(client.macAddress);
  // Byte-delta rate, so the headline number matches a speed test instead of the
  // router's 60-second average of it. Falls back until the second reading lands.
  const liveRate = client.macAddress ? rates.get(client.macAddress) : undefined;
  const downMbps = liveRate?.downMbps ?? throughputMbps(client.rxStats);
  const upMbps = liveRate?.upMbps ?? throughputMbps(client.txStats);
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
    } catch (renameFailure) {
      // Status 7 = the firmware's LAN write lock (measured 2026-07: the router
      // refuses every rename shape from the LAN; only the official app's cloud
      // path can write). Anything else really is a transport problem.
      setRenameError(
        renameFailure instanceof GrpcWebError && renameFailure.grpcStatus === 7
          ? "Starlink's current firmware blocks renames from the local network — rename this device in the official Starlink app instead."
          : "The router refused the rename.",
      );
      setRenameState("error");
    } finally {
      setRenameBusy(false);
    }
  };

  // Ordered facts; the first PRIMARY_FACT_COUNT stay visible, the rest collapse.
  const facts: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "status",
      label: "Status",
      value: idleSeconds < IDLE_AFTER_S ? "active" : `idle · ${formatUptime(idleSeconds)}`,
    },
  ];
  if (client.role) facts.push({ key: "role", label: "Role", value: client.role });
  if (upstreamName) facts.push({ key: "connectedTo", label: "Connected to", value: upstreamName });
  // Always shown. A randomized MAC carries no vendor, so the row reads "Private"
  // as the app's does — an absent row just looks broken.
  facts.push({ key: "manufacturer", label: "Manufacturer", value: vendor ?? "Unknown" });
  facts.push({ key: "connection", label: "Connection", value: bandLabel(client) });
  if (quality) {
    facts.push({
      key: "signal",
      label: "Signal",
      value: (
        <span style={{ color: `var(${quality.colorVar})` }}>
          {client.iface === "ETH" ? "wired" : `${client.signalStrength} dBm · ${quality.label}`}
        </span>
      ),
    });
  }
  if (client.snr !== undefined && client.snr > 0) {
    facts.push({ key: "snr", label: "Signal-to-noise", value: `${client.snr} dB` });
  }
  if (client.channelWidth) {
    facts.push({ key: "bandwidth", label: "Bandwidth", value: `${client.channelWidth} MHz` });
  }
  if (client.rxStats?.mcs !== undefined) {
    facts.push({ key: "mcs", label: "MCS index", value: client.rxStats.mcs });
  }
  if (client.rxStats?.nss !== undefined) {
    facts.push({ key: "nss", label: "Spatial streams", value: client.rxStats.nss });
  }
  if (linkRx) facts.push({ key: "rx", label: "Rx rate", value: `${linkRx} Mbps` });
  if (linkTx) facts.push({ key: "tx", label: "Tx rate", value: `${linkTx} Mbps` });
  if (client.ipAddress) facts.push({ key: "ipv4", label: "IPv4", value: client.ipAddress });
  if (client.ipv6Addresses && client.ipv6Addresses.length > 0) {
    facts.push({
      key: "ipv6",
      label: "IPv6",
      value: <span className='text-[11px]'>{client.ipv6Addresses[0]}</span>,
    });
  }
  if (client.macAddress) facts.push({ key: "mac", label: "MAC address", value: client.macAddress });
  if (client.associatedTimeS) {
    facts.push({
      key: "connectedFor",
      label: "Connected for",
      value: formatUptime(client.associatedTimeS),
    });
  }
  if (rxBytes > 0 || txBytes > 0) {
    facts.push({
      key: "dataUsage",
      label: "Data usage (session)",
      value: `${formatBytes(rxBytes)} ↓ / ${formatBytes(txBytes)} ↑`,
    });
  }

  // Above this many rows the list is capped to a scroll box by default; "View
  // full" drops the cap and spreads every row out.
  const DETAILS_COLLAPSED_PX = 280;
  const detailsScrollable = facts.length > 8;

  return (
    <div>
      <div className='mb-3.5 flex items-center gap-2.5'>
        <DeviceSignalIcon client={client} quality={quality} />
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-[18px] font-bold text-foreground'>{displayName(client)}</span>
            {!editing && (
              <button
                className='inline-flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[999px] border-none bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-[var(--ink-secondary)] [transition:background_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))] hover:text-foreground'
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
          <div className='text-[11.5px] font-medium text-muted-foreground'>
            {deviceRowSubtitle(client, isThisDevice)}
          </div>
        </div>
      </div>

      {editing && (
        <div className='mb-3.5 flex gap-2'>
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
            className={actionButton()}
            disabled={renameBusy}
            onClick={() => void commitRename()}
          >
            {renameBusy ? "Saving…" : "Save"}
          </button>
          <button
            className={actionButton("subtle")}
            disabled={renameBusy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      )}
      {renameState === "error" && (
        <div className='py-2 text-[12.5px] leading-[1.5] text-destructive'>
          {renameError ?? "The router refused the rename."}
        </div>
      )}

      {/* noDataIdleS is the router's own "seconds since this device last passed
          traffic"; proto3 omits it at zero, so absent means traffic right now.
          Observed live, it oscillates a few seconds on devices with background
          chatter, so the threshold sits well clear of that rather than flapping
          between active and idle every poll. */}
      {detailsScrollable ? (
        <>
          {/* Capped by default so the whole list scrolls in place (thin scrollbar)
              instead of pushing Throughput off-screen; "View full" drops the cap. */}
          <motion.div
            initial={false}
            animate={{ height: detailsExpanded ? "auto" : DETAILS_COLLAPSED_PX }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className={`flex flex-col ${detailsExpanded ? "overflow-hidden" : "thin-scroll overflow-y-auto"}`}
          >
            {facts.map((fact) => (
              <DataRow key={fact.key} label={fact.label} value={fact.value} />
            ))}
          </motion.div>
          <button
            className='flex w-full cursor-pointer items-center justify-center gap-1 border-0 bg-transparent py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground'
            onClick={() => setDetailsExpanded((open) => !open)}
            aria-expanded={detailsExpanded}
          >
            {detailsExpanded ? "Collapse" : "View full details"}
            <span
              className={`text-[14px] leading-none transition-transform ${detailsExpanded ? "-rotate-90" : "rotate-90"}`}
              aria-hidden='true'
            >
              ›
            </span>
          </button>
        </>
      ) : (
        <div className='flex flex-col'>
          {facts.map((fact) => (
            <DataRow key={fact.key} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}

      <div className='mt-5 mb-2.5 flex items-center gap-[7px]'>
        <span className='text-[14px] font-semibold tracking-[0.01em] text-foreground'>
          Throughput
        </span>
        <InfoDot tip='How much data this device is transferring right now. Stream a video and watch it jump.' />
      </div>
      {history.length < 2 ? (
        <div className='text-[11.5px] font-medium text-muted-foreground py-3.5'>
          Collecting live throughput… charts fill in as the router is polled (every 5 s).
        </div>
      ) : (
        <>
          <div className='mb-3.5'>
            <div className='mb-0.5 flex items-baseline justify-between'>
              <span className='text-[11.5px] font-medium text-muted-foreground'>Download</span>
              <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
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
          <div className='mb-3.5'>
            <div className='mb-0.5 flex items-baseline justify-between'>
              <span className='text-[11.5px] font-medium text-muted-foreground'>Upload</span>
              <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
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

/**
 * One row in the device / node list. Was `.netrow` + six child classes, rendered twice.
 *
 * The offline state maps to `disabled:` and `group-disabled:` because an offline row is
 * already a disabled button — `.netrow-offline` was a parallel way of saying the same
 * thing, including a :hover rule whose only job was to cancel the base :hover.
 */
function NetRow({
  icon,
  name,
  sub,
  band,
  showChevron,
  disabled,
  highlight,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  sub: React.ReactNode;
  band?: React.ReactNode;
  showChevron?: boolean;
  disabled?: boolean;
  /** The viewer's own device — resting tint bumped so it reads as pinned, like
   *  the official app's "This device" row. */
  highlight?: boolean;
  onClick?: () => void;
}) {
  const restBg = highlight
    ? "bg-[color-mix(in_srgb,var(--ink)_9%,var(--surface))]"
    : "bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]";
  return (
    <button
      className={`group flex w-full cursor-pointer items-center gap-[13px] rounded-lg border-none ${restBg} px-3 py-[11px] text-left [transition:background_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] disabled:cursor-default disabled:hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className='inline-flex flex-none items-center'>{icon}</span>
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='overflow-hidden text-[14px] font-semibold text-ellipsis whitespace-nowrap text-foreground group-disabled:text-[var(--ink-secondary)]'>
          {name}
        </span>
        <span className='text-[11.5px] text-muted-foreground'>{sub}</span>
      </span>
      {band && (
        <span className='flex-none rounded-[6px] border border-[var(--baseline)] px-[7px] py-0.5 font-mono text-[10px] tracking-[0.04em] text-[var(--ink-secondary)] tabular-nums'>
          {band}
        </span>
      )}
      {showChevron && (
        <span className='flex-none text-[18px] leading-none text-muted-foreground'>›</span>
      )}
    </button>
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
  // The viewer's own address(es), to flag "This device" in the list.
  const self = useSelfIdentity(true);

  if (network.routerReachable === null) {
    return <Loading message='Contacting the router…' />;
  }
  if (network.routerReachable === false) {
    return <Callout tone='error'>{ROUTER_UNREACHABLE_MESSAGE}</Callout>;
  }

  const devices = network.clients.filter((client) => !client.role || client.role === "CLIENT");
  const nodes = buildNodeRoster(network.clients, network.wifiConfig);
  // The viewer's own device pins to the top (like the app), then by throughput.
  const sortedDevices = [...devices].sort((a, b) => {
    const selfDelta = Number(matchesSelf(b, self)) - Number(matchesSelf(a, self));
    if (selfDelta !== 0) return selfDelta;
    return liveThroughputMbps(b, network.rates) - liveThroughputMbps(a, network.rates);
  });

  const selectedNode = selectedMac
    ? nodes.find((node) => node.client?.macAddress === selectedMac)
    : null;
  if (selectedNode) {
    return (
      <NodeDetail node={selectedNode} wifiConfig={network.wifiConfig} radios={radio.current} />
    );
  }

  const selected = selectedMac
    ? network.clients.find((client) => client.macAddress === selectedMac)
    : null;
  if (selected) {
    return (
      <DeviceDetail
        client={selected}
        rates={network.rates}
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
          {
            value: "devices",
            label: (
              <>
                Devices{" "}
                <span className='ml-[3px] font-mono text-[11px] tabular-nums opacity-60'>
                  {devices.length}
                </span>
              </>
            ),
          },
          {
            value: "nodes",
            label: (
              <>
                Nodes{" "}
                <span className='ml-[3px] font-mono text-[11px] tabular-nums opacity-60'>
                  {nodes.length}
                </span>
              </>
            ),
          },
        ]}
      />

      {tab === "devices" && (
        <>
          <div
            className='text-[11.5px] font-medium text-muted-foreground'
            style={{ marginBottom: 8 }}
          >
            {devices.length} device{devices.length === 1 ? "" : "s"} · live from the router,
            refreshed every 5 s
          </div>
          <div className='flex flex-col gap-1.5 max-h-[460px] overflow-y-auto'>
            {sortedDevices.map((client, index) => {
              const quality = signalQuality(client);
              const isSelf = matchesSelf(client, self);
              return (
                <NetRow
                  key={client.macAddress ?? index}
                  icon={<DeviceSignalIcon client={client} quality={quality} />}
                  name={displayName(client)}
                  sub={deviceRowSubtitle(client, isSelf)}
                  band={bandLabel(client)}
                  highlight={isSelf}
                  showChevron
                  onClick={() => client.macAddress && onSelect(client.macAddress)}
                />
              );
            })}
          </div>
        </>
      )}

      {tab === "nodes" && (
        <>
          <div
            className='text-[11.5px] font-medium text-muted-foreground'
            style={{ marginBottom: 8 }}
          >
            Router and mesh nodes
          </div>
          <div className='flex flex-col gap-1.5 max-h-[460px] overflow-y-auto'>
            {nodes.map((node) => (
              <NetRow
                key={node.key}
                icon={
                  <RouterIcon size={20} className={!node.connected ? "opacity-35" : undefined} />
                }
                name={node.name}
                sub={node.status}
                band={
                  node.deviceCount
                    ? `${node.deviceCount} device${node.deviceCount === 1 ? "" : "s"}`
                    : undefined
                }
                showChevron={node.connected}
                disabled={!node.connected}
                onClick={() => node.client?.macAddress && onSelect(node.client.macAddress)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
