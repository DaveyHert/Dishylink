// The row primitive both tabs are built from, and the device row composed on top
// of it.
//
// NetworkRow was `.netrow` + six child classes, rendered twice. The offline state
// maps to `disabled:` and `group-disabled:` because an offline row is already a
// disabled button — `.netrow-offline` was a parallel way of saying the same
// thing, including a :hover rule whose only job was to cancel the base :hover.

import type { WifiClientJson } from "../../lib/dishClient";
import { matchesSelf } from "../../lib/selfIdentity";
import type { SelfIdentity } from "../../lib/selfIdentity";
import { classifyDevice } from "../../lib/deviceKind";
import { DeviceTypeIcon } from "../icons/DeviceTypeIcon";
import { Badge } from "../ui/badge";
import { DeviceSignalIcon } from "./DeviceSignalIcon";
import { bandLabel, deviceSubtitle, displayName, signalQuality } from "./networkFormat";

export function NetworkRow({
  icon,
  name,
  subIcon,
  sub,
  band,
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
        {/* Inline rather than a flex row: `sub` is running text, and flexing it
            would break "This device · Apple" into separately spaced items. */}
        <span className='text-[11.5px] text-muted-foreground'>
          {subIcon && <span className='mr-1 inline-flex items-center align-middle'>{subIcon}</span>}
          {sub}
        </span>
      </span>
      {band && <Badge className='flex-none'>{band}</Badge>}
      {showChevron && (
        <span className='flex-none text-[18px] leading-none text-muted-foreground'>›</span>
      )}
    </button>
  );
}

/** Subtitle with a leading "This device" for the viewer's own machine, as the
 *  official app shows it ("This device · Apple"). "This device" is brighter and
 *  semibold to stand out from the muted vendor. Drops the "unknown device"
 *  filler so it never reads "This device · unknown device". */
export function deviceRowSubtitle(client: WifiClientJson, isSelf: boolean): React.ReactNode {
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

/**
 * A client device as a row: signal glyph leading, device-type glyph on the
 * subtitle, band chip trailing. The Devices tab and a node's "Connected devices"
 * list render exactly this, so they cannot drift apart — previously each spelled
 * the same five props out by hand.
 */
export function DeviceRow({
  client,
  self,
  onSelect,
}: {
  client: WifiClientJson;
  self: SelfIdentity;
  onSelect: (macAddress: string | null) => void;
}) {
  const isSelf = matchesSelf(client, self);
  const name = displayName(client);
  return (
    <NetworkRow
      icon={<DeviceSignalIcon client={client} quality={signalQuality(client)} />}
      name={name}
      subIcon={
        <DeviceTypeIcon
          kind={classifyDevice(name)}
          size={13}
          className='text-[var(--ink-secondary)]'
        />
      }
      sub={deviceRowSubtitle(client, isSelf)}
      band={bandLabel(client)}
      highlight={isSelf}
      showChevron
      onClick={() => client.macAddress && onSelect(client.macAddress)}
    />
  );
}
