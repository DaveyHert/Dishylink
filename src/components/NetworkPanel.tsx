// Full client manager backed by the router's gRPC API. Two tabs (Devices /
// Nodes), rows with a signal icon on the left + band/chevron on the right, and
// a per-device drill-in showing everything the API exposes, with rename.

import { useEffect, useState } from "react";
import type { RouterNetwork } from "../hooks/useRouterNetwork";
import type { WifiClientJson } from "../lib/dishClient";
import type { TelemetrySample } from "../lib/telemetry";
import { vendorForMac, ensureOuiLoaded } from "../lib/macVendor";
import { formatUptime, formatThroughputLabel, formatThroughputTick } from "../lib/format";
import { THROUGHPUT_SERIES } from "../lib/statDetails";
import { TelemetryChart } from "./TelemetryChart";
import { Input } from "@/components/ui/input";

function bandLabel(client: WifiClientJson): string {
  const iface = client.iface ?? "";
  if (iface === "ETH") return "Ethernet";
  if (iface.startsWith("RF_")) return iface.replace("RF_", "").replace("GHZ", " GHz").replace("5 GHz_HIGH", "5 GHz");
  return iface || "—";
}

/** Signal quality bucket from dBm (wifi). Ethernet has no RSSI. */
function signalQuality(client: WifiClientJson): { label: string; bars: number; colorVar: string } | null {
  if (client.iface === "ETH") return { label: "wired", bars: 4, colorVar: "--status-good" };
  const dbm = client.signalStrength;
  if (dbm === undefined || dbm === 0) return null;
  if (dbm > -55) return { label: "excellent", bars: 4, colorVar: "--status-good" };
  if (dbm > -67) return { label: "good", bars: 3, colorVar: "--status-good" };
  if (dbm > -75) return { label: "fair", bars: 2, colorVar: "--chart-warm" };
  return { label: "weak", bars: 1, colorVar: "--status-critical" };
}

function liveThroughputMbps(client: WifiClientJson): number {
  return (client.rxStats?.throughputMbpsLast1mAvg ?? 0) + (client.txStats?.throughputMbpsLast1mAvg ?? 0);
}

function displayName(client: WifiClientJson): string {
  return client.givenName || client.name || client.ipAddress || client.macAddress || "Unnamed device";
}

/** Subtitle line: hostname and/or derived vendor, de-duplicated. */
function deviceSubtitle(client: WifiClientJson): string {
  const parts: string[] = [];
  if (client.name && client.name !== client.givenName) parts.push(client.name);
  const vendor = vendorForMac(client.macAddress);
  if (vendor && vendor !== "Private" && !parts.includes(vendor)) parts.push(vendor);
  return parts.join(" · ") || "unknown device";
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
    <svg width="20" height="16" viewBox="0 0 24 20" className="wifi-arc" aria-hidden="true">
      {arcs.map((arc) => (
        <path
          key={arc.litAt}
          d={arc.d}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={bars >= arc.litAt ? 1 : 0.28}
        />
      ))}
      <circle cx={12} cy={19.5} r={1.3} fill="var(--ink)" opacity={bars >= 1 ? 1 : 0.28} />
    </svg>
  );
}

