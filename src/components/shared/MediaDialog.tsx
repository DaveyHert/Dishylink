import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeftIcon } from "../../assets/icons/ChevronLeftIcon";

interface MediaDialogProps {
  /** Read by screen readers only: the media is the heading here. */
  title: string;
  onDismiss: () => void;
  /** Returns to whatever opened the media, beside the close button's mirror spot. */
  onBack?: () => void;
  children: ReactNode;
}

// Sized by the 16:9 media it hosts: as wide as the window allows, but no wider
// than keeps the player, the card above it and the frame's chrome (about 270px
// tall in all) inside the window's height.
const WIDTH = "w-[min(1100px,100%,calc((100dvh_-_270px)*16/9_+_64px))]";

export function MediaDialog({ title, onDismiss, onBack, children }: MediaDialogProps) {
  const { t } = useTranslation();
  const content = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onDismiss()}>
      <DialogPrimitive.Portal>
        <div
          aria-hidden
          className='pointer-events-none fixed inset-0 z-40 bg-[rgba(0,0,0,0.7)] backdrop-blur-[6px]'
        />
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 flex items-center justify-center px-5'>
          <DialogPrimitive.Content
            ref={content}
            data-slot='media-dialog'
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current?.focus();
            }}
            className={`relative flex max-h-[calc(100dvh-2.5rem)] ${WIDTH} flex-col overflow-hidden rounded-[28px] bg-card py-7 [box-shadow:0_28px_90px_rgba(0,0,0,0.55)] outline-none animate-[rise_260ms_cubic-bezier(0.22,1,0.36,1)_both]`}
          >
            <DialogPrimitive.Title className='sr-only'>{title}</DialogPrimitive.Title>
            {onBack && (
              <button
                type='button'
                onClick={onBack}
                aria-label={t("common.back")}
                className='absolute top-5 left-5 z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-secondary/60 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink'
              >
                <ChevronLeftIcon />
              </button>
            )}
            <DialogPrimitive.Close
              aria-label={t("prompts.dismiss")}
              className='absolute top-5 right-5 z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[13px] text-ink-secondary/60 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink'
            >
              ✕
            </DialogPrimitive.Close>
            <div className='thin-scroll min-h-0 overflow-y-auto px-8 pt-7'>{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
