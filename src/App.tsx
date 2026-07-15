import { useEffect, useMemo, useState } from "react";
import { useDishTelemetry } from "./hooks/useDishTelemetry";
import { useSatellites } from "./hooks/useSatellites";
import { useOutageNotifications } from "./hooks/useOutageNotifications";
import { notificationsEnabled, toggleNotifications } from "./lib/notifications";
import { TopBar } from "./components/TopBar";
import { StatTile } from "./components/StatTile";
import { TelemetryChart } from "./components/TelemetryChart";
import { SkyDome } from "./components/SkyDome";
import { OutageLog } from "./components/OutageLog";
import { DevicePanel } from "./components/DevicePanel";
import { StatDetailModal } from "./components/StatDetailModal";
import { SheetModal } from "./components/SheetModal";
import { SpeedTestPanel } from "./components/SpeedTestCard";
import { AlignmentPanel } from "./components/AlignmentCard";
import { THROUGHPUT_SERIES, LATENCY_SERIES, POWER_SERIES, buildStatDetails } from "./lib/statDetails";
import { formatThroughput, formatThroughputLabel, formatThroughputTick } from "./lib/format";
import { loadSavedLocation, saveLocation, clearSavedLocation } from "./lib/observerLocation";
import type { ObserverLocation } from "./lib/satellites";
import type { TelemetrySample } from "./lib/telemetry";

type ThemeName = "light" | "dark";
type SheetName = "speedtest" | "alignment" | "terminal";

const WINDOW_CHOICES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

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

function SearchingHero() {
  return (
    <div className="searching-hero">
      <div className="radar" />
      <div className="searching-title">SEARCHING FOR DISH</div>
      <p className="searching-copy">
        Dishboard talks to your Starlink terminal directly at <code>192.168.100.1</code>. Make sure this
        machine is connected to the Starlink network (Wi‑Fi or ethernet behind the Starlink router) and
        that the dish is powered. Retrying automatically…
      </p>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(() => (localStorage.getItem("dishboard-theme") as ThemeName) ?? "light");
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [notificationsOn, setNotificationsOn] = useState(notificationsEnabled);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetName | null>(null);
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dishboard-theme", theme);
  }, [theme]);

  const { status, samples } = telemetry;

  const liveDownlink = formatThroughput(status?.downlinkThroughputBps ?? 0);
  const liveUplink = formatThroughput(status?.uplinkThroughputBps ?? 0);
  const livePowerW = useMemo(() => recentAverage(samples, (sample) => sample.powerW), [samples]);
  const recentDropRate = useMemo(() => recentAverage(samples, (sample) => sample.dropRate), [samples]);

  const statDetails = useMemo(
    () => buildStatDetails({ status, currentPowerW: livePowerW, outageEvents: telemetry.outageEvents }),
    [status, livePowerW, telemetry.outageEvents],
  );
  const openDetail = openDetailId ? statDetails[openDetailId] : null;

  const hasEverConnected = status !== null;
  const showSearchingHero = telemetry.connectionState === "unreachable" && !hasEverConnected;

  return (
    <>
      <TopBar
        connectionState={telemetry.connectionState}
        status={status}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        notificationsOn={notificationsOn}
        onToggleNotifications={() => {
          toggleNotifications().then(setNotificationsOn);
        }}
        onOpenSpeedTest={() => setOpenSheet("speedtest")}
        onOpenAlignment={() => setOpenSheet("alignment")}
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
              onOpenDetail={() => setOpenDetailId("download")}
            />
            <StatTile
              label="Upload"
              value={liveUplink.value}
              unit={liveUplink.unit}
              caption="current traffic"
              sparkValues={sparklineFrom(samples, (sample) => sample.uplinkBps)}
              sparkColorVar="--chart-warm"
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
              caption="all-time view"
            />
          </section>

          <section className="charts-grid">
            <div className="card span-8">
              <div className="card-header">
                <span className="card-title">Throughput</span>
                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="series-swatch" style={{ background: "var(--chart-ink)" }} /> Download
                  </span>
                  <span className="legend-item">
                    <span className="series-swatch" style={{ background: "var(--chart-warm)" }} /> Upload
                  </span>
                  <div className="window-picker">
                    {WINDOW_CHOICES.map((choice) => (
                      <button
                        key={choice.minutes}
                        className={windowMinutes === choice.minutes ? "active" : ""}
                        onClick={() => setWindowMinutes(choice.minutes)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <TelemetryChart
                samples={samples}
                series={THROUGHPUT_SERIES}
                windowMinutes={windowMinutes}
                formatValue={formatThroughputLabel}
                formatTick={formatThroughputTick}
                outageEvents={telemetry.outageEvents}
              />
            </div>

            <SkyDome
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
            />

            <div className="card span-8">
              <div className="card-header">
                <span className="card-title">Latency</span>
                <span className="card-meta">pop ping · spikes preserved · red bands = outages</span>
              </div>
              <TelemetryChart
                samples={samples}
                series={LATENCY_SERIES}
                windowMinutes={windowMinutes}
                formatValue={(value) => `${value.toFixed(0)} ms`}
                outageEvents={telemetry.outageEvents}
                height={160}
              />
            </div>

            <div className="card span-8">
              <div className="card-header">
                <span className="card-title">Power draw</span>
                <span className="card-meta">
                  ≈ {((livePowerW * 24) / 1000).toFixed(2)} kWh/day at current draw
                </span>
              </div>
              <TelemetryChart
                samples={samples}
                series={POWER_SERIES}
                windowMinutes={windowMinutes}
                formatValue={(value) => `${value.toFixed(0)} W`}
                height={160}
              />
            </div>

            <OutageLog outageEvents={telemetry.outageEvents} />

            {status && <DevicePanel status={status} />}
          </section>
        </main>
      )}

      {openDetail && (
        <StatDetailModal detail={openDetail} samples={samples} onClose={() => setOpenDetailId(null)} />
      )}
      {openSheet === "speedtest" && (
        <SheetModal title="Speed test" onClose={() => setOpenSheet(null)}>
          <SpeedTestPanel />
        </SheetModal>
      )}
      {openSheet === "alignment" && status && (
        <SheetModal title="Alignment" onClose={() => setOpenSheet(null)} wide>
          <AlignmentPanel status={status} />
        </SheetModal>
      )}
    </>
  );
}
