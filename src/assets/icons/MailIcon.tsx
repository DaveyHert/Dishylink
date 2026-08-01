export function MailIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
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
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <path d='m4 7 8 6 8-6' />
    </svg>
  );
}
