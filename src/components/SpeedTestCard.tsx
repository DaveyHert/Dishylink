// Speed test sheet: Ookla-style gauge that sweeps live through the download and
// upload phases, with download/upload headline figures and a ping/jitter/loss
// row. Measures through the actual Starlink link via the dev-server proxy (the
// dish's own speedtest RPCs are unimplemented).

import { useState } from "react";
import { runSpeedTest, type SpeedTestProgress } from "../lib/speedTest";
import { SpeedGauge } from "./SpeedGauge";
import { SpinLoader } from "./loaders/SpinLoader";

const IDLE_PROGRESS: SpeedTestProgress = {
  phase: "idle",
  downloadMbps: null,
  uploadMbps: null,
  latencyMs: null,
  jitterMs: null,
};

const PHASE_LABEL: Record<SpeedTestProgress["phase"], string> = {
  idle: "Measures download, upload, and latency through your Starlink link.",
  latency: "Measuring latency…",
  download: "Measuring download…",
  upload: "Measuring upload…",
  done: "Done.",
  error: "Test failed — check the connection and try again.",
};

function fmt(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

function HeadlineFigure({ arrow, label, value, active }: { arrow: string; label: string; value: string; active: boolean }) {
  return (
    <div className={`speed-headline${active ? " active" : ""}`}>
      <div className="speed-headline-label">
        <span className="speed-headline-arrow">{arrow}</span> {label} <span className="speed-headline-unit">Mbps</span>
      </div>
      <div className="speed-headline-value">{value}</div>
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

export function SpeedTestPanel() {
  const [progress, setProgress] = useState<SpeedTestProgress>(IDLE_PROGRESS);
  const { phase } = progress;
  const isRunning = phase === "latency" || phase === "download" || phase === "upload";

  // What the gauge needle currently reflects.
  const gauge =
    phase === "upload"
      ? { value: progress.uploadMbps, mode: "upload" as const, caption: "Upload" }
      : phase === "download"
        ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
        : phase === "done"
          ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
          : { value: null, mode: "idle" as const, caption: isRunning ? "Latency" : "Ready" };

  return (
    <div className="speedtest">
      <div className="speed-headlines">
        <HeadlineFigure arrow="↓" label="DOWNLOAD" value={fmt(progress.downloadMbps)} active={phase === "download"} />
        <HeadlineFigure arrow="↑" label="UPLOAD" value={fmt(progress.uploadMbps)} active={phase === "upload"} />
      </div>

      <div className="speed-metrics">
        <MetricPill label="Ping" value={fmt(progress.latencyMs)} unit="ms" />
        <MetricPill label="Jitter" value={fmt(progress.jitterMs)} unit="ms" />
        <MetricPill label="Loss" value="—" unit="%" />
      </div>

      <SpeedGauge value={gauge.value} mode={gauge.mode} caption={gauge.caption} />

      <button
        className="speedtest-button"
        disabled={isRunning}
        onClick={() => {
          void runSpeedTest(setProgress);
        }}
      >
        {isRunning ? <SpinLoader variant="activity" size={20} label="Running speed test" /> : phase === "done" ? "Run again" : "Go"}
      </button>
      <div className="stat-caption speedtest-status">{PHASE_LABEL[phase]}</div>
      <div className="stat-caption speedtest-source">
        Measured against Cloudflare · may read lower than tests to a nearby server
      </div>
    </div>
  );
}
