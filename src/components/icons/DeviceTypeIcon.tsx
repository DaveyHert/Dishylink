// Line glyphs for a device's inferred form factor (see lib/deviceKind). Paint in
// currentColor and take a `size`, matching RouterIcon, so callers set colour and
// dimming with text/opacity utilities.

import type { DeviceKind } from "../../lib/deviceKind";

const GLYPHS: Record<DeviceKind, React.ReactNode> = {
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="10.5" y1="18" x2="13.5" y2="18" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  desktop: (
    <>
      <rect x="4" y="5" width="16" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="9" y1="19" x2="15" y2="19" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <line x1="12" y1="15" x2="12" y2="19" stroke="currentColor" strokeWidth={1.6} />
    </>
  ),
  tablet: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <circle cx="12" cy="17.5" r="0.7" fill="currentColor" />
    </>
  ),
  watch: (
    <>
      <rect x="8" y="7" width="8" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="10" y1="7" x2="10.5" y2="4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <line x1="14" y1="7" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <line x1="10" y1="17" x2="10.5" y2="19.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <line x1="14" y1="17" x2="13.5" y2="19.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  // The original 200x144 artwork, unaltered — scaled into the shared 24x24 box so
  // it sits on the same 18-wide footprint and centre line as the glyphs around it.
  tv: (
    <g transform='translate(3 5.52) scale(0.09)' fill='currentColor'>
      <path fillRule='evenodd' clipRule='evenodd' d='M0 0h200v128H0V0zm8 8h184v112H8V8z' />
      <path d='M41.2 137.2c-1.6 1.6-1.5 4.3.2 5.7.9.8 17.3 1 59.1.9 53.8-.3 57.9-.4 58.9-2 .8-1.3.8-2.3 0-3.5-1-1.7-5.1-1.8-59.1-2.1-44.2-.2-58.2.1-59.1 1z' />
    </g>
  ),
  console: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <line x1="7.5" y1="10.5" x2="7.5" y2="13.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <line x1="6" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx="16" cy="12" r="1" fill="currentColor" />
    </>
  ),
  // A chip, not a rounded square with a dot — the latter reads as a watch face.
  unknown: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <rect x="10" y="10" width="4" height="4" rx="0.5" fill="none" stroke="currentColor" strokeWidth={1.3} />
      {[9.5, 12, 14.5].map((y) => (
        <line key={`l${y}`} x1="4.5" y1={y} x2="7" y2={y} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      ))}
      {[9.5, 12, 14.5].map((y) => (
        <line key={`r${y}`} x1="17" y1={y} x2="19.5" y2={y} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      ))}
      {[9.5, 12, 14.5].map((x) => (
        <line key={`t${x}`} x1={x} y1="4.5" x2={x} y2="7" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      ))}
      {[9.5, 12, 14.5].map((x) => (
        <line key={`b${x}`} x1={x} y1="17" x2={x} y2="19.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      ))}
    </>
  ),
};

export function DeviceTypeIcon({
  kind,
  size = 22,
  ...props
}: React.ComponentProps<"svg"> & { kind: DeviceKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {GLYPHS[kind]}
    </svg>
  );
}
