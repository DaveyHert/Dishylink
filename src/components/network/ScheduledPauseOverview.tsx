// The scheduled pauses already set, as rows with a quick on/off, above the
// device list.
//
// A schedule is a device group whose rule carries a timetable, so this reads the
// same store the Rules tab does rather than keeping a list of its own. Turning
// one off writes autoPause=false: the timetable stays, the devices stay in it,
// and nothing is paused — which is what "off" means for a schedule that has
// nothing else to enforce.
//
// Phase 3 — UX: a schedule can be inspected and switched off without opening the
// Rules tab, and the row says who it covers and when.

import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { clockLabel, daysLabel } from "./rules/scheduleTerms";
import { useTimeLocale } from "../../hooks/useTimeLocale";
import type { DeviceGroups } from "../../hooks/useDeviceGroups";
import type { DeviceGroup } from "@core/deviceGroup";

export function ScheduledPauseOverview({ deviceGroups }: { deviceGroups: DeviceGroups }) {
  const { t } = useTranslation();
  const timeLocale = useTimeLocale();

  const scheduled = deviceGroups.groups.filter((group) => group.schedule !== undefined);
  if (scheduled.length === 0) return null;

  const setEnabled = (group: DeviceGroup, autoPause: boolean) =>
    void deviceGroups.save({
      groupId: group.groupId,
      name: group.name,
      memberKeys: group.memberKeys,
      allocationBytes: group.allocationBytes,
      autoPause,
      cycle: group.cycle,
      mode: group.mode,
      countdownMs: group.countdownMs,
      schedule: group.schedule,
    });

  return (
    <div className='mb-3 space-y-1.5'>
      <div className='text-[11.5px] font-medium text-muted-foreground'>
        {t("pauseAll.overviewTitle")}
      </div>
      {scheduled.map((group) => {
        const window = group.schedule?.windows[0];
        const enabled = group.autoPause;
        return (
          <div
            key={group.groupId}
            className='flex items-center gap-3 rounded-lg bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] px-3 py-2'
          >
            <span className='flex min-w-0 flex-1 flex-col gap-px'>
              <span className='truncate text-[13px] font-semibold text-foreground'>
                {group.name}
              </span>
              <span className='truncate text-[11.5px] text-muted-foreground'>
                {window
                  ? `${daysLabel(window, t, timeLocale)} · ${clockLabel(
                      window.startMinute,
                      t,
                      timeLocale,
                    )} – ${clockLabel(window.endMinute, t, timeLocale)}`
                  : ""}
                {` · ${t("pauseAll.overviewDevices", { count: group.memberKeys.length })}`}
                {enabled ? "" : ` · ${t("pauseAll.overviewOff")}`}
              </span>
            </span>
            <Button
              variant='ghost'
              size='sm'
              className='shrink-0 cursor-pointer text-[12px]'
              onClick={() => setEnabled(group, !enabled)}
            >
              {enabled ? t("pauseAll.overviewDisable") : t("pauseAll.overviewEnable")}
            </Button>
            <button
              type='button'
              aria-label={t("pauseAll.overviewDelete")}
              className='grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-destructive'
              onClick={() => void deviceGroups.remove(group.groupId)}
            >
              <Trash2 className='size-3.5' />
            </button>
          </div>
        );
      })}
      {deviceGroups.error && <p className='text-[11.5px] text-destructive'>{deviceGroups.error}</p>}
    </div>
  );
}
