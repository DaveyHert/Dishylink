// The row primitive both tabs are built from, and the device row composed on top
// of it.
//
// An offline row is already a disabled button, so its dimmed look comes from
// disabled: / group-disabled: rather than a separate offline class.

import type { WifiClientJson } from "@core/dishClient";
import { matchesSelf } from "../../lib/selfIdentity";
import type { SelfIdentity } from "../../lib/selfIdentity";
import { classifyDevice } from "../../lib/deviceKind";
import { deviceRowSubtitle } from "./deviceRowSubtitle";
import { DeviceTypeIcon } from "../../assets/icons/DeviceTypeIcon";
import { Badge } from "../ui/badge";
import { DeviceSignalIcon } from "../../assets/icons/DeviceSignalIcon";
import { MeterIcon } from "../../assets/icons/MeterIcon";
import { usageKey } from "@core/clientUsage";
import { useMeterIndicators } from "../../hooks/useDataMeter";
import { METER_INDICATOR_COLOR, type MeterIndicator } from "./rules/meterIndicator";
import { bandLabel, clientEntryKey, displayName, signalQuality } from "./networkFormat";

export function NetworkRow({
  icon,
  name,
  subIcon,
  sub,
  band,
  paused,
  meterIndicator,
  showChevron,
  disabled,
  highlight,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  /** Optional glyph inline on the subtitle line, left of the text (device rows
   *  put the device-type icon here, so the leading slot can show wifi signal). */
  subIcon?: React.ReactNode;
  sub: React.ReactNode;
  band?: React.ReactNode;
  /** Shows a "Paused" tag left of the band chip when the device's internet is
   *  blocked. */
  paused?: boolean;
  /** This device's data limit, or absent when it has none. */
  meterIndicator?: MeterIndicator;
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
        <span className='overflow-hidden text-[14px] font-semibold text-ellipsis whitespace-nowrap text-foreground group-disabled:text-ink-secondary'>
          {name}
        </span>
        {/* Inline rather than a flex row: `sub` is running text, and flexing it
            would break "This device · Apple" into separately spaced items. */}
        <span className='text-[11.5px] text-muted-foreground'>
          {subIcon && <span className='mr-1 inline-flex items-center align-middle'>{subIcon}</span>}
          {sub}
        </span>
      </span>
      {(paused || band || meterIndicator) && (
        // Grouped tight so the pair reads as one unit — [Paused][5 GHz] — rather
        // than each taking the row's wider inter-item gap.
        <span className='flex flex-none items-center gap-1.5'>
          {meterIndicator && (
            <MeterIcon
              active
              className={`size-[18px] flex-none ${METER_INDICATOR_COLOR[meterIndicator] || "text-muted-foreground"}`}
            />
          )}
          {paused && <Badge>{meterIndicator === "held" ? "Paused · limit" : "Paused"}</Badge>}
          {band && <Badge>{band}</Badge>}
        </span>
      )}
      {showChevron && (
        <span className='flex-none text-[18px] leading-none text-muted-foreground'>›</span>
      )}
    </button>
  );
}

/**
 * A client device as a row: signal glyph leading, device-type glyph on the
 * subtitle, band chip trailing. The Devices tab and a node's "Connected devices"
 * list both render exactly this, so a device looks the same wherever it is listed.
 */
export function DeviceRow({
  client,
  self,
  onSelect,
}: {
  client: WifiClientJson;
  self: SelfIdentity;
  /** Receives the row's `clientEntryKey`, which NetworkPanel resolves back. */
  onSelect: (entryKey: string | null) => void;
}) {
  const isSelf = matchesSelf(client, self);
  const name = displayName(client);
  const meterIndicator = useMeterIndicators().get(usageKey(client.clientId, client.macAddress));
  return (
    <NetworkRow
      icon={<DeviceSignalIcon client={client} quality={signalQuality(client)} />}
      name={name}
      subIcon={
        <DeviceTypeIcon kind={classifyDevice(name)} size={13} className='text-ink-secondary' />
      }
      sub={deviceRowSubtitle(client, isSelf)}
      band={bandLabel(client)}
      paused={client.blocked}
      meterIndicator={meterIndicator}
      highlight={isSelf}
      showChevron
      onClick={() => {
        const key = clientEntryKey(client);
        if (key) onSelect(key);
      }}
    />
  );
}
