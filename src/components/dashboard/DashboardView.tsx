import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DishStatusJson, DishObstructionMapJson } from "@core/dishClient";
import { readRouterLatencyMs, type OutageEvent, type TelemetrySample } from "@core/telemetry";
import type { OutageReport } from "@core/postmortem";
import type { DishConnectionState } from "../../hooks/useDishTelemetry";
import type { LiveSparklines } from "../../hooks/useLiveReadings";
import { gradeColorVar } from "@core/latencySummary";
import { StatTile, type StatTileProps as StatTileConfig } from "./StatTile";
import { LatencyDetailPanel } from "./LatencyDetailPanel";
import { useLatencyHistory } from "../../hooks/useLatencyHistory";
import { TelemetryChart } from "../shared/TelemetryChart";
import { ObstructionCard } from "../obstruction/ObstructionCard";
import { OutageLog } from "../alerts/OutageLog";
import { SearchingHero } from "./SearchingHero";
import { DishTerminalCard } from "./DishTerminalCard";
import { SegmentedControl } from "../ui/segmented-control";
import { SectionCard } from "../ui/section-card";
import {
  throughputSeries,
  latencySeries,
  powerSeries,
  buildStatDetails,
} from "../../lib/statDetails";
import { DetailsModal } from "../ui/details-modal";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatThroughputLabel, formatThroughputTick } from "../../lib/format";
import { AppPrompts } from "../shared/AppPrompts";

const CHART_TIME_RANGES: { label: string; minutes: number }[] = [
  { label: "15M", minutes: 15 },
  { label: "1H", minutes: 60 },
  { label: "6H", minutes: 360 },
];

const CHART_TIME_RANGE_FILTER_OPTIONS = CHART_TIME_RANGES.map((range) => ({
  label: range.label,
  value: String(range.minutes),
}));

const legendItem = "inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary";

const THROUGHPUT_LEGEND_COLORS = ["--series-down", "--series-up"];

interface DashboardViewProps {
  status: DishStatusJson | null;
  connectionState: DishConnectionState;
  /** Debounced offline flag from the telemetry hook — the terminal card's stale
   *  badge keys off this, not the raw connectionState, so a blip doesn't flash it. */
  stale: boolean;
  obstructionMap: DishObstructionMapJson | null;
  liveDownlink: { value: string; unit: string };
  liveUplink: { value: string; unit: string };
  sparklines: LiveSparklines;
  livePowerW: number;
  recentPingSuccessPercent: number;
  windowMinutes: number;
  onWindowMinutesChange: (minutes: number) => void;
  chartSamples: TelemetrySample[];
  powerChartSamples: TelemetrySample[];
  powerWindowEndMs: number;
  averagePowerW: number;
  outageEvents: OutageEvent[];
  thermalEvents: OutageEvent[];
  reports: OutageReport[];
  samples: TelemetrySample[];
  onOpenSatelliteView: () => void;
  onExpandTerminal: () => void;
  /** Opens the network panel on one device, from an event that names it. */
  onOpenDevice: (entryKey: string) => void;
}

