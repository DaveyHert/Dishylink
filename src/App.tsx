import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useDishTelemetry } from "./hooks/useDishTelemetry";
import { useLanPresence } from "./hooks/useLanPresence";
import { AnimatePresence, motion } from "motion/react";
import { useSatellites } from "./hooks/useSatellites";
import { useAccountLocation } from "./hooks/useAccountLocation";
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
import { StatTile } from "./components/dashboard/StatTile";
import { TelemetryChart } from "./components/shared/TelemetryChart";
import { windowTail } from "./lib/telemetryWindow";
import { ObstructionCard } from "./components/obstruction/ObstructionCard";
import { SatelliteView } from "./components/satellite/SatelliteView";
import { OutageLog } from "./components/alerts/OutageLog";
import { SearchingHero } from "./components/dashboard/SearchingHero";
import { DishTerminalCard } from "./components/dashboard/DishTerminalCard";
import { StatDetailPanel } from "./components/dashboard/StatDetailPanel";
import { DetailsModal } from "./components/ui/details-modal";
import { SegmentedControl } from "./components/ui/segmented-control";
import { SectionCard } from "./components/ui/section-card";
import { SpeedTestPanel } from "./components/speed-test/SpeedTestCard";
import { AlignmentPanel } from "./components/alignment/AlignmentCard";
import { DataUsagePanel } from "./components/data-usage/DataUsagePanel";
import { NetworkPanel } from "./components/network/NetworkPanel";
import { AccountPanel } from "./components/account/AccountPanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { useRouterNetwork } from "./hooks/useRouterNetwork";
import { useLiveReadings } from "./hooks/useLiveReadings";
import {
  THROUGHPUT_SERIES,
  LATENCY_SERIES,
  POWER_SERIES,
  buildStatDetails,
} from "./lib/statDetails";
import { formatThroughput, formatThroughputLabel, formatThroughputTick } from "./lib/format";
import {
  loadSavedLocation,
  loadLocationCleared,
  saveLocation,
  clearSavedLocation,
} from "./lib/observerLocation";
import type { ObserverLocation } from "./lib/satellites";
import { TooltipProvider } from "./components/ui/tooltip";

type ThemeName = "light" | "dark";
type PanelName =
  "speedtest" | "alignment" | "datausage" | "network" | "account" | "settings" | "terminal";

const WINDOW_CHOICES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

/** ToggleGroup values are strings; minutes stay the source of truth. */
const WINDOW_OPTIONS = WINDOW_CHOICES.map((choice) => ({
  label: choice.label,
  value: String(choice.minutes),
}));

// Throughput legend entry (swatch + series name).
const legendItem =
  "inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-secondary)]";

