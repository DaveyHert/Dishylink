// Pencil — renames a device from its network row.

export function PencilIcon({
  size = 15,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinejoin='round'
      />
    </svg>
  );
}
