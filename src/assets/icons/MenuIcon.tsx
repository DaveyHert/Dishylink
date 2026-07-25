// Hamburger — three rules. Opens the folded nav below the mobile breakpoint.

export function MenuIcon({
  size = 16,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path d='M4 6h16M4 12h16M4 18h16' stroke='currentColor' strokeWidth={2} strokeLinecap='round' />
    </svg>
  );
}
