import { useCallback, useState } from "react";
import type { ToolbarItemId } from "../components/toolbar/AppToolbar";
import { useHashRoute } from "./useHashRoute";

export type PanelName =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "settings" | "terminal";

export function usePanelRouting() {
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
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
