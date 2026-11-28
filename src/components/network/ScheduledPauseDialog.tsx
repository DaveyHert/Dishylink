// Quick "scheduled pause" dialog — the common parental-control pattern made one
// form: "pause these devices every night from 10pm to 7am".
//
// Under the hood this writes a device-group rule with mode=block and a weekly
// schedule window. It reuses the same historian group API (`/api/clients/groups`)
// that the full Rule dialog uses, so the resulting rule appears on the Rules tab
// and can be edited or deleted from there.
//
// Phase 2 — Scheduling:
//   - Weekday/weekend selection, by preset or day by day.
//   - Validation before the write: at least one day, and start ≠ end.
//   - Timezone named under the hour pickers, since the recorder evaluates the
//     window in this machine's local time.
//   - Duplicate detection: terms that match an existing schedule update that
//     schedule instead of creating a second one beside it.
//
// Phase 3 — UX:
//   - The dialog states plainly which schedule it will update, if any.
//   - Days and hours are summarised in the subtitle as they are chosen.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import type { WifiClientJson } from "@core/dishClient";
import type { DeviceGroup } from "@core/deviceGroup";
import { usageKey } from "@core/clientUsage";
import { displayName } from "./networkFormat";
import { apiRequest } from "../../lib/apiHost";
import { Button } from "../ui/button";
import { SpinLoader } from "../loaders/SpinLoader";
import { TimeOfDayField } from "../ui/time-of-day-field";
import { useTimeLocale } from "../../hooks/useTimeLocale";
import { weekdayNames } from "./rules/allowanceTerms";
import { clockLabel } from "./rules/scheduleTerms";
import {
  EVERY_DAY,
  WEEKDAYS,
  WEEKEND,
  dayPreset,
  findMatchingGroup,
  scheduledPause,
  validateSchedule,
  type DayPreset,
} from "./scheduledPauseTerms";
import { formatScheduleParam } from "@core/schedule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

// Default: 10pm to 7am every day — the arrangement most people reach for first.
const DEFAULT_START = 22 * 60;
const DEFAULT_END = 7 * 60;

interface DeviceChoice {
  clientKey: string;
  label: string;
  selected: boolean;
}

const PRESETS: { preset: Exclude<DayPreset, "custom">; days: number[] }[] = [
  { preset: "everyDay", days: EVERY_DAY },
  { preset: "weekdays", days: WEEKDAYS },
  { preset: "weekend", days: WEEKEND },
];

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local time";
  } catch {
    return "local time";
  }
}

