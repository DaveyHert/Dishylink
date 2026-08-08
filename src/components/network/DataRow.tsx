// Label/value line used by both drill-ins. Monospace, tabular value on the
// right, hairline above — the network panel's own spec sheet row.

export function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-baseline justify-between gap-4 border-t border-t-hairline py-[9px]'>
      <span className='text-[11.5px] font-medium text-muted-foreground'>{label}</span>
      <span className='font-mono tabular-nums text-[13px] text-right text-foreground [overflow-wrap:anywhere]'>
        {value}
      </span>
    </div>
  );
}

/** Heading for a section inside a drill-in (Throughput, Radio temperatures,
 *  Connected devices) — a section title, not a caption on a field. `children`
 *  are trailing companions on the same line: an InfoDot, a window picker. */
export function SectionHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className='mt-5 mb-2.5 flex items-center gap-[7px]'>
      <span className='text-[14px] font-semibold tracking-[0.01em] text-foreground'>{title}</span>
      {children}
    </div>
  );
}
