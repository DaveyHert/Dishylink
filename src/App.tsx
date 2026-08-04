import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDishTelemetry } from "./hooks/useDishTelemetry";
import { useLanPresence } from "./hooks/useLanPresence";
import { AnimatePresence, motion } from "motion/react";
import { useSatellites } from "./hooks/useSatellites";
import { useObserverLocation } from "./hooks/useObserverLocation";
import { useHashRoute } from "./hooks/useHashRoute";
import { useOutageNotifications } from "./hooks/useOutageNotifications";
import { useThermalEvents } from "./hooks/useThermalEvents";
import { useDeviceAlerts } from "./hooks/useDeviceAlerts";
import { useOutageHistory, mergeOutages } from "./hooks/useOutageHistory";
import {
  notificationsOn as readNotificationsOn,
  notificationsBlockedReason as readNotificationsBlockedReason,
  subscribeToNotifications,
  toggleNotifications,
} from "./lib/notifications";
import { armAlertSoundOnFirstGesture } from "./lib/alertSound";
import { TopBar } from "./components/dashboard/TopBar";
import { AppToolbar, type ToolbarItemId } from "./components/toolbar/AppToolbar";
import { DashboardView } from "./components/dashboard/DashboardView";
import { windowTail } from "./lib/telemetryWindow";
import { SatelliteView } from "./components/satellite/SatelliteView";
import { DishTerminalCard } from "./components/dashboard/DishTerminalCard";
import { StatDetailPanel } from "./components/dashboard/StatDetailPanel";
import { DetailsModal } from "./components/ui/details-modal";
import { SpeedTestPanel } from "./components/speed-test/SpeedTestCard";
import { AlignmentPanel } from "./components/alignment/AlignmentCard";
import { DataUsagePanel } from "./components/data-usage/DataUsagePanel";
import { NetworkPanel } from "./components/network/NetworkPanel";
import { AccountPanel } from "./components/account/AccountPanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { useRouterNetwork } from "./hooks/useRouterNetwork";
import { useRouterUnreachable } from "./hooks/useRouterUnreachable";
import { useLiveReadings } from "./hooks/useLiveReadings";
import { buildStatDetails } from "./lib/statDetails";
import { formatThroughput } from "./lib/format";
import { TooltipProvider } from "./components/ui/tooltip";