export function DashboardView({
  status,
  connectionState,
  stale,
  obstructionMap,
  liveDownlink,
  liveUplink,
  sparklines,
  livePowerW,
  recentPingSuccessPercent,
  windowMinutes,
  onWindowMinutesChange,
  chartSamples,
  powerChartSamples,
  powerWindowEndMs,
  averagePowerW,
  outageEvents,
  thermalEvents,
  reports,
  samples,
  onOpenSatelliteView,
  onExpandTerminal,
  onOpenDevice,
}: DashboardViewProps) {
  const { t } = useTranslation();
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const latencyQuality = useLatencyHistory("1h", true);
  // Memoised on `t` so each chart keeps one series array per language and its
  // bucket-binning memo is not invalidated every render.
  const chartSeries = useMemo(
    () => ({
      throughput: throughputSeries(t),
      latency: latencySeries(t),
      power: powerSeries(t),
    }),
    [t],
  );
  const statDetails = useMemo(
    () =>
      buildStatDetails({
        status,
        currentPowerW: livePowerW,
        powerWindowEndMs,
        recentPingSuccessPercent,
        outageEvents,
        t,
      }),
    [status, livePowerW, powerWindowEndMs, recentPingSuccessPercent, outageEvents, t],
  );

  const openDetail = openDetailId ? statDetails[openDetailId] : null;
  const detailModal = openDetail && (
    <DetailsModal
      title={openDetail.modalTitle ?? openDetail.label}
      onClose={() => setOpenDetailId(null)}
    >
      {openDetailId === "latency" ? (
        <LatencyDetailPanel detail={openDetail} samples={samples} />
      ) : (
        <StatDetailPanel detail={openDetail} samples={samples} />
      )}
    </DetailsModal>
  );

  if (connectionState === "unreachable" && status === null && samples.length === 0) {
    return (
      <>
        {detailModal}
        <SearchingHero />
      </>
    );
  }

  // popPingLatencyMs carries the same non-measurement sentinels (proto3's
  // omitted zero, an occasional negative) that readRouterLatencyMs already
  // filters for the router's own reading — the tile must reject them too.
  const liveLatencyMs = readRouterLatencyMs(status?.popPingLatencyMs);

  const statTiles: StatTileConfig[] = [
    {
      label: t("metrics.download"),
      value: liveDownlink.value,
      unit: liveDownlink.unit,
      caption: t("metrics.currentTraffic"),
      sparkValues: sparklines.downlink,
      sparkColorVar: "--series-down",
      onOpenDetail: () => setOpenDetailId("download"),
    },
    {
      label: t("metrics.upload"),
      value: liveUplink.value,
      unit: liveUplink.unit,
      caption: t("metrics.currentTraffic"),
      sparkValues: sparklines.uplink,
      sparkColorVar: "--series-up",
      onOpenDetail: () => setOpenDetailId("upload"),
    },
    {
      label: t("metrics.latency"),
      value: (liveLatencyMs ?? 0).toFixed(0),
      unit: "ms",
      caption:
        !latencyQuality.unavailable && latencyQuality.data ? (
          <span className='flex w-full items-center justify-between gap-2 whitespace-nowrap'>
            <span>
              {t("metrics.quality")}:{" "}
              <span className='text-[13px] font-semibold text-foreground'>
                {latencyQuality.data.score}
              </span>
              , {t("metrics.grade")}{" "}
              <span
                className='text-[10px]'
                style={{ color: `var(${gradeColorVar(latencyQuality.data.grade)})` }}
              >
                {latencyQuality.data.grade}
              </span>
            </span>
            <span aria-hidden className='max-[1300px]:hidden'>
              ·
            </span>
            <span className='flex-none max-[1300px]:hidden'>
              {latencyQuality.data.dish.p95 !== null
                ? `${latencyQuality.data.dish.p95.toFixed(0)} ms p95`
                : t("metrics.noData")}
            </span>
          </span>
        ) : (
          t("metrics.popPingLive")
        ),
      sparkValues: sparklines.latency,
      onOpenDetail: () => setOpenDetailId("latency"),
    },
    {
      label: t("metrics.powerDraw"),
      value: livePowerW.toFixed(0),
      unit: "W",
      caption: t("metrics.currentDraw"),
      sparkValues: sparklines.power,
      onOpenDetail: () => setOpenDetailId("power"),
    },
    {
      label: t("metrics.pingSuccess"),
      value: recentPingSuccessPercent.toFixed(1),
      unit: "%",
      caption: t("metrics.lastMinute"),
      sparkValues: sparklines.pingSuccess,
      onOpenDetail: () => setOpenDetailId("pingSuccess"),
    },
    {
      label: t("metrics.skyObstructed"),
      value: ((status?.obstructionStats?.fractionObstructed ?? 0) * 100).toFixed(2),
      unit: "%",
      caption: status?.obstructionStats?.patchesValid
        ? t("metrics.patchesMapped", { count: status.obstructionStats.patchesValid })
        : t("metrics.allTimeView"),
    },
  ];

  return (
    <main className='mx-auto flex max-w-[1400px] flex-col gap-3.5 px-6 pt-3.5 pb-20 animate-[rise_400ms_ease_both]'>
      <AppPrompts />

      {/* Stat tiles */}
      <section className='grid grid-cols-6 gap-3.5 max-[1080px]:grid-cols-3'>
        {statTiles.map((tile) => (
          <StatTile key={tile.label} {...tile} />
        ))}
      </section>

      <section className='grid grid-cols-12 gap-3.5 max-[1080px]:flex max-[1080px]:flex-col'>
        {/* Throughput chart */}
        <SectionCard
          title={t("metrics.throughput")}
          className='col-span-8'
          headerAction={
            <SegmentedControl
              options={CHART_TIME_RANGE_FILTER_OPTIONS}
              value={String(windowMinutes)}
              onChange={(minutes) => onWindowMinutesChange(Number(minutes))}
              label={t("metrics.chartTimeWindow")}
            />
          }
        >
          <TelemetryChart
            samples={chartSamples}
            series={chartSeries.throughput}
            windowMinutes={windowMinutes}
            formatValue={formatThroughputLabel}
            formatTick={formatThroughputTick}
            outageEvents={outageEvents}
          />
          <div className='mt-2 flex items-center justify-center gap-3.5'>
            {chartSeries.throughput.map((entry, index) => (
              <span key={entry.id} className={legendItem}>
                <span
                  className='size-[9px] flex-none rounded-full'
                  style={{ background: `var(${THROUGHPUT_LEGEND_COLORS[index]})` }}
                />{" "}
                {entry.label}
              </span>
            ))}
          </div>
        </SectionCard>

        {/* Obstruction map */}
        <ObstructionCard
          obstructionMap={obstructionMap}
          obstructionStats={status?.obstructionStats}
          status={status}
          onOpenSatelliteView={onOpenSatelliteView}
        />

        {/* Latency chart */}
        <SectionCard
          title={t("metrics.latency")}
          className='col-span-8'
          meta={t("metrics.latencyMeta")}
        >
          <TelemetryChart
            samples={chartSamples}
            series={chartSeries.latency}
            windowMinutes={windowMinutes}
            formatValue={(value) => `${value.toFixed(0)} ms`}
            outageEvents={outageEvents}
            height={160}
          />
        </SectionCard>

        {/* Power draw chart */}
        <SectionCard
          title={t("metrics.powerDraw")}
          className='col-span-8'
          meta={t("metrics.powerMeta", {
            value: ((averagePowerW * 24) / 1000).toFixed(2),
          })}
        >
          <TelemetryChart
            samples={powerChartSamples}
            series={chartSeries.power}
            windowMinutes={windowMinutes}
            formatValue={(value) => `${value.toFixed(0)} W`}
            windowEndMs={powerWindowEndMs}
            height={160}
          />
        </SectionCard>

        {/* Outage log */}
        <OutageLog
          outageEvents={[...outageEvents, ...thermalEvents]}
          reports={reports}
          onOpenDevice={onOpenDevice}
        />

        {/* Terminal card */}
        {status ? (
          <DishTerminalCard status={status} stale={stale} onExpand={onExpandTerminal} />
        ) : (
          <SectionCard
            title={t("navigation.dishTerminal")}
            className='col-span-12'
            meta={
              connectionState === "unreachable"
                ? t("metrics.dishNotAnswering")
                : t("metrics.waitingForDish")
            }
          />
        )}
      </section>
      {detailModal}
    </main>
  );
}
