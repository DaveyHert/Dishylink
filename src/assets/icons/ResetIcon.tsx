// Arrow curling back to its start — resets a device's usage count for the month.

export function ResetIcon({
  size = 15,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
