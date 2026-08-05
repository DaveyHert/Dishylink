// Drill-in for one client device: identity header with rename, the spec sheet,
// and its throughput charts.

import { useState } from "react";
import { throughputMbps, type WifiClientJson } from "@core/dishClient";
import { usageKey, type ClientUsageTotal } from "@core/clientUsage";
import type { TelemetrySample } from "@core/telemetry";
import type { ThroughputRates } from "@core/throughputTracker";
import { classifyDevice } from "../../lib/deviceKind";
import { vendorForMac } from "../../lib/macVendor";
import { DeviceTypeIcon } from "../../assets/icons/DeviceTypeIcon";
import { Badge } from "../ui/badge";
import { DeviceFactsList } from "./DeviceFactsList";
import { DeviceNameEditor, RenameButton } from "./DeviceNameEditor";
import { DeviceSignalIcon } from "../../assets/icons/DeviceSignalIcon";
import { DeviceThroughput } from "./DeviceThroughput";
import { buildDeviceFacts } from "./deviceFacts";
import { deviceRowSubtitle } from "./deviceRowSubtitle";
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
  const liveRate = client.macAddress
    ? rates.get(usageKey(client.clientId, client.macAddress))
    : undefined;
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
      {/* Three columns with equal 1fr flanks put the middle column on the row's
          true midpoint regardless of the name's length, while the middle column
          is a normal flow child — so a stacked "Paused" pill grows the row to fit
          rather than spilling out of it. */}
      <div className='mb-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <DeviceTypeIcon
            kind={classifyDevice(name)}
            size={24}
            className='flex-none text-ink-secondary'
          />
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <span className='truncate text-[18px] font-bold text-foreground'>{name}</span>
              {!editing && <RenameButton onClick={() => setEditing(true)} />}
            </div>
            <div className='text-[11.5px] font-medium text-muted-foreground'>
              {deviceRowSubtitle(client, isThisDevice)}
            </div>
          </div>
        </div>
        {/* Signal glyph, then the router's clientId, then a Paused pill — the
            device's headline state, centred like the app. clientId is opaque and
            uint32 (not a serial, not derived from the MAC) but stable across
            re-associations. */}
        <div className='flex flex-col items-center'>
          <span className='flex h-6 items-center'>
            <DeviceSignalIcon client={client} quality={quality} />
          </span>
          {client.clientId !== undefined && (
            <span className='font-mono text-[11px] tabular-nums text-muted-foreground/70'>
              {client.clientId}
            </span>
          )}
          {client.blocked && <Badge className='mt-1'>Paused</Badge>}
        </div>
        {/* Empty flank balances the left one so the glyph column stays centred. */}
        <div aria-hidden />
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
