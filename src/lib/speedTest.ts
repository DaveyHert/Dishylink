// Browser-measured speed test over the Starlink link, hitting Cloudflare's
// speed endpoints directly (they send `Access-Control-Allow-Origin: *`, so no
// proxy is needed — and going direct is essential: a proxy buffers the upload
// body and would measure browser→proxy instead of the real uplink). The dish's
// own speedtest RPCs are unimplemented on current firmware (verified via grpcurl).
//
// Throughput only — latency is deliberately NOT measured here. Timing a fetch to
// Cloudflare clocks DNS/TCP/TLS setup plus edge processing (~220ms, and ~600ms on
// the cold first probe) rather than the link, which is why that reading used to
// disagree wildly with the Starlink app. The dish reports its own PoP round trip
// (~18ms), so the panel reads latency off dish telemetry for the run's window.

const CLOUDFLARE = "https://speed.cloudflare.com";

export interface SpeedTestProgress {
  phase: "idle" | "download" | "upload" | "resting" | "done" | "error";
  downloadMbps: number | null;
  uploadMbps: number | null;
  /** Wall-clock span of the run, so latency can be read off the dish's own
   *  per-second samples for exactly the window we were loading the link. */
  startedAtMs: number | null;
  endedAtMs: number | null;
}

// Several concurrent streams to saturate the link (a single TCP stream over
// Starlink's latency is BDP/slow-start limited and under-reads).
const STREAMS = 6;
// Chunk sizes, NOT budgets: a stream re-requests until the phase decides to stop.
// Sized large enough that a fast link spends its time transferring, not in setup.
const DOWNLOAD_CHUNK_BYTES = 25_000_000;
const UPLOAD_CHUNK_BYTES = 8_000_000;
const SAMPLE_INTERVAL_MS = 250;
// Ramp-up (connection setup + TCP slow start) is excluded from the figure.
const RAMP_MS = 1_000;
const SETTLE_MS = 900; // post-ramp delay before the live rate is worth showing
const MEASURE_MS = 10_000; // steady-state window, timed identically for both directions
const PHASE_MS = RAMP_MS + MEASURE_MS;
// Gaps so the gauge settles between phases instead of snapping.
const HOLD_RESULT_MS = 900; // keep the download result on the gauge
const REST_MS = 1_100; // let the needle ease back to 0 and rest before upload

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * Runs a phase for a fixed steady-state window rather than a fixed byte budget.
 * Bytes-as-terminator is what made our phases wildly unequal in duration — a fast
 * link drained the budget in ~3s (never reaching steady state) while a slow one
 * was truncated mid-transfer. Time-bounding makes both directions take the same
 * wall clock regardless of speed, which is the property that actually matters.
 *
 * Why a fixed window and not fast.com's dynamic "stop when the estimate settles":
 * both were built and measured here. Stability detection needs a rate signal that
 * can genuinely go flat, and ours can't. Upload rate is derived from XHR
 * `event.loaded`, which reports socket-buffer drains in bursts — instantaneous
 * rates spiked past 1000% of the true average, and no ±10%-over-3s test ever
 * fired, so the "dynamic" duration just ran to its cap every time. A fixed window
 * reaches the same place with far less machinery, and matches M-Lab NDT7 (a fixed
 * 10s test) rather than fast.com. Revisit only with a smoother rate signal.
 *
 * The reported rate is the cumulative average *since the ramp*: it converges and
 * structurally can't freefall (numerator and denominator both only grow), which is
 * what keeps the gauge readable. Per-interval instantaneous rates were tried here
 * and are far too bursty to show. Ramp-up (connection setup + TCP slow start) is
 * excluded from both the live figure and the result, as fast.com describes.
 */
