// Two bars / a triangle — holds the dome's drift still, or sets it going again.
// The face shows what the press will do, so a turning dome offers "pause".

export function PauseIcon({
  size = 14,
  playing = true,
  ...props
}: React.ComponentProps<"svg"> & { size?: number; playing?: boolean }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true' {...props}>
      {playing ? (
        <>
          <rect x={4} y={3} width={2.5} height={10} rx={1} fill='currentColor' />
          <rect x={9.5} y={3} width={2.5} height={10} rx={1} fill='currentColor' />
        </>
      ) : (
        <path
          d='M5 3.4v9.2a.6.6 0 0 0 .93.5l7-4.6a.6.6 0 0 0 0-1l-7-4.6A.6.6 0 0 0 5 3.4z'
          fill='currentColor'
        />
      )}
    </svg>
  );
}