/** Ethernet-port glyph for wired clients (no RSSI to show as arcs). */
function WiredIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 24 20" className="wifi-arc" aria-hidden="true">
      <rect x={4} y={5} width={16} height={9} rx={1.5} fill="none" stroke="var(--ink)" strokeWidth={2} />
      {[8, 12, 16].map((x) => (
        <line key={x} x1={x} y1={14} x2={x} y2={17} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Picks the wired glyph for Ethernet, else the wifi-arc glyph. */
function DeviceSignalIcon({ client, quality }: { client: WifiClientJson; quality: ReturnType<typeof signalQuality> }) {
  if (client.iface === "ETH") return <WiredIcon />;
  return <WifiArcIcon bars={quality?.bars ?? 0} />;
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="devdetail-row">
      <span className="stat-caption">{label}</span>
      <span className="mono-value devdetail-value">{value}</span>
    </div>
  );
}

function DeviceDetail({
  client,
  history,
  onBack,
  onRename,
}: {
  client: WifiClientJson;
  history: TelemetrySample[];
  onBack: () => void;
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
  const downMbps = client.rxStats?.throughputMbpsLast1mAvg ?? 0;
  const upMbps = client.txStats?.throughputMbpsLast1mAvg ?? 0;

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
    <div className="devdetail">
      <button className="devdetail-back" onClick={onBack}>
        ‹ All devices
      </button>

      <div className="devdetail-head">
        <DeviceSignalIcon client={client} quality={quality} />
        <div className="devdetail-headtext">
          <div className="devdetail-nameline">
            <span className="devdetail-name">{displayName(client)}</span>
            {!editing && (
              <button
                className="devdetail-pencil"
                aria-label="Rename device"
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
          <div className="stat-caption">{deviceSubtitle(client)}</div>
        </div>
      </div>

      {editing && (
        <div className="devdetail-rename">
          <Input
            className="h-8 text-sm"
            autoFocus
            value={draftName}
            disabled={renameBusy}
            placeholder="Device name"
            onChange={(event) => {
              setDraftName(event.target.value);
              setRenameState("idle");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename();
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <button className="device-action-button" disabled={renameBusy} onClick={() => void commitRename()}>
            {renameBusy ? "Saving…" : "Save"}
          </button>
          <button className="device-action-button subtle" disabled={renameBusy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      {renameState === "error" && <div className="settings-error">The router refused the rename.</div>}

      <div className="devdetail-grid">
        <DataRow label="Status" value={liveThroughputMbps(client) >= 0.05 ? "active" : "idle"} />
        {vendor && vendor !== "Private" && <DataRow label="Manufacturer" value={vendor} />}
        <DataRow label="Connection" value={bandLabel(client)} />
        {quality && (
          <DataRow
            label="Signal"
            value={
              <span style={{ color: `var(${quality.colorVar})` }}>
                {client.iface === "ETH" ? "wired" : `${client.signalStrength} dBm · ${quality.label}`}
              </span>
            }
          />
        )}
        {client.snr !== undefined && client.snr > 0 && <DataRow label="Signal-to-noise" value={`${client.snr} dB`} />}
        {client.channelWidth ? <DataRow label="Channel width" value={`${client.channelWidth} MHz`} /> : null}
        {(linkRx || linkTx) && (
          <DataRow label="Link rate" value={`${linkRx ?? "—"} ↓ / ${linkTx ?? "—"} ↑ Mbps`} />
        )}
        {client.ipAddress && <DataRow label="IPv4" value={client.ipAddress} />}
        {client.ipv6Addresses && client.ipv6Addresses.length > 0 && (
          <DataRow label="IPv6" value={<span className="devdetail-ipv6">{client.ipv6Addresses[0]}</span>} />
        )}
        {client.macAddress && (
          <DataRow
            label="MAC address"
            value={
              <>
                {client.macAddress}
                {vendor === "Private" && <span className="devdetail-note"> · randomized</span>}
              </>
            }
          />
        )}
        {client.associatedTimeS ? <DataRow label="Connected for" value={formatUptime(client.associatedTimeS)} /> : null}
        {client.secondsUntilDhcpLeaseExpires !== undefined && (
          <DataRow label="DHCP lease renews in" value={formatUptime(Math.round(client.secondsUntilDhcpLeaseExpires))} />
        )}
      </div>

      <div className="devdetail-section-label">Throughput</div>
      {history.length < 2 ? (
        <div className="stat-caption devdetail-collecting">
          Collecting live throughput… charts fill in as the router is polled (every 5 s).
        </div>
      ) : (
        <>
          <div className="devdetail-chart">
            <div className="devdetail-chart-head">
              <span className="stat-caption">Download</span>
              <span className="mono-value devdetail-value">{formatThroughputLabel(downMbps * 1_000_000)}</span>
            </div>
            <TelemetryChart
              samples={history}
              series={[THROUGHPUT_SERIES[0]]}
              windowMinutes={15}
              formatValue={formatThroughputLabel}
              formatTick={formatThroughputTick}
              height={140}
            />
          </div>
          <div className="devdetail-chart">
            <div className="devdetail-chart-head">
              <span className="stat-caption">Upload</span>
              <span className="mono-value devdetail-value">{formatThroughputLabel(upMbps * 1_000_000)}</span>
            </div>
            <TelemetryChart
              samples={history}
              series={[THROUGHPUT_SERIES[1]]}
              windowMinutes={15}
              formatValue={formatThroughputLabel}
              formatTick={formatThroughputTick}
              height={140}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function NetworkPanel({ network }: { network: RouterNetwork }) {
  const [tab, setTab] = useState<"devices" | "nodes">("devices");
  const [selectedMac, setSelectedMac] = useState<string | null>(null);
  // Load the OUI registry once, then bump state so vendor lookups re-render.
  const [, setOuiReady] = useState(false);
  useEffect(() => {
    void ensureOuiLoaded().then(() => setOuiReady(true));
  }, []);

  if (network.routerReachable === null) {
    return <div className="empty-note">contacting the router…</div>;
  }
  if (network.routerReachable === false) {
    return (
      <div className="empty-note">
        Couldn't reach the Starlink router at 192.168.1.1 — it may be in bypass mode or on a different subnet.
      </div>
    );
  }

  const devices = network.clients.filter((client) => !client.role || client.role === "CLIENT");
  const infrastructure = network.clients.filter((client) => client.role && client.role !== "CLIENT");
  const sortedDevices = [...devices].sort((a, b) => liveThroughputMbps(b) - liveThroughputMbps(a));

  const selected = selectedMac ? network.clients.find((client) => client.macAddress === selectedMac) : null;
  if (selected) {
    return (
      <DeviceDetail
        client={selected}
        history={(selected.macAddress && network.throughputHistory.get(selected.macAddress)) || []}
        onBack={() => setSelectedMac(null)}
        onRename={network.renameClient}
      />
    );
  }

  return (
    <div>
      <div className="settings-segment" role="tablist" style={{ maxWidth: 260, margin: "0 auto 14px" }}>
        <span className={`settings-segment-glider ${tab === "nodes" ? "right" : ""}`} aria-hidden="true" />
        <button role="tab" className={tab === "devices" ? "active" : ""} onClick={() => setTab("devices")}>
          Devices
        </button>
        <button role="tab" className={tab === "nodes" ? "active" : ""} onClick={() => setTab("nodes")}>
          Nodes
        </button>
      </div>

      {tab === "devices" && (
        <>
          <div className="stat-caption" style={{ marginBottom: 8 }}>
            {devices.length} device{devices.length === 1 ? "" : "s"} · live from the router, refreshed every 5 s
          </div>
          <div className="netlist">
            {sortedDevices.map((client, index) => {
              const quality = signalQuality(client);
              return (
                <button
                  className="netrow"
                  key={client.macAddress ?? index}
                  onClick={() => client.macAddress && setSelectedMac(client.macAddress)}
                >
                  <span className="netrow-signal">
                    <DeviceSignalIcon client={client} quality={quality} />
                  </span>
                  <span className="netrow-main">
                    <span className="netrow-name">{displayName(client)}</span>
                    <span className="netrow-sub">{deviceSubtitle(client)}</span>
                  </span>
                  <span className="netrow-band mono-value">{bandLabel(client)}</span>
                  <span className="netrow-chevron">›</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {tab === "nodes" && (
        <>
          <div className="stat-caption" style={{ marginBottom: 8 }}>
            Router and mesh nodes
          </div>
          <div className="netlist">
            {infrastructure.map((client, index) => (
              <button
                className="netrow"
                key={client.macAddress ?? index}
                onClick={() => client.macAddress && setSelectedMac(client.macAddress)}
              >
                <span className="netrow-signal">
                  <WifiArcIcon bars={4} />
                </span>
                <span className="netrow-main">
                  <span className="netrow-name">{displayName(client)}</span>
                  <span className="netrow-sub">
                    {client.role?.toLowerCase()} · {bandLabel(client)}
                  </span>
                </span>
                <span className="netrow-chevron">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
