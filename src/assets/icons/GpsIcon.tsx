// GPS crosshair (Phosphor, fill). Paints in currentColor like the other icons
// here; callers set the color and size.

export function GpsIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 256 256'
      fill='currentColor'
      aria-hidden='true'
      {...props}
    >
      <path d='M240,120H215.63A88.13,88.13,0,0,0,136,40.37V16a8,8,0,0,0-16,0V40.37A88.13,88.13,0,0,0,40.37,120H16a8,8,0,0,0,0,16H40.37A88.13,88.13,0,0,0,120,215.63V240a8,8,0,0,0,16,0V215.63A88.13,88.13,0,0,0,215.63,136H240a8,8,0,0,0,0-16ZM128,200a72,72,0,1,1,72-72A72.08,72.08,0,0,1,128,200Z' />
    </svg>
  );
}
