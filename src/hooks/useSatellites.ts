// Live Starlink constellation tracking above the dish.
//
// State updates are deliberately split by rate: textual stats update at 1 Hz
// through React state, while the dome samples positions imperatively via
// `sampleSky()` inside its own animation loop (the tracker throttles the
// underlying propagation), so satellite motion is smooth without re-rendering
// the app at animation rate.

import { useEffect, useRef, useState, useCallback } from "react";
import type { DishObstructionMapJson } from "@core/dishClient";
import type { DishModel } from "../lib/dishMesh";
import {
  resolveObstructionFrame,
  skyDirectionToGrid,
} from "../components/obstruction/obstructionFrame";
import { chooseServingCandidate, type ServingHold } from "../lib/servingSlot";
import {
  loadStarlinkTles,
  StarlinkTracker,
  EphemerisError,
  SERVING_ELEVATION_FLOOR_DEG,
  type EphemerisFailure,
  type ObserverLocation,
  type SatelliteSky,
} from "../lib/satellites";

const COARSE_PASS_MS = 60_000;
const STATS_UPDATE_MS = 1_000;
/** Backoff between startup attempts, holding at the last value from then on.
 *  The source is a single 1.8 MB file from a small public service — worth
 *  waiting out rather than hammering. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];

export type SatelliteFeedState = "location-needed" | "loading" | "active" | "error";

/**
 * How far the ephemeris load has got, and which location it was for.
 *
 * Keyed by location so moving the observer reads as a fresh load on the next
 * render, rather than needing an effect to reset the phase first — which would
 * leave a frame claiming the old location's satellites are this one's.
 */
interface EphemerisLoad {
  locationKey: string;
  state: "loading" | "active" | "error";
  reason: EphemerisFailure | null;
}

const LOADING: EphemerisLoad = { locationKey: "", state: "loading", reason: null };

export interface SatelliteStats {
  inViewCount: number;
  serviceableCount: number;
  servingCandidate: SatelliteSky | null;
  forecastMinServiceable30m: number | null;
  constellationSize: number;
}

export interface SatelliteFeed {
  feedState: SatelliteFeedState;
  /** Set while `feedState` is "error": which side failed, so the UI can say so
   *  rather than blaming the user's connection for every fault. */
  errorReason: EphemerisFailure | null;
  stats: SatelliteStats;
  /** Imperative sampler for the dome's animation loop; null until active. */
  sampleSky: (() => SatelliteSky[]) | null;
  /** Best serving candidate, kept in a ref so the sampler stays cheap. */
  servingCandidateName: string | null;
}

const EMPTY_STATS: SatelliteStats = {
  inViewCount: 0,
  serviceableCount: 0,
  servingCandidate: null,
  forecastMinServiceable30m: null,
  constellationSize: 0,
};

/** Is the sky cell toward this az/el clear according to the dish's map? */
function isUnobstructed(
  sky: SatelliteSky,
  obstructionMap: DishObstructionMapJson | null,
  dishModel: DishModel,
  boresightAzimuthDeg: number,
): boolean {
  const grid = obstructionMap?.snr;
  if (!grid || grid.length === 0) return true;
  const gridSize = obstructionMap.numRows ?? Math.round(Math.sqrt(grid.length));
  const maxThetaDeg = obstructionMap.maxThetaDeg ?? 80;
  const radialFraction = (90 - sky.elevationDeg) / maxThetaDeg;
  if (radialFraction > 1) return false;
  const frame = resolveObstructionFrame(obstructionMap.mapReferenceFrame, dishModel);
  const { row, col } = skyDirectionToGrid(
    sky.azimuthDeg,
    radialFraction,
    gridSize,
    frame,
    boresightAzimuthDeg,
  );
  const fractionUsable = grid[row * gridSize + col];
  return fractionUsable === undefined || fractionUsable < 0 || 1 - fractionUsable <= 0.05;
}

