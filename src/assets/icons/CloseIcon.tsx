// Cross — discards a record outright, so it carries the destructive tint from
// whichever button holds it rather than owning a colour itself.

export function CloseIcon({
  size = 15,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true' {...props}>
      <path d='M6 6l12 12M18 6L6 18' stroke='currentColor' strokeWidth={2} strokeLinecap='round' />
    </svg>
  );
}
