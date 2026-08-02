export function ChartLineIcon({
  size = 14,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 247 242'
      fill='none'
      stroke='currentColor'
      strokeWidth={14}
      aria-hidden='true'
      {...props}
    >
      <rect x='183.936' y='7' width='55.1152' height='227.39' rx='27.5576' />
      <rect x='7' y='79.8018' width='55.1152' height='154.588' rx='27.5576' />
      <rect x='95.4678' y='124.088' width='55.1152' height='110.302' rx='27.5576' />
    </svg>
  );
}
