// Shared furniture for the settings panel: the row layout both tabs are built
// from, the section label above a group, and the compact select styling that
// keeps the controls in the app's language rather than the library's default.

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { actionButton } from "../ui/action-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlideToConfirm } from "@/components/ui/slide-to-confirm";
import { Callout } from "@/components/ui/callout";
import { useScrollIntoViewWhen } from "../../hooks/useScrollIntoViewWhen";
import { InfoDot } from "../shared/InfoDot";
import type { Severity } from "../ui/severity-icon";

/** Compact select trigger in the app's language (mono, hairline, small). */
export const triggerClass =
  "font-mono tabular-nums inline-flex h-7 items-center justify-between gap-1.5 rounded-lg border border-hairline bg-transparent px-2.5 text-xs text-foreground shadow-none outline-none hover:border-input data-[placeholder]:text-muted-foreground [&>svg]:size-3 [&>svg]:opacity-60";
export const selectContentClass = "min-w-[7rem] rounded-lg border-hairline";
export const selectItemClass = "text-xs py-1.5";

/** One settings row: label block on the left, control(s) pinned right, never
 *  wrapping. `note` is an outcome line that spans the full width underneath.
 *  `info` puts the ⓘ beside the title. */
export function SettingRow({
  title,
  info,
  infoSeverity,
  caption,
  note,
  children,
}: {
  title: string;
  info?: string;
  infoSeverity?: Severity;
  caption?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-settings-row className='py-[11px]'>
      <div className='flex items-center justify-between gap-5'>
        <div className='min-w-0'>
          <span className='flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground'>
            {title}
            {info && <InfoDot tip={info} severity={infoSeverity} />}
          </span>
          {caption && (
            <span className='mt-px block text-[12px] text-muted-foreground'>{caption}</span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>{children}</div>
      </div>
      {note && <div className='mt-1.5 text-[12px] text-muted-foreground'>{note}</div>}
    </div>
  );
}

/** Small caps heading over a group of rows (Maintenance, Networks, Mesh nodes). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-section-label
      className='mt-4 mb-0.5 font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase'
    >
      {children}
    </div>
  );
}

/**
 * A section that stays folded until asked for.
 *
 * For settings that are correct by default and only wanted by the few people the
 * default fails. Folded, it reads as one line the eye skips; a curious click is
 * what it costs to see it, which is the right price for a control that can stop
 * the app finding the hardware.
 */
export function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div data-collapsible-section className='mt-4'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className='flex w-full items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.11em] text-muted-foreground uppercase transition-colors hover:text-foreground'
      >
        <ChevronRightIcon
          className={`size-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        {title}
      </button>
      {open && <div className='mt-0.5'>{children}</div>}
    </div>
  );
}

/** Destructive action with an armed confirm. Pass `slideLabel` when the cost is real
 *  downtime rather than a recoverable reset. */
export function DangerAction({
  title,
  caption,
  buttonLabel,
  confirmLabel,
  slideLabel,
  warning,
  disabled = false,
  onRun,
}: {
  title: string;
  caption: string;
  buttonLabel: string;
  confirmLabel: string;
  slideLabel?: string;
  warning?: string;
  /** Shown but not runnable, for an action whose device is not answering. */
  disabled?: boolean;
  onRun: () => Promise<string>;
}) {
  const [armed, setArmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const armedRef = useScrollIntoViewWhen<HTMLDivElement>(armed);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await onRun());
    } catch (error) {
      setResult(`Failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      setArmed(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <SettingRow
        title={title}
        caption={caption}
        note={
          <>
            {armed && slideLabel && (
              <div ref={armedRef} className='flex flex-col gap-2 pt-1 pb-0.5'>
                <SlideToConfirm
                  label={slideLabel}
                  busyLabel={busy ? "Sending…" : "Confirm to continue"}
                  tone='danger'
                  busy={confirming || busy}
                  onConfirm={() => setConfirming(true)}
                />
                {warning && (
                  <Callout tone='error' icon='warning'>
                    {warning}
                  </Callout>
                )}
              </div>
            )}
            {result && (
              <span role='status' className='block'>
                {result}
              </span>
            )}
          </>
        }
      >
        {!armed ? (
          <button
            className={actionButton("subtle")}
            disabled={disabled}
            onClick={() => setArmed(true)}
          >
            {buttonLabel}
          </button>
        ) : (
          <>
            {!slideLabel && (
              <button className={actionButton("danger")} disabled={busy} onClick={() => void run()}>
                {busy ? "Sending…" : confirmLabel}
              </button>
            )}
            <button
              className={actionButton("subtle")}
              disabled={busy}
              onClick={() => setArmed(false)}
            >
              Cancel
            </button>
          </>
        )}
      </SettingRow>

      <Dialog open={confirming} onOpenChange={(open) => !open && !busy && setConfirming(false)}>
        <DialogContent
          showCloseButton={false}
          className='glass-panel gap-3 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[19px] leading-snug'>Are you sure?</DialogTitle>
            <DialogDescription className='text-[13.5px] leading-relaxed'>
              {caption}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='mt-2 gap-2'>
            <Button
              variant='outline'
              className='cursor-pointer sm:min-w-28'
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              className='cursor-pointer sm:min-w-28'
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? "Sending…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
