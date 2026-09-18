import { useRef, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

interface PromptDialogProps {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onLater: () => void;
  onNever: () => void;
}

export function PromptDialog({
  icon,
  title,
  body,
  children,
  actions,
  onLater,
  onNever,
}: PromptDialogProps) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onLater()}>
      <DialogPrimitive.Portal>
        {/* Outside Content: backdrop-filter re-resolves every frame its subtree moves. */}
        <div
          aria-hidden
          className='pointer-events-none fixed inset-0 z-40 bg-[rgba(0,0,0,0.6)] backdrop-blur-[6px]'
        />
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 flex items-center justify-center px-5'>
          <DialogPrimitive.Content
            ref={content}
            data-slot='prompt-dialog'
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current?.focus();
            }}
            className='relative w-[min(700px,100%)] overflow-hidden rounded-[28px] bg-card px-16 pt-16 pb-14 text-center [box-shadow:0_28px_90px_rgba(0,0,0,0.55)] outline-none animate-[rise_260ms_cubic-bezier(0.22,1,0.36,1)_both]'
          >
            <div
              aria-hidden
              className='pointer-events-none absolute -top-28 left-1/2 h-60 w-96 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.13),transparent)] blur-2xl'
            />

            <DialogPrimitive.Close
              aria-label='Dismiss'
              className='absolute top-5 right-5 inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[13px] text-ink-secondary/60 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink'
            >
              ✕
            </DialogPrimitive.Close>

            <div className='relative'>
              <div
                aria-hidden
                className='mx-auto mb-8 flex size-[88px] items-center justify-center rounded-[26px] bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface))] text-(--accent) [&_svg]:size-[42px]'
              >
                {icon}
              </div>

              <DialogPrimitive.Title className='text-[27px] leading-[1.2] font-bold tracking-tight text-ink'>
                {title}
              </DialogPrimitive.Title>
              <p className='mx-auto mt-3.5 max-w-[440px] text-[14.5px] leading-relaxed text-ink-secondary'>
                {body}
              </p>

              {children}

              <div className='mt-9 flex flex-col items-center gap-2.5'>{actions}</div>

              <div className='mt-5 flex flex-col items-center gap-2'>
                <button
                  type='button'
                  onClick={onLater}
                  className='cursor-pointer border-0 bg-transparent text-[13px] text-ink-secondary/80 transition-colors hover:text-ink'
                >
                  Maybe later
                </button>
                <button
                  type='button'
                  onClick={onNever}
                  className='cursor-pointer border-0 bg-transparent text-[12px] text-ink-secondary/45 transition-colors hover:text-ink-secondary'
                >
                  Don&rsquo;t ask again
                </button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
