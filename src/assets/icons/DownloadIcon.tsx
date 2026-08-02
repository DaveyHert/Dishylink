export function DownloadIcon({ size = 14, ...props }: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 256 256'
      fill='currentColor'
      aria-hidden='true'
      {...props}
    >
      <path d='M224,152v56a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V152a8,8,0,0,1,16,0v48H208V152a8,8,0,0,1,16,0ZM128,152a8,8,0,0,0,5.66-2.34l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32l40,40A8,8,0,0,0,128,152Z' />
    </svg>
  );
}
