// Writing a rule from the Rules list: its name, its devices, and what it
// measures. An allowance and a schedule are separate fields rather than a
// choice, because a rule can hold both and the stricter one decides.

import { useState } from "react";
import { useCloudUsage } from "../../../hooks/useCloudAccount";
import { removeDeviceRule, restartRule, saveDeviceRule } from "../../../hooks/useDataMeter";
import { useDeviceGroups } from "../../../hooks/useDeviceGroups";
import { useNow } from "../../../hooks/useNow";
import type { Rule } from "../../../hooks/useRules";
import { Button } from "../../ui/button";
import { Callout } from "../../ui/callout";
import { Input } from "../../ui/input";
import { SpinLoader } from "../../loaders/SpinLoader";
import { DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { AppliesToField, RuleModesInfo, RuleModeToggle } from "./allowanceFields";
import {
  autoPauseDetail,
  billingDayOf,
  ruleTerms,
  useAllowanceDraft,
  useRuleModeDraft,
  type MemberCandidate,
} from "./allowanceTerms";
import { MeasureFields, RuleDialogShell, SwitchRow } from "./ruleFormBlocks";
import { useScheduleDraft } from "./scheduleTerms";

export function RuleDialog({
  rule,
  candidates,
  open,
  onOpenChange,
  onSaved,
}: {
  /** The rule being changed, or undefined to write a new one. */
  rule?: Rule;
  candidates: MemberCandidate[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [displayedRule, setDisplayedRule] = useState(rule);
  if (open && displayedRule !== rule) setDisplayedRule(rule);

  return (
    <RuleDialogShell open={open} onOpenChange={onOpenChange} described={false}>
      <RuleForm
        key={displayedRule?.id ?? "new"}
        rule={displayedRule}
        candidates={candidates}
        onCancel={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </RuleDialogShell>
  );
}

function RuleForm({
  rule,
  candidates,
  onCancel,
  onSaved,
}: {
  rule?: Rule;
  candidates: MemberCandidate[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const groups = useDeviceGroups();
  // A cycle written from a slow clock still lands on the right boundaries; only
  // a custom cycle reads this at all, and it reads a date.
  const nowMs = useNow(60_000);
  const { data: usage } = useCloudUsage(true);
  const billingDay = billingDayOf(usage?.content?.billingCyclesAnnotated);
  const [name, setName] = useState(rule?.name ?? "");
  const [members, setMembers] = useState<string[]>(rule?.memberKeys ?? []);
  const [shared, setShared] = useState(rule?.mode === "pooled");
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);

  const allowance = useAllowanceDraft({
    allocationBytes: rule?.allocationBytes,
    autoPause: rule?.autoPause,
    cycle: rule?.cycle,
    countdownMs: rule?.countdownMs,
    billingDay,
    startedMs: nowMs,
  });
  const timetable = useScheduleDraft(rule?.schedule);
  const rules = useRuleModeDraft(rule, allowance, timetable);

  // The device whose own rule this is, absent for a group's. Written back through
  // the device it names: as a group it would be a second rule beside the first,
  // anchored at today's counter and holding nothing the first one holds.
  const ownKey = rule && !rule.group ? rule.memberKeys[0] : undefined;
  const stillOneDevice = members.length === 1 && members[0] === ownKey;
  // A device's own rule is named after the device, and there is nowhere to keep a
  // different name until it covers more than one.
  const named = ownKey === undefined || !stillOneDevice;

  const ready = name.trim().length > 0 && members.length > 0 && rules.measuresSomething;

  const save = async () => {
    setPending("save");
    setError(null);
    try {
      const terms = ruleTerms(rules, allowance, timetable);
      if (ownKey !== undefined && stillOneDevice) await saveDeviceRule(ownKey, terms);
      else {
        // Widening it moves the rule into the group rather than leaving it there.
        if (ownKey !== undefined) await removeDeviceRule(ownKey);
        await groups.save({
          ...terms,
          groupId: rule?.group?.groupId,
          name: name.trim(),
          memberKeys: members,
          mode: shared ? "pooled" : "perMember",
        });
      }
      onSaved();
    } catch {
      setError("The recorder refused the change.");
    } finally {
      setPending(null);
    }
  };

  const startOver = () => {
    if (!rule) return;
    // Ahead of the write: the restarted rule carries a new period start, which
    // is the form's remount key.
    onSaved();
    void restartRule(
      rule.group ? { groupId: rule.group.groupId } : { clientKey: rule.memberKeys[0] },
    );
  };

  const deleteRule = async () => {
    if (!rule) return;
    setPending("delete");
    setError(null);
    try {
      if (rule.group) await groups.remove(rule.group.groupId);
      else await removeDeviceRule(rule.memberKeys[0]);
      onSaved();
    } catch {
      setError("The recorder refused the change.");
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <DialogHeader className='pb-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='space-y-1'>
            <DialogTitle className='flex items-center gap-1.5 text-[19px] leading-snug'>
              {rule ? "Edit rule" : "New rule"}
              <RuleModesInfo />
            </DialogTitle>
          </div>
          <RuleModeToggle mode={rules.mode} onChange={rules.chooseMode} />
        </div>
      </DialogHeader>

      <div className='space-y-5 border-t border-border/60 py-5'>
        <label className='block space-y-1.5'>
          <span className='text-[12px] font-medium text-foreground'>Name</span>
          <Input
            value={name}
            placeholder='Kids devices'
            disabled={!named}
            title={named ? undefined : "Named after the device it covers"}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <AppliesToField
          candidates={candidates}
          selected={members}
          onToggle={(clientKey) =>
            setMembers((held) =>
              held.includes(clientKey)
                ? held.filter((other) => other !== clientKey)
                : [...held, clientKey],
            )
          }
          shared={shared}
          onSharedChange={setShared}
          carriesAllowance={rules.carriesAllowance}
          timer={allowance.timer}
        />

        <SwitchRow
          title='Auto-pause'
          detail={autoPauseDetail(allowance.autoPause, rules.mode, members.length > 1)}
          checked={allowance.autoPause}
          onChange={allowance.setAutoPause}
        />

        <MeasureFields
          rules={rules}
          allowance={allowance}
          timetable={timetable}
          capDetail='Cap the data these devices use, on top of their hours.'
        />

        {!groups.loading && !groups.pauseEnforceable && allowance.autoPause && (
          <Callout tone='error'>
            Connect your Starlink account for Dishylink to pause a device on its own. Until then
            this rule is watched and announced, but nothing is paused.
          </Callout>
        )}
        {error && <Callout tone='error'>{error}</Callout>}
      </div>

      <DialogFooter className='flex-row items-center justify-between gap-2 border-t border-border/60 pt-4 sm:justify-between'>
        <div className='flex gap-2'>
          {rule && (
            <>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer'
                disabled={busy}
                onClick={startOver}
              >
                Start over
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer text-destructive hover:text-destructive'
                disabled={busy}
                onClick={() => void deleteRule()}
              >
                {pending === "delete" ? (
                  <SpinLoader variant='segment' size={14} label='Deleting' />
                ) : (
                  "Delete rule"
                )}
              </Button>
            </>
          )}
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={onCancel}>
            Cancel
          </Button>
          <Button className='cursor-pointer' disabled={busy || !ready} onClick={() => void save()}>
            {pending === "save" ? (
              <SpinLoader variant='segment' size={16} label='Saving' />
            ) : rule ? (
              "Save rule"
            ) : (
              "Create rule"
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
