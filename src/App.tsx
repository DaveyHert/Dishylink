import { useEffect, useMemo, useState } from "react";
import { useDishTelemetry } from "./hooks/useDishTelemetry";
import { useSatellites } from "./hooks/useSatellites";
import { useOutageNotifications } from "./hooks/useOutageNotifications";
import { useThermalEvents } from "./hooks/useThermalEvents";
import { useDeviceAlerts } from "./hooks/useDeviceAlerts";
import { useOutageHistory, mergeOutages } from "./hooks/useOutageHistory";
import { notificationsEnabled, toggleNotifications } from "./lib/notifications";
import { TopBar } from "./components/dashboard/TopBar";
import { StatTile } from "./components/dashboard/StatTile";
import { TelemetryChart, windowTail } from "./components/shared/TelemetryChart";
import { SkyDome } from "./components/skydome/SkyDome";
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
import { THROUGHPUT_SERIES, LATENCY_SERIES, POWER_SERIES, buildStatDetails } from "./lib/statDetails";
import { formatThroughput, formatThroughputLabel, formatThroughputTick } from "./lib/format";
import { loadSavedLocation, saveLocation, clearSavedLocation } from "./lib/observerLocation";
import type { ObserverLocation } from "./lib/satellites";
import type { TelemetrySample } from "./lib/telemetry";

type ThemeName = "light" | "dark";
type SheetName =
  | "speedtest"
  | "alignment"
  | "skyview"
  | "datausage"
  | "network"
  | "account"
  | "settings"
  | "terminal";

const WINDOW_CHOICES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

/** ToggleGroup values are strings; minutes stay the source of truth. */
const WINDOW_OPTIONS = WINDOW_CHOICES.map((choice) => ({ label: choice.label, value: String(choice.minutes) }));

// Throughput legend entry (swatch + series name).
const legendItem = "inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-secondary)]";

function sparklineFrom(samples: TelemetrySample[], getValue: (sample: TelemetrySample) => number | null) {
  return samples.slice(-90).map(getValue);
}

function recentAverage(samples: TelemetrySample[], getValue: (sample: TelemetrySample) => number | null): number {
  const recentValues = samples
    .slice(-60)
    .map(getValue)
    .filter((value): value is number => value !== null);
  if (recentValues.length === 0) return 0;
  return recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length;
}

