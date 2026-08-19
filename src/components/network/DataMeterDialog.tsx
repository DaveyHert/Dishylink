// One device's data allowance: what it has spent this cycle, when the cycle
// turns over, and where its internet is cut off.
//
// Every figure here belongs to the rule, not to the account. "Cycle ends in five
// days" is this rule's own period; the bar's full width is the allowance someone
// set for this device. The Starlink plan's own cap covers the whole connection
// and is a different measurement, so it is never the scale on this card.

import { useState } from "react";
import { Wifi } from "lucide-react";
import { countdownLeftMs } from "@core/dataMeter";
import type { DataMeter } from "../../hooks/useDataMeter";
import { useDeviceGroups } from "../../hooks/useDeviceGroups";
import { useCloudUsage } from "../../hooks/useCloudAccount";
import { useNow } from "../../hooks/useNow";
import { formatBytes } from "../../lib/format";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Callout } from "../ui/callout";
import { SpinLoader } from "../loaders/SpinLoader";
import { AllowanceFields, AllowanceModeToggle, AppliesToField } from "./allowanceFields";
import {
  billingDayOf,
  cycleLabel,
  endsAtLabel,
  endsIn,
  formatDuration,
  ringReading,
  splitDuration,
  timeLeft,
  useAllowanceDraft,
  type MemberCandidate,
} from "./allowanceTerms";

/** What a limit covering several devices is called. There is no name to type, so
 *  it is built from the devices it covers — which is what it is. */
