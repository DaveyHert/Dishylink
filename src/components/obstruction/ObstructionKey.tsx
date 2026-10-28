// Legend and stat blocks under the dome. The standard card shows the obstruction
// half; the immersive view adds the satellite entries and the live feed stats.

import { useTranslation } from "react-i18next";
import type { DishObstructionStatsJson } from "@core/dishClient";
import type { SatelliteFeed } from "../../hooks/useSatellites";
import { StatLabel } from "../shared/InfoDot";

export const skyLegendClass = "flex flex-wrap gap-x-4 gap-y-2.5 pt-1";
export const skyStatsClass = "mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-2";
const legendItem =
  "inline-flex items-center gap-[7px] text-[12.5px] font-medium text-ink-secondary";
const legendCell = "size-[9px] flex-none rounded-full";

function LegendEntry({ color, label }: { color: string; label: string }) {
  return (
    <span className={legendItem}>
      <span className={legendCell} style={{ background: color }} />
      {label}
    </span>
  );
}

/** The obstruction-map key. `withServing` adds the amber entry, which only the
 *  satellite view has anything to key — its craft are recognisable models, so
 *  the only colour worth naming is the one that marks the serving one.
 *  `centred` is for chrome floating over a scene, where a centred row reads as
 *  part of the composition rather than as text stuck to the left edge. */
export function ObstructionKey({
  withServing = false,
  centred = false,
}: {
  withServing?: boolean;
  centred?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${skyLegendClass}${centred ? " justify-center" : ""}`}>
      <span className={legendItem}>
        <span className={legendCell} style={{ background: "var(--sky-unmapped)", opacity: 0.45 }} />
        {t("obstruction.legendUnmapped")}
      </span>
      <LegendEntry color='var(--sky-clear)' label={t("obstruction.legendClear")} />
      <LegendEntry color='var(--sky-partial)' label={t("obstruction.legendPartial")} />
      <LegendEntry color='var(--sky-obstructed)' label={t("obstruction.legendObstructions")} />
      {withServing && (
        <LegendEntry color='var(--chart-warm)' label={t("obstruction.legendServing")} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tip,
  fullWidth,
  centred,
}: {
  label: string;
  value: string;
  tip?: string;
  fullWidth?: boolean;
  centred?: boolean;
}) {
  return (
    <div
      className={centred ? "text-center" : undefined}
      style={fullWidth ? { gridColumn: "1 / -1" } : undefined}
    >
      {tip ? (
        <StatLabel className='block' tip={tip}>
          {label}
        </StatLabel>
      ) : (
        <span className='block text-[11.5px] font-medium text-muted-foreground'>{label}</span>
      )}
      <span className='font-mono text-[14px] font-semibold tabular-nums'>{value}</span>
    </div>
  );
}

/** Obstruction figures, plus the satellite feed's own once it is live. */
export function ObstructionStats({
  obstructionStats,
  satellites,
  centred = false,
}: {
  obstructionStats?: DishObstructionStatsJson;
  /** Omitted on the standard card, which shows obstruction figures only. */
  satellites?: SatelliteFeed;
  /** Centres each figure in its column, for chrome floating over a scene. */
  centred?: boolean;
}) {
  const { t } = useTranslation();
  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  const validHours = (obstructionStats?.validS ?? 0) / 3600;
  const stats = satellites?.stats;
  const showFeed = satellites?.feedState === "active" && stats !== undefined;

  return (
    <div className={skyStatsClass}>
      <Stat
        centred={centred}
        label={t("metrics.skyObstructed")}
        value={`${(fractionObstructed * 100).toFixed(2)}%`}
      />
      <Stat
        centred={centred}
        label={t("obstruction.observedFor")}
        value={t("obstruction.observedHours", { hours: validHours.toFixed(1) })}
      />
      {showFeed && (
        <>
          <Stat
            label={t("obstruction.satellitesOverhead")}
            value={t("obstruction.overheadValue", {
              inView: stats.inViewCount,
              serviceable: stats.serviceableCount,
            })}
            tip={t("obstruction.satellitesOverheadTip")}
          />
          <Stat
            label={t("obstruction.next30Min")}
            value={
              stats.forecastMinServiceable30m === null
                ? "…"
                : t("obstruction.serviceableCount", { count: stats.forecastMinServiceable30m })
            }
            tip={t("obstruction.next30MinTip")}
          />
          <Stat
            fullWidth
            label={t("obstruction.likelyServing")}
            value={
              stats.servingCandidate
                ? t("obstruction.servingValue", {
                    name: stats.servingCandidate.name,
                    elevation: stats.servingCandidate.elevationDeg.toFixed(0),
                    range: stats.servingCandidate.rangeKm.toFixed(0),
                  })
                : t("obstruction.noneAbove25")
            }
            tip={t("obstruction.likelyServingTip")}
          />
        </>
      )}
    </div>
  );
}
