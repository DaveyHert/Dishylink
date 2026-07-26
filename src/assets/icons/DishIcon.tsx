// Dish glyph: a parabola in profile on a short stand, with three dots climbing
// away from the feed as the beam. Paints in currentColor, so callers set the
// color (and any dimming) with text/opacity utilities on the icon or its parent.

export function DishIcon({ size = 22, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={1}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      {/* bowl: chord and the parabola it subtends */}
      <path d='M4 11L11 18' />
      <path d='M4 11C6.5 11 9.5 14 11 18' />
      {/* stand */}
      <path d='M7.5 14.5L5 18' />
      <path d='M3 18H7' />
      {/* beam */}
      <circle cx='12' cy='11' r='0.8' fill='currentColor' stroke='none' />
      <circle cx='15' cy='8' r='0.8' fill='currentColor' stroke='none' />
      <circle cx='18' cy='5' r='0.8' fill='currentColor' stroke='none' />
    </svg>
  );
}