export default function App() {
  // Dark is the instrument's resting state — it's how the Starlink app ships and
  // what the charts and beam were coloured against. A stored choice still wins.
  const [theme, setTheme] = useState<ThemeName>(() => (localStorage.getItem("dishboard-theme") as ThemeName) ?? "dark");
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [notificationsOn, setNotificationsOn] = useState(notificationsEnabled);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetName | null>(null);
  // Which device/node the Network sheet is drilled into — owned here so the
  // sheet header can carry the back chevron beside its title.
  const [networkSelectedMac, setNetworkSelectedMac] = useState<string | null>(null);
  const [savedObserver, setSavedObserver] = useState<ObserverLocation | null>(loadSavedLocation);
  const telemetry = useDishTelemetry();
  // The dish's own GPS still wins where the plan allows it (Priority); consumer
  // plans fall back to the saved/browser location.
  const observerLocation = useMemo<ObserverLocation | null>(() => {
    const dishLla = telemetry.dishLocation?.lla;
    if (dishLla?.lat !== undefined && dishLla?.lon !== undefined) {
      return { latitudeDeg: dishLla.lat, longitudeDeg: dishLla.lon, altitudeM: dishLla.alt ?? 0 };
    }
    return savedObserver;
  }, [telemetry.dishLocation, savedObserver]);
  const satellites = useSatellites(observerLocation, telemetry.obstructionMap);
  useOutageNotifications(telemetry);
  // Live alerts for both devices, and the notifications that go with them —
  // a superset of the old thermal-only notifications, off live device status.
  const deviceAlerts = useDeviceAlerts(telemetry.status, telemetry.connectionState);
  const thermalEvents = useThermalEvents();
  // The dish's own event list is short and resets on reboot; the collector's log
  // reaches further back, so the two are folded together.
  const persistedOutages = useOutageHistory();
  const outageEvents = useMemo(
    () => mergeOutages(telemetry.outageEvents, persistedOutages),
    [telemetry.outageEvents, persistedOutages],
  );
  // Router polling runs only while a router-backed surface is open.
  const routerNetwork = useRouterNetwork(openSheet === "network" || openSheet === "settings");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dishboard-theme", theme);
  }, [theme]);

  const { status, samples } = telemetry;

  const liveDownlink = formatThroughput(status?.downlinkThroughputBps ?? 0);
  const liveUplink = formatThroughput(status?.uplinkThroughputBps ?? 0);
  // The buffer holds 6h; the charts draw one window of it. Trim once here rather
  // than handing each chart the whole thing.
  const chartSamples = useMemo(() => windowTail(samples, windowMinutes), [samples, windowMinutes]);
  const livePowerW = useMemo(() => recentAverage(samples, (sample) => sample.powerW), [samples]);
  const recentDropRate = useMemo(() => recentAverage(samples, (sample) => sample.dropRate), [samples]);

  const statDetails = useMemo(
    () => buildStatDetails({ status, currentPowerW: livePowerW, outageEvents }),
    [status, livePowerW, outageEvents],
  );
  const openDetail = openDetailId ? statDetails[openDetailId] : null;

  // The hero is for a genuinely empty first run only. A refresh mid-outage also
  // starts with a null status, but the collector's backfilled samples mean there
  // is a dashboard worth showing — and an outage is exactly when it's needed.
  const showSearchingHero =
    telemetry.connectionState === "unreachable" && status === null && samples.length === 0;

  return (
    <>
      <TopBar
        connectionState={telemetry.connectionState}
        status={status}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        deviceAlerts={deviceAlerts}
        notificationsOn={notificationsOn}
        onToggleNotifications={() => {
          toggleNotifications().then(setNotificationsOn);
        }}
        onOpenSpeedTest={() => setOpenSheet("speedtest")}
        onOpenAlignment={() => setOpenSheet("alignment")}
        onOpenDataUsage={() => setOpenSheet("datausage")}
        onOpenNetwork={() => setOpenSheet("network")}
        onOpenAccount={() => setOpenSheet("account")}
        onOpenSettings={() => setOpenSheet("settings")}
      />
      {showSearchingHero ? (
        <SearchingHero />
      ) : (
        <main className="dashboard">
          <section className="tiles-row">
            <StatTile
              label="Download"
              value={liveDownlink.value}
              unit={liveDownlink.unit}
              caption="current traffic"
              sparkValues={sparklineFrom(samples, (sample) => sample.downlinkBps)}
              sparkColorVar="--series-down"
              onOpenDetail={() => setOpenDetailId("download")}
            />
            <StatTile
              label="Upload"
              value={liveUplink.value}
              unit={liveUplink.unit}
              caption="current traffic"
              sparkValues={sparklineFrom(samples, (sample) => sample.uplinkBps)}
              sparkColorVar="--series-up"
              onOpenDetail={() => setOpenDetailId("upload")}
            />
            <StatTile
              label="Latency"
              value={status?.popPingLatencyMs?.toFixed(0) ?? "—"}
              unit="ms"
              caption="pop ping, live"
              sparkValues={sparklineFrom(samples, (sample) => sample.latencyMs)}
              onOpenDetail={() => setOpenDetailId("latency")}
            />
            <StatTile
              label="Power draw"
              value={livePowerW > 0 ? livePowerW.toFixed(0) : "—"}
              unit="W"
              caption="average, last minute"
              sparkValues={sparklineFrom(samples, (sample) => sample.powerW)}
              onOpenDetail={() => setOpenDetailId("power")}
            />
            <StatTile
              label="Ping success"
              value={(100 - recentDropRate * 100).toFixed(1)}
              unit="%"
              caption="last minute"
            />
            <StatTile
              label="Sky obstructed"
              value={((status?.obstructionStats?.fractionObstructed ?? 0) * 100).toFixed(2)}
              unit="%"
              caption={
                status?.obstructionStats?.patchesValid
                  ? `${status.obstructionStats.patchesValid.toLocaleString()} patches mapped`
                  : "all-time view"
              }
            />
          </section>

          <section className="charts-grid">
            <SectionCard
              title="Throughput"
              className="col-span-8"
              headerAction={
                <SegmentedControl
                  options={WINDOW_OPTIONS}
                  value={String(windowMinutes)}
                  onChange={(minutes) => setWindowMinutes(Number(minutes))}
                  label="Chart time window"
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
              <div className="mt-2 flex items-center justify-center gap-3.5">
                <span className={legendItem}>
                  <span className="series-swatch" style={{ background: "var(--series-down)" }} /> Download
                </span>
                <span className={legendItem}>
                  <span className="series-swatch" style={{ background: "var(--series-up)" }} /> Upload
                </span>
              </div>
            </SectionCard>

            <SkyDome
              obstructionMap={telemetry.obstructionMap}
              obstructionStats={status?.obstructionStats}
              status={status}
              theme={theme}
              satellites={satellites}
              observerLocation={observerLocation}
              onLocationSaved={(location) => {
                saveLocation(location);
                setSavedObserver(location);
              }}
              onClearLocation={() => {
                clearSavedLocation();
                setSavedObserver(null);
              }}
              variant="standard"
              onOpenImmersive={() => setOpenSheet("skyview")}
            />

            <SectionCard
              title="Latency"
              className="col-span-8"
              meta="pop ping · spikes preserved · red bands = outages"
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
              title="Power draw"
              className="col-span-8"
              meta={`≈ ${((livePowerW * 24) / 1000).toFixed(2)} kWh/day at current draw`}
            >
              <TelemetryChart
                samples={chartSamples}
                series={POWER_SERIES}
                windowMinutes={windowMinutes}
                formatValue={(value) => `${value.toFixed(0)} W`}
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
                onExpand={() => setOpenSheet("terminal")}
              />
            ) : (
              <SectionCard
                title="Starlink Dish Terminal"
                className="col-span-12"
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

      {openDetail && (
        <DetailsModal title={openDetail.label} onClose={() => setOpenDetailId(null)}>
          <StatDetailPanel detail={openDetail} samples={samples} />
        </DetailsModal>
      )}
      {openSheet === "terminal" && status && (
        <DetailsModal title="Starlink Dish Terminal" onClose={() => setOpenSheet(null)} size="xxl">
          <DishTerminalCard status={status} stale={telemetry.connectionState !== "online"} expanded />
        </DetailsModal>
      )}
      {openSheet === "speedtest" && (
        <DetailsModal title="Speed test" onClose={() => setOpenSheet(null)}>
          <SpeedTestPanel samples={samples} />
        </DetailsModal>
      )}
      {openSheet === "alignment" && status && (
        <DetailsModal title="Alignment" onClose={() => setOpenSheet(null)} size="wide">
          <AlignmentPanel status={status} onOpenSkyView={() => setOpenSheet("skyview")} />
        </DetailsModal>
      )}
      {openSheet === "datausage" && (
        <DetailsModal title="Data usage" onClose={() => setOpenSheet(null)} size="wide">
          <DataUsagePanel />
        </DetailsModal>
      )}
      {openSheet === "account" && (
        <DetailsModal title="Starlink account" onClose={() => setOpenSheet(null)} size="wide">
          <AccountPanel />
        </DetailsModal>
      )}
      {openSheet === "network" && (
        <DetailsModal
          title="Network"
          onBack={networkSelectedMac ? () => setNetworkSelectedMac(null) : undefined}
          onClose={() => {
            setOpenSheet(null);
            setNetworkSelectedMac(null);
          }}
          size="wide"
        >
          <NetworkPanel
            network={routerNetwork}
            selectedMac={networkSelectedMac}
            onSelect={setNetworkSelectedMac}
          />
        </DetailsModal>
      )}
      <SettingsModal
        open={openSheet === "settings"}
        onClose={() => setOpenSheet(null)}
        status={status}
        hardwareVersion={telemetry.deviceInfo?.hardwareVersion ?? status?.deviceInfo?.hardwareVersion}
        wifiConfig={routerNetwork.wifiConfig}
        routerReachable={routerNetwork.routerReachable}
      />
      {openSheet === "skyview" && (
        <DetailsModal title="Satellite view" onClose={() => setOpenSheet(null)} size="xl">
          <SkyDome
            caption="Satellites shown are propagated live from SpaceX's published ephemerides."
            status={status}
            obstructionMap={telemetry.obstructionMap}
            obstructionStats={status?.obstructionStats}
            theme={theme}
            satellites={satellites}
            observerLocation={observerLocation}
            onLocationSaved={(location) => {
              saveLocation(location);
              setSavedObserver(location);
            }}
            onClearLocation={() => {
              clearSavedLocation();
              setSavedObserver(null);
            }}
            variant="immersive"
          />
        </DetailsModal>
      )}
    </>
  );
}
