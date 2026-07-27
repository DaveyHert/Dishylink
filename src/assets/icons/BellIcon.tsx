// Notification bell, struck through when alert sounds are muted — the same
// shorthand every messaging app uses, so the state reads without a legend.
// Paints in currentColor like the other icons here; callers set the color.

export function BellIcon({
  size = 14,
  muted = false,
  ...props
}: React.ComponentProps<"svg"> & { size?: number; muted?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      aria-hidden='true'
      {...props}
    >
      <path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' />
      <path d='M13.7 21a2 2 0 0 1-3.4 0' />
      {muted && <path d='M3 3 L21 21' strokeLinecap='round' />}
    </svg>
  );
}
