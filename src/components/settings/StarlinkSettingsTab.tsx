// Dish configuration and maintenance — the Starlink half of the settings panel.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, InfoIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { Callout } from "@/components/ui/callout";
import { Loading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { actionButton } from "@/components/ui/action-button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DishClient, DishStatusJson, SnowMeltMode } from "@core/dishClient";
import type { useDishSettings } from "../../hooks/useDishSettings";
import { AccountRequiredError } from "../../lib/dishConfigUpdate";
import { errorText } from "../../lib/errorText";
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";
import {
  DangerAction,
  SectionLabel,
  SettingRow,
  selectContentClass,
  selectItemClass,
  triggerClass,
} from "./settingsChrome";
import {
  formatLocalMinutes,
  localMinutesToUtcMinutes,
  utcMinutesToLocalMinutes,
} from "./sleepSchedule";
import { useTimeLocale } from "../../hooks/useTimeLocale";
import { TimePicker } from "./TimePicker";
import { UPDATE_WINDOWS, updateWindowFor } from "./updateWindow";
import type { TranslationKey } from "../../i18n";

const SNOW_MELT_LABEL: Record<SnowMeltMode, TranslationKey> = {
  AUTO: "common.automatic",
  ALWAYS_ON: "common.alwaysOn",
  ALWAYS_OFF: "common.off",
};

const SNOW_MELT_DESCRIPTION: Record<SnowMeltMode, TranslationKey> = {
  AUTO: "settings.snowAutoDesc",
  ALWAYS_ON: "settings.snowAlwaysDesc",
  ALWAYS_OFF: "settings.snowOffDesc",
};

// The official app's wording for each reboot window (see updateWindow.ts),
// keyed by the hour the dish stores.
const UPDATE_WINDOW_COPY: Record<number, { label: TranslationKey; caption: TranslationKey }> = {
  3: { label: "settings.updateOvernight", caption: "settings.updateOvernightCaption" },
  9: { label: "settings.updateMorning", caption: "settings.updateMorningCaption" },
  15: { label: "settings.updateAfternoon", caption: "settings.updateAfternoonCaption" },
  21: { label: "settings.updateEvening", caption: "settings.updateEveningCaption" },
};

function SnowMeltOption({ mode }: { mode: SnowMeltMode }) {
  const { t } = useTranslation();
  return (
    <SelectPrimitive.Item
      value={mode}
      className={cn(
        selectItemClass,
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-12 pl-2 outline-hidden select-none focus:bg-accent focus:text-accent-foreground",
      )}
    >
      <span className='absolute right-2 flex items-center gap-1.5'>
        <SelectPrimitive.ItemIndicator className='flex size-3.5 items-center justify-center'>
          <CheckIcon className='size-4' />
        </SelectPrimitive.ItemIndicator>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className='flex size-3.5 shrink-0 items-center justify-center text-muted-foreground'
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <InfoIcon className='size-3.5' />
            </span>
          </TooltipTrigger>
          <TooltipContent side='left' className='max-w-56'>
            {t(SNOW_MELT_DESCRIPTION[mode])}
          </TooltipContent>
        </Tooltip>
      </span>
      <SelectPrimitive.ItemText>{t(SNOW_MELT_LABEL[mode])}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function StarlinkSettingsTab({
  settings,
  status,
  isMotorized,
  loadDish,
  onCopyDiagnostics,
}: {
  settings: ReturnType<typeof useDishSettings>;
  status: DishStatusJson | null;
  /** Mast-mounted hardware can stow; a fixed panel cannot. */
  isMotorized: boolean;
  loadDish: () => Promise<DishClient>;
  onCopyDiagnostics: () => Promise<"copied" | "failed">;
}) {
  const { t } = useTranslation();
  const timeLocale = useTimeLocale();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const config = settings.config;

  const sleepEnabled = Boolean(config?.powerSaveMode);
  const sleepStartLocal = utcMinutesToLocalMinutes(config?.powerSaveStartMinutes ?? 60);
  const sleepDurationMinutes = config?.powerSaveDurationMinutes ?? 360;
  const wakeLocal = (sleepStartLocal + sleepDurationMinutes) % 1440;
  const updateWindow = updateWindowFor(config?.swupdateRebootHour);

  // Every write is fire-and-forget with the failure swallowed: the hook already
  // surfaces `settings.error`, and a rejected promise here would be unhandled.
  const save = (patch: Parameters<typeof settings.save>[0]) =>
    void settings.save(patch).catch(() => {});

  return (
    <>
      {settings.loading && <Loading message={t("settings.readingDish")} />}
      {/* Same Callout the Router tab uses for its failures — the two tabs are
          siblings and their errors must not read as two different apps. */}
      {settings.error && (
        <Callout tone='error'>
          {settings.error instanceof AccountRequiredError ? (
            <AccountRequiredNotice />
          ) : (
            errorText(settings.error)
          )}
        </Callout>
      )}
      {config && (
        <>
          <SettingRow title={t("settings.snowMelt")} caption={t("settings.snowMeltDesc")}>
            <Select
              value={config.snowMeltMode ?? "AUTO"}
              disabled={settings.saving}
              onValueChange={(mode) => save({ snowMeltMode: mode as SnowMeltMode })}
            >
              <SelectTrigger className={triggerClass} style={{ width: 118 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                {(Object.keys(SNOW_MELT_LABEL) as SnowMeltMode[]).map((mode) => (
                  <SnowMeltOption key={mode} mode={mode} />
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            title={t("settings.sleepSchedule")}
            caption={
              sleepEnabled
                ? t("settings.sleepScheduleOn", {
                    sleep: formatLocalMinutes(sleepStartLocal, timeLocale),
                    wake: formatLocalMinutes(wakeLocal, timeLocale),
                  })
                : t("settings.sleepScheduleOff")
            }
          >
            <Switch
              checked={sleepEnabled}
              disabled={settings.saving}
              onCheckedChange={(enabled) =>
                save(
                  enabled
                    ? {
                        powerSaveMode: true,
                        powerSaveStartMinutes:
                          config.powerSaveStartMinutes ?? localMinutesToUtcMinutes(60),
                        powerSaveDurationMinutes: config.powerSaveDurationMinutes || 360,
                      }
                    : { powerSaveMode: false },
                )
              }
            />
          </SettingRow>
          {sleepEnabled && (
            <div className='flex items-center justify-end gap-2 pb-[8px]'>
              <span className='mt-px block text-[12px] text-muted-foreground'>
                {t("settings.sleepFrom")}
              </span>
              <TimePicker
                minutes={sleepStartLocal}
                disabled={settings.saving}
                onChange={(newStartLocal) =>
                  save({
                    powerSaveStartMinutes: localMinutesToUtcMinutes(newStartLocal),
                    powerSaveDurationMinutes: (wakeLocal - newStartLocal + 1440) % 1440 || 1440,
                  })
                }
              />
              <span className='mt-px block text-[12px] text-muted-foreground'>
                {t("settings.sleepTo")}
              </span>
              <TimePicker
                minutes={wakeLocal}
                disabled={settings.saving}
                onChange={(newWakeLocal) =>
                  save({
                    powerSaveDurationMinutes:
                      (newWakeLocal - sleepStartLocal + 1440) % 1440 || 1440,
                  })
                }
              />
            </div>
          )}

          {/* Four windows, not 24 hours: the dish reboots somewhere inside a
              six-hour band, which is why the official app offers exactly these
              and words them "around 3 AM · Between 12 AM and 6 AM". */}
          <SettingRow
            title={t("settings.softwareUpdates")}
            caption={t(UPDATE_WINDOW_COPY[updateWindow.hour].caption)}
          >
            <Select
              value={String(updateWindow.hour)}
              disabled={settings.saving}
              onValueChange={(hour) => save({ swupdateRebootHour: Number(hour) })}
            >
              <SelectTrigger className={triggerClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                {UPDATE_WINDOWS.map((window) => (
                  <SelectItem
                    key={window.hour}
                    value={String(window.hour)}
                    className={selectItemClass}
                  >
                    {t(UPDATE_WINDOW_COPY[window.hour].label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow title={t("settings.deferUpdates")} caption={t("settings.deferUpdatesDesc")}>
            <Switch
              checked={Boolean(config.swupdateThreeDayDeferralEnabled)}
              disabled={settings.saving}
              onCheckedChange={(enabled) => save({ swupdateThreeDayDeferralEnabled: enabled })}
            />
          </SettingRow>

          <SettingRow title={t("settings.debugData")} caption={t("settings.debugDataDesc")}>
            <button
              className={actionButton("subtle")}
              onClick={() => {
                void onCopyDiagnostics().then((outcome) => {
                  setCopyState(outcome);
                  window.setTimeout(() => setCopyState("idle"), 2500);
                });
              }}
            >
              {copyState === "copied"
                ? t("settings.copied")
                : copyState === "failed"
                  ? t("settings.copyFailed")
                  : t("settings.copy")}
            </button>
          </SettingRow>

          <SectionLabel>{t("settings.maintenance")}</SectionLabel>
          <DangerAction
            title={t("settings.resetObstruction")}
            caption={t("settings.resetObstructionDesc")}
            buttonLabel={t("settings.reset")}
            confirmLabel={t("settings.confirmResetMap")}
            onRun={async () => {
              await (await loadDish()).clearObstructionMap();
              return t("settings.resetObstructionSent");
            }}
          />
          <DangerAction
            title={t("settings.rebootStarlink")}
            caption={t("settings.rebootStarlinkDesc")}
            buttonLabel={t("settings.reboot")}
            slideLabel={t("settings.slideRebootDish")}
            confirmLabel={t("settings.rebootDish")}
            onRun={async () => {
              await (await loadDish()).reboot();
              return t("settings.rebootDishSent");
            }}
          />
          <DangerAction
            title={t("settings.factoryResetStarlink")}
            caption={t("settings.factoryResetStarlinkDesc")}
            buttonLabel={t("settings.factoryReset")}
            slideLabel={t("settings.slideFactoryResetDish")}
            confirmLabel={t("settings.factoryResetDish")}
            warning={t("settings.factoryResetDishWarning")}
            onRun={async () => {
              await (await loadDish()).dishFactoryReset();
              return t("settings.factoryResetDishSent");
            }}
          />
          {isMotorized && (
            <DangerAction
              title={status?.stowRequested ? t("settings.unstowDish") : t("settings.stowDish")}
              caption={
                status?.stowRequested ? t("settings.unstowDishDesc") : t("settings.stowDishDesc")
              }
              buttonLabel={status?.stowRequested ? t("settings.unstow") : t("settings.stow")}
              confirmLabel={
                status?.stowRequested ? t("settings.confirmUnstow") : t("settings.confirmStow")
              }
              onRun={async () => {
                await (await loadDish()).stow(Boolean(status?.stowRequested));
                return status?.stowRequested ? t("settings.unstowSent") : t("settings.stowSent");
              }}
            />
          )}
        </>
      )}
    </>
  );
}