export default function App() {
  // Dark is the instrument's resting state — it's how the Starlink app ships and
  // what the charts and beam were coloured against. A stored choice still wins.
  const [theme, setTheme] = useState<ThemeName>(
    () => (localStorage.getItem("dishboard-theme") as ThemeName) ?? "dark",
  );
  const [windowMinutes, setWindowMinutes] = useState(15);
  // Read from the notifications module rather than held here, because this window
  // is not the only thing that changes it: the desktop tray switches notifications
  // on and off with no window involved. Subscribing is what keeps this control and
  // that one showing the same answer.
  const notificationsOn = useSyncExternalStore(subscribeToNotifications, readNotificationsOn);
  // Why nothing is arriving despite being asked for, shown beside the toggle so it
  // explains itself instead of reading as a dead click.
  const notificationsBlockedReason = useSyncExternalStore(
    subscribeToNotifications,
    readNotificationsBlockedReason,
  );
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  // Full-viewport surface: the dashboard behind it is unmounted, not just covered,
  // so its dome canvas and per-frame draw loop stop while it cannot be seen.
  // Carried in the URL fragment rather than in `openPanel` — it is a place you
  // can be, so the back button should leave it and a reload should return to it.
  const [skyViewOpen, setSkyViewOpen] = useHashRoute("satellite");
  // Which device/node the Network panel is drilled into — owned here so the
  // panel header can carry the back chevron beside its title.
  const [networkSelectedKey, setNetworkSelectedKey] = useState<string | null>(null);
  const [savedObserver, setSavedObserver] = useState<ObserverLocation | null>(loadSavedLocation);
  // Tracked apart from `savedObserver === null`, which cannot tell "never set
  // one" from "cleared it on purpose". Only the former may be filled in
  // automatically.
  const [locationCleared, setLocationCleared] = useState(loadLocationCleared);
  const telemetry = useDishTelemetry();
  // Where the dish is, best source first: the dish itself (priority customers), then the app's saved observer, then the account's location.
  const dishLla = telemetry.dishLocation?.lla;
  const hasDishGps = dishLla?.lat !== undefined && dishLla?.lon !== undefined;
  const accountObserver = useAccountLocation(
    !hasDishGps && savedObserver === null && !locationCleared,
  );
  const observerLocation = useMemo<ObserverLocation | null>(() => {
    if (dishLla?.lat !== undefined && dishLla?.lon !== undefined) {
      return { latitudeDeg: dishLla.lat, longitudeDeg: dishLla.lon, altitudeM: dishLla.alt ?? 0 };
    }
    return savedObserver ?? accountObserver;
  }, [dishLla, savedObserver, accountObserver]);
  // Which account devices this machine can reach directly, so the account
  // panel's dots read the LAN's last few seconds instead of the cloud's
  // ~2-minute-old telemetry. Rides polls already running — costs neither device
  // a request.
  const lanOnline = useLanPresence(telemetry.status, telemetry.connectionState);
  const satellites = useSatellites(observerLocation, telemetry.obstructionMap);
  useOutageNotifications(telemetry);
  // Live alerts for both devices, and the notifications that go with them, read
  // off live device status rather than the historian.
  const deviceAlerts = useDeviceAlerts(telemetry.status, telemetry.connectionState);
  const thermalEvents = useThermalEvents();
  // The dish's own event list is short and resets on reboot; the historian's log
  // reaches further back, so the two are folded together.
  const persistedOutages = useOutageHistory();
  const outageEvents = useMemo(
    () => mergeOutages(telemetry.outageEvents, persistedOutages),
    [telemetry.outageEvents, persistedOutages],
  );
  // Router polling runs only while a router-backed surface is open.
  const routerNetwork = useRouterNetwork(openPanel === "network" || openPanel === "settings");

  // The toolbar's destinations: five open a panel over the dashboard; the sky
  // view is a place of its own, so it leaves the panels and routes to the
  // full-viewport surface instead.
  const openNav = (id: ToolbarItemId) => {
    if (id === "satellite") {
      setOpenPanel(null);
      setSkyViewOpen(true);
    } else {
      setOpenPanel(id);
    }
  };

  // Browsers only let audio start after a gesture; take the first one going.
  useEffect(() => armAlertSoundOnFirstGesture(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dishboard-theme", theme);
  }, [theme]);

  const { status, samples } = telemetry;

  // Forward the live throughput to the desktop readout — the macOS menu bar or the
  // Windows taskbar strip — so it shows the same number this dashboard does. A
  // no-op in the browser and the extension, where the bridge is absent.
  useEffect(() => {
    window.dishlink?.reportThroughput?.(
      status?.downlinkThroughputBps ?? 0,
      status?.uplinkThroughputBps ?? 0,
    );
  }, [status]);

  // One clock for the tiles and the chart windows alike, so a figure and the
  // chart beneath it describe the same instant — except power, whose figure and
  // chart both settle instead on the 5s boundary (`powerWindowEndMs`).
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
  // The buffer holds 6h; the charts draw one window of it. Trim once here rather
  // than handing each chart the whole thing.
  const chartSamples = useMemo(
    () => windowTail(samples, windowMinutes, nowMs),
    [samples, windowMinutes, nowMs],
  );
  // The power chart's window ends on the 5s boundary, so its trim is anchored
  // there too: a live floor would keep dropping samples still inside the frozen
  // window, marching the left edge every second under an otherwise still chart.
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

  // The hero is for a genuinely empty first run only. A refresh mid-outage also
  // starts with a null status, but the historian's backfilled samples mean there
  // is a dashboard worth showing — and an outage is exactly when it's needed.
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
            {showSearchingHero ? (
              <SearchingHero />
            ) : (
              <main className='mx-auto flex max-w-[1400px] flex-col gap-3.5 px-6 pt-3.5 pb-12 animate-[rise_400ms_ease_both]'>
                <section className='grid grid-cols-6 gap-3.5 max-[1080px]:grid-cols-3'>
                  <StatTile
                    label='Download'
                    value={liveDownlink.value}
                    unit={liveDownlink.unit}
                    caption='current traffic'
                    sparkValues={sparklines.downlink}
                    sparkColorVar='--series-down'
                    onOpenDetail={() => setOpenDetailId("download")}
                  />
                  <StatTile
                    label='Upload'
                    value={liveUplink.value}
                    unit={liveUplink.unit}
                    caption='current traffic'
                    sparkValues={sparklines.uplink}
                    sparkColorVar='--series-up'
                    onOpenDetail={() => setOpenDetailId("upload")}
                  />
                  <StatTile
                    label='Latency'
                    value={(status?.popPingLatencyMs ?? 0).toFixed(0)}
                    unit='ms'
                    caption='pop ping, live'
                    sparkValues={sparklines.latency}
                    onOpenDetail={() => setOpenDetailId("latency")}
                  />
                  <StatTile
                    label='Power draw'
                    value={livePowerW.toFixed(0)}
                    unit='W'
                    caption='current draw'
                    sparkValues={sparklines.power}
                    onOpenDetail={() => setOpenDetailId("power")}
                  />
                  <StatTile
                    label='Ping success'
                    value={recentPingSuccessPercent.toFixed(1)}
                    unit='%'
                    caption='last minute'
                    sparkValues={sparklines.pingSuccess}
                    onOpenDetail={() => setOpenDetailId("pingSuccess")}
                  />
                  <StatTile
                    label='Sky obstructed'
                    value={((status?.obstructionStats?.fractionObstructed ?? 0) * 100).toFixed(2)}
                    unit='%'
                    caption={
                      status?.obstructionStats?.patchesValid
                        ? `${status.obstructionStats.patchesValid.toLocaleString()} patches mapped`
                        : "all-time view"
                    }
                  />
                </section>

                {/* 12-col on desktop. At ≤1080px it switches to a flex column so the
                  children's col-span-* turns inert and every card stacks full width —
                  a plain grid-cols-1 wouldn't, since a col-span-8 child spawns
                  implicit columns rather than clamping to the lone column. */}
                <section className='grid grid-cols-12 gap-3.5 max-[1080px]:flex max-[1080px]:flex-col'>
                  <SectionCard
                    title='Throughput'
                    className='col-span-8'
                    headerAction={
                      <SegmentedControl
                        options={WINDOW_OPTIONS}
                        value={String(windowMinutes)}
                        onChange={(minutes) => setWindowMinutes(Number(minutes))}
                        label='Chart time window'
                      />
                    }
                  >
                    <TelemetryChart
                      samples={chartSamples}
                      series={THROUGHPUT_SERIES}
                      windowMinutes={windowMinutes}
                      formatValue={formatThroughputLabel}
                      formatTick={formatThroughputTick}
                      outageEvents={outageEvents}
                    />
                    <div className='mt-2 flex items-center justify-center gap-3.5'>
                      <span className={legendItem}>
                        <span
                          className='size-[9px] flex-none rounded-full'
                          style={{ background: "var(--series-down)" }}
                        />{" "}
                        Download
                      </span>
                      <span className={legendItem}>
                        <span
                          className='size-[9px] flex-none rounded-full'
                          style={{ background: "var(--series-up)" }}
                        />{" "}
                        Upload
                      </span>
                    </div>
                  </SectionCard>

                  <ObstructionCard
                    obstructionMap={telemetry.obstructionMap}
                    obstructionStats={status?.obstructionStats}
                    status={status}
                    onOpenSatelliteView={() => setSkyViewOpen(true)}
                  />

                  <SectionCard
                    title='Latency'
                    className='col-span-8'
                    meta='pop ping · red bands = outages'
                  >
                    <TelemetryChart
                      samples={chartSamples}
                      series={LATENCY_SERIES}
                      windowMinutes={windowMinutes}
                      formatValue={(value) => `${value.toFixed(0)} ms`}
                      outageEvents={outageEvents}
                      height={160}
                    />
                  </SectionCard>

                  <SectionCard
                    title='Power draw'
                    className='col-span-8'
                    meta={`≈ ${((averagePowerW * 24) / 1000).toFixed(2)} kWh/day at recent draw`}
                  >
                    <TelemetryChart
                      samples={powerChartSamples}
                      series={POWER_SERIES}
                      windowMinutes={windowMinutes}
                      formatValue={(value) => `${value.toFixed(0)} W`}
                      windowEndMs={powerWindowEndMs}
                      height={160}
                    />
                  </SectionCard>

                  {/* Thermal episodes join the event list, but not the charts above:
                    those shade outage bands, and a throttle is not an outage. */}
                  <OutageLog outageEvents={[...outageEvents, ...thermalEvents]} />

                  {/* The card never unmounts on an outage: last-known facts with a
                    stale caveat beat a silently missing card. Only a session that
                    has never heard from the dish has nothing to render. */}
                  {status ? (
                    <DishTerminalCard
                      status={status}
                      stale={telemetry.connectionState !== "online"}
                      onExpand={() => setOpenPanel("terminal")}
                    />
                  ) : (
                    <SectionCard
                      title='Starlink Dish Terminal'
                      className='col-span-12'
                      meta={
                        telemetry.connectionState === "unreachable"
                          ? "dish isn’t answering — no status received yet"
                          : "waiting for the dish’s first reply…"
                      }
                    />
                  )}
                </section>
              </main>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {openDetail && (
        <DetailsModal
          title={openDetail.modalTitle ?? openDetail.label}
          onClose={() => setOpenDetailId(null)}
        >
          <StatDetailPanel detail={openDetail} samples={samples} />
        </DetailsModal>
      )}
      {openPanel === "terminal" && status && (
        <DetailsModal title='Starlink Dish Terminal' onClose={() => setOpenPanel(null)} size='xxl'>
          <DishTerminalCard
            status={status}
            stale={telemetry.connectionState !== "online"}
            expanded
          />
        </DetailsModal>
      )}
      {openPanel === "speedtest" && (
        <DetailsModal title='Speed test' onClose={() => setOpenPanel(null)}>
          <SpeedTestPanel samples={samples} status={status} />
        </DetailsModal>
      )}
      {openPanel === "alignment" && status && (
        <DetailsModal title='Alignment' onClose={() => setOpenPanel(null)} size='wide'>
          <AlignmentPanel status={status} onOpenSkyView={() => setSkyViewOpen(true)} />
        </DetailsModal>
      )}
      {openPanel === "datausage" && (
        <DetailsModal title='Data usage' onClose={() => setOpenPanel(null)} size='wide'>
          <DataUsagePanel />
        </DetailsModal>
      )}
      {openPanel === "account" && (
        <DetailsModal title='Starlink account' onClose={() => setOpenPanel(null)} size='wide'>
          <AccountPanel lanOnline={lanOnline} />
        </DetailsModal>
      )}
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
            selectedKey={networkSelectedKey}
            onSelect={setNetworkSelectedKey}
          />
        </DetailsModal>
      )}
      <SettingsModal
        open={openPanel === "settings"}
        onClose={() => setOpenPanel(null)}
        status={status}
        hardwareVersion={
          telemetry.deviceInfo?.hardwareVersion ?? status?.deviceInfo?.hardwareVersion
        }
        wifiConfig={routerNetwork.wifiConfig}
        routerReachable={routerNetwork.routerReachable}
      />
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
              onLocationSaved={(location) => {
                saveLocation(location);
                setSavedObserver(location);
                setLocationCleared(false);
              }}
              onClearLocation={() => {
                clearSavedLocation();
                setSavedObserver(null);
                setLocationCleared(true);
              }}
              onClose={() => setSkyViewOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </TooltipProvider>
  );
}