type ThemeName = "light" | "dark";
type PanelName =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "settings" | "terminal";

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(
    () => (localStorage.getItem("dishboard-theme") as ThemeName) ?? "dark",
  );
  const [windowMinutes, setWindowMinutes] = useState(15);
  const notificationsOn = useSyncExternalStore(subscribeToNotifications, readNotificationsOn);
  const notificationsBlockedReason = useSyncExternalStore(
    subscribeToNotifications,
    readNotificationsBlockedReason,
  );
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  const [skyViewOpen, setSkyViewOpen] = useHashRoute("satellite");
  const [networkSelectedKey, setNetworkSelectedKey] = useState<string | null>(null);
  const telemetry = useDishTelemetry();
  const { observerLocation, onLocationSaved, onClearLocation } = useObserverLocation(
    telemetry.dishLocation?.lla,
  );
  const lanOnline = useLanPresence(telemetry.status, telemetry.connectionState);
  const satellites = useSatellites(observerLocation, telemetry.obstructionMap);
  useOutageNotifications(telemetry);
  const deviceAlerts = useDeviceAlerts(telemetry.status, telemetry.connectionState);
  const thermalEvents = useThermalEvents();
  const persistedOutages = useOutageHistory();
  const outageEvents = useMemo(
    () => mergeOutages(telemetry.outageEvents, persistedOutages),
    [telemetry.outageEvents, persistedOutages],
  );
  const routerNetwork = useRouterNetwork(openPanel === "network" || openPanel === "settings");
  const routerUnreachable = useRouterUnreachable(
    routerNetwork.routerReachable,
    telemetry.status,
    telemetry.connectionState === "online",
  );

  const openNav = (id: ToolbarItemId) => {
    if (id === "satellite") {
      setOpenPanel(null);
      setSkyViewOpen(true);
    } else {
      setOpenPanel(id);
    }
  };

  useEffect(() => armAlertSoundOnFirstGesture(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dishboard-theme", theme);
  }, [theme]);

  const { status, samples } = telemetry;

  useEffect(() => {
    window.dishlink?.reportThroughput?.(
      status?.downlinkThroughputBps ?? 0,
      status?.uplinkThroughputBps ?? 0,
    );
  }, [status]);

  const {
    nowMs,
    livePowerW,
    powerWindowEndMs,
    averagePowerW,
    recentPingSuccessPercent,
    sparklines,
  } = useLiveReadings(samples);

  const liveDownlink = formatThroughput(status?.downlinkThroughputBps ?? 0);
  const liveUplink = formatThroughput(status?.uplinkThroughputBps ?? 0);
  const chartSamples = useMemo(
    () => windowTail(samples, windowMinutes, nowMs),
    [samples, windowMinutes, nowMs],
  );
  const powerChartSamples = useMemo(
    () => windowTail(samples, windowMinutes, powerWindowEndMs),
    [samples, windowMinutes, powerWindowEndMs],
  );
  const statDetails = useMemo(
    () =>
      buildStatDetails({
        status,
        currentPowerW: livePowerW,
        powerWindowEndMs,
        recentPingSuccessPercent,
        outageEvents,
      }),
    [status, livePowerW, powerWindowEndMs, recentPingSuccessPercent, outageEvents],
  );
  const openDetail = openDetailId ? statDetails[openDetailId] : null;

  const showSearchingHero =
    telemetry.connectionState === "unreachable" && status === null && samples.length === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <AnimatePresence initial={false} mode='wait'>
        {!skyViewOpen && (
          <motion.div
            key='dashboard'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <TopBar
              connectionState={telemetry.connectionState}
              status={status}
              theme={theme}
              onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
              deviceAlerts={deviceAlerts}
              notificationsOn={notificationsOn}
              notificationsBlockedReason={notificationsBlockedReason}
              onToggleNotifications={() => void toggleNotifications()}
            />
            <AppToolbar activeId={openPanel} onSelect={openNav} />

            <DashboardView
              showSearchingHero={showSearchingHero}
              status={status}
              connectionState={telemetry.connectionState}
              obstructionMap={telemetry.obstructionMap}
              liveDownlink={liveDownlink}
              liveUplink={liveUplink}
              sparklines={sparklines}
              livePowerW={livePowerW}
              recentPingSuccessPercent={recentPingSuccessPercent}
              windowMinutes={windowMinutes}
              onWindowMinutesChange={setWindowMinutes}
              chartSamples={chartSamples}
              powerChartSamples={powerChartSamples}
              powerWindowEndMs={powerWindowEndMs}
              averagePowerW={averagePowerW}
              outageEvents={outageEvents}
              thermalEvents={thermalEvents}
              onOpenDetail={setOpenDetailId}
              onOpenSatelliteView={() => setSkyViewOpen(true)}
              onExpandTerminal={() => setOpenPanel("terminal")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stat detail modal */}
      {openDetail && (
        <DetailsModal
          title={openDetail.modalTitle ?? openDetail.label}
          onClose={() => setOpenDetailId(null)}
        >
          <StatDetailPanel detail={openDetail} samples={samples} />
        </DetailsModal>
      )}
      {/* Terminal modal */}
      {openPanel === "terminal" && status && (
        <DetailsModal title='Starlink Dish Terminal' onClose={() => setOpenPanel(null)} size='xxl'>
          <DishTerminalCard
            status={status}
            stale={telemetry.connectionState !== "online"}
            expanded
          />
        </DetailsModal>
      )}
      {/* Speed test modal */}
      {openPanel === "speedtest" && (
        <DetailsModal title='Speed test' onClose={() => setOpenPanel(null)}>
          <SpeedTestPanel samples={samples} status={status} />
        </DetailsModal>
      )}
      {/* Alignment modal */}
      {openPanel === "alignment" && (
        <DetailsModal title='Alignment' onClose={() => setOpenPanel(null)} size='wide'>
          <AlignmentPanel status={status} onOpenSkyView={() => setSkyViewOpen(true)} />
        </DetailsModal>
      )}
      {/* Data usage modal */}
      {openPanel === "datausage" && (
        <DetailsModal title='Data usage' onClose={() => setOpenPanel(null)} size='wide'>
          <DataUsagePanel />
        </DetailsModal>
      )}
      {/* Account modal */}
      {openPanel === "account" && (
        <DetailsModal title='Starlink account' onClose={() => setOpenPanel(null)} size='wide'>
          <AccountPanel lanOnline={lanOnline} />
        </DetailsModal>
      )}
      {/* Network modal */}
      {openPanel === "network" && (
        <DetailsModal
          title='Network'
          onBack={networkSelectedKey ? () => setNetworkSelectedKey(null) : undefined}
          onClose={() => {
            setOpenPanel(null);
            setNetworkSelectedKey(null);
          }}
          size='wide'
        >
          <NetworkPanel
            network={routerNetwork}
            unreachable={routerUnreachable}
            selectedKey={networkSelectedKey}
            onSelect={setNetworkSelectedKey}
          />
        </DetailsModal>
      )}
      {/* Settings modal */}
      <SettingsModal
        open={openPanel === "settings"}
        onClose={() => setOpenPanel(null)}
        status={status}
        hardwareVersion={
          telemetry.deviceInfo?.hardwareVersion ?? status?.deviceInfo?.hardwareVersion
        }
        wifiConfig={routerNetwork.wifiConfig}
        routerReachable={routerNetwork.routerReachable}
        routerUnreachable={routerUnreachable}
      />
      {/* Sky view (full-viewport) */}
      <AnimatePresence>
        {skyViewOpen && (
          <motion.div
            key='skyview'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <SatelliteView
              obstructionMap={telemetry.obstructionMap}
              obstructionStats={status?.obstructionStats}
              status={status}
              satellites={satellites}
              observerLocation={observerLocation}
              onLocationSaved={onLocationSaved}
              onClearLocation={onClearLocation}
              onClose={() => setSkyViewOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
}
