export function UptimeIcon({
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
      strokeWidth={1.75}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      {/* Clock face */}
      <circle cx='12' cy='12' r='9' />
      {/* Clock hands: 12 o'clock hour, minute pointing to ~10 past */}
      <polyline points='12 7 12 12 15 14' />
      {/* Small check mark at bottom-right to signal "OK / uptime" */}
      <polyline points='8.5 20 10.5 22 14.5 18' />
    </svg>
  );
}
