// Notification bell. Paints in currentColor like the other icons here;
// callers set the color.

export function BellIcon({
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
      aria-hidden='true'
      {...props}
    >
      <path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' />
      <path d='M13.7 21a2 2 0 0 1-3.4 0' />
    </svg>
  );
}
