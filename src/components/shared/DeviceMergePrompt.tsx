// Asks whether two usage entries sharing a name are one device the router gave two
// identities. Shown below the device list, fed by the candidate list on the totals
// reply. The two entries render as side-by-side device cards; buttons report the
// answer to the caller, which owns the merge.

import type { MergeCandidate } from "@core/clientTotals";
import { usageKey, type ClientUsageTotal } from "@core/clientUsage";
import { formatBytes, formatRelativeTime } from "../../lib/format";
import { vendorForMac } from "../../lib/macVendor";
import { useOuiRegistry } from "../../hooks/useOuiRegistry";
import { classifyDevice } from "../../lib/deviceKind";
import { DeviceTypeIcon } from "../../assets/icons/DeviceTypeIcon";
import { MergeIcon } from "../../assets/icons/MergeIcon";

export function DeviceMergePrompt({
  candidates,
  totals,
  nowMs,
  onAnswer,
}: {
  candidates: MergeCandidate[];
  /** The rows the candidates refer to, for the byte figures and last-seen times. */
  totals: ClientUsageTotal[];
  nowMs: number;
  onAnswer: (candidate: MergeCandidate, same: boolean) => void;
}) {
  useOuiRegistry();

  // One question at a time. Answering removes the candidate upstream, so the next
  // takes its place; several at once reads as an error report about the network
  // rather than a question with two buttons.
  const [candidate] = candidates;
  if (!candidate) return null;

  const byKey = new Map(totals.map((t) => [usageKey(t.clientId, t.macAddress), t]));
  const older = byKey.get(candidate.fromKey);
  const newer = byKey.get(candidate.toKey);
  // A candidate naming a row that is not in the list cannot be shown honestly.
  if (!older || !newer) return null;

  return (
    <div className='relative mt-3 overflow-hidden rounded-lg border border-border bg-card'>
      {/* Attention band down the left edge, muted attention red. */}
      <span
        className='absolute inset-y-0 left-0 w-[3px] bg-[color-mix(in_srgb,#f90000_55%,var(--ink-muted))]'
        aria-hidden='true'
      />
      <div className='p-3 pl-3.5'>
        <div className='flex items-center gap-1.5'>
          <MergeIcon size={15} className='text-chart-warm' />
          <span className='text-[14.5px] font-[650] text-foreground'>
            Possible duplicate device
          </span>
          {candidates.length > 1 && (
            <span className='ml-auto text-[11px] text-muted-foreground'>
              {candidates.length - 1} more to review
            </span>
          )}
        </div>
        <div className='mt-1 text-[13.5px] leading-[1.55] text-ink-secondary'>
          This device appears twice, both named{" "}
          <span className='font-medium text-foreground'>{candidate.detail}</span>. This happens when
          a device changes its Wi-Fi address and your router treats it as new.
        </div>

        <div className='mt-2.5 flex items-stretch gap-2'>
          <MergeDeviceCard total={older} nowMs={nowMs} />
          {/* Directional: the older, idle device folds into the current one. */}
          <span className='shrink-0 self-center text-[13px] text-chart-warm' aria-hidden='true'>
            →
          </span>
          <MergeDeviceCard total={newer} nowMs={nowMs} />
        </div>

        {/* The outcome is quoted from the candidate, which the recorder filled in.
            Whether the two figures add depends on the month each bucket covers — a
            rule the recorder owns, and re-deriving it here would eventually promise
            a total it does not produce. The history joins either way. */}
        <div className='mt-2.5 text-[13.5px] leading-[1.55] text-ink-secondary'>
          {candidate.foldsBytes
            ? `Combining keeps one device with ${formatBytes(
                candidate.resultRxBytes + candidate.resultTxBytes,
              )} this month, and joins their usage history.`
            : "These cover different months, so their usage history is joined but the monthly figures stay as they are."}
        </div>

        <div className='mt-2.5 flex items-center gap-3'>
          <button
            className='cursor-pointer rounded-md border-0 bg-foreground px-2.5 py-1 text-[12px] font-semibold text-background'
            onClick={() => onAnswer(candidate, true)}
          >
            Same device
          </button>
          <button
            className='cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground'
            onClick={() => onAnswer(candidate, false)}
          >
            Different devices
          </button>
        </div>
      </div>
    </div>
  );
}

// One side of the pair, drawn as the device row it is in the usage list, at the
// list's own type sizes so it does not read as a shrunken oddity beside the rows
// above it: type icon leading, name over its meta, and the month's total over the
// ↓/↑ split on the right.
//
// The name gets its own line and is never clipped — it is the field the user reads
// to decide whether the two are one device. Below it the maker ("Private" for the
// masked address behind the split) with active/last-seen, and below that the
// router's labelled id on its own row: what the router assigned the two differently,
// the technical reason they split, but not what a person judges by — set apart by a
// softer colour, not a smaller size.
function MergeDeviceCard({ total, nowMs }: { total: ClientUsageTotal; nowMs: number }) {
  const vendor = vendorForMac(total.macAddress);
  const maker = vendor || "Private";
  const name = total.name || vendor || total.macAddress;
  const kind = classifyDevice(name);
  const routerId = total.clientId !== undefined ? String(total.clientId) : "unknown";
  // Matches the usage row's threshold: a device the historian touched within two
  // minutes is here now, and "Active now" against the other's "2 days ago" is the
  // contrast that reads the direction of the merge.
  const isActive = nowMs - total.lastSeenMs < 120_000;
  const seenLabel = isActive ? "Active now" : formatRelativeTime(total.lastSeenMs, nowMs);

  return (
    <div className='flex flex-1 items-center gap-3 rounded-md border border-border p-2.5'>
      <DeviceTypeIcon kind={kind} size={22} className='flex-none text-ink-secondary' />
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className='text-[14px] leading-[1.3] font-semibold text-foreground'>{name}</span>
        <span className='text-[11.5px] leading-[1.3] text-muted-foreground'>
          {maker} · {seenLabel}
        </span>
        <span className='text-[11.5px] leading-[1.3] text-muted-foreground'>
          Router ID: {routerId}
        </span>
      </span>
      <span className='flex flex-none flex-col items-end'>
        <span className='font-mono text-[14px] font-semibold tabular-nums text-foreground'>
          {formatBytes(total.rxBytes + total.txBytes)}
        </span>
        <span className='font-mono text-[10.5px] tabular-nums text-muted-foreground'>
          {formatBytes(total.rxBytes)} <span className='text-series-down'>↓</span> ·{" "}
          {formatBytes(total.txBytes)} <span className='text-series-up'>↑</span>
        </span>
      </span>
    </div>
  );
}