export function ScheduledPauseDialog({
  devices,
  selfClientId,
  existingGroups,
  open,
  onOpenChange,
  onSaved,
}: {
  devices: WifiClientJson[];
  selfClientId: number | undefined;
  /** Schedules already on the recorder, to spot one these terms would twin. */
  existingGroups: readonly DeviceGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const timeLocale = useTimeLocale();
  const weekdayLabels = weekdayNames(i18n.language, "short");
  // Static map rather than a template-literal key: the catalog is type-checked,
  // so `pauseAll.schedulePreset.${preset}` would not resolve for "custom".
  const presetLabels = {
    everyDay: t("pauseAll.schedulePreset.everyDay"),
    weekdays: t("pauseAll.schedulePreset.weekdays"),
    weekend: t("pauseAll.schedulePreset.weekend"),
  };

  const candidates = devices
    .filter((device) => device.clientId !== undefined && device.clientId !== selfClientId)
    .map((device) => ({
      clientKey: usageKey(device.clientId, device.macAddress),
      label: displayName(device, t),
    }));

  const [choices, setChoices] = useState<DeviceChoice[]>([]);
  const [days, setDays] = useState<number[]>(EVERY_DAY);
  const [startMinute, setStartMinute] = useState(DEFAULT_START);
  const [endMinute, setEndMinute] = useState(DEFAULT_END);
  const [ruleName, setRuleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setChoices(candidates.map((candidate) => ({ ...candidate, selected: true })));
    setDays(EVERY_DAY);
    setStartMinute(DEFAULT_START);
    setEndMinute(DEFAULT_END);
    setRuleName(t("pauseAll.scheduledRuleDefaultName"));
    setError(null);
    onOpenChange(true);
  };

  const closeDialog = () => onOpenChange(false);

  const toggleDevice = (key: string) =>
    setChoices((held) =>
      held.map((choice) =>
        choice.clientKey === key ? { ...choice, selected: !choice.selected } : choice,
      ),
    );

  const toggleDay = (weekday: number) =>
    setDays((held) =>
      held.includes(weekday)
        ? held.filter((other) => other !== weekday)
        : [...held, weekday].sort(),
    );

  const selectedKeys = choices.filter((choice) => choice.selected).map((c) => c.clientKey);
  const terms = { days, startMinute, endMinute };

  // Recomputed as the form changes: what the write would update, if anything.
  const matchingGroup =
    selectedKeys.length > 0 ? findMatchingGroup(existingGroups, terms, selectedKeys) : undefined;

  const startLabel = clockLabel(startMinute, t, timeLocale);
  const endLabel = clockLabel(endMinute, t, timeLocale);
  const preset = dayPreset(days);

  const handleSave = async () => {
    if (selectedKeys.length === 0) {
      setError(t("pauseAll.scheduleNoDevices"));
      return;
    }
    const invalid = validateSchedule(terms);
    if (invalid === "noDays") {
      setError(t("pauseAll.scheduleNoDays"));
      return;
    }
    if (invalid === "sameTime") {
      setError(t("pauseAll.scheduleSameTime"));
      return;
    }

    const name = ruleName.trim() || t("pauseAll.scheduledRuleDefaultName");
    const query = new URLSearchParams({
      name,
      members: selectedKeys.join(","),
      allocation: "0",
      autoPause: "1",
      cycle: "daily",
      schedule: formatScheduleParam(scheduledPause(terms)),
      // Updating rather than creating is the whole point of the duplicate check.
      ...(matchingGroup ? { group: matchingGroup.groupId } : {}),
    });
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest(`/api/clients/groups?${query.toString()}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message ?? t("rules.recorderRefused"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant='secondary'
        size='sm'
        className='flex cursor-pointer items-center gap-1.5'
        onClick={openDialog}
      >
        <CalendarClock className='size-3.5' />
        {t("pauseAll.scheduleButton")}
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : closeDialog())}>
        <DialogContent
          showCloseButton
          className='glass-panel gap-4 sm:max-w-md'
          overlayClassName='bg-black/30 backdrop-blur-[2px]'
        >
          <DialogHeader>
            <DialogTitle className='text-[18px] leading-snug'>
              {t("pauseAll.scheduleTitle")}
            </DialogTitle>
            <DialogDescription className='text-[13px] leading-relaxed'>
              {t("pauseAll.scheduleSubtitle", { start: startLabel, end: endLabel })}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-1'>
            <label className='text-[12px] font-medium text-muted-foreground'>
              {t("rules.name")}
            </label>
            <input
              type='text'
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              placeholder={t("pauseAll.scheduledRuleDefaultName")}
              className='w-full rounded-lg border border-border/60 bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-primary focus:outline-none'
            />
          </div>

          {/* Days: presets first, then the individual weekdays. */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-[12px] font-medium text-muted-foreground'>
                {t("pauseAll.scheduleDays")}
              </span>
              <div className='flex items-center gap-0.5 text-[12px]'>
                {PRESETS.map(({ preset: value, days: presetDays }) => (
                  <button
                    key={value}
                    type='button'
                    aria-pressed={preset === value}
                    onClick={() => setDays(presetDays)}
                    className={`cursor-pointer rounded-md px-2 py-1 transition-colors ${
                      preset === value
                        ? "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] font-semibold text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {presetLabels[value]}
                  </button>
                ))}
              </div>
            </div>
            <div className='flex justify-center gap-1'>
              {weekdayLabels.map((label, weekday) => {
                const picked = days.includes(weekday);
                return (
                  <button
                    key={weekday}
                    type='button'
                    aria-pressed={picked}
                    onClick={() => toggleDay(weekday)}
                    className={`cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      picked
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {days.length === 0 && (
              <p className='text-[11.5px] text-destructive'>{t("pauseAll.scheduleNoDays")}</p>
            )}
          </div>

          {/* Hours, and the zone they are read in. */}
          <div className='space-y-2'>
            <div className='text-[12px] font-medium text-muted-foreground'>
              {t("pauseAll.scheduleBlockHours")}
            </div>
            <div className='flex flex-wrap items-center gap-x-5 gap-y-3'>
              <TimeOfDayField
                label={t("rules.from")}
                value={startMinute}
                onChange={setStartMinute}
              />
              <TimeOfDayField label={t("rules.to")} value={endMinute} onChange={setEndMinute} />
            </div>
            <p className='text-[11.5px] text-muted-foreground'>
              {endMinute === startMinute
                ? t("pauseAll.scheduleSameTime")
                : endMinute < startMinute
                  ? t("rules.pastMidnight")
                  : t("pauseAll.scheduleTimezone", { zone: localZone() })}
            </p>
          </div>

          {/* Devices. */}
          <div className='space-y-2'>
            <div className='text-[12px] font-medium text-muted-foreground'>
              {t("pauseAll.scheduleDevices")}
            </div>
            {choices.length === 0 ? (
              <p className='text-[12.5px] text-muted-foreground'>
                {t("pauseAll.scheduleNoDevicesAvailable")}
              </p>
            ) : (
              <div className='thin-scroll flex max-h-[180px] flex-col gap-1 overflow-y-auto'>
                {choices.map((choice) => (
                  <label
                    key={choice.clientKey}
                    className='flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
                  >
                    <input
                      type='checkbox'
                      checked={choice.selected}
                      onChange={() => toggleDevice(choice.clientKey)}
                      className='size-3.5 accent-primary'
                    />
                    <span className='truncate text-foreground'>{choice.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Says plainly that this will replace rather than twin an existing one. */}
          {matchingGroup && (
            <p className='rounded-md border border-border/60 bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-3 py-2 text-[12px] text-muted-foreground'>
              {t("pauseAll.scheduleDuplicate", { name: matchingGroup.name })}
            </p>
          )}

          {error && <p className='text-[12px] text-destructive'>{error}</p>}

          <DialogFooter className='gap-2'>
            <Button variant='outline' className='cursor-pointer sm:min-w-24' onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              className='cursor-pointer sm:min-w-28'
              disabled={saving || selectedKeys.length === 0 || days.length === 0}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <SpinLoader variant='segment' size={14} label={t("common.savingEllipsis")} />
              ) : matchingGroup ? (
                t("pauseAll.scheduleUpdate")
              ) : (
                t("pauseAll.scheduleCreate")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
