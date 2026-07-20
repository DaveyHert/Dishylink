// Dish configuration and maintenance — the Starlink half of the settings sheet.

import { useState } from "react";
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
import type { DishClient, DishStatusJson, SnowMeltMode } from "../../lib/dishClient";
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

  // Every write is fire-and-forget with the failure swallowed: the hook already
  // surfaces `settings.error`, and a rejected promise here would be unhandled.
  const save = (patch: Parameters<typeof settings.save>[0]) => void settings.save(patch).catch(() => {});

  return (
    <>
      {settings.loading && <Loading message='Reading dish configuration…' />}
      {settings.error && (
        <div className='py-2 text-[12.5px] leading-[1.5] text-destructive'>{settings.error}</div>
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
                className='h-7 rounded-sm border border-[var(--hairline)] bg-transparent px-2 font-mono text-[12px] text-[color:var(--ink)] tabular-nums hover:border-[var(--baseline)]'
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

          <SettingRow
            title='Update reboot hour'
            caption='Firmware-update reboots only happen at this local hour'
          >
            <Select
              value={String(config.swupdateRebootHour ?? 3)}
              disabled={settings.saving}
              onValueChange={(hour) => save({ swupdateRebootHour: Number(hour) })}
            >
              <SelectTrigger className={triggerClass} style={{ width: 84 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={`${selectContentClass} max-h-56`}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <SelectItem key={hour} value={String(hour)} className={selectItemClass}>
                    {String(hour).padStart(2, "0")}:00
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
              {copyState === "copied" ? "Copied ✓" : copyState === "failed" ? "Copy failed" : "Copy"}
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
