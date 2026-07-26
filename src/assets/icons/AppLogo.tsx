// App mark: two orbital rings with a bright satellite on the upper orbit and a
// dimmer counterpart opposite, around a receiver ring. The wordmark is not part
// of it — TopBar sets "DISHYLINK" in type beside it.
//
// Paints in currentColor. With no plate behind the rings the mark sits directly
// on the page, so it has to invert with the theme like the rest of the ink; the
// receiver is drawn as a stroked ring rather than a disc with a punched hole,
// which would need to know the background color.

export function AppLogo({ size = 26, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 220 220'
      fill='none'
      role='img'
      aria-label='DishyLink'
      {...props}
    >
      <g transform='translate(110, 110)' stroke='currentColor' fill='currentColor'>
        {/* orbits */}
        <circle r='95' fill='none' strokeWidth={7} opacity={0.85} />
        <ellipse
          rx='95'
          ry='105'
          fill='none'
          strokeWidth={3}
          opacity={0.4}
          transform='rotate(45)'
        />
        {/* satellite, and its dimmer counterpart opposite */}
        <circle cx='67' cy='-67' r='13' stroke='none' />
        <circle cx='-67' cy='67' r='8' stroke='none' opacity={0.55} />
        {/* receiver */}
        <circle r='17' fill='none' strokeWidth={13} />
      </g>
    </svg>
  );
}
