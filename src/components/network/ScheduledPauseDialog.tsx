// Quick "scheduled pause" dialog — shortcut for the most common parental-control
// pattern: "pause these devices every night from 10pm to 7am".
//
// Under the hood this writes a device-group rule with mode=block and a weekly
// schedule window covering every day. It reuses the same historian group API
// (`/api/clients/groups`) that the full RuleDialog uses, so the resulting rule
// appears on the Rules tab and can be edited or deleted from there.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import type { WifiClientJson } from "@core/dishClient";
import { usageKey } from "@core/clientUsage";
import { formatScheduleParam } from "@core/schedule";
import { displayName } from "./networkFormat";
import { apiRequest } from "../../lib/apiHost";
import { Button } from "../ui/button";
import { SpinLoader } from "../loaders/SpinLoader";
import { TimeOfDayField } from "../ui/time-of-day-field";
import { useTimeLocale } from "../../hooks/useTimeLocale";
import { clockLabel } from "./rules/scheduleTerms";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// Default: 10 pm to 7 am (block window)
const DEFAULT_START = 22 * 60; // 1320
const DEFAULT_END = 7 * 60; // 420

interface DeviceChoice {
  clientKey: string;
  label: string;
  selected: boolean;
}

export function ScheduledPauseDialog({
  devices,
  selfClientId,
  open,
  onOpenChange,
  onSaved,
}: {
  devices: WifiClientJson[];
  selfClientId: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const timeLocale = useTimeLocale();

  // Candidates: non-self devices that have a clientId
  const candidateKeys = devices
    .filter((d) => d.clientId !== undefined && d.clientId !== selfClientId)
    .map((d) => ({
      clientKey: usageKey(d.clientId, d.macAddress),
      label: displayName(d, t),
    }));

  const [choices, setChoices] = useState<DeviceChoice[]>([]);
  const [startMinute, setStartMinute] = useState(DEFAULT_START);
  const [endMinute, setEndMinute] = useState(DEFAULT_END);
  const [ruleName, setRuleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setChoices(candidateKeys.map((c) => ({ ...c, selected: true })));
    setStartMinute(DEFAULT_START);
    setEndMinute(DEFAULT_END);
    setRuleName(t("pauseAll.scheduledRuleDefaultName"));
    setError(null);
    onOpenChange(true);
  };

  const closeDialog = () => onOpenChange(false);

  const toggle = (key: string) =>
    setChoices((held) =>
      held.map((c) => (c.clientKey === key ? { ...c, selected: !c.selected } : c)),
    );

  const selectedKeys = choices.filter((c) => c.selected).map((c) => c.clientKey);

  const handleSave = async () => {
    if (selectedKeys.length === 0) {
      setError(t("pauseAll.scheduleNoDevices"));
      return;
    }
    const name = ruleName.trim() || t("pauseAll.scheduledRuleDefaultName");
    const schedule = formatScheduleParam({
      mode: "block",
      windows: [{ weekdays: EVERY_DAY, startMinute, endMinute }],
    });
    const query = new URLSearchParams({
      name,
      members: selectedKeys.join(","),
      allocation: "0",
      autoPause: "1",
      cycle: "daily",
      schedule,
    });
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest(`/api/clients/groups?${query.toString()}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message ?? t("rules.recorderRefused"));
    } finally {
      setSaving(false);
    }
  };

  const startLabel = clockLabel(startMinute, t, timeLocale);
  const endLabel = clockLabel(endMinute, t, timeLocale);

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

          {/* Rule name */}
          <div className='space-y-1'>
            <label className='text-[12px] font-medium text-muted-foreground'>
              {t("rules.name")}
            </label>
            <input
              type='text'
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder={t("pauseAll.scheduledRuleDefaultName")}
              className='w-full rounded-lg border border-border/60 bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary'
            />
          </div>

          {/* Time range */}
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
            {endMinute <= startMinute && (
              <p className='text-[11.5px] text-muted-foreground'>{t("rules.pastMidnight")}</p>
            )}
          </div>

          {/* Device picker */}
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
                {choices.map((c) => (
                  <label
                    key={c.clientKey}
                    className='flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
                  >
                    <input
                      type='checkbox'
                      checked={c.selected}
                      onChange={() => toggle(c.clientKey)}
                      className='size-3.5 accent-primary'
                    />
                    <span className='truncate text-foreground'>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className='text-[12px] text-destructive'>{error}</p>}

          <DialogFooter className='gap-2'>
            <Button variant='outline' className='cursor-pointer sm:min-w-24' onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              className='cursor-pointer sm:min-w-28'
              disabled={saving || selectedKeys.length === 0}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <SpinLoader variant='segment' size={14} label={t("common.savingEllipsis")} />
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
