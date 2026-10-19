// Drill-in for a node.
//
// A node is not a client of the network — it *is* the network — so the router
// reports no per-node throughput or signal (its rxStats / txStats come back
// empty). This shows what a node actually has: what it serves, and what it is.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RadioReading } from "../../hooks/useRadioTemps";
import type { WifiNetworkConfigJson, WifiStatusJson } from "@core/dishClient";
import type { SelfIdentity } from "../../lib/selfIdentity";
import { RouterIcon } from "../../assets/icons/RouterIcon";
import { formatDeviceEnum, formatUptime } from "../../lib/format";
import { DataRow, SectionHeading } from "./DataRow";
import { DeviceRow } from "./NetworkRow";
import { MeshNodeNameEditor, RenameButton } from "./DeviceNameEditor";
import { RadioTempsSection } from "./RadioTempsSection";
import { bandLabel, clientEntryKey } from "./networkFormat";
import type { NodeEntry } from "./nodeRoster";

export function NodeDetail({
  node,
  wifiConfig,
  routerStatus,
  radios,
  self,
  onSelect,
  onRename,
}: {
  node: NodeEntry;
  wifiConfig: WifiNetworkConfigJson | null;
  /** The router's own hardware/software version and uptime. */
  routerStatus: WifiStatusJson | null;
  /** Live radio temps from the historian — router node only. */
  radios: RadioReading[];
  self: SelfIdentity;
  /** Drill from a node straight into one of its clients, as the app does.
   *  Receives the client row's `clientEntryKey`. */
  onSelect: (entryKey: string | null) => void;
  onRename?: (deviceId: string, displayName: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const client = node.client;
  const meshConfig = node.key ? wifiConfig?.meshConfigs?.[node.key] : undefined;
  const isRouter = client?.role === "CONTROLLER";
  // `node.key` is a `meshConfigs` id only when it starts `Router-`; it falls back
  // to a MAC or a positional key otherwise, and the controller has no entry.
  const canRename = Boolean(onRename) && !isRouter && node.key.startsWith("Router-");
  // The rate the link negotiated, not throughput — the same number the app shows
  // as "Rx rate". The controller reports empty stats for itself, so this is
  // absent there rather than zero.
  const linkRxMbps = client?.rxStats?.rateMbps;
  // Only the main router's own firmware is in wifiConfig.boot; a mesh node
  // reports just its hardware revision in its config entry.
  const firmware = isRouter ? wifiConfig?.boot?.evenSideSoftwareVersion : undefined;
  const routerHardware = isRouter ? routerStatus?.deviceInfo?.hardwareVersion : undefined;
  const routerUptimeS = isRouter ? routerStatus?.deviceState?.uptimeS : undefined;
  const lastRebootReason = isRouter
    ? formatDeviceEnum(wifiConfig?.boot?.lastReason, "")
    : undefined;

  return (
    <div>
      <div className='mb-3.5 flex items-center gap-2.5'>
        <RouterIcon size={20} className={!node.connected ? "opacity-35" : undefined} />
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-[18px] font-bold text-foreground'>{node.name}</span>
            {canRename && !editing && (
              <RenameButton label={t("network.renameNode")} onClick={() => setEditing(true)} />
            )}
          </div>
          <div className='text-[11.5px] font-medium text-muted-foreground'>{node.status}</div>
        </div>
      </div>

      {canRename && editing && onRename && (
        <MeshNodeNameEditor
          deviceId={node.key}
          currentName={meshConfig?.displayName ?? ""}
          onRename={onRename}
          onDone={() => setEditing(false)}
        />
      )}

      <div className='flex flex-col'>
        {client?.role && <DataRow label={t("network.role")} value={client.role} />}
        {/* A mesh node is a client entry like any other, so it carries the same
            radio detail — the app's node screen leads with these two, and they
            are what a "move it closer" prompt is actually asking you to fix.
            Deliberately unlabelled: the client-signal buckets (-55 excellent…)
            describe a phone's link to an AP, and applying them here reported a
            backhaul as "good" while the Starlink app called the same node slow.
            The app prints the raw dBm too, and judges the node separately. */}
        {client?.signalStrength !== undefined && client.iface !== "ETH" && (
          <DataRow label={t("network.signalStrength")} value={`${client.signalStrength} dBm`} />
        )}
        {linkRxMbps !== undefined && (
          <DataRow label={t("network.rxRate")} value={`${Math.round(linkRxMbps)} Mbps`} />
        )}
        {client && <DataRow label={t("network.connection")} value={bandLabel(client)} />}
        {client?.iface && <DataRow label={t("network.interface")} value={client.iface} />}
        {isRouter && <DataRow label={t("network.uplink")} value={t("network.uplinkDish")} />}
        {client?.macAddress && (
          <DataRow label={t("network.macAddress")} value={client.macAddress} />
        )}
        {client?.deviceId && <DataRow label={t("network.deviceId")} value={client.deviceId} />}
        {client?.ipAddress && <DataRow label={t("network.ipAddress")} value={client.ipAddress} />}
        {firmware && <DataRow label={t("terminal.firmware")} value={firmware} />}
        {(meshConfig?.hardwareVersion ?? routerHardware) && (
          <DataRow
            label={t("terminal.hardware")}
            value={meshConfig?.hardwareVersion ?? routerHardware!}
          />
        )}
        {routerUptimeS !== undefined && (
          <DataRow label={t("terminal.uptime")} value={formatUptime(Number(routerUptimeS), t)} />
        )}
        {lastRebootReason && <DataRow label={t("network.lastReboot")} value={lastRebootReason} />}
        {wifiConfig?.countryCode && isRouter && (
          <DataRow label={t("network.region")} value={wifiConfig.countryCode} />
        )}
      </div>

      {isRouter && <RadioTempsSection radios={radios} />}

      {/* The clients this node is carrying, each drilling into the same device
          detail the Network list opens — a node's device list is a way into a
          device, not a leaf. */}
      {node.connected && (
        <div>
          <SectionHeading title={t("network.connectedDevices")} />
          {node.devices.length === 0 ? (
            <div className='text-[11.5px] font-medium text-muted-foreground'>
              {t("network.noDevicesOnNode")}
            </div>
          ) : (
            <div className='flex flex-col gap-1.5'>
              {node.devices.map((device, index) => (
                <DeviceRow
                  key={clientEntryKey(device) ?? index}
                  client={device}
                  self={self}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!node.connected && (
        <div className='text-[11.5px] font-medium text-muted-foreground py-3.5'>
          {t("network.nodeUnreachable")}
        </div>
      )}
    </div>
  );
}
