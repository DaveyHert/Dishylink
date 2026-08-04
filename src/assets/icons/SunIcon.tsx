// Disc and eight rays — the theme toggle's light-mode face.

export function SunIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <circle cx={12} cy={12} r={4} stroke='currentColor' strokeWidth={2} />
      <path
        d='M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4'
        stroke='currentColor'
        strokeWidth={2}
      />
    </svg>
  );
}
