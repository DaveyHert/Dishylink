// The pieces both rule forms are built from — the device card's and the Rules
// tab's — which differ only in the devices they open on and where they save.

import type { ReactNode } from "react";
import { Switch } from "../../ui/switch";
import { Dialog, DialogContent } from "../../ui/dialog";
import { AllowanceFields } from "./allowanceFields";
import type { AllowanceDraft, RuleModeDraft } from "./allowanceTerms";
import { ScheduleFields } from "./scheduleFields";
import type { ScheduleDraft } from "./scheduleTerms";

export function RuleDialogShell({
  open,
  onOpenChange,
  described = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False when the panel carries no DialogDescription, which Radix otherwise
   *  warns about. */
  described?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='thin-scroll max-h-[85vh] gap-0 overflow-y-auto rounded-xl border border-border/50 bg-surface-raised text-ink shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] sm:max-w-lg dark:bg-[color-mix(in_srgb,#0e0e0e_80%,transparent)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
        showCloseButton={false}
        {...(described ? {} : { "aria-describedby": undefined })}
        // Focus the panel, not the help icon it would otherwise land on, whose
        // tooltip opens on focus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function SwitchRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <div>
        <div className='text-[13px] font-medium text-foreground'>{title}</div>
        <div className='text-[12px] text-muted-foreground'>{detail}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** The fields for whichever of the three things this rule measures. A schedule is
 *  the only mode offering a second measure beside it: hours and an allowance
 *  answer different questions, and a rule is allowed to ask both. */
export function MeasureFields({
  rules,
  allowance,
  timetable,
  capDetail,
}: {
  rules: RuleModeDraft;
  allowance: AllowanceDraft;
  timetable: ScheduleDraft;
  capDetail: string;
}) {
  if (rules.mode !== "schedule") return <AllowanceFields draft={allowance} />;
  return (
    <>
      <ScheduleFields draft={timetable} />
      <div className='space-y-4 border-t border-border/60 pt-4'>
        <SwitchRow
          title='Data allowance'
          detail={capDetail}
          checked={rules.capping}
          onChange={rules.setCapping}
        />
        {rules.capping && <AllowanceFields draft={allowance} />}
      </div>
    </>
  );
}
