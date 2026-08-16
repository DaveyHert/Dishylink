// Bracket tying a control to a field revealed beneath it — out from the upper
// control, down the channel beside them, back in to the lower one.

export function ConnectorThread({ ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox='0 0 8 45' fill='none' preserveAspectRatio='none' aria-hidden='true' {...props}>
      <path
        d='M0 0.5 H2 Q4 0.5 4 2.5 V42 Q4 44.5 2 44.5 H0'
        stroke='currentColor'
        strokeWidth={1}
        strokeLinecap='round'
        strokeDasharray='3 3'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  );
}
