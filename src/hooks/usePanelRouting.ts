import { useCallback, useEffect, useState } from "react";
import type { ToolbarItemId } from "../components/toolbar/AppToolbar";
import { useHashRoute } from "./useHashRoute";

export type PanelName =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "settings" | "terminal";

export type SettingsTab = "starlink" | "router" | "app";

// Panels are opened by the toolbar, which owns this state, but a control buried
// in one panel sometimes has to send the user to another. Module-level so it can
// be called from anywhere without threading a setter through every layer.
let openRequest: ((panel: PanelName, tab?: SettingsTab) => void) | null = null;

/** `tab` sends the settings modal straight to one section, for a control that
 *  names a setting living somewhere else. */
export function requestPanel(panel: PanelName, tab?: SettingsTab): void {
  openRequest?.(panel, tab);
}

export function usePanelRouting() {
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("starlink");

  useEffect(() => {
    openRequest = (panel, tab) => {
      setSettingsTab(tab ?? "starlink");
      setOpenPanel(panel);
    };
    return () => {
      openRequest = null;
    };
  }, []);
  const [skyViewOpen, setSkyViewOpen] = useHashRoute("satellite");

  // The sky view and the panels are mutually exclusive: it covers the viewport,
  // and a panel left open renders on top of it.
  const openSkyView = useCallback(() => {
    setOpenPanel(null);
    setSkyViewOpen(true);
  }, [setSkyViewOpen]);

  const openNav = useCallback(
    (id: ToolbarItemId) => {
      if (id === "satellite") openSkyView();
      else {
        // Reached from the toolbar rather than from a control naming one setting,
        // so settings opens where it always does.
        setSettingsTab("starlink");
        setOpenPanel(id);
      }
    },
    [openSkyView],
  );

  return {
    openPanel,
    setOpenPanel,
    settingsTab,
    skyViewOpen,
    setSkyViewOpen,
    openNav,
    openSkyView,
  };
}
