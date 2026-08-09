// App-level display choices — the ones that are about Dishylink itself, not the
// dish or the router. Kept in their own tab so the two device tabs stay a mirror
// of the official app and app preferences don't masquerade as dish config.
//
// The toolbar choice is universal (web, extension, desktop); the throughput
// readout is a desktop feature — the macOS menu bar or the Windows taskbar — so
// that row appears only where the desktop host actually exposes it. Presence of
// the method is the whole gate; the host's `platform` only words the copy.

import { useEffect, useState, useSyncExternalStore } from "react";
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

export function AppSettingsTab() {
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
