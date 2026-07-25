// Drill-in for one client device: identity header with rename, the spec sheet,
// and its throughput charts.

import { useState } from "react";
import { throughputMbps, type WifiClientJson } from "../../lib/dishClient";
import type { ClientUsageTotal } from "../../lib/clientUsage";
import type { TelemetrySample } from "../../lib/telemetry";
import type { ThroughputRates } from "../../lib/throughputTracker";
import { classifyDevice } from "../../lib/deviceKind";
import { vendorForMac } from "../../lib/macVendor";
import { DeviceTypeIcon } from "../../assets/icons/DeviceTypeIcon";
import { DeviceFactsList } from "./DeviceFactsList";
import { DeviceNameEditor, RenameButton } from "./DeviceNameEditor";
import { DeviceSignalIcon } from "../../assets/icons/DeviceSignalIcon";
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
  /** This device's monthly usage from the historian's odometer, if it has one. */
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
      <div className='relative mb-3.5 flex items-center gap-2.5'>
        <DeviceTypeIcon
          kind={classifyDevice(name)}
          size={24}
          className='flex-none text-[var(--ink-secondary)]'
        />
        {/* Signal glyph centred on the header row itself — not pinned to either
            edge — so it reads as the device's headline state, the way the app
            centres it. Absolute rather than a flex child because the row's true
            midpoint must not move with the length of the name. */}
        <span className='absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center'>
          <span className='flex h-6 items-center'>
            <DeviceSignalIcon client={client} quality={quality} />
          </span>
          {/* The router's own id for this client, sat under the glyph. Opaque and
              uint32 — not a serial, and not derived from the MAC (crc32/FNV/djb2
              over six spellings all miss) — but stable across re-associations,
              so it identifies the device the way the app uses it. */}
          {client.clientId !== undefined && (
            <span className='font-mono text-[11px] tabular-nums text-muted-foreground/70'>
              {client.clientId}
            </span>
          )}
        </span>
        <div className='min-w-0 flex-1'>
          {/* Capped short of the centred glyph so a long name truncates instead
              of running underneath it. */}
          <div className='flex max-w-[calc(50%-36px)] items-center gap-2'>
            <span className='truncate text-[18px] font-bold text-foreground'>{name}</span>
            {!editing && <RenameButton onClick={() => setEditing(true)} />}
          </div>
          <div className='text-[11.5px] font-medium text-muted-foreground'>
            {deviceRowSubtitle(client, isThisDevice)}
          </div>
        </div>
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
