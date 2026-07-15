// Speed test sheet content in the Starlink app's speed-test layout: three
// big figures (↓ Mbps · ↑ Mbps · ms) and a single run button. Rendered
// inside a SheetModal. Measures through the actual Starlink link via the
// dev-server proxy (the dish's own speedtest RPCs are unimplemented).

import { useState } from "react";
import { runSpeedTest, type SpeedTestProgress } from "../lib/speedTest";

const IDLE_PROGRESS: SpeedTestProgress = { phase: "idle", downloadMbps: null, uploadMbps: null, latencyMs: null };

const PHASE_LABEL: Record<SpeedTestProgress["phase"], string> = {
  idle: "Measures download, upload, and latency through your Starlink link.",
  latency: "Measuring latency…",
  download: "Measuring download…",
  upload: "Measuring upload…",
  done: "Done.",
  error: "Test failed — check the connection and try again.",
};

function SpeedFigure({ icon, value, unit }: { icon: string; value: string; unit: string }) {
  return (
    <div className="detail-figure">
      <div className="detail-figure-value">
        {value}
      </div>
      <div className="detail-figure-label">
        {icon} {unit}
      </div>
    </div>
  );
}

export function SpeedTestPanel() {
  const [progress, setProgress] = useState<SpeedTestProgress>(IDLE_PROGRESS);
  const isRunning = progress.phase === "latency" || progress.phase === "download" || progress.phase === "upload";

  return (
    <div>
      <div className="detail-figures">
        <SpeedFigure icon="↓" value={progress.downloadMbps === null ? "—" : progress.downloadMbps.toFixed(0)} unit="Mbps" />
        <div className="detail-figure-divider" />
        <SpeedFigure icon="↑" value={progress.uploadMbps === null ? "—" : progress.uploadMbps.toFixed(0)} unit="Mbps" />
        <div className="detail-figure-divider" />
        <SpeedFigure icon="◷" value={progress.latencyMs === null ? "—" : progress.latencyMs.toFixed(0)} unit="ms" />
      </div>
      <button
        className="speedtest-button"
        disabled={isRunning}
        onClick={() => {
          void runSpeedTest(setProgress);
        }}
      >
        {isRunning ? "Testing…" : "Run speed test"}
      </button>
      <div className="stat-caption" style={{ marginTop: 10 }}>
        {PHASE_LABEL[progress.phase]}
      </div>
    </div>
  );
}
