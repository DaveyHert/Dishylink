// Dish configuration and maintenance — the Starlink half of the settings panel.

import { useState } from "react";
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
import { AccountRequiredNotice } from "../shared/AccountRequiredNotice";
import {
  DangerAction,
  SectionLabel,
  SettingRow,
  selectContentClass,
  selectItemClass,
  triggerClass,
} from "./settingsChrome";
import { formatClock12, localMinutesToUtcMinutes, utcMinutesToLocalMinutes } from "./sleepSchedule";
import { TimePicker } from "./TimePicker";
import { UPDATE_WINDOWS, updateWindowFor } from "./updateWindow";

const SNOW_MELT_LABEL: Record<SnowMeltMode, string> = {
  AUTO: "Automatic",
  ALWAYS_ON: "Always on",
  ALWAYS_OFF: "Off",
};

const SNOW_MELT_DESCRIPTION: Record<SnowMeltMode, string> = {
  AUTO: "Automatically detect snow and heat up when needed.",
  ALWAYS_ON:
    "Keep warm to better resist snow build-up. This option may increase power consumption.",
  ALWAYS_OFF: "Never use extra power to melt snow.",
};

function SnowMeltOption({ mode }: { mode: SnowMeltMode }) {
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
            {SNOW_MELT_DESCRIPTION[mode]}
          </TooltipContent>
        </Tooltip>
      </span>
      <SelectPrimitive.ItemText>{SNOW_MELT_LABEL[mode]}</SelectPrimitive.ItemText>
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
      {settings.loading && <Loading message='Reading dish configuration…' />}
      {/* Same Callout the Router tab uses for its failures — the two tabs are
          siblings and their errors must not read as two different apps. */}
      {settings.error && (
        <Callout tone='error'>
          {settings.error instanceof AccountRequiredError ? (
            <AccountRequiredNotice />
          ) : (
            settings.error.message
          )}
        </Callout>
      )}
      {config && (
        <>
          <SettingRow
            title='Snow melt'
            caption="Heats the panel to shed snow. Auto uses the dish's own sensors."
          >
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
            title='Sleep schedule'
            caption={
              sleepEnabled
                ? `Dish powers down daily at ${formatClock12(sleepStartLocal)} and wakes at ${formatClock12(wakeLocal)}`
                : "Power the dish down for part of every day"
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
              <span className='mt-px block text-[12px] text-muted-foreground'>from</span>
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
              <span className='mt-px block text-[12px] text-muted-foreground'>to</span>
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
            title='Software updates'
            caption={`Update reboots happen ${updateWindow.range.toLowerCase()}`}
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
                    {window.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow title='Defer updates' caption='Hold firmware updates for up to 3 days'>
            <Switch
              checked={Boolean(config.swupdateThreeDayDeferralEnabled)}
              disabled={settings.saving}
              onCheckedChange={(enabled) => save({ swupdateThreeDayDeferralEnabled: enabled })}
            />
          </SettingRow>

          <SettingRow
            title='Debug data'
            caption='Diagnostics + status + config as JSON, for support or bug reports'
          >
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
                ? "Copied ✓"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy"}
            </button>
          </SettingRow>

          <SectionLabel>Maintenance</SectionLabel>
          <DangerAction
            title='Reset obstruction map'
            caption='Wipes the learned sky survey — do this after physically relocating the dish. Takes hours to relearn.'
            buttonLabel='Reset'
            confirmLabel='Yes, reset map'
            onRun={async () => {
              await (await loadDish()).clearObstructionMap();
              return "Obstruction map cleared — the survey restarts now.";
            }}
          />
          <DangerAction
            title='Reboot Starlink'
            caption='Internet drops for ~2–3 minutes while the dish restarts'
            buttonLabel='Reboot'
            slideLabel='Slide to reboot dish'
            confirmLabel='Reboot dish'
            onRun={async () => {
              await (await loadDish()).reboot();
              return "Reboot command sent — the dish is restarting.";
            }}
          />
          <DangerAction
            title='Factory reset Starlink'
            caption='Wipes every dish setting back to how it shipped. Not reversible.'
            buttonLabel='Factory reset'
            slideLabel='Slide to factory reset the dish'
            confirmLabel='Factory reset dish'
            warning='Only factory reset as a last resort or when Starlink recommends it. Frequent factory resets can cause permanent hardware failure.'
            onRun={async () => {
              await (await loadDish()).factoryReset();
              return "Factory reset sent — the dish is wiping and restarting.";
            }}
          />
          {isMotorized && (
            <DangerAction
              title={status?.stowRequested ? "Unstow dish" : "Stow dish"}
              caption={
                status?.stowRequested
                  ? "Unfold and reacquire satellites over a few minutes"
                  : "Folds the dish flat and stops internet until unstowed"
              }
              buttonLabel={status?.stowRequested ? "Unstow" : "Stow"}
              confirmLabel={status?.stowRequested ? "Yes, unstow" : "Yes, stow"}
              onRun={async () => {
                await (await loadDish()).stow(Boolean(status?.stowRequested));
                return status?.stowRequested
                  ? "Unstow sent — deploying."
                  : "Stow sent — folding flat.";
              }}
            />
          )}
        </>
      )}
    </>
  );
}
