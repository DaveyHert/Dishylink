export function ShieldIcon({
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
      <path d='M12 3 4 6v6c0 4.4 3.4 7.6 8 9 4.6-1.4 8-4.6 8-9V6l-8-3Z' />
    </svg>
  );
}
