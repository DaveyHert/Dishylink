// Live Starlink constellation tracking above the dish.
//
// State updates are deliberately split by rate: textual stats update at 1 Hz
// through React state, while the dome samples positions imperatively via
// `sampleSky()` inside its own animation loop (the tracker throttles the
// underlying propagation), so satellite motion is smooth without re-rendering
// the app at animation rate.

import { useEffect, useRef, useState, useCallback } from "react";
import type { DishObstructionMapJson } from "../lib/dishClient";
import {
  loadStarlinkTles,
  StarlinkTracker,
  SERVING_ELEVATION_FLOOR_DEG,
  type ObserverLocation,
  type SatelliteSky,
} from "../lib/satellites";
import { sendNotification } from "../lib/notifications";

const COARSE_PASS_MS = 60_000;
const STATS_UPDATE_MS = 1_000;

export type SatelliteFeedState = "location-needed" | "loading" | "active" | "error";

export interface SatelliteStats {
  inViewCount: number;
  serviceableCount: number;
  servingCandidate: SatelliteSky | null;
  forecastMinServiceable30m: number | null;
  constellationSize: number;
}

export interface SatelliteFeed {
  feedState: SatelliteFeedState;
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
function isUnobstructed(sky: SatelliteSky, obstructionMap: DishObstructionMapJson | null): boolean {
  const grid = obstructionMap?.snr;
  if (!grid || grid.length === 0) return true;
  const gridSize = obstructionMap.numRows ?? Math.round(Math.sqrt(grid.length));
  const maxThetaDeg = obstructionMap.maxThetaDeg ?? 80;
  const radialFraction = (90 - sky.elevationDeg) / maxThetaDeg;
  if (radialFraction > 1) return false;
  const azimuthRad = (sky.azimuthDeg * Math.PI) / 180;
  const gridCenter = (gridSize - 1) / 2;
  const columnIndex = Math.round(gridCenter + Math.sin(azimuthRad) * radialFraction * gridCenter);
  const rowIndex = Math.round(gridCenter - Math.cos(azimuthRad) * radialFraction * gridCenter);
  const fractionUsable = grid[rowIndex * gridSize + columnIndex];
  return fractionUsable === undefined || fractionUsable < 0 || 1 - fractionUsable <= 0.05;
}

function pickServingCandidate(
  inView: SatelliteSky[],
  obstructionMap: DishObstructionMapJson | null,
): SatelliteSky | null {
  let bestUnobstructed: SatelliteSky | null = null;
  for (const sky of inView) {
    if (sky.elevationDeg < SERVING_ELEVATION_FLOOR_DEG) break; // sorted by elevation
    if (isUnobstructed(sky, obstructionMap)) {
      bestUnobstructed = sky;
      break;
    }
  }
  return bestUnobstructed ?? (inView[0]?.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG ? inView[0] : null);
}

export function useSatellites(
  observerLocation: ObserverLocation | null,
  obstructionMap: DishObstructionMapJson | null,
): SatelliteFeed {
  const [feedState, setFeedState] = useState<SatelliteFeedState>("location-needed");
  const [stats, setStats] = useState<SatelliteStats>(EMPTY_STATS);
  const trackerRef = useRef<StarlinkTracker | null>(null);
  const obstructionMapRef = useRef(obstructionMap);
  obstructionMapRef.current = obstructionMap;
  const previousCandidateRef = useRef<string | null>(null);

  const latitude = observerLocation?.latitudeDeg;
  const longitude = observerLocation?.longitudeDeg;
  const altitude = observerLocation?.altitudeM ?? 0;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      setFeedState("location-needed");
      return;
    }
    let disposed = false;
    const timerIds: number[] = [];
    setFeedState("loading");

    (async () => {
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
        setFeedState("active");

        const updateStats = () => {
          const inView = tracker.finePass();
          const servingCandidate = pickServingCandidate(inView, obstructionMapRef.current);
          if (
            previousCandidateRef.current !== null &&
            servingCandidate &&
            servingCandidate.name !== previousCandidateRef.current
          ) {
            sendNotification(
              "handoff",
              "Likely serving satellite changed",
              `${servingCandidate.name} is now the best unobstructed satellite over your dish.`,
            );
          }
          previousCandidateRef.current = servingCandidate?.name ?? previousCandidateRef.current;
          setStats((previousStats) => ({
            ...previousStats,
            inViewCount: inView.length,
            serviceableCount: inView.filter((sky) => sky.elevationDeg >= SERVING_ELEVATION_FLOOR_DEG).length,
            servingCandidate,
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
      } catch {
        if (!disposed) setFeedState("error");
      }
    })();

    return () => {
      disposed = true;
      timerIds.forEach((timerId) => window.clearInterval(timerId));
      trackerRef.current = null;
    };
  }, [latitude, longitude, altitude]);

  const sampleSky = useCallback(() => trackerRef.current?.finePass() ?? [], []);

  return {
    feedState,
    stats,
    sampleSky: feedState === "active" ? sampleSky : null,
    servingCandidateName: stats.servingCandidate?.name ?? null,
  };
}
