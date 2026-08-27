// App-level display choices — the ones that are about Dishylink itself, not the
// dish or the router. Kept in their own tab so the two device tabs stay a mirror
// of the official app and app preferences don't masquerade as dish config.
//
// The toolbar choice is universal (web, extension, desktop); the throughput
// readout is a desktop feature — the macOS menu bar or the Windows taskbar — so
// that row appears only where the desktop host actually exposes it. Presence of
// the method is the whole gate; the host's `platform` only words the copy.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow, selectContentClass, selectItemClass, triggerClass } from "./settingsChrome";
import {
  readToolbarStyle,
  setToolbarStyle,
  subscribeToToolbarStyle,
  type ToolbarStyle,
} from "../../lib/toolbarStyle";
import { selfDeviceHost } from "../../lib/selfDeviceHost";
import { badgeModeHost, DEFAULT_BADGE_MODE, type BadgeMode } from "../../lib/badgeMode";
import { displayName, isClientDevice } from "../network/networkFormat";
import type { WifiClientJson } from "@core/dishClient";

/** The desktop host's throughput-readout bridge, exposed only in the macOS and
 *  Windows desktop apps (the preload gates it on those platforms). Null everywhere
 *  else — a browser tab, the extension, Linux — which is what keeps the row from
 *  rendering there. A dev run shows it too: the toggle and the window-open readout
 *  work, and only the window-closed feed is dark, since the recorder that drives it
 *  runs solely in the packaged app. */
function menuBarHost() {
  const host = window.dishlink;
  return typeof host?.setMenuBarThroughput === "function" ? host : null;
}

/** Follows the menu-bar preference the main process owns: seeded once, then kept
 *  in step with the tray checkbox through the host's change feed. */
function useMenuBarThroughput(): [boolean, (on: boolean) => void] | null {
  const host = menuBarHost();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!host) return;
    let active = true;
    void host.menuBarThroughput?.().then((value) => {
      if (active) setOn(value);
    });
    const unsubscribe = host.onMenuBarThroughput?.((value) => setOn(value));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [host]);

  if (!host) return null;
  // Optimistic locally, then reconciled with what main reports back, so the switch
  // never lags the click by a round trip.
  const toggle = (next: boolean) => {
    setOn(next);
    void host.setMenuBarThroughput?.(next).then(setOn);
  };
  return [on, toggle];
}

const NO_SELF_DEVICE = "none";

/** Names one roster entry as the device the dashboard runs on, for hosts that
 *  cannot work it out. Pausing is withheld from whatever is named here. */
