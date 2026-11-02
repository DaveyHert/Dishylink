// Setting a device's limit from its own card. Widening it to more devices moves
// the rule into a group rather than leaving a second rule on the device.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { groupsForDevice } from "@core/deviceGroup";
import { removeDeviceRule, type DataMeter } from "../../../hooks/useDataMeter";
import { useDeviceGroups } from "../../../hooks/useDeviceGroups";
import { useCloudUsage } from "../../../hooks/useCloudAccount";
import { useNow } from "../../../hooks/useNow";
import { formatBytes } from "../../../lib/format";
import { Button } from "../../ui/button";
import { Callout } from "../../ui/callout";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { SpinLoader } from "../../loaders/SpinLoader";
import { AppliesToField, RuleModesInfo, RuleModeToggle } from "./allowanceFields";
import {
  autoPauseDetail,
  billingDayOf,
  endsIn,
  ruleTerms,
  useAllowanceDraft,
  useRuleModeDraft,
  type MemberCandidate,
} from "./allowanceTerms";
import { MeasureFields, SwitchRow } from "./ruleFormBlocks";
import { useScheduleDraft } from "./scheduleTerms";

/** What a limit covering several devices is called, built from the devices it
 *  covers since there is no name to type. */
function groupNameFor(
  memberKeys: readonly string[],
  candidates: MemberCandidate[],
  t: TFunction,
): string {
  const named = memberKeys.map(
    (key) =>
      candidates.find((candidate) => candidate.clientKey === key)?.name ??
      t("rules.deviceFallback", { key }),
  );
  if (named.length <= 1) return named[0] ?? "";
  if (named.length === 2) return t("rules.groupNameTwo", { first: named[0], second: named[1] });
  return t("rules.groupNameMany", { first: named[0], count: named.length - 1 });
}