export function useSatellites(
  observerLocation: ObserverLocation | null,
  obstructionMap: DishObstructionMapJson | null,
  dishModel: DishModel = "unknown",
  boresightAzimuthDeg = 0,
): SatelliteFeed {
  const [stats, setStats] = useState<SatelliteStats>(EMPTY_STATS);
  const [load, setLoad] = useState<EphemerisLoad>(LOADING);
  const trackerRef = useRef<StarlinkTracker | null>(null);
  // What the stats interval reads the current obstruction map from, so a new map
  // does not restart the tracker. Written after commit rather than while
  // rendering, which React may repeat or discard.
  const lookupRef = useRef({ obstructionMap, dishModel, boresightAzimuthDeg });
  useEffect(() => {
    lookupRef.current = { obstructionMap, dishModel, boresightAzimuthDeg };
  }, [obstructionMap, dishModel, boresightAzimuthDeg]);

  const latitude = observerLocation?.latitudeDeg;
  const longitude = observerLocation?.longitudeDeg;
  const altitude = observerLocation?.altitudeM ?? 0;

  // Without somewhere to stand there is nothing to compute, so that answer comes
  // from the arguments rather than being stored and kept in step.
  const hasLocation = latitude !== undefined && longitude !== undefined;
  const locationKey = hasLocation ? `${latitude},${longitude},${altitude}` : "";
  const current = load.locationKey === locationKey ? load : LOADING;
  const feedState: SatelliteFeedState = hasLocation ? current.state : "location-needed";
  const errorReason = current.reason;

  useEffect(() => {
    if (!hasLocation) return;
    let disposed = false;
    let hold: ServingHold | null = null;
    const timerIds: number[] = [];
    const retryIds: number[] = [];

    const start = async (attempt: number) => {
      try {
        const tleRecords = await loadStarlinkTles();
        if (disposed) return;
        const tracker = new StarlinkTracker(tleRecords, {
          latitudeDeg: latitude,
          longitudeDeg: longitude,
          altitudeM: altitude,
        });
        await tracker.coarsePass();
        if (disposed) return;
        trackerRef.current = tracker;
        setLoad({ locationKey, state: "active", reason: null });

        const updateStats = () => {
          const inView = tracker.finePass();
          const lookup = lookupRef.current;
          // The 1 Hz sampler reads the boundary up to a second late: a fixed
          // offset, not per-slot jitter.
          const serving = chooseServingCandidate(inView, Date.now(), hold, (sky) =>
            isUnobstructed(
              sky,
              lookup.obstructionMap,
              lookup.dishModel,
              lookup.boresightAzimuthDeg,
            ),
          );
          hold = serving.hold;
          setStats((previousStats) => ({
            ...previousStats,
            inViewCount: inView.length,
            serviceableCount: inView.filter(
              (sky) => sky.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG,
            ).length,
            servingCandidate: serving.candidate,
            constellationSize: tracker.constellationSize,
          }));
        };

        const updateForecast = () => {
          setStats((previousStats) => ({
            ...previousStats,
            forecastMinServiceable30m: tracker.forecastMinimumInView(),
          }));
        };

        updateStats();
        updateForecast();
        timerIds.push(window.setInterval(updateStats, STATS_UPDATE_MS));
        timerIds.push(
          window.setInterval(() => {
            void tracker.coarsePass().then(updateForecast);
          }, COARSE_PASS_MS),
        );
      } catch (error) {
        if (disposed) return;
        setLoad({
          locationKey,
          state: "error",
          reason: error instanceof EphemerisError ? error.reason : "source",
        });
        // Keep trying rather than parking here until the user reloads: the
        // usual cause is the source being briefly slow or unreachable, which
        // resolves on its own.
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        retryIds.push(window.setTimeout(() => void start(attempt + 1), delay));
      }
    };

    void start(0);

    return () => {
      disposed = true;
      // Holds both the repeating passes and any pending retry. The two share an
      // id space in the browser, but clearing each by its own kind keeps this
      // honest about what it is cancelling.
      timerIds.forEach((timerId) => window.clearInterval(timerId));
      retryIds.forEach((retryId) => window.clearTimeout(retryId));
      trackerRef.current = null;
    };
  }, [hasLocation, latitude, longitude, altitude, locationKey]);

  const sampleSky = useCallback(() => trackerRef.current?.finePass() ?? [], []);

  return {
    feedState,
    errorReason,
    stats,
    sampleSky: feedState === "active" ? sampleSky : null,
    servingCandidateName: stats.servingCandidate?.name ?? null,
  };
}