function SelfDeviceRow({ clients }: { clients: WifiClientJson[] }) {
  const host = selfDeviceHost();
  const [clientId, setClientId] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (!host) return;
    let active = true;
    void host.read().then((stored) => {
      if (active) setClientId(stored);
    });
    return () => {
      active = false;
    };
  }, [host]);

  const devices = useMemo(
    () => clients.filter((client) => isClientDevice(client) && client.clientId !== undefined),
    [clients],
  );

  if (!host) return null;

  const named = devices.find((device) => device.clientId === clientId);
  // An empty roster is the router not answering yet, not a choice gone bad.
  const missing = clientId !== null && devices.length > 0 && !named;

  // The worker reads what was stored, not what this row shows, so a write that
  // failed has to take the row back with it.
  const choose = async (value: string) => {
    const previous = clientId;
    const next = value === NO_SELF_DEVICE ? null : Number(value);
    setClientId(next);
    setSaveFailed(false);
    try {
      await host.write(next);
    } catch {
      setClientId(previous);
      setSaveFailed(true);
    }
  };

  return (
    <SettingRow
      title='Your device on this network'
      info='The router lists every connected device the same way, so Dishylink cannot tell which one you are sitting at. Pick yours and it is marked "This device" in the network list, with no pause button of its own: pausing it would cut off the internet connection this dashboard needs to unpause it again, and you would have to undo it from another device or the Starlink app. Change or clear it here at any time.'
      infoSeverity='warn'
      caption='Pick the computer you are using right now'
      note={
        saveFailed
          ? "That could not be saved, so nothing changed. Try again."
          : clientId === null
            ? "Until you pick one, no device can be paused."
            : missing
              ? "The device you picked is not connected right now. Pick it again when it is back."
              : undefined
      }
    >
      <Select
        value={clientId === null ? NO_SELF_DEVICE : String(clientId)}
        onValueChange={(value) => void choose(value)}
      >
        <SelectTrigger className={triggerClass} style={{ maxWidth: 178 }}>
          <SelectValue>
            <span className='truncate'>
              {named ? displayName(named) : missing ? "Not connected" : "Choose…"}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={selectContentClass}>
          <SelectItem value={NO_SELF_DEVICE} className={selectItemClass}>
            None
          </SelectItem>
          {devices.length === 0 && (
            <div className='px-2 py-1.5 text-xs text-muted-foreground'>
              Waiting for the router to list your devices…
            </div>
          )}
          {devices.map((device) => (
            <SelectItem
              key={device.clientId}
              value={String(device.clientId)}
              className={selectItemClass}
            >
              <span className='flex flex-col items-start gap-px'>
                <span>{displayName(device)}</span>
                <span className='text-[10.5px] text-muted-foreground'>
                  {[device.macAddress, device.ipAddress].filter(Boolean).join(" · ")}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** What the extension's toolbar badge counts. Absent on every other host, which
 *  is what keeps the row out of the desktop app and a plain browser tab. */
function BadgeModeRow() {
  const host = badgeModeHost();
  const [mode, setMode] = useState<BadgeMode>(DEFAULT_BADGE_MODE);

  useEffect(() => {
    if (!host) return;
    let active = true;
    void host.read().then((stored) => {
      if (active) setMode(stored);
    });
    return () => {
      active = false;
    };
  }, [host]);

  if (!host) return null;

  const choose = (value: string) => {
    const next = value as BadgeMode;
    setMode(next);
    void host.write(next);
  };

  return (
    <SettingRow
      title='Toolbar badge'
      info='The count on the extension icon. Being away from your Starlink makes both devices unreachable, and the badge cannot tell that from a device that has actually failed — so "Device faults only" leaves both out. Alerts still reach the panel and your notifications either way.'
      caption='What the count on the extension icon includes'
    >
      <Select value={mode} onValueChange={choose}>
        <SelectTrigger className={triggerClass} style={{ width: 158 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={selectContentClass}>
          <SelectItem value='all' className={selectItemClass}>
            All alerts
          </SelectItem>
          <SelectItem value='faults' className={selectItemClass}>
            Device faults only
          </SelectItem>
          <SelectItem value='off' className={selectItemClass}>
            No badge
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export function AppSettingsTab({ clients }: { clients: WifiClientJson[] }) {
  const toolbarStyle = useSyncExternalStore(subscribeToToolbarStyle, readToolbarStyle);
  const menuBar = useMenuBarThroughput();
  // The readout lives in the menu bar on macOS and the taskbar on Windows; name
  // whichever this host is. Only reached when the bridge is present, i.e. desktop.
  const surface = window.dishlink?.platform === "win32" ? "taskbar" : "menu bar";

  return (
    <>
      <SettingRow title='App toolbar' caption='Floating dock or a left rail for the section links'>
        <Select
          value={toolbarStyle}
          onValueChange={(value) => setToolbarStyle(value as ToolbarStyle)}
        >
          <SelectTrigger className={triggerClass} style={{ width: 118 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value='dock' className={selectItemClass}>
              Dock
            </SelectItem>
            <SelectItem value='rail' className={selectItemClass}>
              Left rail
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SelfDeviceRow clients={clients} />

      <BadgeModeRow />

      {menuBar && (
        <SettingRow
          title={`Throughput in ${surface}`}
          caption={`Show the live ↓/↑ rate in the ${surface}`}
        >
          <Switch checked={menuBar[0]} onCheckedChange={menuBar[1]} />
        </SettingRow>
      )}
    </>
  );
}
