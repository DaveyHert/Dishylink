// The Alignment sheet: a verdict line, the two instruments, and the numbers
// behind them. The math is SpaceX's own (alignmentMath.ts) and the dials are
// ported 1:1 from their web app (AlignmentInstruments.tsx); what lives here is
// the sheet that arranges them.

import type { DishStatusJson } from "../../lib/dishClient";
import { formatHasActuators } from "../../lib/format";
import { Explainer } from "../ui/explainer";
import { FactGrid, FactRow } from "../ui/fact-row";
import { RotationInstrument, TiltInstrument } from "./AlignmentInstruments";
import { computeAlignment, type AlignmentReading } from "./alignmentMath";

/** The one-line verdict, coloured by how sure we are of it. */
function AlignmentVerdict({ reading }: { reading: AlignmentReading }) {
  return (
    <div
      className='text-[11.5px] font-medium text-muted-foreground'
      style={{
        color: reading.isAligned
          ? "var(--status-good)"
          : reading.isValid
            ? "var(--chart-warm)"
            : "var(--ink-muted)",
        fontWeight: 600,
        fontSize: 13.5,
      }}
    >
      {!reading.isValid
        ? "Attitude filter not ready — alignment data is settling."
        : reading.isAligned
          ? "Starlink is aligned — pointed in the correct direction."
          : "Starlink is not aligned — adjust the dish toward the wedge."}
    </div>
  );
}

/** The figures the dials are drawn from, plus the GPS/attitude context that
 *  explains why a reading might not be trustworthy yet. */
function AlignmentFacts({
  status,
  reading,
}: {
  status: DishStatusJson;
  reading: AlignmentReading;
}) {
  const stats = status.alignmentStats;
  return (
    <FactGrid columns={2}>
      <FactRow label='Azimuth'>
        <span className='font-mono tabular-nums'>
          {reading.boresightAzimuthDeg.toFixed(1)}° · target{" "}
          {reading.desiredAzimuthDeg.toFixed(1)}° ±{reading.azimuthToleranceDeg.toFixed(0)}°
        </span>
      </FactRow>
      <FactRow label='Elevation'>
        <span className='font-mono tabular-nums'>
          {reading.boresightElevationDeg.toFixed(1)}° · band{" "}
          {reading.lowerElevationLimitDeg.toFixed(0)}–{reading.upperElevationLimitDeg.toFixed(0)}°
        </span>
      </FactRow>
      <FactRow label='Tilt'>
        <span className='font-mono tabular-nums'>{(stats?.tiltAngleDeg ?? 0).toFixed(1)}°</span>
      </FactRow>
      <FactRow label='Attitude uncertainty'>
        <span className='font-mono tabular-nums'>
          ±{(stats?.attitudeUncertaintyDeg ?? 0).toFixed(2)}°
        </span>
      </FactRow>
      <FactRow label='Attitude filter'>
        <span className='font-mono tabular-nums'>
          {(stats?.attitudeEstimationState ?? "—").replaceAll("_", " ").toLowerCase()}
        </span>
      </FactRow>
      <FactRow label='Satellites in View (GPS)'>
        <span className='font-mono tabular-nums'>
          {status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix"}
        </span>
      </FactRow>
      <FactRow label='Has actuators'>
        <span className='font-mono tabular-nums'>
          {formatHasActuators(status.alignmentStats?.hasActuators ?? status.hasActuators)}
        </span>
      </FactRow>
      {status.ned2dishQuaternion && (
        <FactRow label='Orientation (quaternion)'>
          <span className='font-mono tabular-nums'>
            w {(status.ned2dishQuaternion.qScalar ?? 0).toFixed(2)} · x{" "}
            {(status.ned2dishQuaternion.qX ?? 0).toFixed(2)} · y{" "}
            {(status.ned2dishQuaternion.qY ?? 0).toFixed(2)} · z{" "}
            {(status.ned2dishQuaternion.qZ ?? 0).toFixed(2)}
          </span>
        </FactRow>
      )}
    </FactGrid>
  );
}

export function AlignmentPanel({
  status,
  onOpenSkyView,
}: {
  status: DishStatusJson;
  onOpenSkyView?: () => void;
}) {
  const reading = computeAlignment(status);

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <AlignmentVerdict reading={reading} />
        {onOpenSkyView && (
          <button
            className='shrink-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-[var(--accent)] transition-[color,opacity] duration-[120ms] hover:opacity-75'
            onClick={onOpenSkyView}
          >
            Satellite view ›
          </button>
        )}
      </div>

      <div className='my-3.5 flex gap-3.5 max-[720px]:flex-col'>
        <RotationInstrument reading={reading} />
        <TiltInstrument reading={reading} />
      </div>

      <AlignmentFacts status={status} reading={reading} />

      <div className='text-[11.5px] font-medium text-muted-foreground' style={{ marginTop: 12 }}>
        <Explainer title='How to read this'>
          The wedge shows the desired pointing direction ± tolerance. The dish plate and orange
          needle show where the dish is actually pointing. If the needle is inside the wedge, the
          dish is aligned. If it’s outside, adjust the dish toward the wedge. Values update live
          every 2s
        </Explainer>
      </div>
    </div>
  );
}
