export function HeartIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M12 20.6c-.3 0-.6-.1-.8-.3C7.6 17.5 4 14.3 4 10.4 4 7.7 6.1 5.6 8.7 5.6c1.4 0 2.7.6 3.3 1.6.6-1 1.9-1.6 3.3-1.6 2.6 0 4.7 2.1 4.7 4.8 0 3.9-3.6 7.1-7.2 9.9-.2.2-.5.3-.8.3Z'
        stroke='currentColor'
        strokeWidth={2}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
