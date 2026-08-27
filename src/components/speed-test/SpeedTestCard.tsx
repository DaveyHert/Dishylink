// Speed test panel: download/upload/latency headline figures over a live gauge or
// beam view. Throughput is measured through the real link against Cloudflare;
// latency, jitter and loss are read off the dish's own per-second PoP-ping
// telemetry for the window the test ran (see speedTest.ts for why timing a fetch
// is the wrong instrument for latency).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ClockIcon, LoaderIcon, RotateCcwIcon } from "lucide-react";
import { runSpeedTest, type SpeedTestProgress } from "../../lib/speedTest";
import type { TelemetrySample } from "@core/telemetry";
import type { DishStatusJson } from "@core/dishClient";
import { dishModelFor } from "../../lib/dishMesh";
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
  resting: "Done.",
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
function linkQualityOver(
  samples: TelemetrySample[],
  startedAtMs: number | null,
  endedAtMs: number | null,
): LinkQuality {
  if (startedAtMs === null) return NO_QUALITY;
  const until = endedAtMs ?? Date.now();
  const window = samples.filter(
    (sample) => sample.timestampMs >= startedAtMs && sample.timestampMs <= until,
  );
  const latencies = window
    .map((sample) => sample.latencyMs)
    .filter((latency): latency is number => latency !== null);
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
// The unit sits next to the number, not up in the label, so the row reads the same
// way as every other figure in the app (see FigureRow).
function HeadlineFigure({
  icon,
  label,
  unit,
  value,
  digits,
  active,
}: {
  icon: ReactNode;
  label: string;
  unit: string;
  value: number | null;
  digits: number;
  active: boolean;
}) {
  const pending = value === null;
  return (
    <div
      className={`flex-1 pt-2 pb-[9px] text-center transition-opacity ${active ? "opacity-100" : "opacity-50"}`}
    >
      <div
        className={`text-[11px] font-semibold tracking-[0.04em] ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        <span className='inline-flex align-[-1px]'>{icon}</span> {label}
      </div>
      {/* The number is what the eye tracks down the column, so it — not the
          number-plus-unit — is what sits centred under the label. The unit rides
          along outside the flow so a 1- or 3-digit reading doesn't shift it. */}
      <div
        className={`text-[28px] font-bold leading-[1.1] tracking-[-0.01em] tabular-nums ${pending ? "text-muted-foreground" : "text-foreground"}`}
      >
        <span className='relative inline-block'>
          {pending ? "0" : fmt(value, digits)}
          <span className='absolute bottom-[0.14em] left-full ml-[4px] text-[13px] font-medium text-muted-foreground'>
            {unit}
          </span>
        </span>
      </div>
    </div>
  );
}

function MetricPill({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className='flex items-center gap-[7px]'>
      <span className='text-[12px] text-muted-foreground'>{label}</span>
      <span className='text-[13px] font-semibold text-foreground tabular-nums'>
        {value}
        <span className='font-medium text-muted-foreground'> {unit}</span>
      </span>
    </div>
  );
}

export function SpeedTestPanel({
  samples,
  status,
}: {
  samples: TelemetrySample[];
  /** Live status, for the one thing the illustration needs: which kit to draw. */
  status: DishStatusJson | null;
}) {
  const [progress, setProgress] = useState<SpeedTestProgress>(IDLE_PROGRESS);
  const [view, setView] = useState<SpeedView>("beam");
  // The panel unmounts when it is closed, but a run is bound only by its own
  // clock — so without this it keeps six streams (and then a whole upload phase)
  // saturating the link after the panel is gone.
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);
  const { phase } = progress;
  const isRunning = phase === "download" || phase === "upload";
  const quality = linkQualityOver(samples, progress.startedAtMs, progress.endedAtMs);

  const failed = phase === "error";
  // The filled button belongs to the untouched panel only. It hands off the moment
  // a run starts, not when one finishes — carrying the fill through the run made the
  // button change colour under a spinner nobody was looking at.
  const untouched = phase === "idle";

  // What the gauge needle currently reflects. A failed run says so rather than
  // resting on "Ready": every other element on the panel returns to its idle
  // look when a test fails, so a gauge that also reads "Ready" left nothing at
  // all to distinguish "it broke" from "you haven't pressed Go yet".
  const gauge =
    phase === "upload"
      ? { value: progress.uploadMbps, mode: "upload" as const, caption: "Upload" }
      : phase === "download"
        ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
        : phase === "done"
          ? { value: progress.downloadMbps, mode: "download" as const, caption: "Download" }
          : // The rest between upload and the download reading: the needle drains to 0
            // under the download caption the reading returns in, so it settles up from
            // zero. Kept in download mode (not idle) so the beam stays lit through the
            // handoff, mirroring how the download→upload rest holds the upload look.
            phase === "resting"
            ? { value: null, mode: "download" as const, caption: "Download" }
            : failed
              ? { value: null, mode: "idle" as const, caption: "Failed" }
              : { value: null, mode: "idle" as const, caption: "Ready" };

  return (
    <div className='flex flex-col items-center gap-1'>
      <SegmentedControl
        variant='glider'
        label='Speed test view'
        className='mb-3'
        disabled={isRunning}
        value={view}
        onChange={setView}
        options={[
          { value: "beam", label: "Starlink" },
          { value: "gauge", label: "Gauge" },
        ]}
      />

      <div className='flex w-full gap-3'>
        {/* Emphasis marks the phase being measured; with nothing running they read equally. */}
        {/* Throughput carries the decimal the gauge shows; latency is a median of
            whole-millisecond pings, so a decimal there would be invented precision. */}
        <HeadlineFigure
          icon={<ArrowDownIcon size={12} strokeWidth={2.5} />}
          label='DOWNLOAD'
          unit='Mbps'
          digits={1}
          value={progress.downloadMbps}
          active={!isRunning || phase === "download"}
        />
        <HeadlineFigure
          icon={<ArrowUpIcon size={12} strokeWidth={2.5} />}
          label='UPLOAD'
          unit='Mbps'
          digits={1}
          value={progress.uploadMbps}
          active={!isRunning || phase === "upload"}
        />
        <HeadlineFigure
          icon={<ClockIcon size={12} strokeWidth={2.5} />}
          label='LATENCY'
          unit='ms'
          digits={0}
          value={quality.latencyMs}
          active={!isRunning}
        />
      </div>

      <div className='flex w-full justify-center gap-[18px] border-t border-b border-border py-2'>
        {/* a decimal place: real Starlink jitter is often sub-1ms and would round to a bare 0 */}
        <MetricPill label='Jitter' value={fmt(quality.jitterMs, 1)} unit='ms' />
        <MetricPill label='Loss' value={fmt(quality.lossPct, 1)} unit='%' />
      </div>

      {view === "beam" ? (
        <SpeedBeam
          value={gauge.value}
          mode={gauge.mode}
          caption={gauge.caption}
          // Lit through the whole test, the rest between download and upload
          // included, so the beam holds across the handoff and drops only at the end.
          testActive={isRunning || phase === "resting"}
          dishModel={dishModelFor(status)}
        />
      ) : (
        <SpeedGauge value={gauge.value} mode={gauge.mode} caption={gauge.caption} />
      )}

      {/* Filled until you've run something: with nothing on the panel to look at,
          the button is the one thing to press, and the translucent treatment left
          it competing with the empty gauge. Once a reading is up the reading is the
          point, so "Run again" steps back to the quieter fill. */}
      <button
        className={`mt-2 flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-0 py-[11px] font-sans text-[14px] font-semibold transition-colors duration-300 disabled:cursor-default ${
          untouched
            ? "bg-[color-mix(in_srgb,var(--ink)_86%,transparent)] text-page enabled:hover:bg-ink"
            : "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-foreground enabled:hover:bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] disabled:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] disabled:text-muted-foreground"
        }`}
        disabled={isRunning || phase === "resting"}
        onClick={() => {
          // Whatever was in flight loses the link first: two runs measure each
          // other's load, and both report the result low.
          run.current?.abort();
          run.current = new AbortController();
          void runSpeedTest(setProgress, run.current.signal);
        }}
      >
        {isRunning || phase === "resting" ? (
          <LoaderIcon
            className='animate-[speedtest-spin_1s_steps(12,end)_infinite]'
            size={20}
            strokeWidth={2.5}
            aria-label='Running speed test'
          />
        ) : phase === "done" ? (
          <>
            <RotateCcwIcon size={15} strokeWidth={2.5} /> Run again
          </>
        ) : failed ? (
          <>
            <RotateCcwIcon size={15} strokeWidth={2.5} /> Try again
          </>
        ) : (
          "Go"
        )}
      </button>
      {/* A failure has to look like one. This line is the only place the panel
          reports an outcome, and in muted grey it was indistinguishable from the
          idle helper text it replaces — so a failed run read as "nothing
          happened", which is exactly how it was reported. */}
      <div
        className={`mt-2.5 text-center text-[11.5px] font-medium ${failed ? "text-destructive" : "text-muted-foreground"}`}
        role={failed ? "alert" : undefined}
      >
        {PHASE_LABEL[phase]}
      </div>
      <div className='mt-1 text-center text-[10.5px] font-medium text-muted-foreground opacity-70'>
        Measured against Cloudflare · may read lower than tests to a nearby server
      </div>
    </div>
  );
}
