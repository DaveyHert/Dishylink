// Scrubber over the hourly obstruction snapshots, with LIVE as the last stop.
//
// The ticks exist because a bare range input gives no clue how many positions it
// has; one tick per snapshot makes the slidable points visible, and the final
// green one is the live map rather than a stored frame.

import type { ObstructionSnapshot } from "../../lib/obstructionSnapshots";

export function ObstructionTimeLapse({
  snapshots,
  scrubIndex,
  stale = false,
  onScrub,
}: {
  snapshots: ObstructionSnapshot[];
  /** null = live. */
  scrubIndex: number | null;
  /** Dish not answering: the live end is offline, not live. */
  stale?: boolean;
  onScrub: (index: number | null) => void;
}) {
  const isViewingHistory = scrubIndex !== null && scrubIndex < snapshots.length;
  const sliderValue = scrubIndex ?? snapshots.length;

  return (
    <div className='flex items-center gap-2.5 px-0.5 pt-0.5 pb-2.5'>
      <span
        className='text-[11.5px] font-medium text-muted-foreground'
        style={{ whiteSpace: "nowrap" }}
      >
        Obstruction time-lapse
      </span>
      <div className='relative flex h-[22px] flex-1 items-center'>
        <div
          className='pointer-events-none absolute inset-x-2 inset-y-0 flex items-center justify-between'
          aria-hidden='true'
        >
          {Array.from({ length: snapshots.length + 1 }, (_, tickIndex) => {
            const isActive = tickIndex === sliderValue;
            const isLive = tickIndex === snapshots.length;
            return (
              <span
                key={tickIndex}
                className={`w-[2px] rounded-[1px] ${isActive ? "h-3" : "h-2"} ${
                  isLive
                    ? stale
                      ? "bg-status-critical"
                      : "bg-status-good"
                    : isActive
                      ? "bg-ink"
                      : "bg-ink-muted"
                }`}
              />
            );
          })}
        </div>
        <input
          type='range'
          className='relative z-[1] h-[3px] w-full accent-ink'
          min={0}
          max={snapshots.length}
          step={1}
          value={sliderValue}
          onChange={(changeEvent) => {
            const next = Number(changeEvent.target.value);
            onScrub(next >= snapshots.length ? null : next);
          }}
          aria-label='Obstruction time-lapse'
        />
      </div>
      {/* Fixed width, not min: the label swaps between "LIVE" and a timestamp,
          and a min-width lets the wider one grow the label and squeeze the
          flex-1 track — the track visibly jumps as you scrub off LIVE. Sized
          for the widest form the locale can produce (e.g. "09:49 AM"), and
          left-aligned so both forms start at the same edge rather than the
          shorter "LIVE" drifting off to the right. */}
      <span
        className='flex items-center gap-1.5 text-[11.5px] font-medium'
        style={{ whiteSpace: "nowrap", width: 64, flex: "0 0 auto" }}
      >
        {isViewingHistory ? (
          <span className='tabular-nums text-muted-foreground'>
            {new Date(snapshots[scrubIndex].takenAtMs).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : stale ? (
          <span className='font-semibold tracking-wide text-status-critical'>OFFLINE</span>
        ) : (
          <>
            <span className='font-semibold tracking-wide text-status-good'>LIVE</span>
            {/* The one moving thing in the row — a live pulse, not just a word. */}
            <span
              className='size-1.5 animate-pulse rounded-full bg-status-good'
              aria-hidden='true'
            />
          </>
        )}
      </span>
    </div>
  );
}
