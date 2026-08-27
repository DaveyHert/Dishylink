// A device's limit, read or written. A device with no rule opens on the form.

import { useState } from "react";
import type { DataMeter } from "../../../hooks/useDataMeter";
import { DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { SpinLoader } from "../../loaders/SpinLoader";
import type { MemberCandidate } from "./allowanceTerms";
import { MeterForm } from "./MeterForm";
import { MeterStatus } from "./MeterStatus";
import { RuleDialogShell } from "./ruleFormBlocks";

export function DataMeterDialog({
  meter,
  clientKey,
  deviceName,
  macAddress,
  candidates,
  open,
  onOpenChange,
}: {
  meter: DataMeter;
  /** The device this card is for, and the one member a group always keeps. */
  clientKey: string;
  deviceName: string;
  macAddress: string;
  /** Every device a limit could be extended to. The odometer's roster, not the
   *  router's live one, so a device that is away can still be picked. */
  candidates: MemberCandidate[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const showForm = editing || (meter.rule === null && !meter.loading);
  const withSelf = candidates.some((candidate) => candidate.clientKey === clientKey)
    ? candidates
    : [{ clientKey, name: deviceName, macAddress, active: true, lastSeenMs: 0 }, ...candidates];
  const setOpen = (next: boolean) => {
    if (!next) setEditing(false);
    onOpenChange(next);
  };
  return (
    <RuleDialogShell open={open} onOpenChange={setOpen}>
      {showForm ? (
        <MeterForm
          // Keyed on the rule's identity, never its usage: the poll's fresh figure
          // every ten seconds would otherwise remount and discard what is being typed.
          key={meter.rule ? `${meter.rule.clientKey}:${meter.rule.periodStartMs}` : "unset"}
          meter={meter}
          clientKey={clientKey}
          deviceName={deviceName}
          candidates={withSelf}
          onOpenChange={setOpen}
          onCancel={editing ? () => setEditing(false) : () => setOpen(false)}
          onSaved={editing ? () => setEditing(false) : () => setOpen(false)}
        />
      ) : meter.rule ? (
        <MeterStatus
          meter={meter}
          deviceName={deviceName}
          onEdit={() => setEditing(true)}
          onClose={() => setOpen(false)}
        />
      ) : (
        <>
          <DialogHeader className='pb-4'>
            <DialogTitle className='text-[19px] leading-snug'>Data limit</DialogTitle>
            <DialogDescription className='text-[13px]'>{deviceName}</DialogDescription>
          </DialogHeader>
          <div className='grid min-h-[220px] place-items-center border-t border-border/60'>
            <SpinLoader size={36} />
          </div>
        </>
      )}
    </RuleDialogShell>
  );
}
