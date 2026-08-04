import { useSyncExternalStore } from "react";
import { AnimatePresence } from "motion/react";
import { readToolbarStyle, subscribeToToolbarStyle } from "../../lib/toolbarStyle";
import { ToolbarDock } from "./ToolbarDock";
import { ToolbarRail } from "./ToolbarRail";
import { SpeedometerIcon } from "../../assets/icons/SpeedometerIcon";
import { CrosshairIcon } from "../../assets/icons/CrosshairIcon";
import { ChartLineIcon } from "../../assets/icons/ChartLineIcon";
import { NetworkIcon } from "../../assets/icons/NetworkIcon";
import { UserIcon } from "../../assets/icons/UserIcon";
import { PlanetIcon } from "../../assets/icons/PlanetIcon";
import { SettingsIcon } from "../../assets/icons/SettingsIcon";

// The `id` of each destination matches the App's panel key, which is how a
// toolbar lights the open one.
export type ToolbarItemId =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "satellite" | "settings";

export interface ToolbarItem {
  id: ToolbarItemId;
  label: string;
  Icon: (props: { size?: number; className?: string }) => React.ReactElement;
}

// Ordered as the instrument is worked: the measurements taken against the dish
// first, then the network it feeds, the account behind it, the sky it sees, and
// the app's own settings last.
const TOOLBAR_ITEMS: ToolbarItem[] = [
  { id: "speedtest", label: "Speed test", Icon: SpeedometerIcon },
  { id: "alignment", label: "Alignment", Icon: CrosshairIcon },
  { id: "datausage", label: "Data usage", Icon: ChartLineIcon },
  { id: "network", label: "Network", Icon: NetworkIcon },
  { id: "account", label: "Account", Icon: UserIcon },
  { id: "satellite", label: "Satellite view", Icon: PlanetIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

interface AppToolbarProps {
  /** The open panel, so the active destination lights up. */
  activeId: string | null;
  onSelect: (id: ToolbarItemId) => void;
}

export function AppToolbar({ activeId, onSelect }: AppToolbarProps) {
  const toolbarStyle = useSyncExternalStore(subscribeToToolbarStyle, readToolbarStyle);

  return (
    <AnimatePresence mode='wait'>
      {toolbarStyle === "rail" ? (
        <ToolbarRail key='rail' items={TOOLBAR_ITEMS} activeId={activeId} onSelect={onSelect} />
      ) : (
        <ToolbarDock key='dock' items={TOOLBAR_ITEMS} activeId={activeId} onSelect={onSelect} />
      )}
    </AnimatePresence>
  );
}
