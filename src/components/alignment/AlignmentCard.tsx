// The Alignment panel: a verdict line, the two instruments, and the numbers
// behind them. The math is SpaceX's own (alignmentMath.ts) and the dials are
// ported 1:1 from their web app (AlignmentInstruments.tsx); what lives here is
// the panel that arranges them.

import { useTranslation } from "react-i18next";
import type { DishStatusJson } from "@core/dishClient";
import {
  formatActuatorState,
  attitudeStateLabel,
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
  const { t } = useTranslation();
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
        ? lastStatusAtMs
          ? t("alignment.staleFrom", { when: formatRelativeTime(lastStatusAtMs, t) })
          : t("alignment.stale")
        : !reading.isValid
          ? t("alignment.notReady")
          : reading.isAligned
            ? t("alignment.aligned")
            : t("alignment.notAligned")}
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
  const { t } = useTranslation();
  const stats = status.alignmentStats;
  // Two columns matching the two dials above: rotation/azimuth on the left,
  // tilt/elevation on the right. Each column holds its own rows, so one can gain
  // or lose a row without shifting the other.
  return (
    <FactColumns>
      {/* Rotation — the left dial */}
      <FactColumn>
        <FactRow label={t("alignment.currentRotation")} hint={t("alignment.currentRotationHint")}>
          <span className='font-mono tabular-nums'>{reading.boresightAzimuthDeg.toFixed(1)}°</span>
        </FactRow>
        {/* An amount and a direction per axis, so the panel says what to do and
            not only what is. Both are the dish's own current-minus-target. */}
        <FactRow
          label={t("alignment.rotateRecommendation")}
          hint={t("alignment.rotateRecommendationHint")}
        >
          <span
            className='font-mono tabular-nums'
            style={{ color: adjustmentColor(reading.azimuthErrorDeg) }}
          >
            {Math.abs(reading.azimuthErrorDeg).toFixed(2)}°{" "}
            {reading.azimuthErrorDeg > 0 ? "↺" : "↻"}
          </span>
        </FactRow>
        <FactRow label={t("alignment.targetAzimuth")} hint={t("alignment.targetAzimuthHint")}>
          <span className='font-mono tabular-nums'>
            {reading.desiredAzimuthDeg.toFixed(1)}° ±{reading.azimuthToleranceDeg.toFixed(0)}°
          </span>
        </FactRow>
        <FactRow
          label={t("alignment.boresightError")}
          hint={t("alignment.boresightErrorHint", { limit: SEPARATION_LIMIT_DEG })}
        >
          <span
            className='font-mono tabular-nums'
            style={{ color: adjustmentColor(reading.boresightErrorDeg) }}
          >
            {t("alignment.boresightErrorValue", {
              error: reading.boresightErrorDeg.toFixed(2),
              limit: SEPARATION_LIMIT_DEG,
            })}
          </span>
        </FactRow>
        <FactRow
          label={t("alignment.attitudeUncertainty")}
          hint={t("alignment.attitudeUncertaintyHint")}
        >
          <span className='font-mono tabular-nums'>
            ±{(stats?.attitudeUncertaintyDeg ?? 0).toFixed(2)}°
          </span>
        </FactRow>
        <FactRow label={t("alignment.attitudeState")} hint={t("alignment.attitudeStateHint")}>
          <span className='font-mono tabular-nums'>
            {attitudeStateLabel(stats?.attitudeEstimationState, t) ?? "—"}
          </span>
        </FactRow>
        <FactRow label={t("terminal.gpsSatellites")} hint={t("alignment.gpsSatellitesHint")}>
          <span className='font-mono tabular-nums'>
            {status.gpsStats?.gpsValid
              ? t("terminal.satellitesCount", { count: status.gpsStats.gpsSats ?? 0 })
              : t("terminal.noFix")}
          </span>
        </FactRow>
      </FactColumn>
      {/* Tilt — the right dial */}
      <FactColumn>
        <FactRow label={t("alignment.currentTilt")} hint={t("alignment.currentTiltHint")}>
          <span className='font-mono tabular-nums'>{reading.tiltAngleDeg.toFixed(1)}°</span>
        </FactRow>
        <FactRow
          label={t("alignment.tiltRecommendation")}
          hint={t("alignment.tiltRecommendationHint")}
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
          label={t("alignment.boresightElevation")}
          hint={t("alignment.boresightElevationHint")}
        >
          <span className='font-mono tabular-nums'>
            {reading.boresightElevationDeg.toFixed(1)}°
          </span>
        </FactRow>
        {/* The dish's own reported target — NOT `reading.targetElevationDeg`,
            which computeAlignment clamps to the band floor (min(70, desired)) for
            the alignment test. On this dish that clamp turns 76.0° into 70.0°. */}
        <FactRow label={t("alignment.targetElevation")} hint={t("alignment.targetElevationHint")}>
          <span className='font-mono tabular-nums'>{reading.desiredElevationDeg.toFixed(1)}°</span>
        </FactRow>
        {/* Split off Target elevation: that figure is this dish's own target, this
            one is SpaceX's fixed tolerance around it. Same span the Tilt dial
            fills as its grey wedge. */}
        <FactRow label={t("alignment.elevationRange")} hint={t("alignment.elevationRangeHint")}>
          <span className='font-mono tabular-nums'>
            {reading.lowerElevationLimitDeg.toFixed(0)}–{reading.upperElevationLimitDeg.toFixed(0)}°
          </span>
        </FactRow>
        <FactRow label={t("alignment.hasActuators")} hint={t("alignment.hasActuatorsHint")}>
          <span className='font-mono tabular-nums'>
            {formatHasActuators(status.alignmentStats?.hasActuators ?? status.hasActuators, t)}
          </span>
        </FactRow>
        <FactRow label={t("alignment.actuationState")} hint={t("alignment.actuationStateHint")}>
          <span className='font-mono tabular-nums'>
            {formatActuatorState(stats?.actuatorState, t)}
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
  const { t } = useTranslation();
  // Null only on a cold start; after the first reading the dish going quiet keeps
  // the last status and is the `stale` case instead.
  if (!status) {
    return <Callout tone='error'>{t("alignment.noReading")}</Callout>;
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
            {t("obstruction.liveSatelliteView")}
          </button>
        )}
      </div>

      <div className='my-3.5 flex gap-3.5 max-[720px]:flex-col'>
        <RotationInstrument reading={reading} />
        <TiltInstrument reading={reading} />
      </div>

      <AlignmentFacts status={status} reading={reading} />

      <div className='text-[11.5px] font-medium text-muted-foreground' style={{ marginTop: 12 }}>
        <Explainer title={t("alignment.howToRead")}>{t("alignment.howToReadBody")}</Explainer>
      </div>
    </div>
  );
}
