export function StarIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
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
      <path d='m12 17.3-5.8 3.7 1.6-6.6-5.3-4.6 6.7-.6L12 3l2.8 6.2 6.7.6-5.3 4.6 1.6 6.6Z' />
    </svg>
  );
}
