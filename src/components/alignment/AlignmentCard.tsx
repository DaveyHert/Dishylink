// The Alignment panel: a verdict line, the two instruments, and the numbers
// behind them. The math is SpaceX's own (alignmentMath.ts) and the dials are
// ported 1:1 from their web app (AlignmentInstruments.tsx); what lives here is
// the panel that arranges them.

import type { DishStatusJson } from "@core/dishClient";
import {
  formatActuatorState,
  formatAttitudeState,
  formatHasActuators,
  formatRelativeTime,
} from "../../lib/format";
import { Callout } from "../ui/callout";
import { Explainer } from "../ui/explainer";
import { FactColumn, FactColumns, FactRow } from "../ui/fact-row";
import { RotationInstrument, TiltInstrument } from "./AlignmentInstruments";
import { computeAlignment, SEPARATION_LIMIT_DEG, type AlignmentReading } from "./alignmentMath";

/** Green inside SpaceX's separation limit, warm outside it. */
const adjustmentColor = (errorDeg: number) =>
  Math.abs(errorDeg) < SEPARATION_LIMIT_DEG ? "var(--status-good)" : "var(--chart-warm)";

/** The one-line verdict, coloured by how sure we are of it. A stale reading
 *  supersedes the alignment verdict: a frozen "aligned" must not read as live. */