function groupNameFor(memberKeys: readonly string[], candidates: MemberCandidate[]): string {
  const named = memberKeys.map(
    (key) => candidates.find((candidate) => candidate.clientKey === key)?.name ?? `device ${key}`,
  );
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named[0]} and ${named.length - 1} others`;
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function DataMeterDialog({
  meter,
  clientKey,
  deviceName,
  candidates,
  open,
  onOpenChange,
}: {
  meter: DataMeter;
  /** The device this card is for, and the one member a group always keeps. */
  clientKey: string;
  deviceName: string;
  /**
   * Every device a limit could be extended to.
   *
   * The odometer's roster rather than the router's live one: a rule on a device
   * that is away still rolls its cycle and still releases its pause, so being
   * offline is a tag on the row, never a reason it cannot be picked.
   */
  candidates: MemberCandidate[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const showForm = editing || (meter.rule === null && !meter.loading);
  const withSelf = candidates.some((candidate) => candidate.clientKey === clientKey)
    ? candidates
    : [{ clientKey, name: deviceName, active: true, lastSeenMs: 0 }, ...candidates];
  const setOpen = (next: boolean) => {
    if (!next) setEditing(false);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className='gap-0 rounded-xl border border-border/50 bg-surface-raised text-ink shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] sm:max-w-lg dark:bg-[color-mix(in_srgb,#0e0e0e_80%,transparent)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
        showCloseButton={false}
      >
        {showForm ? (
          <MeterForm
            // The stored rule is the form's opening value, so the form is remounted
            // when a different one arrives rather than being written into by an
            // effect. Keyed on the rule's identity and not its usage, so the poll's
            // fresh figure every ten seconds never discards what is being typed.
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
      </DialogContent>
    </Dialog>
  );
}

const NEARING_LIMIT = 0.9;

function UsageRing({ spent, paused }: { spent: number; paused: boolean }) {
  const radius = 71;
  const circumference = 2 * Math.PI * radius;
  const stroke =
    paused || spent >= 1
      ? "var(--status-critical)"
      : spent >= NEARING_LIMIT
        ? "var(--accent)"
        : "var(--series-down)";
  return (
    <svg
      width='168'
      height='168'
      viewBox='0 0 168 168'
      aria-hidden='true'
      className='overflow-visible'
    >
      <circle
        cx='84'
        cy='84'
        r={radius}
        fill='none'
        strokeWidth='12'
        stroke='color-mix(in srgb, var(--ink) 12%, transparent)'
      />
      <circle
        cx='84'
        cy='84'
        r={radius}
        fill='none'
        strokeWidth='12'
        strokeLinecap='round'
        stroke={stroke}
        strokeDasharray={`${circumference * spent} ${circumference}`}
        transform='rotate(-90 84 84)'
      />
    </svg>
  );
}

/** Hours and minutes with their units set down in size, so the figure reads as a
 *  number first and the units never crowd it. */
function CountdownReading({ leftMs }: { leftMs: number }) {
  const { hours, minutes } = splitDuration(leftMs);
  return (
    <span className='flex items-baseline gap-1.5 text-[34px] leading-none font-extrabold tabular-nums text-foreground'>
      {hours > 0 && (
        <span className='flex items-baseline'>
          {hours}
          <span className='text-[17px] font-bold'>h</span>
        </span>
      )}
      <span className='flex items-baseline'>
        {minutes}
        <span className='text-[17px] font-bold'>m</span>
      </span>
    </span>
  );
}

function MeterStatus({
  meter,
  deviceName,
  onEdit,
  onClose,
}: {
  meter: DataMeter;
  deviceName: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  // A countdown is watched as it runs; an allowance only ever reads in hours.
  const nowMs = useNow(meter.rule?.countdownMs === undefined ? 60_000 : 1_000);
  const rule = meter.rule;
  if (!rule) return null;

  const used = rule.usageBytes;
  const allowance = rule.allocationBytes;
  const remaining = Math.max(0, allowance - used);
  const paused = rule.pauseState === "applied";
  const resets = endsIn(rule.periodEndMs, nowMs);
  const timing = rule.countdownMs !== undefined;
  const leftMs = countdownLeftMs(rule, nowMs) ?? 0;
  // A countdown fills its ring on the clock; an allowance fills it on what it has
  // spent. Both read as how much of the rule is gone.
  const spent = timing
    ? 1 - leftMs / rule.countdownMs!
    : allowance > 0
      ? Math.min(1, used / allowance)
      : 0;
  // A countdown draws its own hours and minutes; only a byte figure is one string.
  const bytesReading = timing ? null : ringReading(used);

  return (
    <>
      <DialogHeader className='pb-4'>
        <DialogTitle className='text-[19px] leading-snug'>
          {timing ? "Timer" : "Data limit"}
        </DialogTitle>
        <DialogDescription className='text-[13px]'>
          {rule.groupName ? `${deviceName} · shared with others` : deviceName}
        </DialogDescription>
      </DialogHeader>

      <div className='space-y-5 py-5'>
        <div className='relative grid place-items-center'>
          <UsageRing spent={spent} paused={paused} />
          <div className='absolute grid place-items-center text-center'>
            {paused ? (
              <span className='flex flex-col items-center gap-2 text-foreground/60 [animation:paused-pulse_2.4s_ease-in-out_infinite]'>
                <Wifi className='size-9' strokeWidth={2} />
                <span className='text-[17px] font-semibold tracking-wide'>PAUSED</span>
              </span>
            ) : (
              <>
                {bytesReading ? (
                  <span className='text-[34px] leading-none font-extrabold tabular-nums text-foreground'>
                    {bytesReading.value}
                  </span>
                ) : (
                  <CountdownReading leftMs={leftMs} />
                )}
                <span className='mt-1.5 text-[11.5px] tracking-wide text-muted-foreground'>
                  {bytesReading?.unit ?? "LEFT"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className='text-center text-[15px] text-muted-foreground'>
          {timing ? (
            <>
              of a{" "}
              <span className='font-semibold text-foreground'>
                {formatDuration(rule.countdownMs!)}
              </span>{" "}
              timer
            </>
          ) : (
            <>
              of <span className='font-semibold text-foreground'>{formatBytes(allowance)}</span>{" "}
              allowance
            </>
          )}
        </div>

        {paused && (
          <Callout tone='error'>
            {timing
              ? `${deviceName}’s ${formatDuration(rule.countdownMs!)} timer is up, so its internet is paused until you start it over.`
              : `${deviceName} reached its ${formatBytes(allowance)} allowance, so its internet is paused${resets ? ` until the cycle ${resets.replace(/^ends/, "resets")}` : ""}.`}
          </Callout>
        )}

        <div className='grid grid-cols-3 gap-3 border-t border-border/60 pt-4'>
          <div>
            <div className='text-[12px] text-muted-foreground'>
              {timing ? "Time left" : "Remaining"}
            </div>
            <div
              className={`text-[16px] font-semibold tabular-nums ${(timing ? leftMs <= 0 : remaining <= 0) ? "text-destructive" : "text-foreground"}`}
            >
              {timing ? formatDuration(leftMs) : formatBytes(remaining)}
            </div>
          </div>
          <div className='text-center'>
            <div className='text-[12px] text-muted-foreground'>
              {timing ? "Pauses at" : "Resets in"}
            </div>
            <div className='text-[16px] font-semibold text-foreground'>
              {timing
                ? leftMs > 0
                  ? endsAtLabel(leftMs, nowMs)
                  : "now"
                : (timeLeft(rule.periodEndMs, nowMs) ?? "never")}
            </div>
          </div>
          <div className='text-right'>
            <div className='text-[12px] text-muted-foreground'>{timing ? "Set for" : "Cycle"}</div>
            <div className='text-[16px] font-semibold text-foreground'>
              {timing ? formatDuration(rule.countdownMs!) : cycleLabel(rule.cycle)}
            </div>
          </div>
        </div>

        {!timing && (
          <p className='text-center text-[12px] font-medium text-muted-foreground'>
            Only data used while Dishylink is running is counted.
          </p>
        )}
        {!rule.autoPause && (
          <Callout tone='info'>
            Auto-pause is off, so this {timing ? "timer" : "allowance"} is watched and announced but
            never enforced.
          </Callout>
        )}
        {rule.pauseState === "failed" && rule.reached && (
          <Callout tone='error'>
            This device reached its limit, but the pause could not be sent to Starlink.
            {rule.pauseError ? ` ${rule.pauseError}.` : ""} It is retried every minute.
          </Callout>
        )}
        {meter.error && <Callout tone='error'>{meter.error}</Callout>}
      </div>

      <div className='space-y-4 border-t border-border/60 pt-4'>
        {rule.groupName && (
          <Callout tone='info'>
            This limit covers {rule.groupName}
            {rule.sharedAllowance ? ", which share it between them" : ", each with their own"}.
            Editing it here changes it for all of them.
          </Callout>
        )}
        {rule.autoPause && !paused && !rule.groupName && (
          <Callout tone='info'>
            Device data will automatically pause when usage reaches this limit.
          </Callout>
        )}
        <DialogFooter className='flex-row items-center justify-end gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={onClose}>
            Close
          </Button>
          <Button className='cursor-pointer' onClick={onEdit}>
            Edit limit
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}

function MeterForm({
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
  const { rule, pauseEnforceable, error, save, restart, remove, reload } = meter;
  const { data: usage } = useCloudUsage(true);
  const groups = useDeviceGroups();
  const billingDay = billingDayOf(usage?.content?.billingCyclesAnnotated);
  const [busy, setBusy] = useState(false);
  // Until the groups have been read, this device's membership is unknown. Saving
  // against that guess would write a device rule over a group's terms, which the
  // next projection silently puts back.
  const membershipKnown = !groups.loading;
  const heldBy = groups.groups.find((group) => group.memberKeys.includes(clientKey));
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
  const { allocationBytes, autoPause, setAutoPause, timer, countdownMs } = draft;
  const used = rule?.usageBytes ?? 0;
  const remaining = allocationBytes - used;
  const spent = allocationBytes > 0 ? Math.min(1, used / allocationBytes) : 0;
  const willPauseOnSave =
    autoPause && rule !== null && allocationBytes > 0 && used >= allocationBytes;

  const apply = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
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
    const terms = {
      allocationBytes,
      autoPause,
      cycle: draft.cycle,
      countdownMs,
    };
    if (members.length > 1 || heldBy) {
      await groups.save({
        ...terms,
        groupId: heldBy?.groupId,
        name: heldBy?.name ?? groupNameFor(members, candidates),
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
            <DialogTitle className='text-[19px] leading-snug'>
              {timer ? "Timer" : "Data limit"}
            </DialogTitle>
            <DialogDescription className='text-[13px]'>
              {timer
                ? `Pause “${deviceName}” once the time is up.`
                : `Pause “${deviceName}” once it has used its share.`}
            </DialogDescription>
          </div>
          <AllowanceModeToggle draft={draft} />
        </div>
      </DialogHeader>

      <div className='space-y-5 border-t border-border/60 py-5'>
        <div className={timer ? "hidden" : undefined}>
          <div className='flex items-baseline justify-between'>
            <span className='text-[13px] font-medium text-foreground'>This cycle</span>
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
                ? (endsIn(rule.periodEndMs, nowMs) ?? "Does not reset on its own")
                : "No limit set yet"}
            </span>
            {rule && allocationBytes > 0 && (
              <span className={remaining <= 0 ? "text-destructive" : undefined}>
                {formatBytes(Math.max(0, remaining))} left
              </span>
            )}
          </div>
        </div>

        <div className='flex items-start justify-between gap-4'>
          <div>
            <div className='text-[13px] font-medium text-foreground'>Auto-pause data</div>
            <div className='text-[12px] text-muted-foreground'>
              {members.length > 1
                ? timer
                  ? "Cuts their internet when the time is up."
                  : "Cuts their internet until the cycle turns over."
                : timer
                  ? "Cuts this device’s internet when the time is up."
                  : "Cuts this device’s internet until the cycle turns over."}
            </div>
          </div>
          <Switch checked={autoPause} onCheckedChange={setAutoPause} />
        </div>

        <AllowanceFields draft={draft} />

        {membershipKnown && (
          <AppliesToField
            candidates={candidates}
            selected={members}
            onToggle={toggleMember}
            shared={sharing}
            onSharedChange={setShared}
            timer={timer}
          />
        )}

        {timer && countdownMs !== undefined && countdownMs > 0 && (
          <Callout tone='info'>
            Runs for {formatDuration(countdownMs)} from when you save, pausing this device at about{" "}
            {endsAtLabel(countdownMs, nowMs)}. Editing the duration starts it over.
          </Callout>
        )}
        {!timer && willPauseOnSave && (
          <Callout tone='error'>
            This device has already used more than that, so saving pauses it straight away.
          </Callout>
        )}
        {autoPause &&
          (pauseEnforceable ? (
            <Callout tone='info'>
              Auto-pausing requires your Starlink account to be signed in. It works whether or not
              this computer is on the same network as the router.
            </Callout>
          ) : (
            <Callout tone='error'>
              Connect your Starlink account for Dishylink to pause a device on its own. Until then
              the limit is watched and announced, but nothing is paused.
            </Callout>
          ))}
        {rule?.pauseState === "failed" && rule.reached && (
          <Callout tone='error'>
            This device reached its limit, but the pause could not be sent to Starlink.
            {rule.pauseError ? ` ${rule.pauseError}.` : ""} It is retried every minute.
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
                Start over
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='cursor-pointer text-destructive hover:text-destructive'
                disabled={busy}
                onClick={() =>
                  void apply(async () => {
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
                {heldBy && heldBy.memberKeys.length > 1 ? "Remove for all" : "Remove"}
              </Button>
            </>
          )}
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' className='cursor-pointer' onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className='cursor-pointer'
            disabled={busy || !membershipKnown || (timer ? !countdownMs : allocationBytes <= 0)}
            onClick={() =>
              void apply(async () => {
                await persist();
                onSaved();
              })
            }
          >
            {timer ? "Start timer" : members.length > 1 ? "Save limit for all" : "Save limit"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
