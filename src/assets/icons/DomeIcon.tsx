// The obstruction dome, as a mark: one dashed arc, open underneath, because the
// dome is a scatter of readings over the sky and not a solid shape.
//
// Trimmed, the feet sit on the dome's own width. `skirted` carries the same
// circle a step further round so they hang below it — the never-observed skirt
// the dish cannot see past. Both are struck from the same circle at the same 30°
// spacing, so the two read as one dome losing or gaining a row.
//
// Each path runs 15° past its last dot at both ends. The dots sit at the middle
// of each division, never on an end: a dot on the final point is a zero-length
// dash there, which a renderer may drop, and that takes one foot away and leaves
// the mark lopsided. The overhang falls inside a gap, so nothing of it shows.

const DOTS = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeDasharray: "0.01 3.6552",
  strokeDashoffset: -1.8326,
} as const;

const HALF_DOME = "M1.24 13.31A7 7 0 1 1 14.76 13.31";
const SKIRTED = "M3.05 14.7A7 7 0 1 1 12.95 14.7";

export function DomeIcon({
  size = 14,
  skirted = true,
  ...props
}: React.ComponentProps<"svg"> & { size?: number; skirted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true' {...props}>
      <path d={skirted ? SKIRTED : HALF_DOME} {...DOTS} />
    </svg>
  );
}
