// Legend and stat blocks under the dome. The standard card shows the obstruction
// half; the immersive view adds the satellite entries and the live feed stats.

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
  return (
    <div className={`${skyLegendClass}${centred ? " justify-center" : ""}`}>
      <span className={legendItem}>
        <span className={legendCell} style={{ background: "var(--sky-unmapped)", opacity: 0.45 }} />
        Unmapped
      </span>
      <LegendEntry color='var(--sky-clear)' label='Clear view' />
      <LegendEntry color='var(--sky-partial)' label='Partial' />
      <LegendEntry color='var(--sky-obstructed)' label='Obstructions' />
      {withServing && <LegendEntry color='var(--chart-warm)' label='Serving satellite' />}
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
  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  const validHours = (obstructionStats?.validS ?? 0) / 3600;
  const stats = satellites?.stats;
  const showFeed = satellites?.feedState === "active" && stats !== undefined;

  return (
    <div className={skyStatsClass}>
      <Stat
        centred={centred}
        label='Sky obstructed'
        value={`${(fractionObstructed * 100).toFixed(2)}%`}
      />
      <Stat centred={centred} label='Observed for' value={`${validHours.toFixed(1)} h`} />
      {showFeed && (
        <>
          <Stat
            label='Satellites overhead'
            value={`${stats.inViewCount} · ${stats.serviceableCount} serviceable`}
            tip="Starlink satellites currently above your horizon. 'Serviceable' ones are high enough (above ~25° elevation) that your dish could actually lock onto them."
          />
          <Stat
            label='Next 30 min minimum'
            value={
              stats.forecastMinServiceable30m === null
                ? "…"
                : `${stats.forecastMinServiceable30m} serviceable`
            }
            tip="The fewest serviceable satellites at any moment over the next 30 minutes, from SpaceX's published orbits. A low number can mean brief drops as satellites hand off."
          />
          <Stat
            fullWidth
            label='Likely serving satellite'
            value={
              stats.servingCandidate
                ? `${stats.servingCandidate.name} · ${stats.servingCandidate.elevationDeg.toFixed(0)}° el · ${stats.servingCandidate.rangeKm.toFixed(0)} km`
                : "none above 25°"
            }
            tip='Our best guess at the satellite your dish is talking to right now — the highest, unobstructed one, inferred from live orbits.'
          />
        </>
      )}
    </div>
  );
}
