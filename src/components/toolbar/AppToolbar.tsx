import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence } from "motion/react";
import type { TranslationKey } from "../../i18n";
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
const TOOLBAR_ITEMS: { id: ToolbarItemId; labelKey: TranslationKey; Icon: ToolbarItem["Icon"] }[] =
  [
    { id: "speedtest", labelKey: "navigation.speedTest", Icon: SpeedometerIcon },
    { id: "alignment", labelKey: "navigation.alignment", Icon: CrosshairIcon },
    { id: "datausage", labelKey: "navigation.dataUsage", Icon: ChartLineIcon },
    { id: "network", labelKey: "navigation.network", Icon: NetworkIcon },
    { id: "account", labelKey: "navigation.account", Icon: UserIcon },
    { id: "satellite", labelKey: "navigation.satelliteView", Icon: PlanetIcon },
    { id: "settings", labelKey: "navigation.settings", Icon: SettingsIcon },
  ];

interface AppToolbarProps {
  /** The open panel, so the active destination lights up. */
  activeId: string | null;
  onSelect: (id: ToolbarItemId) => void;
}

export function AppToolbar({ activeId, onSelect }: AppToolbarProps) {
  const { t } = useTranslation();
  const toolbarStyle = useSyncExternalStore(subscribeToToolbarStyle, readToolbarStyle);
  const items: ToolbarItem[] = TOOLBAR_ITEMS.map(({ id, labelKey, Icon }) => ({
    id,
    label: t(labelKey),
    Icon,
  }));
  const navLabel = t("navigation.dashboardSections");

  return (
    <AnimatePresence mode='wait'>
      {toolbarStyle === "rail" ? (
        <ToolbarRail
          key='rail'
          items={items}
          activeId={activeId}
          onSelect={onSelect}
          navLabel={navLabel}
        />
      ) : (
        <ToolbarDock
          key='dock'
          items={items}
          activeId={activeId}
          onSelect={onSelect}
          navLabel={navLabel}
        />
      )}
    </AnimatePresence>
  );
}
