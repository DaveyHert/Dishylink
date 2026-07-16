// Settings modal (gear icon): dish config + maintenance on the Starlink tab,
// network info + reboot on the Router tab — layout mirrors the official app.
// Chrome is the shadcn Dialog; the segment control, buttons and typography use
// the Dishboard design language. The body animates its height between tabs.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DishClient, type DishStatusJson, type SnowMeltMode, type WifiNetworkConfigJson } from "../lib/dishClient";
import { useDishSettings } from "../hooks/useDishSettings";
import { specForHardware } from "../lib/dishMesh";

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
  "settings-select mono-value inline-flex h-7 items-center justify-between gap-1.5 rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 text-xs text-foreground shadow-none outline-none hover:border-[var(--baseline)] data-[placeholder]:text-muted-foreground [&>svg]:size-3 [&>svg]:opacity-60";
const selectContentClass = "min-w-[7rem] rounded-lg border-[var(--hairline)]";
const selectItemClass = "text-xs py-1.5";

function SettingRow({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {caption && <span className="settings-row-caption">{caption}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
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
    <div className="settings-row settings-row--wrap">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        <span className="settings-row-caption">{caption}</span>
      </div>
      <div className="settings-row-control">
        {!armed ? (
          <button className="device-action-button subtle" onClick={() => setArmed(true)}>
            {buttonLabel}
          </button>
        ) : (
          <>
            <button
              className="device-action-button danger"
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
            <button className="device-action-button subtle" disabled={busy} onClick={() => setArmed(false)}>
              Cancel
            </button>
          </>
        )}
      </div>
      {result && <div className="settings-action-result">{result}</div>}
    </div>
  );
}

export function SettingsModal({ open, onClose, status, hardwareVersion, wifiConfig, routerReachable }: SettingsModalProps) {
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
    const measure = () => setBodyHeight(Math.min(panel.scrollHeight, Math.round(window.innerHeight * 0.68)));
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
      const [diagnostics, deviceInfo] = await Promise.all([client.getDiagnostics(), client.getDeviceInfo()]);
      const payload = { capturedAt: new Date().toISOString(), deviceInfo, diagnostics, status, config };
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
      if (set.band) bands.push(set.band.replace("RF_", "").replace("GHZ", " GHz").replace("5 GHz_HIGH", "5 GHz hi"));
      byName.set(set.ssid, bands);
    }
    return [...byName.entries()];
  }, [wifiConfig]);

  const meshNodes = Object.values(wifiConfig?.meshConfigs ?? {});

  return (
    <Dialog open={open} onOpenChange={(stillOpen) => !stillOpen && onClose()}>
      <DialogContent className="max-w-md bg-card border-border p-0 gap-0" showCloseButton={false}>
        <DialogHeader className="settings-head">
          <DialogTitle className="settings-title">Settings</DialogTitle>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </DialogHeader>

        <div className="settings-segment-wrap">
          <div className="settings-segment" role="tablist">
            <span className={`settings-segment-glider ${tab === "router" ? "right" : ""}`} aria-hidden="true" />
            <button role="tab" className={tab === "starlink" ? "active" : ""} onClick={() => setTab("starlink")}>
              Starlink
            </button>
            <button role="tab" className={tab === "router" ? "active" : ""} onClick={() => setTab("router")}>
              Router
            </button>
          </div>
        </div>

        <div className="settings-body-motion" style={{ height: bodyHeight }}>
          <div className="settings-panel" ref={panelRef}>
            {tab === "starlink" && (
              <>
                {settings.loading && <div className="settings-note">Reading dish configuration…</div>}
                {settings.error && <div className="settings-error">{settings.error}</div>}
                {config && (
                  <>
                    <SettingRow
                      title="Snow melt"
                      caption="Heats the panel to shed snow. Auto uses the dish's own sensors."
                    >
                      <Select
                        value={config.snowMeltMode ?? "AUTO"}
                        disabled={settings.saving}
                        onValueChange={(mode) => void settings.save({ snowMeltMode: mode as SnowMeltMode }).catch(() => {})}
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
                      title="Sleep schedule"
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
                                      config.powerSaveStartMinutes ?? localTimeToUtcMinutes("01:00"),
                                    powerSaveDurationMinutes: config.powerSaveDurationMinutes || 360,
                                  }
                                : { powerSaveMode: false },
                            )
                            .catch(() => {})
                        }
                      />
                    </SettingRow>
                    {sleepEnabled && (
                      <div className="settings-subrow">
                        <span className="settings-row-caption">from</span>
                        <input
                          type="time"
                          className="settings-time mono-value"
                          value={sleepStart}
                          disabled={settings.saving}
                          onChange={(event) =>
                            void settings
                              .save({ powerSaveStartMinutes: localTimeToUtcMinutes(event.target.value) })
                              .catch(() => {})
                          }
                        />
                        <span className="settings-row-caption">for</span>
                        <Select
                          value={String(sleepDurationH)}
                          disabled={settings.saving}
                          onValueChange={(hours) =>
                            void settings.save({ powerSaveDurationMinutes: Number(hours) * 60 }).catch(() => {})
                          }
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
                      title="Update reboot hour"
                      caption="Firmware-update reboots only happen at this local hour"
                    >
                      <Select
                        value={String(config.swupdateRebootHour ?? 3)}
                        disabled={settings.saving}
                        onValueChange={(hour) => void settings.save({ swupdateRebootHour: Number(hour) }).catch(() => {})}
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

                    <SettingRow title="Defer updates" caption="Hold firmware updates for up to 3 days">
                      <Switch
                        checked={Boolean(config.swupdateThreeDayDeferralEnabled)}
                        disabled={settings.saving}
                        onCheckedChange={(enabled) =>
                          void settings.save({ swupdateThreeDayDeferralEnabled: enabled }).catch(() => {})
                        }
                      />
                    </SettingRow>

                    <SettingRow
                      title="Debug data"
                      caption="Diagnostics + status + config as JSON, for support or bug reports"
                    >
                      <button className="device-action-button subtle" onClick={() => void copyDiagnostics()}>
                        {copyState === "copied" ? "Copied ✓" : copyState === "failed" ? "Copy failed" : "Copy"}
                      </button>
                    </SettingRow>

                    <div className="settings-section-label">Maintenance</div>
                    <DangerAction
                      title="Reset obstruction map"
                      caption="Wipes the learned sky survey — do this after physically relocating the dish. Takes hours to relearn."
                      buttonLabel="Reset"
                      confirmLabel="Yes, reset map"
                      onRun={async () => {
                        await (await loadDish()).clearObstructionMap();
                        return "Obstruction map cleared — the survey restarts now.";
                      }}
                    />
                    <DangerAction
                      title="Reboot Starlink"
                      caption="Internet drops for ~2–3 minutes while the dish restarts"
                      buttonLabel="Reboot"
                      confirmLabel="Yes, reboot dish"
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
                          return status?.stowRequested ? "Unstow sent — deploying." : "Stow sent — folding flat.";
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {tab === "router" && (
              <>
                {routerReachable === null && <div className="settings-note">Contacting the router…</div>}
                {routerReachable === false && (
                  <div className="settings-note">
                    Router unreachable at 192.168.1.1 — bypass mode or a different subnet.
                  </div>
                )}
                {routerReachable && wifiConfig && (
                  <>
                    <div className="settings-section-label">Networks</div>
                    {ssids.map(([ssid, bands]) => (
                      <SettingRow key={ssid} title={ssid} caption="WPA2 · password managed in the Starlink app">
                        {[...new Set(bands)].map((band) => (
                          <span key={band} className="settings-band mono-value">
                            {band}
                          </span>
                        ))}
                      </SettingRow>
                    ))}
                    {meshNodes.length > 0 && (
                      <>
                        <div className="settings-section-label">Mesh nodes</div>
                        {meshNodes.map((node, nodeIndex) => (
                          <SettingRow
                            key={nodeIndex}
                            title={node.displayName ?? "Mesh node"}
                            caption={node.hardwareVersion ? `hardware ${node.hardwareVersion}` : undefined}
                          >
                            <span
                              className="settings-band mono-value"
                              style={node.auth !== "MESH_AUTH_TRUSTED" ? { color: "var(--status-critical)" } : undefined}
                            >
                              {node.auth === "MESH_AUTH_TRUSTED" ? "trusted" : (node.auth ?? "unknown")}
                            </span>
                          </SettingRow>
                        ))}
                      </>
                    )}
                    {wifiConfig.boot?.evenSideSoftwareVersion && (
                      <SettingRow title="Router firmware" caption={`country ${wifiConfig.countryCode ?? "—"}`}>
                        <span className="mono-value settings-firmware">{wifiConfig.boot.evenSideSoftwareVersion}</span>
                      </SettingRow>
                    )}
                    <div className="settings-section-label">Maintenance</div>
                    <DangerAction
                      title="Reboot router"
                      caption="WiFi drops for a minute or two; the dish stays up"
                      buttonLabel="Reboot"
                      confirmLabel="Yes, reboot router"
                      onRun={async () => {
                        const routerClient = await DishClient.load("router");
                        await routerClient.reboot();
                        return "Reboot sent — the router is restarting.";
                      }}
                    />
                    <div className="settings-note settings-note--foot">
                      Custom DNS, bypass mode, and content filtering are intentionally not exposed here — a bad write can
                      take your WiFi down until a physical reset. Use the official app for those.
                    </div>
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
