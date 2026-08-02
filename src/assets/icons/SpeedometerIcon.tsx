export function SpeedometerIcon({
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
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <path d='m12 14 4-4' />
      <path d='M3.34 19a10 10 0 1 1 17.32 0' strokeWidth={1.5} />
    </svg>
  );
}
