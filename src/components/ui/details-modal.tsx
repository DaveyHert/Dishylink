// The app's drill-down modal: a top-aligned, scrollable overlay hosting a named view
// (Speed test, Alignment, Data usage, Network, Terminal) or a stat detail.
//

//
// Distinct from ui/dialog.tsx, which is the CENTERED dialog used by Settings.
//
// Built on Radix for the behaviour a modal has to get right and is easy to get
// wrong: focus trap, focus restore on close, body scroll lock, and dismissal keyed
// to where the pointer went DOWN — so a drag that merely ends on the backdrop
// (selecting a reading, dragging a scrubber) does not close the panel.
//
// Exact values are enforced by details-modal.test.tsx. @keyframes rise lives in index.css.

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon } from "../../assets/icons/ChevronLeftIcon";

const panel = cva(
  // [box-shadow:] rather than shadow-[]: the shadow utility composes with ring vars.
  "bg-card rounded-[18px] pt-5 px-[22px] pb-[22px] [box-shadow:0_24px_80px_rgba(0,0,0,0.45)] animate-[rise_240ms_ease_both] outline-none",
  {
    variants: {
      size: {
        default: "w-[min(680px,100%)]",
        wide: "w-[min(780px,100%)]",
        xl: "w-[min(920px,100%)]",
        xxl: "w-[min(1080px,100%)]",
      },
    },
    defaultVariants: { size: "default" },
  },
);

interface DetailsModalProps extends VariantProps<typeof panel> {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Set while the modal shows a drill-in: puts a back chevron beside the title,
   *  where the app keeps it, instead of a separate nav row in the body. */
  onBack?: () => void;
}

export function DetailsModal({ title, onClose, children, size, onBack }: DetailsModalProps) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        {/* The scrim, kept outside the scrolling Overlay: backdrop-filter is
            re-resolved every frame its subtree scrolls, and Chromium presents the
            frames where that has not finished. */}
        <div
          aria-hidden
          className='pointer-events-none fixed inset-0 z-40 bg-[rgba(0,0,0,0.55)] backdrop-blur-[5px]'
        />
        {/* Content nests inside Overlay (not Radix's usual sibling layout) so the
            backdrop stays the scroll container. */}
        <DialogPrimitive.Overlay
          data-slot='details-modal-overlay'
          className='thin-scroll fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-[6vh] pr-5 pb-10 pl-5'
        >
          <DialogPrimitive.Content
            data-slot='details-modal'
            className={cn(panel({ size }))}
            aria-describedby={undefined}
          >
            <div className='mb-1.5 flex items-center gap-2'>
              {onBack && (
                <button
                  className='-mr-0.5 inline-flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[999px] border-0 bg-none p-0 text-ink-secondary [transition:background_120ms_ease,color_120ms_ease] hover:bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] hover:text-ink'
                  onClick={onBack}
                  aria-label='Back'
                  type='button'
                >
                  <ChevronLeftIcon />
                </button>
              )}
              <DialogPrimitive.Title
                data-slot='details-modal-title'
                className='text-[19px] font-bold'
              >
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label='Close'
                className='ml-auto inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[999px] border-0 bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-[13px] text-ink-secondary hover:text-ink'
              >
                ✕
              </DialogPrimitive.Close>
            </div>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
