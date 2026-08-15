import { useCallback, useEffect, useState } from "react";
import type { ToolbarItemId } from "../components/toolbar/AppToolbar";
import { useHashRoute } from "./useHashRoute";

export type PanelName =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "settings" | "terminal";

// Panels are opened by the toolbar, which owns this state, but a control buried
// in one panel sometimes has to send the user to another. Module-level so it can
// be called from anywhere without threading a setter through every layer.
let openRequest: ((panel: PanelName) => void) | null = null;

export function requestPanel(panel: PanelName): void {
  openRequest?.(panel);
}

export function usePanelRouting() {
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);

  useEffect(() => {
    openRequest = setOpenPanel;
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
      else setOpenPanel(id);
    },
    [openSkyView],
  );

  return {
    openPanel,
    setOpenPanel,
    skyViewOpen,
    setSkyViewOpen,
    openNav,
    openSkyView,
  };
}