function startPhase(getBytes: () => number, onMbps: (mbps: number) => void, signal?: AbortSignal) {
  const startedAt = performance.now();
  let rampBytes: number | null = null;
  let rampAt = 0;

  const rateSinceRamp = (nowMs: number): number => {
    const [markBytes, markAt] = rampBytes === null ? [0, startedAt] : [rampBytes, rampAt];
    const seconds = (nowMs - markAt) / 1000;
    return seconds > 0 ? ((getBytes() - markBytes) * 8) / seconds / 1e6 : 0;
  };

  const timer = setInterval(() => {
    const now = performance.now();
    if (rampBytes === null) {
      // Mark the end of the ramp: bytes from here on are steady-state.
      if (now - startedAt >= RAMP_MS) {
        rampBytes = getBytes();
        rampAt = now;
      }
      return;
    }
    // Hold the readout back until the post-ramp window is wide enough to divide by:
    // a single buffered burst over ~300ms reads as a wild spike before converging.
    if (now - rampAt >= SETTLE_MS) onMbps(rateSinceRamp(now));
  }, SAMPLE_INTERVAL_MS);

  return {
    // Cancelling ends the phase exactly as its own clock running out does — the
    // stream loops and the stop watchers all read this one predicate.
    shouldStop: () => signal?.aborted === true || performance.now() - startedAt >= PHASE_MS,
    /** Final figure, measured over the post-ramp window only. */
    finish: (): number => {
      clearInterval(timer);
      return rateSinceRamp(performance.now());
    },
  };
}

async function measureDownload(
  onMbps: (mbps: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const abortController = new AbortController();
  // Cancelling the run cuts the in-flight bodies the same way the phase's own
  // clock does below.
  signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  let receivedBytes = 0;
  const phase = startPhase(() => receivedBytes, onMbps, signal);
  // Cut in-flight bodies the moment the phase is done, so a settled fast link
  // isn't held open pulling another 25MB it no longer needs.
  const stopWatcher = setInterval(() => {
    if (phase.shouldStop()) abortController.abort();
  }, 100);

  // Each stream re-requests until the phase stops. Errors are swallowed per
  // stream so one failure can't fail the whole test.
  const runStream = async () => {
    try {
      while (!phase.shouldStop()) {
        const response = await fetch(
          `${CLOUDFLARE}/__down?bytes=${DOWNLOAD_CHUNK_BYTES}&r=${Math.random()}`,
          {
            cache: "no-store",
            signal: abortController.signal,
          },
        );
        const bodyReader = response.body!.getReader();
        for (;;) {
          const chunk = await bodyReader.read();
          if (chunk.done) break;
          receivedBytes += chunk.value.length;
        }
      }
    } catch {
      // aborted/failed stream — keep whatever bytes it delivered
    }
  };

  await Promise.allSettled(Array.from({ length: STREAMS }, runStream));
  clearInterval(stopWatcher);
  const mbps = phase.finish();

  if (receivedBytes === 0) throw new Error("download failed");
  return mbps;
}

// Parallel XHR uploads (not fetch) because only xhr.upload emits progress. Each
// stream posts chunks back-to-back until the phase stops, and `event.loaded` is
// summed across them. `loaded` is bytes drained to the socket — with buffers far
// smaller than the payload, that tracks real upload throughput under backpressure.
async function measureUpload(
  onMbps: (mbps: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  // Bytes from finished chunks, plus the in-flight chunk's progress. Kept apart
  // so a chunk's bytes are counted exactly once as it rolls over.
  const sentPerStream = new Array<number>(STREAMS).fill(0);
  const inFlightPerStream = new Array<number>(STREAMS).fill(0);
  const totalBytes = () =>
    sentPerStream.reduce((sum, n) => sum + n, 0) + inFlightPerStream.reduce((sum, n) => sum + n, 0);

  const phase = startPhase(totalBytes, onMbps, signal);
  const inFlight = new Set<XMLHttpRequest>();
  const stopWatcher = setInterval(() => {
    if (phase.shouldStop()) inFlight.forEach((xhr) => xhr.abort());
  }, 100);
  // Don't wait up to 100ms for the watcher: cancelling drops the sockets now.
  signal?.addEventListener("abort", () => inFlight.forEach((xhr) => xhr.abort()), { once: true });

  // One buffer shared by every stream — it's only ever read.
  const payload = new Uint8Array(UPLOAD_CHUNK_BYTES);
  crypto.getRandomValues(payload.subarray(0, 65_536));

  // `loadend` fires on success, error, abort, and timeout, so each chunk always
  // resolves — one failing chunk can't reject the whole test. Bytes actually sent
  // are counted, so an aborted chunk still contributes what it managed to push.
  const sendChunk = (streamIndex: number): Promise<void> =>
    new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      inFlight.add(xhr);
      xhr.open("POST", `${CLOUDFLARE}/__up`);
      xhr.timeout = PHASE_MS + 5_000;
      xhr.upload.addEventListener("progress", (event) => {
        inFlightPerStream[streamIndex] = event.loaded;
      });
      xhr.addEventListener("loadend", () => {
        inFlight.delete(xhr);
        sentPerStream[streamIndex] += inFlightPerStream[streamIndex];
        inFlightPerStream[streamIndex] = 0;
        resolve();
      });
      xhr.send(payload);
    });

  const uploadStream = async (streamIndex: number) => {
    while (!phase.shouldStop()) await sendChunk(streamIndex);
  };

  await Promise.all(Array.from({ length: STREAMS }, (_, index) => uploadStream(index)));
  clearInterval(stopWatcher);
  const mbps = phase.finish();

  if (totalBytes() === 0) throw new Error("upload failed");
  return mbps;
}

