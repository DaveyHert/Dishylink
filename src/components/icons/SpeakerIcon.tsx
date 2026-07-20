// Speaker: sound waves when on, the bare cone when off. No extra markers —
// waves present or absent carry the state. Paints in currentColor like the
// other icons here.

export function SpeakerIcon({
  size = 14,
  on = true,
  ...props
}: React.ComponentProps<"svg"> & { size?: number; on?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinejoin='round'
      aria-hidden='true'
      {...props}
    >
      <path d='M11 5 L6 9 H2 v6 h4 l5 4 z' />
      {on && (
        <>
          <path d='M15.5 8.5a5 5 0 0 1 0 7' />
          <path d='M18.5 5.5a9.5 9.5 0 0 1 0 13' />
        </>
      )}
    </svg>
  );
}
