// Crescent — the theme toggle's dark-mode face.

export function MoonIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path
        d='M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'
        stroke='currentColor'
        strokeWidth={2}
      />
    </svg>
  );
}
