// Drill-in for one client device: identity header with rename, the spec sheet,
// and its throughput charts.

import { useState } from "react";
import { throughputMbps, type WifiClientJson } from "../../lib/dishClient";
import type { ClientUsageTotal } from "../../lib/clientUsage";
import type { TelemetrySample } from "../../lib/telemetry";
import type { ThroughputRates } from "../../lib/throughputTracker";
import { classifyDevice } from "../../lib/deviceKind";
import { vendorForMac } from "../../lib/macVendor";
import { DeviceTypeIcon } from "../icons/DeviceTypeIcon";
import { DeviceFactsList } from "./DeviceFactsList";
import { DeviceNameEditor, RenameButton } from "./DeviceNameEditor";
import { DeviceSignalIcon } from "./DeviceSignalIcon";
import { DeviceThroughput } from "./DeviceThroughput";
import { buildDeviceFacts } from "./deviceFacts";
import { deviceRowSubtitle } from "./NetworkRow";
import { displayName, signalQuality } from "./networkFormat";

export function DeviceDetail({
  client,
  history,
  rates,
  total,
  upstreamName,
  isThisDevice,
  onRename,
}: {
  client: WifiClientJson;
  /** Live per-MAC rates from the hook's byte-delta tracker. */
  rates: Map<string, ThroughputRates>;
  history: TelemetrySample[];
  /** This device's monthly usage from the collector's odometer, if it has one. */
  total?: ClientUsageTotal;
  /** Resolved name of the node this client is attached to (via upstreamMacAddress). */
  upstreamName?: string;
  /** True when this is the device viewing the dashboard. */
  isThisDevice: boolean;
  onRename: (macAddress: string, givenName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  const quality = signalQuality(client);
  const name = displayName(client);
  // Byte-delta rate, so the headline number matches a speed test instead of the
  // router's 60-second average of it. Falls back until the second reading lands.
  const liveRate = client.macAddress ? rates.get(client.macAddress) : undefined;
  const downMbps = liveRate?.downMbps ?? throughputMbps(client.rxStats);
  const upMbps = liveRate?.upMbps ?? throughputMbps(client.txStats);

  const facts = buildDeviceFacts({
    client,
    quality,
    vendor: vendorForMac(client.macAddress),
    upstreamName,
    total,
  });

  return (
    <div>
      <div className='mb-3.5 flex items-center gap-2.5'>
        <DeviceTypeIcon
          kind={classifyDevice(name)}
          size={24}
          className='flex-none text-[var(--ink-secondary)]'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <span className='text-[18px] font-bold text-foreground'>{name}</span>
            {!editing && <RenameButton onClick={() => setEditing(true)} />}
          </div>
          <div className='text-[11.5px] font-medium text-muted-foreground'>
            {deviceRowSubtitle(client, isThisDevice)}
          </div>
        </div>
        {/* Signal glyph pushed to the extreme right, so the leading icon can show
            device type. */}
        <span className='flex-none self-start'>
          <DeviceSignalIcon client={client} quality={quality} />
        </span>
      </div>

      {editing && (
        <DeviceNameEditor
          // Remount on a different device so the draft never carries over.
          key={client.macAddress}
          client={client}
          onRename={onRename}
          onDone={() => setEditing(false)}
        />
      )}

      <DeviceFactsList facts={facts} />

      <DeviceThroughput history={history} downMbps={downMbps} upMbps={upMbps} />
    </div>
  );
}
