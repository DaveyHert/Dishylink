// Settings modal (gear icon): dish config + maintenance on the Starlink tab,
// network info + reboot on the Router tab — layout mirrors the official app.
// Chrome is the shadcn Dialog; the segment control, buttons and typography use
// the DishyLink design language. The body animates its height between tabs.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/callout";
import { Loading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { actionButton } from "@/components/ui/action-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DishClient,
  ROUTER_UNREACHABLE_MESSAGE,
  type DishStatusJson,
  type SnowMeltMode,
  type WifiNetworkConfigJson,
} from "../../lib/dishClient";
import { useDishSettings } from "../../hooks/useDishSettings";
import { specForHardware } from "../../lib/dishMesh";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  status: DishStatusJson | null;
  hardwareVersion?: string;
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null;
}

// power_save_start_minutes is minutes after midnight UTC on the dish.
function utcMinutesToLocalTime(utcMinutes: number): string {
  const date = new Date();
  date.setUTCHours(Math.floor(utcMinutes / 60), utcMinutes % 60, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localTimeToUtcMinutes(localTime: string): number {
  const [hours, minutes] = localTime.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

const SNOW_MELT_LABEL: Record<SnowMeltMode, string> = {
  AUTO: "Automatic",
  ALWAYS_ON: "Always on",
  ALWAYS_OFF: "Off",
};

// compact select trigger in the app's language (mono, hairline, small)
const triggerClass =
  "font-mono tabular-nums inline-flex h-7 items-center justify-between gap-1.5 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 text-xs text-foreground shadow-none outline-none hover:border-[var(--baseline)] data-[placeholder]:text-muted-foreground [&>svg]:size-3 [&>svg]:opacity-60";
const selectContentClass = "min-w-[7rem] rounded-lg border-[var(--hairline)]";
const selectItemClass = "text-xs py-1.5";

// One settings row: label block on the left, control(s) pinned right, never
// wrapping. `note` is an outcome line that spans the full width underneath.
function SettingRow({
  title,
  caption,
  note,
  children,
}: {
  title: string;
  caption?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-settings-row className='py-[11px]'>
      <div className='flex items-center justify-between gap-5'>
        <div className='min-w-0'>
          <span className='block text-[13.5px] font-semibold text-foreground'>{title}</span>
          {caption && (
            <span className='mt-px block text-[12px] text-muted-foreground'>{caption}</span>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>{children}</div>
      </div>
      {note && <div className='mt-1.5 text-[12px] text-muted-foreground'>{note}</div>}
    </div>
  );
}

/** Destructive action with inline armed-confirm, using the app's buttons. */
function DangerAction({
  title,
  caption,
  buttonLabel,
  confirmLabel,
  onRun,
}: {
  title: string;
  caption: string;
  buttonLabel: string;
  confirmLabel: string;
  onRun: () => Promise<string>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <SettingRow
      title={title}
      caption={caption}
      note={
        result && (
          <span role='status' className='block'>
            {result}
          </span>
        )
      }
    >
      {!armed ? (
        <button className={actionButton("subtle")} onClick={() => setArmed(true)}>
          {buttonLabel}
        </button>
      ) : (
        <>
          <button
            className={actionButton("danger")}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await onRun());
              } catch (error) {
                setResult(`Failed: ${(error as Error).message}`);
              } finally {
                setBusy(false);
                setArmed(false);
              }
            }}
          >
            {busy ? "Sending…" : confirmLabel}
          </button>
          <button
            className={actionButton("subtle")}
            disabled={busy}
            onClick={() => setArmed(false)}
          >
            Cancel
          </button>
        </>
      )}
    </SettingRow>
  );
}

export function SettingsModal({
  open,
  onClose,
  status,
  hardwareVersion,
  wifiConfig,
  routerReachable,
}: SettingsModalProps) {
  const [tab, setTab] = useState<"starlink" | "router">("starlink");
  const settings = useDishSettings(open);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  // Animate the body height: measure the active panel and cap at 68vh (inner
  // scrolls past that), so switching tabs eases between the two heights.
  const panelRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () =>
      setBodyHeight(Math.min(panel.scrollHeight, Math.round(window.innerHeight * 0.68)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tab, open, settings.config, settings.error]);

  const isMotorized = specForHardware(hardwareVersion).mount === "mast";
  const config = settings.config;

  const sleepEnabled = Boolean(config?.powerSaveMode);
  const sleepStart = utcMinutesToLocalTime(config?.powerSaveStartMinutes ?? 0);
  const sleepDurationH = Math.round((config?.powerSaveDurationMinutes ?? 360) / 60);

  const dishClient = useMemo(() => ({ current: null as Promise<DishClient> | null }), []);
  const loadDish = () => (dishClient.current ??= DishClient.load("dish"));

  const copyDiagnostics = async () => {
    try {
      const client = await loadDish();
      const [diagnostics, deviceInfo] = await Promise.all([
        client.getDiagnostics(),
        client.getDeviceInfo(),
      ]);
      const payload = {
        capturedAt: new Date().toISOString(),
        deviceInfo,
        diagnostics,
        status,
        config,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };

  const ssids = useMemo(() => {
    const sets = wifiConfig?.networks?.flatMap((network) => network.basicServiceSets ?? []) ?? [];
    const byName = new Map<string, string[]>();
    for (const set of sets) {
      if (!set.ssid) continue;
      const bands = byName.get(set.ssid) ?? [];
      if (set.band)
        bands.push(
          set.band.replace("RF_", "").replace("GHZ", " GHz").replace("5 GHz_HIGH", "5 GHz hi"),
        );
      byName.set(set.ssid, bands);
    }
    return [...byName.entries()];
  }, [wifiConfig]);

  const meshNodes = Object.values(wifiConfig?.meshConfigs ?? {});

  return (
    <Dialog open={open} onOpenChange={(stillOpen) => !stillOpen && onClose()}>
      <DialogContent className='max-w-md bg-card border-border p-0 gap-0' showCloseButton={false}>
        <DialogHeader className='flex flex-row items-center justify-between px-5 pt-[12px] pb-1 text-left'>
          <DialogTitle className='text-[17px] font-semibold tracking-[0.01em]'>
            Settings
          </DialogTitle>
          <button
            className='inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full border-0 bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-[13px] leading-none text-[color:var(--ink-secondary)] transition-colors hover:text-foreground'
            onClick={onClose}
            aria-label='Close'
          >
            ✕
          </button>
        </DialogHeader>

        <div className='px-5 pt-2 pb-1.5'>
          <SegmentedControl
            variant='glider'
            label='Settings section'
            value={tab}
            onChange={setTab}
            options={[
              { value: "starlink", label: "Starlink" },
              { value: "router", label: "Router" },
            ]}
          />
        </div>

        <div
          className='overflow-hidden transition-[height] duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)]'
          style={{ height: bodyHeight }}
        >
          <div className='thin-scroll max-h-[68vh] overflow-y-auto px-5 pt-1 pb-5' ref={panelRef}>
            {tab === "starlink" && (
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
                        onValueChange={(mode) =>
                          void settings.save({ snowMeltMode: mode as SnowMeltMode }).catch(() => {})
                        }
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
                          void settings
                            .save(
                              enabled
                                ? {
                                    powerSaveMode: true,
                                    powerSaveStartMinutes:
                                      config.powerSaveStartMinutes ??
                                      localTimeToUtcMinutes("01:00"),
                                    powerSaveDurationMinutes:
                                      config.powerSaveDurationMinutes || 360,
                                  }
                                : { powerSaveMode: false },
                            )
                            .catch(() => {})
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
                            void settings
                              .save({
                                powerSaveStartMinutes: localTimeToUtcMinutes(event.target.value),
                              })
                              .catch(() => {})
                          }
                        />
                        <span className='mt-px block text-[12px] text-muted-foreground'>for</span>
                        <Select
                          value={String(sleepDurationH)}
                          disabled={settings.saving}
                          onValueChange={(hours) =>
                            void settings
                              .save({ powerSaveDurationMinutes: Number(hours) * 60 })
                              .catch(() => {})
                          }
                        >
                          <SelectTrigger className={triggerClass} style={{ width: 72 }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={selectContentClass}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((hours) => (
                              <SelectItem
                                key={hours}
                                value={String(hours)}
                                className={selectItemClass}
                              >
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
                        onValueChange={(hour) =>
                          void settings.save({ swupdateRebootHour: Number(hour) }).catch(() => {})
                        }
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

                    <SettingRow
                      title='Defer updates'
                      caption='Hold firmware updates for up to 3 days'
                    >
                      <Switch
                        checked={Boolean(config.swupdateThreeDayDeferralEnabled)}
                        disabled={settings.saving}
                        onCheckedChange={(enabled) =>
                          void settings
                            .save({ swupdateThreeDayDeferralEnabled: enabled })
                            .catch(() => {})
                        }
                      />
                    </SettingRow>

                    <SettingRow
                      title='Debug data'
                      caption='Diagnostics + status + config as JSON, for support or bug reports'
                    >
                      <button
                        className={actionButton("subtle")}
                        onClick={() => void copyDiagnostics()}
                      >
                        {copyState === "copied"
                          ? "Copied ✓"
                          : copyState === "failed"
                            ? "Copy failed"
                            : "Copy"}
                      </button>
                    </SettingRow>

                    <div
                      data-section-label
                      className='mt-4 mb-0.5 font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase'
                    >
                      Maintenance
                    </div>
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
            )}

            {tab === "router" && (
              <>
                {routerReachable === null && <Loading message='Contacting the router…' />}
                {routerReachable === false && (
                  <Callout tone='error'>{ROUTER_UNREACHABLE_MESSAGE}</Callout>
                )}
                {routerReachable && wifiConfig && (
                  <>
                    <div
                      data-section-label
                      className='mt-4 mb-0.5 font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase'
                    >
                      Networks
                    </div>
                    {ssids.map(([ssid, bands]) => (
                      <SettingRow
                        key={ssid}
                        title={ssid}
                        caption='WPA2 · password managed in the Starlink app'
                      >
                        {[...new Set(bands)].map((band) => (
                          <span
                            key={band}
                            className='rounded-[6px] border border-[var(--baseline)] px-[7px] py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-[color:var(--ink-secondary)] tabular-nums'
                          >
                            {band}
                          </span>
                        ))}
                      </SettingRow>
                    ))}
                    {meshNodes.length > 0 && (
                      <>
                        <div
                          data-section-label
                          className='mt-4 mb-0.5 font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase'
                        >
                          Mesh nodes
                        </div>
                        {meshNodes.map((node, nodeIndex) => (
                          <SettingRow
                            key={nodeIndex}
                            title={node.displayName ?? "Mesh node"}
                            caption={
                              node.hardwareVersion ? `hardware ${node.hardwareVersion}` : undefined
                            }
                          >
                            <span
                              className='rounded-[6px] border border-[var(--baseline)] px-[7px] py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-[color:var(--ink-secondary)] tabular-nums'
                              style={
                                node.auth !== "MESH_AUTH_TRUSTED"
                                  ? { color: "var(--status-critical)" }
                                  : undefined
                              }
                            >
                              {node.auth === "MESH_AUTH_TRUSTED"
                                ? "trusted"
                                : (node.auth ?? "unknown")}
                            </span>
                          </SettingRow>
                        ))}
                      </>
                    )}
                    {wifiConfig.boot?.evenSideSoftwareVersion && (
                      <SettingRow
                        title='Router firmware'
                        caption={`country ${wifiConfig.countryCode ?? "—"}`}
                      >
                        <span className='font-mono text-[12px] text-muted-foreground tabular-nums'>
                          {wifiConfig.boot.evenSideSoftwareVersion}
                        </span>
                      </SettingRow>
                    )}
                    <div
                      data-section-label
                      className='mt-4 mb-0.5 font-mono text-[10px] font-medium tracking-[0.11em] text-muted-foreground uppercase'
                    >
                      Maintenance
                    </div>
                    <DangerAction
                      title='Reboot router'
                      caption='WiFi drops for a minute or two; the dish stays up'
                      buttonLabel='Reboot'
                      confirmLabel='Yes, reboot router'
                      onRun={async () => {
                        const routerClient = await DishClient.load("router");
                        await routerClient.reboot();
                        return "Reboot sent — the router is restarting.";
                      }}
                    />
                    <Callout className='mt-3.5'>
                      Custom DNS, bypass mode, and content filtering are intentionally not exposed
                      here — a bad write can take your WiFi down until a physical reset. Use the
                      official app for those.
                    </Callout>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
