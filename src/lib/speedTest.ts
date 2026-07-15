// Browser-measured speed test over the Starlink link, using Cloudflare's
// speed endpoints through the dev-server proxy (the dish's own speedtest
// RPCs are unimplemented on current firmware — verified via grpcurl).

export interface SpeedTestProgress {
  phase: "idle" | "latency" | "download" | "upload" | "done" | "error";
  downloadMbps: number | null;
  uploadMbps: number | null;
  latencyMs: number | null;
  jitterMs: number | null;
}

const DOWNLOAD_BYTES = 60_000_000;
const UPLOAD_BYTES = 12_000_000;
const PHASE_TIME_LIMIT_MS = 10_000;
const LATENCY_PROBES = 4;

async function measureLatency(): Promise<{ latencyMs: number; jitterMs: number }> {
  const roundTrips: number[] = [];
  for (let probeIndex = 0; probeIndex < LATENCY_PROBES; probeIndex++) {
    const startedAt = performance.now();
    await fetch(`/speedtest/__down?bytes=0&cachebust=${Date.now()}-${probeIndex}`, { cache: "no-store" });
    roundTrips.push(performance.now() - startedAt);
  }
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
  try {
    const response = await fetch(`/speedtest/__down?bytes=${DOWNLOAD_BYTES}&cachebust=${Date.now()}`, {
      cache: "no-store",
      signal: abortController.signal,
    });
    const bodyReader = response.body!.getReader();
    for (;;) {
      const chunk = await bodyReader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.length;
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      if (elapsedSeconds > 0.5) onMbps((receivedBytes * 8) / elapsedSeconds / 1e6);
    }
  } catch (transferError) {
    if (!(transferError instanceof DOMException && transferError.name === "AbortError")) throw transferError;
  } finally {
    clearTimeout(timeoutId);
  }
  const totalSeconds = (performance.now() - startedAt) / 1000;
  return (receivedBytes * 8) / totalSeconds / 1e6;
}

async function measureUpload(onMbps: (mbps: number) => void): Promise<number> {
  const payload = new Uint8Array(UPLOAD_BYTES);
  crypto.getRandomValues(payload.subarray(0, 65_536));
  const startedAt = performance.now();
  await fetch("/speedtest/__up", { method: "POST", body: payload, cache: "no-store" });
  const totalSeconds = (performance.now() - startedAt) / 1000;
  const uploadMbps = (UPLOAD_BYTES * 8) / totalSeconds / 1e6;
  onMbps(uploadMbps);
  return uploadMbps;
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
    progress.phase = "upload";
    report();
    progress.uploadMbps = await measureUpload((finalMbps) => {
      progress.uploadMbps = finalMbps;
    });
    progress.phase = "done";
    report();
  } catch {
    progress.phase = "error";
    report();
  }
}
