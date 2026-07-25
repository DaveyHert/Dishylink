// Router glyph: a base with two broadcast arcs. Paints in currentColor, so
// callers set the color (and any dimming) with text/opacity utilities on the
// icon or its parent.

export function RouterIcon({
  size = 22,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden='true' {...props}>
      <rect
        x='4'
        y='14'
        width='16'
        height='6'
        rx='2'
        fill='none'
        stroke='currentColor'
        strokeWidth={1}
      />
      <circle cx='8' cy='17' r='1' fill='currentColor' />
      <path
        d='M9.5 10a4 4 0 0 1 5 0'
        fill='none'
        stroke='currentColor'
        strokeWidth={1}
        strokeLinecap='round'
      />
      <path
        d='M7 7.2a8 8 0 0 1 10 0'
        fill='none'
        stroke='currentColor'
        strokeWidth={1}
        strokeLinecap='round'
      />
    </svg>
  );
}
