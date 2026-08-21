import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDishTelemetry } from "./hooks/useDishTelemetry";
import { useLanPresence } from "./hooks/useLanPresence";
import { AnimatePresence, motion } from "motion/react";
import { useSatellites } from "./hooks/useSatellites";
import { useObserverLocation } from "./hooks/useObserverLocation";
import { usePanelRouting } from "./hooks/usePanelRouting";
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
import { AppToolbar } from "./components/toolbar/AppToolbar";
import { DashboardView } from "./components/dashboard/DashboardView";
import { windowTail } from "./lib/telemetryWindow";
import { SatelliteView } from "./components/satellite/SatelliteView";
import { DishTerminalCard } from "./components/dashboard/DishTerminalCard";
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
import { formatThroughput } from "./lib/format";
import { TooltipProvider } from "./components/ui/tooltip";
import { useTheme } from "./hooks/useTheme";
import { dishModelFor } from "./lib/dishMesh";

export default function App() {
  const { theme, cycleTheme } = useTheme();
  const {
    openPanel,
    setOpenPanel,
    settingsTab,
    skyViewOpen,
    setSkyViewOpen,
    openNav,
    openSkyView,
  } = usePanelRouting();
  const [windowMinutes, setWindowMinutes] = useState(15);
  const notificationsOn = useSyncExternalStore(subscribeToNotifications, readNotificationsOn);
  const notificationsBlockedReason = useSyncExternalStore(
    subscribeToNotifications,
    readNotificationsBlockedReason,
  );
  const telemetry = useDishTelemetry();
  const { observerLocation, onLocationSaved, onClearLocation } = useObserverLocation(
    telemetry.dishLocation?.lla,
  );
  const lanOnline = useLanPresence(telemetry.status, telemetry.connectionState);
  const satellites = useSatellites(
    observerLocation,
    telemetry.obstructionMap,
    dishModelFor(telemetry.status),
    telemetry.status?.boresightAzimuthDeg ?? 0,
  );
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

  useEffect(() => armAlertSoundOnFirstGesture(), []);

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
              onCycleTheme={cycleTheme}
              deviceAlerts={deviceAlerts}
              notificationsOn={notificationsOn}
              notificationsBlockedReason={notificationsBlockedReason}
              onToggleNotifications={() => void toggleNotifications()}
            />
            <AppToolbar activeId={openPanel} onSelect={openNav} />

            <DashboardView
              status={status}
              connectionState={telemetry.connectionState}
              stale={telemetry.stale}
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
              samples={samples}
              onOpenSatelliteView={openSkyView}
              onExpandTerminal={() => setOpenPanel("terminal")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terminal modal */}
      {openPanel === "terminal" && status && (
        <DetailsModal title='Starlink Dish Terminal' onClose={() => setOpenPanel(null)} size='xxl'>
          <DishTerminalCard status={status} stale={telemetry.stale} expanded />
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
          <AlignmentPanel
            status={status}
            stale={telemetry.stale}
            lastStatusAtMs={telemetry.lastStatusAtMs}
            onOpenSkyView={openSkyView}
          />
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
        <NetworkPanel
          network={routerNetwork}
          unreachable={routerUnreachable}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {/* Settings modal */}
      {openPanel === "settings" && (
        <SettingsModal
          onClose={() => setOpenPanel(null)}
          status={status}
          hardwareVersion={
            telemetry.deviceInfo?.hardwareVersion ?? status?.deviceInfo?.hardwareVersion
          }
          wifiConfig={routerNetwork.wifiConfig}
          clients={routerNetwork.clients}
          initialTab={settingsTab}
          routerReachable={routerNetwork.routerReachable}
          routerViaAccount={routerNetwork.wifiConfigViaAccount}
          routerUnreachable={routerUnreachable}
          onRouterConfigChanged={routerNetwork.refreshConfig}
        />
      )}
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
              stale={telemetry.stale}
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
