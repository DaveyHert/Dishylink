// Shared furniture for the settings sheet: the row layout both tabs are built
// from, the section label above a group, and the compact select styling that
// keeps the controls in the app's language rather than the library's default.

import { useState } from "react";
import { actionButton } from "../ui/action-button";

/** Compact select trigger in the app's language (mono, hairline, small). */
export const triggerClass =
  "font-mono tabular-nums inline-flex h-7 items-center justify-between gap-1.5 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 text-xs text-foreground shadow-none outline-none hover:border-[var(--baseline)] data-[placeholder]:text-muted-foreground [&>svg]:size-3 [&>svg]:opacity-60";
export const selectContentClass = "min-w-[7rem] rounded-lg border-[var(--hairline)]";
export const selectItemClass = "text-xs py-1.5";

/** One settings row: label block on the left, control(s) pinned right, never
 *  wrapping. `note` is an outcome line that spans the full width underneath. */
export function SettingRow({
  title,
  caption,
  note,
  children,
}: {
  title: string;
  caption?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-settings-row className='py-[11px]'>
      <div className='flex items-center justify-between gap-5'>
        <div className='min-w-0'>
          <span className='block text-[13.5px] font-semibold text-foreground'>{title}</span>
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

/** Bordered mono chip — a band on a network row, an auth state on a mesh node. */
export function Chip({ children, tone }: { children: React.ReactNode; tone?: "critical" }) {
  return (
    <span
      className='rounded-[6px] border border-[var(--baseline)] px-[7px] py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-[color:var(--ink-secondary)] tabular-nums'
      style={tone === "critical" ? { color: "var(--status-critical)" } : undefined}
    >
      {children}
    </span>
  );
}

/** Destructive action with inline armed-confirm, using the app's buttons. */
export function DangerAction({
  title,
  caption,
  buttonLabel,
  confirmLabel,
  onRun,
}: {
  title: string;
  caption: string;
  buttonLabel: string;
  confirmLabel: string;
  onRun: () => Promise<string>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <SettingRow
      title={title}
      caption={caption}
      note={
        result && (
          <span role='status' className='block'>
            {result}
          </span>
        )
      }
    >
      {!armed ? (
        <button className={actionButton("subtle")} onClick={() => setArmed(true)}>
          {buttonLabel}
        </button>
      ) : (
        <>
          <button
            className={actionButton("danger")}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await onRun());
              } catch (error) {
                setResult(`Failed: ${(error as Error).message}`);
              } finally {
                setBusy(false);
                setArmed(false);
              }
            }}
          >
            {busy ? "Sending…" : confirmLabel}
          </button>
          <button className={actionButton("subtle")} disabled={busy} onClick={() => setArmed(false)}>
            Cancel
          </button>
        </>
      )}
    </SettingRow>
  );
}