export function MeterForm({
  meter,
  clientKey,
  deviceName,
  candidates,
  onOpenChange,
  onCancel,
  onSaved,
}: {
  meter: DataMeter;
  clientKey: string;
  deviceName: string;
  candidates: MemberCandidate[];
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { rule, pauseEnforceable, error, loading, save, restart, remove, reload } = meter;
  const { data: usage } = useCloudUsage(true);
  const groups = useDeviceGroups();
  const billingDay = billingDayOf(usage?.content?.billingCyclesAnnotated);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const busy = pending !== null;
  // Until the groups have been read, this device's membership is unknown. Saving
  // against that guess would write a device rule over a group's terms, which the
  // next projection silently puts back.
  const membershipKnown = !groups.loading;
  // The rule this form is editing decides which group it belongs to, so a device
  // in several is never edited through whichever happened to be read first.
  const covering = groupsForDevice(groups.groups, clientKey);
  const heldBy = covering.find((group) => group.groupId === rule?.groupId) ?? covering[0];
  // Seeded once. A group arriving on a later poll must not discard a selection
  // someone is part-way through making.
  const [memberKeys, setMemberKeys] = useState<string[] | null>(null);
  const [shared, setShared] = useState<boolean | null>(null);
  const members = memberKeys ?? heldBy?.memberKeys ?? [clientKey];
  // Each by default: it is the per-device rule the user already understands, run
  // once per member. Sharing one allowance is the choice they opt into.
  const sharing = shared ?? (heldBy ? heldBy.mode === "pooled" : false);
  // The countdown moves whether or not anything re-renders, and only ever reads
  // in hours, so a slow tick is enough.
  const nowMs = useNow(60_000);
  const draft = useAllowanceDraft({
    allocationBytes: rule?.allocationBytes,
    autoPause: rule?.autoPause,
    cycle: rule?.cycle,
    countdownMs: rule?.countdownMs,
    billingDay,
    startedMs: nowMs,
  });
  const { allocationBytes, autoPause, setAutoPause, timer } = draft;
  const timetable = useScheduleDraft(rule?.schedule);
  const rules = useRuleModeDraft(rule ?? undefined, draft, timetable);
  const { mode, capBytes } = rules;
  const several = members.length > 1;
  const used = rule?.usageBytes ?? 0;
  const remaining = capBytes - used;
  const spent = capBytes > 0 ? Math.min(1, used / capBytes) : 0;
  const willPauseOnSave = autoPause && rule !== null && capBytes > 0 && used >= capBytes;

  const apply = async (action: "save" | "delete", run: () => Promise<void>) => {
    setPending(action);
    try {
      await run();
    } finally {
      setPending(null);
    }
  };

  /** This device is never dropped: the limit is being set from its own card. */
  const toggleMember = (key: string) =>
    setMemberKeys(
      key === clientKey
        ? members
        : members.includes(key)
          ? members.filter((other) => other !== key)
          : [...members, key],
    );

  const persist = async () => {
    const terms = ruleTerms(rules, draft, timetable);
    if (several || heldBy) {
      // The device's own rule was what this form opened on, so widening it moves
      // it into the group rather than leaving it behind as a second rule holding
      // the same device against a limit nothing here still shows.
      if (!heldBy && rule !== null && rule.groupId === undefined) await removeDeviceRule(clientKey);
      await groups.save({
        ...terms,
        groupId: heldBy?.groupId,
        // The name is built from the devices, so it follows them — unless it has
        // since been named by hand, which is a name to keep.
        name:
          heldBy && heldBy.name !== groupNameFor(heldBy.memberKeys, candidates, t)
            ? heldBy.name
            : groupNameFor(members, candidates, t),
        memberKeys: members,
        mode: sharing ? "pooled" : "perMember",
      });
      // The rule this card draws is the group's, written by the group route.
      await reload();
      return;
    }
    await save(terms);
  };

  return (
    <>
      <DialogHeader className='pb-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='space-y-1'>
            <DialogTitle className='flex items-center gap-1.5 text-[19px] leading-snug'>
              {mode === "timer"
                ? t("rules.timer")
                : mode === "schedule"
                  ? t("rules.schedule")
                  : t("network.dataLimit")}
              <RuleModesInfo />
            </DialogTitle>
            <DialogDescription className='text-[13px]'>
              {mode === "timer"
                ? t("rules.descTimer", { name: deviceName })
                : mode === "schedule"
                  ? t("rules.descSchedule", { name: deviceName })
                  : t("rules.descLimit", { name: deviceName })}
            </DialogDescription>
          </div>
          <RuleModeToggle mode={mode} onChange={rules.chooseMode} />
        </div>
      </DialogHeader>

      <div className='space-y-5 border-t border-border/60 py-5'>
        <div
          className={
            mode === "timer" || (mode === "schedule" && !rules.capping) ? "hidden" : undefined
          }
        >
          <div className='flex items-baseline justify-between'>
            <span className='text-[13px] font-medium text-foreground'>{t("rules.thisCycle")}</span>
            <span className='text-[13px] tabular-nums text-muted-foreground'>
              <span
                className={`font-semibold ${remaining <= 0 ? "text-destructive" : "text-foreground"}`}
              >
                {formatBytes(used)}
              </span>
              {allocationBytes > 0 && <> / {formatBytes(allocationBytes)}</>}
            </span>
          </div>
          <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'>
            <div
              className={`h-full rounded-full ${spent >= 1 ? "bg-destructive" : "bg-[color-mix(in_srgb,var(--ink)_78%,var(--baseline))]"}`}
              style={{ width: `${spent * 100}%` }}
            />
          </div>
          <div className='mt-1.5 flex justify-between text-[11.5px] text-muted-foreground'>
            <span>
              {rule
                ? (endsIn(rule.periodEndMs, nowMs, t) ?? t("rules.noReset"))
                : t("rules.noLimitYet")}
            </span>
            {rule && allocationBytes > 0 && (
              <span className={remaining <= 0 ? "text-destructive" : undefined}>
                {t("rules.bytesLeft", { bytes: formatBytes(Math.max(0, remaining)) })}
              </span>
            )}
          </div>
        </div>

        <SwitchRow
          title={t("rules.autoPauseData")}
          detail={autoPauseDetail(autoPause, mode, several, t)}
          checked={autoPause}
          onChange={setAutoPause}
        />

        <MeasureFields
          rules={rules}
          allowance={draft}
          timetable={timetable}
          capDetail={several ? t("rules.capDetailSeveral") : t("rules.capDetailOne")}
        />

        {membershipKnown && (
          <AppliesToField
            candidates={candidates}
            selected={members}
            onToggle={toggleMember}
            shared={sharing}
            onSharedChange={setShared}
            carriesAllowance={rules.carriesAllowance}
            timer={timer}
          />
        )}

        {mode !== "timer" && willPauseOnSave && (
          <Callout tone='error'>{t("rules.alreadyUsed")}</Callout>
        )}
        {!loading &&
          autoPause &&
          (pauseEnforceable ? (
            <Callout tone='info'>{t("rules.autoPauseRequires")}</Callout>
          ) : (
            <Callout tone='error'>{t("rules.connectToPauseLimit")}</Callout>
          ))}
        {rule?.pauseState === "failed" && rule.reached && (
          <Callout tone='error'>
            {t("rules.pauseFailed")}
            {rule.pauseError ? ` ${rule.pauseError}.` : ""} {t("rules.pauseFailedRetry")}
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
                onClick={() => {
                  // Ahead of the write: the restarted rule carries a new period
                  // start, which is the form's remount key.
                  onSaved();
                  void restart();
                }}
              >
                {t("rules.startOver")}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer text-destructive hover:text-destructive'
                disabled={busy}
                onClick={() =>
                  void apply("delete", async () => {
                    // The card is showing the group's limit, so removing it takes
                    // the group rather than leaving the other members metered by
                    // something the user just deleted.
                    if (heldBy) {
                      await groups.remove(heldBy.groupId);
                      await reload();
                    } else await remove();
                    onOpenChange(false);
                  })
                }
              >
                {pending === "delete" ? (
                  <SpinLoader variant='segment' size={14} label={t("rules.deleting")} />
                ) : (
                  t("rules.deleteRule")
                )}
              </Button>
            </>
          )}
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            className='cursor-pointer'
            disabled={busy || !membershipKnown || !rules.measuresSomething}
            onClick={() =>
              void apply("save", async () => {
                await persist();
                onSaved();
              })
            }
          >
            {pending === "save" ? (
              <SpinLoader variant='segment' size={16} label={t("common.saving")} />
            ) : mode === "timer" ? (
              t("rules.startTimer")
            ) : several ? (
              t("rules.saveLimitAll")
            ) : (
              t("rules.saveLimit")
            )}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
