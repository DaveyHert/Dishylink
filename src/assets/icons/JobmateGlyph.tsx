// Jobmate's own brand indigo rather than the theme's ink, the same in light and dark.
export const JOBMATE_INK = "oklch(0.4894 0.2298 275.42)";

/** Jobmate's glyph, cropped to its bounds, for setting beside the wordmark. */
export function JobmateGlyph(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox='9.4 4.3 16.21 26.2' fill={JOBMATE_INK} aria-hidden='true' {...props}>
      <path d='M15.2319 14.1725C14.9678 14.3012 14.7991 14.5779 14.7991 14.882V23.0336L19.1331 20.9215C19.6304 20.6791 20.2007 21.058 20.2007 21.631V28.1722C20.2007 28.7452 20.7709 29.1241 21.2683 28.8817L25.1694 26.9805C25.4335 26.8518 25.6023 26.5752 25.6023 26.2711V10.3484C25.6023 9.77546 25.032 9.39654 24.5346 9.6389L20.2007 11.751L15.2319 14.1725Z' />
      <path
        opacity={0.85}
        d='M9.82733 8.90787C9.56488 9.03722 9.39746 9.31299 9.39746 9.61591V25.6671L14.7991 23.0347V14.8831C14.7991 14.579 14.9678 14.3023 15.2319 14.1736L20.2006 11.7521V5.03102C20.2006 4.45661 19.6277 4.07772 19.1301 4.32299L9.82733 8.90787Z'
      />
      <path d='M14.7991 23.0342L9.39746 25.6666L13.4871 30.4882C13.9448 31.0279 14.7991 30.6899 14.7991 29.9692V23.0342Z' />
    </svg>
  );
}
