// Two nodes converging into one — the "these are one device" glyph for the
// duplicate-record prompt. Strokes in currentColor; callers set colour and size.

export function MergeIcon({
  size = 14,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      aria-hidden='true'
      {...props}
    >
      <circle cx='6' cy='6' r='2.25' />
      <circle cx='6' cy='18' r='2.25' />
      <circle cx='18' cy='12' r='2.25' />
      <path d='M8 7Q13 9 16 11' />
      <path d='M8 17Q13 15 16 13' />
    </svg>
  );
}
