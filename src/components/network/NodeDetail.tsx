// Drill-in for a node.
//
// A node is not a client of the network — it *is* the network — so the router
// reports no per-node throughput or signal (its rxStats / txStats come back
// empty). This shows what a node actually has: what it serves, and what it is.

import type { RadioReading } from "../../hooks/useRadioTemps";
import type { WifiNetworkConfigJson, WifiStatusJson } from "@core/dishClient";
import type { SelfIdentity } from "../../lib/selfIdentity";
import { RouterIcon } from "../../assets/icons/RouterIcon";
import { formatDeviceEnum, formatUptime } from "../../lib/format";
import { DataRow, SectionHeading } from "./DataRow";
import { DeviceRow } from "./NetworkRow";
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
}) {
  const client = node.client;
  const meshConfig = node.key ? wifiConfig?.meshConfigs?.[node.key] : undefined;
  const isRouter = client?.role === "CONTROLLER";
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
          </div>
          <div className='text-[11.5px] font-medium text-muted-foreground'>{node.status}</div>
        </div>
      </div>

      <div className='flex flex-col'>
        {client?.role && <DataRow label='Role' value={client.role} />}
        {/* A mesh node is a client entry like any other, so it carries the same
            radio detail — the app's node screen leads with these two, and they
            are what a "move it closer" prompt is actually asking you to fix.
            Deliberately unlabelled: the client-signal buckets (-55 excellent…)
            describe a phone's link to an AP, and applying them here reported a
            backhaul as "good" while the Starlink app called the same node slow.
            The app prints the raw dBm too, and judges the node separately. */}
        {client?.signalStrength !== undefined && client.iface !== "ETH" && (
          <DataRow label='Signal strength' value={`${client.signalStrength} dBm`} />
        )}
        {linkRxMbps !== undefined && (
          <DataRow label='Rx rate' value={`${Math.round(linkRxMbps)} Mbps`} />
        )}
        {client && <DataRow label='Connection' value={bandLabel(client)} />}
        {client?.iface && <DataRow label='Interface' value={client.iface} />}
        {isRouter && <DataRow label='Uplink' value='Starlink dish' />}
        {client?.macAddress && <DataRow label='MAC address' value={client.macAddress} />}
        {client?.deviceId && <DataRow label='Device ID' value={client.deviceId} />}
        {client?.ipAddress && <DataRow label='IP address' value={client.ipAddress} />}
        {firmware && <DataRow label='Firmware' value={firmware} />}
        {(meshConfig?.hardwareVersion ?? routerHardware) && (
          <DataRow label='Hardware' value={meshConfig?.hardwareVersion ?? routerHardware!} />
        )}
        {routerUptimeS !== undefined && (
          <DataRow label='Uptime' value={formatUptime(Number(routerUptimeS))} />
        )}
        {lastRebootReason && <DataRow label='Last reboot' value={lastRebootReason} />}
        {wifiConfig?.countryCode && isRouter && (
          <DataRow label='Region' value={wifiConfig.countryCode} />
        )}
      </div>

      {isRouter && <RadioTempsSection radios={radios} />}

      {/* The clients this node is carrying, each drilling into the same device
          detail the Network list opens — a node's device list is a way into a
          device, not a leaf. */}
      {node.connected && (
        <div>
          <SectionHeading title='Connected devices' />
          {node.devices.length === 0 ? (
            <div className='text-[11.5px] font-medium text-muted-foreground'>
              No devices are using this node right now.
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
          This node is paired with your network but not currently reachable. Power it on, or move it
          closer to the router, and it will reappear here.
        </div>
      )}
    </div>
  );
}
