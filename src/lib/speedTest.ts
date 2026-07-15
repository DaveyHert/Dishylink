// Browser-measured speed test over the Starlink link, hitting Cloudflare's
// speed endpoints directly (they send `Access-Control-Allow-Origin: *`, so no
// proxy is needed — and going direct is essential: a proxy buffers the upload
// body and would measure browser→proxy instead of the real uplink). The dish's
// own speedtest RPCs are unimplemented on current firmware (verified via grpcurl).

const CLOUDFLARE = "https://speed.cloudflare.com";

export interface SpeedTestProgress {
  phase: "idle" | "latency" | "download" | "upload" | "done" | "error";
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
}

// Ookla-style: several concurrent streams to saturate the link (a single TCP
// stream over Starlink's latency is BDP/slow-start limited and under-reads).
const STREAMS = 6;
const DOWNLOAD_BYTES_PER_STREAM = 20_000_000;
const UPLOAD_BYTES_PER_STREAM = 8_000_000;
const PHASE_TIME_LIMIT_MS = 12_000;
const LATENCY_PROBES = 4;
const SAMPLE_INTERVAL_MS = 250;
// Gaps so the gauge settles between phases instead of snapping.
const HOLD_RESULT_MS = 900; // keep the download result on the gauge
const REST_MS = 1_100; // let the needle ease back to 0 and rest before upload

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Samples a byte counter and reports the *cumulative average* rate
 * (bytesSoFar·8 / elapsed). This converges and structurally can't freefall —
 * both numerator and denominator only grow. The first 0.5s is skipped to hide
 * the connection-setup transient. (Instantaneous per-interval rates are far too
 * bursty for a gauge; going direct to Cloudflare removed the proxy artifact that
 * previously made cumulative decay, so cumulative is the right choice now.)
 */
function startRateSampler(getBytes: () => number, onMbps: (mbps: number) => void): () => void {
  const startedAt = performance.now();
  const timer = setInterval(() => {
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    if (elapsedSeconds > 0.5) onMbps((getBytes() * 8) / elapsedSeconds / 1e6);
  }, SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
}

async function measureLatency(): Promise<{ latencyMs: number; jitterMs: number }> {
  const roundTrips: number[] = [];
  for (let probeIndex = 0; probeIndex < LATENCY_PROBES; probeIndex++) {
    const startedAt = performance.now();
    try {
      await fetch(`${CLOUDFLARE}/__down?bytes=0&cachebust=${Date.now()}-${probeIndex}`, { cache: "no-store" });
      roundTrips.push(performance.now() - startedAt);
    } catch {
      // drop a failed probe rather than failing the whole test
    }
  }
  if (roundTrips.length === 0) return { latencyMs: 0, jitterMs: 0 };
  // Jitter = mean absolute difference between consecutive probes (Ookla-style).
  let jitterSum = 0;
  for (let i = 1; i < roundTrips.length; i++) jitterSum += Math.abs(roundTrips[i] - roundTrips[i - 1]);
  const jitterMs = roundTrips.length > 1 ? jitterSum / (roundTrips.length - 1) : 0;
  roundTrips.sort((first, second) => first - second);
  return { latencyMs: roundTrips[Math.floor(roundTrips.length / 2)], jitterMs };
}

async function measureDownload(onMbps: (mbps: number) => void): Promise<number> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PHASE_TIME_LIMIT_MS);
  const startedAt = performance.now();
  let receivedBytes = 0;
  const stopSampler = startRateSampler(() => receivedBytes, onMbps);

  // Each stream swallows its own errors so one failure can't fail the whole test.
  const runStream = async () => {
    try {
      const response = await fetch(`${CLOUDFLARE}/__down?bytes=${DOWNLOAD_BYTES_PER_STREAM}&r=${Math.random()}`, {
        cache: "no-store",
        signal: abortController.signal,
      });
      const bodyReader = response.body!.getReader();
      for (;;) {
        const chunk = await bodyReader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.length;
      }
    } catch {
      // aborted/failed stream — keep whatever bytes it delivered
    }
  };

  await Promise.allSettled(Array.from({ length: STREAMS }, runStream));
  clearTimeout(timeoutId);
  stopSampler();

  const totalSeconds = (performance.now() - startedAt) / 1000;
  if (receivedBytes === 0 || totalSeconds <= 0) throw new Error("download failed");
  return (receivedBytes * 8) / totalSeconds / 1e6;
}

// Parallel XHR uploads (not fetch) because only xhr.upload emits progress. Each
// stream's `event.loaded` is summed; the sampler turns the aggregate into a live
// rate. `loaded` is bytes drained to the socket — with buffers far smaller than
// the payload, that tracks real upload throughput under backpressure.
async function measureUpload(onMbps: (mbps: number) => void): Promise<number> {
  const loadedPerStream = new Array<number>(STREAMS).fill(0);
  const startedAt = performance.now();
  const stopSampler = startRateSampler(() => loadedPerStream.reduce((sum, n) => sum + n, 0), onMbps);

  // `loadend` fires on success, error, abort, and timeout, so each stream always
  // resolves — one failing stream can't reject the whole test. We count bytes
  // actually sent (loadedPerStream), so a partial stream still contributes.
  const uploadStream = (streamIndex: number): Promise<void> =>
    new Promise((resolve) => {
      const payload = new Uint8Array(UPLOAD_BYTES_PER_STREAM);
      crypto.getRandomValues(payload.subarray(0, 65_536));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${CLOUDFLARE}/__up`);
      xhr.timeout = PHASE_TIME_LIMIT_MS + 5_000;
      xhr.upload.addEventListener("progress", (event) => {
        loadedPerStream[streamIndex] = event.loaded;
      });
      xhr.addEventListener("loadend", () => resolve());
      xhr.send(payload);
    });

  await Promise.all(Array.from({ length: STREAMS }, (_, index) => uploadStream(index)));
  stopSampler();

  const totalSeconds = (performance.now() - startedAt) / 1000;
  const totalBytes = loadedPerStream.reduce((sum, n) => sum + n, 0);
  if (totalBytes === 0 || totalSeconds <= 0) throw new Error("upload failed");
  return (totalBytes * 8) / totalSeconds / 1e6;
}

export async function runSpeedTest(onProgress: (progress: SpeedTestProgress) => void): Promise<void> {
  const progress: SpeedTestProgress = {
    phase: "latency",
    downloadMbps: null,
    uploadMbps: null,
    latencyMs: null,
    jitterMs: null,
  };
  const report = () => onProgress({ ...progress });
  report();
  try {
    const latency = await measureLatency();
    progress.latencyMs = latency.latencyMs;
    progress.jitterMs = latency.jitterMs;
    progress.phase = "download";
    report();
    progress.downloadMbps = await measureDownload((liveMbps) => {
      progress.downloadMbps = liveMbps;
      report();
    });
    report(); // hold the final download reading on the gauge…
    await delay(HOLD_RESULT_MS);

    // Switch to upload with no value yet, so the needle eases down to 0 and rests
    // before the upload sweep organically kicks in.
    progress.phase = "upload";
    progress.uploadMbps = null;
    report();
    await delay(REST_MS);

    progress.uploadMbps = await measureUpload((liveMbps) => {
      progress.uploadMbps = liveMbps;
      report();
    });
    progress.phase = "done";
    report();
  } catch {
    progress.phase = "error";
    report();
  }
}
