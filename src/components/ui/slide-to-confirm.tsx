// A commitment that cannot be made by accident: the handle has to cross the whole
// track before anything fires, and releasing short of the end is a no-op, so
// backing out needs no second control.
//
// The travel runs toward the state being entered — right to switch on, left to
// switch back off — so the gesture itself says which way the change goes.

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The handle is round, so this is its diameter: track height less both insets. */
const HANDLE_PX = 46;
const TRACK_INSET_PX = 3;
/** One arrow press; the track takes five of them, so the keyboard pays the same
 *  deliberate cost as the drag. */
const KEY_STEP = 0.2;

export function SlideToConfirm({
  label,
  busyLabel,
  direction = "right",
  tone = "default",
  disabled = false,
  busy = false,
  onConfirm,
}: {
  label: string;
  /** Shown once the action is away, while the caller reports it busy. */
  busyLabel: string;
  direction?: "right" | "left";
  tone?: "default" | "danger";
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<number | null>(null);
  // Read by the release, which runs before the state it would read has committed.
  const travelled = useRef(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const locked = disabled || busy;
  const complete = progress >= 1;

  // The handle is parked back at the start once the caller stops being busy —
  // whether the write succeeded or threw, the gesture is spent either way.
  const [wasBusy, setWasBusy] = useState(busy);
  if (wasBusy !== busy) {
    setWasBusy(busy);
    if (!busy) setProgress(0);
  }

  useEffect(() => {
    if (!busy) travelled.current = 0;
  }, [busy]);

  const travelPx = () => {
    const track = trackRef.current;
    if (!track) return 1;
    return Math.max(1, track.clientWidth - HANDLE_PX - TRACK_INSET_PX * 2);
  };

  const moveTo = (next: number) => {
    travelled.current = Math.min(1, Math.max(0, next));
    setProgress(travelled.current);
  };

  const commit = () => {
    dragOrigin.current = null;
    setDragging(false);
    moveTo(1);
    onConfirm();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = event.clientX;
    // Every gesture starts from nothing, so a press with no travel cannot inherit
    // the distance the last one covered and fire on release.
    travelled.current = 0;
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current === null) return;
    const travelled =
      direction === "right"
        ? event.clientX - dragOrigin.current
        : dragOrigin.current - event.clientX;
    moveTo(travelled / travelPx());
  };

  // Reaching the end arms the action; letting go there is what fires it. A hand
  // that overshoots can travel back and release without having done anything.
  const endDrag = () => {
    if (locked || dragOrigin.current === null) return;
    dragOrigin.current = null;
    setDragging(false);
    if (travelled.current >= 1) commit();
    else moveTo(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const forward = direction === "right" ? "ArrowRight" : "ArrowLeft";
    const back = direction === "right" ? "ArrowLeft" : "ArrowRight";
    // A press is its own complete gesture, so the one that lands on the end
    // fires there — it is the keyboard's release.
    if (event.key === forward) {
      if (travelled.current + KEY_STEP >= 1) commit();
      else moveTo(travelled.current + KEY_STEP);
    } else if (event.key === back) moveTo(travelled.current - KEY_STEP);
    else if (event.key === "Home" || event.key === "Escape") moveTo(0);
    else return;
    event.preventDefault();
  };

  const danger = tone === "danger";
  // Snap back is animated; following a finger is not, or the handle lags it.
  const glide = dragging ? "" : "transition-[left,width] duration-200 ease-out";
  const handleOffset = direction === "right" ? progress : 1 - progress;

  return (
    <div
      ref={trackRef}
      data-slide-track
      className={cn(
        "relative h-[52px] w-full overflow-hidden rounded-full border border-hairline select-none",
        "bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]",
        locked && "cursor-not-allowed opacity-45",
      )}
    >
      <div
        data-slide-fill
        className={cn(
          "absolute inset-y-0",
          direction === "right" ? "left-0" : "right-0",
          glide,
          danger
            ? "bg-[color-mix(in_srgb,var(--status-critical)_22%,transparent)]"
            : "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]",
        )}
        style={{ width: `${progress * 100}%` }}
      />

      <span
        className='pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-secondary'
        style={{ opacity: complete || busy ? 1 : 1 - progress * 0.85 }}
      >
        {busy ? busyLabel : label}
        {!busy && !complete && (
          <span className='flex items-center gap-[3px]' aria-hidden='true'>
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={cn(
                  "h-[5px] w-[5px] rounded-full bg-current opacity-30",
                  "motion-safe:animate-[slide-hint_1.4s_ease-in-out_infinite]",
                )}
                style={{
                  animationDelay: `${(direction === "right" ? index : 2 - index) * 160}ms`,
                }}
              />
            ))}
          </span>
        )}
      </span>

      <div
        data-slide-handle
        role='slider'
        tabIndex={locked ? -1 : 0}
        aria-label={label}
        aria-disabled={locked || undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={`${Math.round(progress * 100)}% of the way to ${label.toLowerCase()}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        className={cn(
          "absolute inset-y-[3px] flex items-center justify-center rounded-full",
          "touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          locked ? "cursor-not-allowed" : dragging ? "cursor-grabbing" : "cursor-grab",
          danger ? "bg-(--status-critical) text-white" : "bg-ink text-(--surface)",
          glide,
        )}
        style={{
          width: HANDLE_PX,
          left: `calc(${TRACK_INSET_PX}px + ${handleOffset} * (100% - ${HANDLE_PX + TRACK_INSET_PX * 2}px))`,
        }}
      >
        {complete ? (
          <CheckIcon className='size-[18px]' />
        ) : direction === "right" ? (
          <ArrowRightIcon className='size-[18px]' />
        ) : (
          <ArrowLeftIcon className='size-[18px]' />
        )}
      </div>
    </div>
  );
}
