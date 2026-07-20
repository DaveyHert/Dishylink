// Scrubber over the hourly obstruction snapshots, with LIVE as the last stop.
//
// The ticks exist because a bare range input gives no clue how many positions it
// has; one tick per snapshot makes the slidable points visible, and the final
// green one is the live map rather than a stored frame.

import type { ObstructionSnapshot } from "../../lib/obstructionSnapshots";

export function ObstructionTimeLapse({
  snapshots,
  scrubIndex,
  onScrub,
}: {
  snapshots: ObstructionSnapshot[];
  /** null = live. */
  scrubIndex: number | null;
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
                    ? "bg-[var(--status-good)]"
                    : isActive
                      ? "bg-[var(--ink)]"
                      : "bg-[var(--baseline)]"
                }`}
              />
            );
          })}
        </div>
        <input
          type='range'
          className='relative z-[1] h-[3px] w-full accent-[var(--ink)]'
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
      <span
        className='text-[11.5px] font-medium text-muted-foreground'
        style={{ whiteSpace: "nowrap", minWidth: 44, textAlign: "right" }}
      >
        {isViewingHistory
          ? new Date(snapshots[scrubIndex].takenAtMs).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "LIVE"}
      </span>
    </div>
  );
}
