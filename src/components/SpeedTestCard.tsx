// Speed test sheet: download/upload/latency headline figures over a live gauge or
// beam view. Throughput is measured through the real link against Cloudflare;
// latency, jitter and loss are read off the dish's own per-second PoP-ping
// telemetry for the window the test ran (see speedTest.ts for why timing a fetch
// is the wrong instrument for latency).

import { useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ClockIcon, LoaderIcon, RotateCcwIcon } from "lucide-react";
import { runSpeedTest, type SpeedTestProgress } from "../lib/speedTest";
import type { TelemetrySample } from "../lib/telemetry";
import { SpeedGauge } from "./SpeedGauge";
import { SpeedBeam } from "./SpeedBeam";

type SpeedView = "gauge" | "beam";

const IDLE_PROGRESS: SpeedTestProgress = {
  phase: "idle",
  downloadMbps: null,
  uploadMbps: null,
  startedAtMs: null,
  endedAtMs: null,
};

const PHASE_LABEL: Record<SpeedTestProgress["phase"], string> = {
  idle: "Measures download, upload, and latency through your Starlink link.",
  download: "Measuring download…",
  upload: "Measuring upload…",
  done: "Done.",
  error: "Test failed — check the connection and try again.",
};

interface LinkQuality {
  latencyMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
}

const NO_QUALITY: LinkQuality = { latencyMs: null, jitterMs: null, lossPct: null };

/**
 * Latency/jitter/loss for the run, taken from the dish's PoP pings over the test
 * window. The dish samples once a second but history is polled every few seconds,
 * so these fill in shortly after the run finishes rather than instantly — the
 * Starlink app behaves the same way for the same reason.
 */
function linkQualityOver(samples: TelemetrySample[], startedAtMs: number | null, endedAtMs: number | null): LinkQuality {
  if (startedAtMs === null) return NO_QUALITY;
  const until = endedAtMs ?? Date.now();
  const window = samples.filter((sample) => sample.timestampMs >= startedAtMs && sample.timestampMs <= until);
  const latencies = window.map((sample) => sample.latencyMs).filter((latency): latency is number => latency !== null);
  if (latencies.length === 0) return NO_QUALITY;

  // Jitter = mean absolute difference between consecutive pings (Ookla-style).
  let jitterSum = 0;
  for (let i = 1; i < latencies.length; i++) jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
  const jitterMs = latencies.length > 1 ? jitterSum / (latencies.length - 1) : 0;

  const sorted = [...latencies].sort((first, second) => first - second);
  const lossPct = (window.reduce((sum, sample) => sum + sample.dropRate, 0) / window.length) * 100;
  return { latencyMs: sorted[Math.floor(sorted.length / 2)], jitterMs, lossPct };
}

function fmt(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

// Unmeasured figures read as a muted 0 rather than a dash, as in the Starlink app.
function HeadlineFigure({
  icon,
  label,
  unit,
  value,
  active,
}: {
  icon: ReactNode;
  label: string;
  unit: string;
  value: number | null;
  active: boolean;
}) {
  const pending = value === null;
  return (
    <div className={`speed-headline${active ? " active" : ""}`}>
      <div className="speed-headline-label">
        <span className="speed-headline-icon">{icon}</span> {label} <span className="speed-headline-unit">{unit}</span>
      </div>
      <div className={`speed-headline-value${pending ? " pending" : ""}`}>{pending ? "0" : fmt(value)}</div>
    </div>
  );
}

function MetricPill({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="speed-metric">
      <span className="speed-metric-label">{label}</span>
      <span className="speed-metric-value">
        {value}
        <span className="speed-metric-unit"> {unit}</span>
      </span>
    </div>
  );
}

export function SpeedTestPanel({ samples }: { samples: TelemetrySample[] }) {
  const [progress, setProgress] = useState<SpeedTestProgress>(IDLE_PROGRESS);
  const [view, setView] = useState<SpeedView>("beam");
  const { phase } = progress;
  const isRunning = phase === "download" || phase === "upload";
  const quality = linkQualityOver(samples, progress.startedAtMs, progress.endedAtMs);

  // What the gauge needle currently reflects.
  const gauge =
    phase === "upload"
      ? { value: progress.uploadMbps, mode: "upload" as const, caption: "Upload" }
      : phase === "download"
        ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
        : phase === "done"
          ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
          : { value: null, mode: "idle" as const, caption: "Ready" };

  return (
    <div className="speedtest">
      <div className="speed-segment" role="tablist" aria-label="Speed test view">
        <button
          role="tab"
          aria-selected={view === "beam"}
          className={view === "beam" ? "active" : ""}
          disabled={isRunning}
          onClick={() => setView("beam")}
        >
          Starlink
        </button>
        <button
          role="tab"
          aria-selected={view === "gauge"}
          className={view === "gauge" ? "active" : ""}
          disabled={isRunning}
          onClick={() => setView("gauge")}
        >
          Gauge
        </button>
      </div>

      <div className="speed-headlines">
        {/* Emphasis marks the phase being measured; with nothing running they read equally. */}
        <HeadlineFigure
          icon={<ArrowDownIcon size={12} strokeWidth={2.5} />}
          label="DOWNLOAD"
          unit="Mbps"
          value={progress.downloadMbps}
          active={!isRunning || phase === "download"}
        />
        <HeadlineFigure
          icon={<ArrowUpIcon size={12} strokeWidth={2.5} />}
          label="UPLOAD"
          unit="Mbps"
          value={progress.uploadMbps}
          active={!isRunning || phase === "upload"}
        />
        <HeadlineFigure
          icon={<ClockIcon size={12} strokeWidth={2.5} />}
          label="LATENCY"
          unit="ms"
          value={quality.latencyMs}
          active={!isRunning}
        />
      </div>

      <div className="speed-metrics">
        {/* a decimal place: real Starlink jitter is often sub-1ms and would round to a bare 0 */}
        <MetricPill label="Jitter" value={fmt(quality.jitterMs, 1)} unit="ms" />
        <MetricPill label="Loss" value={fmt(quality.lossPct, 1)} unit="%" />
      </div>

      {view === "beam" ? (
        <SpeedBeam value={gauge.value} mode={gauge.mode} caption={gauge.caption} running={isRunning} />
      ) : (
        <SpeedGauge value={gauge.value} mode={gauge.mode} caption={gauge.caption} />
      )}

      <button
        className="speedtest-button"
        disabled={isRunning}
        onClick={() => {
          void runSpeedTest(setProgress);
        }}
      >
        {isRunning ? (
          <LoaderIcon className="speedtest-spinner" size={20} strokeWidth={2.5} aria-label="Running speed test" />
        ) : phase === "done" ? (
          <>
            <RotateCcwIcon size={15} strokeWidth={2.5} /> Run again
          </>
        ) : (
          "Go"
        )}
      </button>
      <div className="stat-caption speedtest-status">{PHASE_LABEL[phase]}</div>
      <div className="stat-caption speedtest-source">Measured against Cloudflare · may read lower than tests to a nearby server</div>
    </div>
  );
}