function AlignmentVerdict({
  reading,
  stale,
  lastStatusAtMs,
}: {
  reading: AlignmentReading;
  stale: boolean;
  lastStatusAtMs: number | null;
}) {
  return (
    <div
      className='text-[11.5px] font-medium text-muted-foreground'
      style={{
        color: stale
          ? "var(--status-critical)"
          : reading.isAligned
            ? "var(--status-good)"
            : reading.isValid
              ? "var(--chart-warm)"
              : "var(--ink-muted)",
        fontWeight: 600,
        fontSize: 13.5,
      }}
    >
      {stale
        ? `Dish not answering — showing the last reading${lastStatusAtMs ? ` from ${formatRelativeTime(lastStatusAtMs)}` : ""}.`
        : !reading.isValid
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
  // Two columns matching the two dials above: rotation/azimuth on the left,
  // tilt/elevation on the right. Each column holds its own rows, so one can gain
  // or lose a row without shifting the other.
  return (
    <FactColumns>
      {/* Rotation — the left dial */}
      <FactColumn>
        <FactRow
          label='Current rotation'
          hint='Current rotation (boresight azimuth) is the compass direction the dish is actually pointing, measured clockwise from North (0° to 360°).'
        >
          <span className='font-mono tabular-nums'>{reading.boresightAzimuthDeg.toFixed(1)}°</span>
        </FactRow>
        {/* An amount and a direction per axis, so the panel says what to do and
            not only what is. Both are the dish's own current-minus-target. */}
        <FactRow
          label='Rotate recommendation'
          hint='How far to turn the dish around, and which way, seen from above. ↺ is anticlockwise, ↻ is clockwise.'
        >
          <span
            className='font-mono tabular-nums'
            style={{ color: adjustmentColor(reading.azimuthErrorDeg) }}
          >
            {Math.abs(reading.azimuthErrorDeg).toFixed(2)}°{" "}
            {reading.azimuthErrorDeg > 0 ? "↺" : "↻"}
          </span>
        </FactRow>
        <FactRow
          label='Target azimuth'
          hint='The compass direction the dish wants to point, clockwise from North, and how far either side of it still counts as aligned.'
        >
          <span className='font-mono tabular-nums'>
            {reading.desiredAzimuthDeg.toFixed(1)}° ±{reading.azimuthToleranceDeg.toFixed(0)}°
          </span>
        </FactRow>
        <FactRow
          label='Boresight error'
          hint={`Boresight error (pointing error) is how far the dish is pointing from where it wants to point, as one angle. Under ${SEPARATION_LIMIT_DEG}° counts as aligned.`}
        >
          <span
            className='font-mono tabular-nums'
            style={{ color: adjustmentColor(reading.boresightErrorDeg) }}
          >
            {reading.boresightErrorDeg.toFixed(2)}° · ideal &lt;{SEPARATION_LIMIT_DEG}°
          </span>
        </FactRow>
        <FactRow
          label='Attitude uncertainty'
          hint='How sure the dish is of its own orientation. Smaller is better — a large figure means the readings above are still settling.'
        >
          <span className='font-mono tabular-nums'>
            ±{(stats?.attitudeUncertaintyDeg ?? 0).toFixed(2)}°
          </span>
        </FactRow>
        <FactRow
          label='Attitude estimation state'
          hint='Whether the dish has finished working out its own orientation. Converged means the alignment figures can be trusted.'
        >
          <span className='font-mono tabular-nums'>
            {formatAttitudeState(stats?.attitudeEstimationState) ?? "—"}
          </span>
        </FactRow>
        <FactRow
          label='Satellites in View (GPS)'
          hint='GPS satellites the dish can currently see. It uses these to fix its own position and orientation, not for the internet link.'
        >
          <span className='font-mono tabular-nums'>
            {status.gpsStats?.gpsValid ? `${status.gpsStats.gpsSats ?? 0} satellites` : "no fix"}
          </span>
        </FactRow>
      </FactColumn>
      {/* Tilt — the right dial */}
      <FactColumn>
        <FactRow
          label='Current tilt'
          hint='Current tilt (tilt angle) is the physical angle of the dish plate off flat. Flat is 0°, and the steeper the plate the lower it aims.'
        >
          <span className='font-mono tabular-nums'>{reading.tiltAngleDeg.toFixed(1)}°</span>
        </FactRow>
        <FactRow
          label='Tilt recommendation'
          hint='How far to re-aim the dish up or down, and which way. Down means the dish is aiming too high; steepen the plate to bring it down.'
        >
          <span
            className='font-mono tabular-nums'
            style={{ color: adjustmentColor(reading.elevationErrorDeg) }}
          >
            {Math.abs(reading.elevationErrorDeg).toFixed(2)}°{" "}
            {reading.elevationErrorDeg > 0 ? "↓" : "↑"}
          </span>
        </FactRow>
        <FactRow
          label='Boresight elevation'
          hint='Boresight elevation is how far above the horizon the dish is actually pointing, where 0° is level with the horizon and 90° is straight up.'
        >
          <span className='font-mono tabular-nums'>
            {reading.boresightElevationDeg.toFixed(1)}°
          </span>
        </FactRow>
        {/* The dish's own reported target — NOT `reading.targetElevationDeg`,
            which computeAlignment clamps to the band floor (min(70, desired)) for
            the alignment test. On this dish that clamp turns 76.0° into 70.0°. */}
        <FactRow
          label='Target elevation'
          hint='Target elevation is the angle above the horizon this dish wants to point, worked out for your location.'
        >
          <span className='font-mono tabular-nums'>{reading.desiredElevationDeg.toFixed(1)}°</span>
        </FactRow>
        {/* Split off Target elevation: that figure is this dish's own target, this
            one is SpaceX's fixed tolerance around it. Same span the Tilt dial
            fills as its grey wedge. */}
        <FactRow
          label='Acceptable elevation range'
          hint='Acceptable elevation range is the span of elevations that still counts as aligned. It is the grey wedge drawn on the Tilt dial above — while the dish points inside it, the dial stays green.'
        >
          <span className='font-mono tabular-nums'>
            {reading.lowerElevationLimitDeg.toFixed(0)}–{reading.upperElevationLimitDeg.toFixed(0)}°
          </span>
        </FactRow>
        <FactRow
          label='Has actuators'
          hint='Whether the dish steers itself with motors. Without them, aiming is electronic and any physical adjustment is done by hand.'
        >
          <span className='font-mono tabular-nums'>
            {formatHasActuators(status.alignmentStats?.hasActuators ?? status.hasActuators)}
          </span>
        </FactRow>
        <FactRow
          label='Actuation state'
          hint='What the dish’s motors are doing right now — idle, or actively moving to a new position.'
        >
          <span className='font-mono tabular-nums'>
            {formatActuatorState(stats?.actuatorState)}
          </span>
        </FactRow>
      </FactColumn>
    </FactColumns>
  );
}

export function AlignmentPanel({
  status,
  stale = false,
  lastStatusAtMs = null,
  onOpenSkyView,
}: {
  status: DishStatusJson | null;
  stale?: boolean;
  lastStatusAtMs?: number | null;
  onOpenSkyView?: () => void;
}) {
  // Null only on a cold start; after the first reading the dish going quiet keeps
  // the last status and is the `stale` case instead.
  if (!status) {
    return (
      <Callout tone='error'>
        Couldn't reach the Starlink dish — alignment needs a live reading. This updates on its own
        once the dish is back online.
      </Callout>
    );
  }

  const reading = computeAlignment(status);

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <AlignmentVerdict reading={reading} stale={stale} lastStatusAtMs={lastStatusAtMs} />
        {onOpenSkyView && (
          <button
            className='shrink-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-(--accent) transition-[color,opacity] duration-[120ms] hover:opacity-75'
            onClick={onOpenSkyView}
          >
            Live satellite view ›
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
