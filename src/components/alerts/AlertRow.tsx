// One alert line: severity dot, message, optional advice, meta underneath.
// Shared by the Active and History tabs so a cleared alert reads the same as a
// firing one, minus the colour.

import { InfoDot } from "../shared/InfoDot";

export function AlertRow({
  color,
  dim,
  title,
  meta,
  advice,
}: {
  color: string;
  dim?: boolean;
  title: string;
  meta?: string;
  /** What to do about it — an ⓘ beside the message, never inside it. Only worth
   *  offering while the alert is live; history passes none. */
  advice?: string;
}) {
  return (
    <div className='flex items-start gap-3 px-4 py-2.5'>
      {/* Centred against the title's first line, not nudged down by a guessed
          margin: the box matches the line height (13.5px × leading-snug), so the
          dot stays put if the type changes and never drifts to the middle of a
          title that wraps to two lines. */}
      <span className='flex h-[1.375em] shrink-0 items-center text-[13.5px]'>
        <span
          className='size-2 rounded-full'
          style={{ background: color, opacity: dim ? 0.4 : 1 }}
        />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-[13.5px] leading-snug text-[var(--ink)]'>
          {title}
          {/* Sits after the message, not inside it. The gap is on the wrapper —
              a bare InfoDot has none of its own (StatLabel's .info-label
              supplies it there), and it would otherwise butt against the text. */}
          {advice && (
            <span className='ml-1.5 inline-flex translate-y-[1px] align-middle'>
              <InfoDot tip={advice} />
            </span>
          )}
        </p>
        {meta && <p className='mt-0.5 text-xs text-[var(--ink-muted)]'>{meta}</p>}
      </div>
    </div>
  );
}