/**
 * `signal` cancels the run. Without it a test outlives whatever started it: the
 * streams are bound only by the phase clock, so closing the panel mid-test left
 * six streams — then a whole upload phase that began after the unmount —
 * saturating the link for the rest of the ~26s run, invisibly, since progress
 * updates to a gone component are silent no-ops.
 */
export async function runSpeedTest(
  onProgress: (progress: SpeedTestProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const progress: SpeedTestProgress = {
    phase: "download",
    downloadMbps: null,
    uploadMbps: null,
    startedAtMs: Date.now(),
    endedAtMs: null,
  };
  // A cancelled run stops speaking: whoever cancelled is no longer listening,
  // and a late phase change would otherwise land on a panel that moved on.
  const report = () => {
    if (!signal?.aborted) onProgress({ ...progress });
  };
  report();
  try {
    progress.downloadMbps = await measureDownload((liveMbps) => {
      progress.downloadMbps = liveMbps;
      report();
    }, signal);
    report(); // hold the final download reading on the gauge…
    await delay(HOLD_RESULT_MS, signal);

    // Switch to upload with no value yet, so the needle eases down to 0 and rests
    // before the upload sweep organically kicks in.
    progress.phase = "upload";
    progress.uploadMbps = null;
    report();
    await delay(REST_MS, signal);

    progress.uploadMbps = await measureUpload((liveMbps) => {
      progress.uploadMbps = liveMbps;
      report();
    }, signal);
    // Close the measurement window here, at the true end of upload — the hold and
    // rest that follow are idle time, and letting them into the window would drag
    // ~2s of post-test pings into the latency/jitter/loss figures.
    progress.endedAtMs = Date.now();
    report(); // hold the final upload reading on the gauge…
    await delay(HOLD_RESULT_MS, signal);

    // Mirror the download→upload handoff: drain the needle to 0 and rest before the
    // download reading returns, so it settles up from zero rather than gliding
    // straight off the upload figure (which reads as upload still climbing).
    progress.phase = "resting";
    report();
    await delay(REST_MS, signal);

    progress.phase = "done";
    report();
  } catch {
    // A cancelled run is not a failed one — the streams were told to stop, and
    // there is nobody left to tell about it.
    if (signal?.aborted) return;
    progress.phase = "error";
    report();
  }
}
