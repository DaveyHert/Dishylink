// Four corner brackets — opens the terminal card into its full detail panel.

export function ExpandIcon({
  size = 16,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinecap='round'
      />
    </svg>
  );
}
