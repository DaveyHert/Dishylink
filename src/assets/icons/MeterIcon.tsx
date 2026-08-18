// Rising bars with a cut-off line across them — a device's data allowance and
// the point its internet stops.

export function MeterIcon({
  size = 15,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M5 20v-5M12 20V9M19 20v-8'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinecap='round'
      />
      <path
        d='M3 5.5h18'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinecap='round'
        strokeDasharray='3 2.5'
      />
    </svg>
  );
}
