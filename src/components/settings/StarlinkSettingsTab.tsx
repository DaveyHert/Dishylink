// Dish configuration and maintenance — the Starlink half of the settings panel.

import { useState } from "react";
import { Callout } from "@/components/ui/callout";
import { Loading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { actionButton } from "@/components/ui/action-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DishClient, DishStatusJson, SnowMeltMode } from "@core/dishClient";
import type { useDishSettings } from "../../hooks/useDishSettings";
import {
  DangerAction,
  SectionLabel,
  SettingRow,
  selectContentClass,
  selectItemClass,
  triggerClass,
} from "./settingsChrome";
import { localTimeToUtcMinutes, utcMinutesToLocalTime } from "./sleepSchedule";
import { UPDATE_WINDOWS, updateWindowFor } from "./updateWindow";

const SNOW_MELT_LABEL: Record<SnowMeltMode, string> = {
  AUTO: "Automatic",
  ALWAYS_ON: "Always on",
  ALWAYS_OFF: "Off",
};

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
  const sleepStart = utcMinutesToLocalTime(config?.powerSaveStartMinutes ?? 0);
  const sleepDurationH = Math.round((config?.powerSaveDurationMinutes ?? 360) / 60);
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
      {settings.error && <Callout tone='error'>{settings.error}</Callout>}
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
                  <SelectItem key={mode} value={mode} className={selectItemClass}>
                    {SNOW_MELT_LABEL[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            title='Sleep schedule'
            caption={
              sleepEnabled
                ? `Dish powers down daily at ${sleepStart} for ${sleepDurationH} h`
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
                          config.powerSaveStartMinutes ?? localTimeToUtcMinutes("01:00"),
                        powerSaveDurationMinutes: config.powerSaveDurationMinutes || 360,
                      }
                    : { powerSaveMode: false },
                )
              }
            />
          </SettingRow>
          {sleepEnabled && (
            <div className='flex items-center gap-2 pb-[8px] pl-0.5'>
              <span className='mt-px block text-[12px] text-muted-foreground'>from</span>
              <input
                type='time'
                className='h-7 rounded-sm border border-hairline bg-transparent px-2 font-mono text-[12px] text-ink tabular-nums hover:border-input'
                value={sleepStart}
                disabled={settings.saving}
                onChange={(event) =>
                  save({ powerSaveStartMinutes: localTimeToUtcMinutes(event.target.value) })
                }
              />
              <span className='mt-px block text-[12px] text-muted-foreground'>for</span>
              <Select
                value={String(sleepDurationH)}
                disabled={settings.saving}
                onValueChange={(hours) => save({ powerSaveDurationMinutes: Number(hours) * 60 })}
              >
                <SelectTrigger className={triggerClass} style={{ width: 72 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={selectContentClass}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((hours) => (
                    <SelectItem key={hours} value={String(hours)} className={selectItemClass}>
                      {hours} h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            confirmLabel='Yes, reboot dish'
            onRun={async () => {
              await (await loadDish()).reboot();
              return "Reboot command sent — the dish is restarting.";
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
