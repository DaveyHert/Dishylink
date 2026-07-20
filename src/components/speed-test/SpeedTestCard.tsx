// Speed test sheet: download/upload/latency headline figures over a live gauge or
// beam view. Throughput is measured through the real link against Cloudflare;
// latency, jitter and loss are read off the dish's own per-second PoP-ping
// telemetry for the window the test ran (see speedTest.ts for why timing a fetch
// is the wrong instrument for latency).

import { useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ClockIcon, LoaderIcon, RotateCcwIcon } from "lucide-react";
import { runSpeedTest, type SpeedTestProgress } from "../../lib/speedTest";
import type { TelemetrySample } from "../../lib/telemetry";
import { SpeedGauge } from "./SpeedGauge";
import { SpeedBeam } from "./SpeedBeam";
import { SegmentedControl } from "../ui/segmented-control";

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
    <div className={`flex-1 pt-2 pb-[9px] text-center transition-opacity ${active ? "opacity-100" : "opacity-50"}`}>
      <div
        className={`text-[11px] font-semibold tracking-[0.04em] ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        <span className="inline-flex align-[-1px]">{icon}</span> {label}{" "}
        <span className="font-medium">{unit}</span>
      </div>
      <div
        className={`text-[28px] font-bold leading-[1.1] tracking-[-0.01em] ${pending ? "text-muted-foreground" : "text-foreground"}`}
      >
        {pending ? "0" : fmt(value)}
      </div>
    </div>
  );
}

function MetricPill({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center gap-[7px]">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-semibold text-foreground tabular-nums">
        {value}
        <span className="font-medium text-muted-foreground"> {unit}</span>
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
    <div className="flex flex-col items-center gap-1">
      <SegmentedControl
        variant="glider"
        label="Speed test view"
        className="mb-3"
        disabled={isRunning}
        value={view}
        onChange={setView}
        options={[
          { value: "beam", label: "Starlink" },
          { value: "gauge", label: "Gauge" },
        ]}
      />

      <div className="flex w-full gap-3">
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

      <div className="flex w-full justify-center gap-[18px] border-t border-b border-border py-2">
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
        className="mt-2 flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] py-[11px] font-sans text-[14px] font-semibold text-foreground transition-colors enabled:hover:bg-[color-mix(in_srgb,var(--ink)_18%,transparent)] disabled:cursor-default disabled:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:text-muted-foreground"
        disabled={isRunning}
        onClick={() => {
          void runSpeedTest(setProgress);
        }}
      >
        {isRunning ? (
          <LoaderIcon
            className="animate-[speedtest-spin_1s_steps(12,end)_infinite] motion-reduce:animate-none"
            size={20}
            strokeWidth={2.5}
            aria-label="Running speed test"
          />
        ) : phase === "done" ? (
          <>
            <RotateCcwIcon size={15} strokeWidth={2.5} /> Run again
          </>
        ) : (
          "Go"
        )}
      </button>
      <div className="mt-2.5 text-center text-[11.5px] font-medium text-muted-foreground">{PHASE_LABEL[phase]}</div>
      <div className="mt-1 text-center text-[10.5px] font-medium text-muted-foreground opacity-70">
        Measured against Cloudflare · may read lower than tests to a nearby server
      </div>
    </div>
  );
}
