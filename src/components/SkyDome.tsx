// Draggable 3D sky dome, in the style of the Starlink app's Obstructions
// view, extended well past it:
//   - the dish's 123×123 obstruction grid as a hemisphere of dots
//     (ink = clear, red = obstructed, faint gray = unmapped)
//   - live Starlink satellites crossing the sky (SGP4 from SpaceX ephemeris),
//     with motion trails and a beam to the likely serving satellite
//   - a time-lapse scrubber over hourly obstruction snapshots
// Hand-rolled orthographic projection on 2D canvas; drag to orbit and tilt.

import { useEffect, useRef, useCallback, useState } from "react";
import type { DishObstructionMapJson, DishObstructionStatsJson } from "../lib/dishClient";
import type { SatelliteFeed } from "../hooks/useSatellites";
import type { ObserverLocation } from "../lib/satellites";
import { LocationSetup } from "./LocationSetup";
import {
  listSnapshots,
  saveSnapshotIfDue,
  unpackCells,
  CELL_UNMAPPED,
  CELL_CLEAR,
  type ObstructionSnapshot,
} from "../lib/obstructionSnapshots";

interface SkyDomeProps {
  obstructionMap: DishObstructionMapJson | null;
  obstructionStats?: DishObstructionStatsJson;
  theme: "light" | "dark";
  satellites: SatelliteFeed;
  observerLocation: ObserverLocation | null;
  onLocationSaved: (location: ObserverLocation) => void;
  onClearLocation: () => void;
  /** "standard" = compact obstructions card; "immersive" = full satellite view in a sheet. */
  variant?: "standard" | "immersive";
  onOpenImmersive?: () => void;
}

type DomePointKind = "clear" | "obstructed" | "unmapped";

interface DomePoint {
  x: number; // east
  y: number; // north
  z: number; // up
  kind: DomePointKind;
}

interface TrailPoint {
  azimuthDeg: number;
  elevationDeg: number;
  atMs: number;
}

const STANDARD_CANVAS_SIZE = 330;
const IMMERSIVE_CANVAS_SIZE = 540;
const GRID_STRIDE = 2;
const INITIAL_YAW = 0.6;
const INITIAL_ELEVATION = 0.62;
const TRAIL_POINT_INTERVAL_MS = 1_000;
const TRAIL_MAX_POINTS = 24;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function skyToWorld(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  const elevationRad = (elevationDeg * Math.PI) / 180;
  return {
    x: Math.cos(elevationRad) * Math.sin(azimuthRad),
    y: Math.cos(elevationRad) * Math.cos(azimuthRad),
    z: Math.sin(elevationRad),
  };
}

function buildDomePoints(
  gridSize: number,
  maxThetaDeg: number,
  kindAtCell: (rowIndex: number, columnIndex: number) => DomePointKind | null,
): DomePoint[] {
  const maxThetaRad = (maxThetaDeg * Math.PI) / 180;
  const gridCenter = (gridSize - 1) / 2;
  const points: DomePoint[] = [];
  for (let rowIndex = 0; rowIndex < gridSize; rowIndex += GRID_STRIDE) {
    for (let columnIndex = 0; columnIndex < gridSize; columnIndex += GRID_STRIDE) {
      const eastOffset = (columnIndex - gridCenter) / gridCenter;
      const northOffset = (gridCenter - rowIndex) / gridCenter;
      const radialFraction = Math.hypot(eastOffset, northOffset);
      if (radialFraction > 1) continue;
      const kind = kindAtCell(rowIndex, columnIndex);
      if (kind === null) continue;
      const zenithAngle = radialFraction * maxThetaRad;
      const horizontalScale = radialFraction === 0 ? 0 : Math.sin(zenithAngle) / radialFraction;
      points.push({
        x: eastOffset * horizontalScale,
        y: northOffset * horizontalScale,
        z: Math.cos(zenithAngle),
        kind,
      });
    }
  }
  return points;
}

function liveKindAtCell(grid: number[], gridSize: number) {
  return (rowIndex: number, columnIndex: number): DomePointKind => {
    const fractionUsable = grid[rowIndex * gridSize + columnIndex];
    if (fractionUsable < 0) return "unmapped";
    return 1 - fractionUsable > 0.005 ? "obstructed" : "clear";
  };
}

function snapshotKindAtCell(cells: Uint8Array, gridSize: number) {
  return (rowIndex: number, columnIndex: number): DomePointKind => {
    const cellKind = cells[rowIndex * gridSize + columnIndex];
    if (cellKind === CELL_UNMAPPED) return "unmapped";
    return cellKind === CELL_CLEAR ? "clear" : "obstructed";
  };
}

export function SkyDome({
  obstructionMap,
  obstructionStats,
  theme,
  satellites,
  observerLocation,
  onLocationSaved,
  onClearLocation,
  variant = "standard",
  onOpenImmersive,
}: SkyDomeProps) {
  const isImmersive = variant === "immersive";
  const canvasSize = isImmersive ? IMMERSIVE_CANVAS_SIZE : STANDARD_CANVAS_SIZE;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<DomePoint[]>([]);
  const yawRef = useRef(INITIAL_YAW);
  const elevationRef = useRef(INITIAL_ELEVATION);
  const dragStateRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const trailsRef = useRef(new Map<string, TrailPoint[]>());
  const [snapshots, setSnapshots] = useState<ObstructionSnapshot[]>(listSnapshots);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null); // null = live

  const isViewingHistory = scrubIndex !== null && scrubIndex < snapshots.length;

  const drawDome = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const pixelRatio = window.devicePixelRatio > 1 ? 2 : 1;
    const sizePx = canvasSize * pixelRatio;
    if (canvas.width !== sizePx) {
      canvas.width = sizePx;
      canvas.height = sizePx;
    }

    const inkColor = cssVar("--chart-ink") || "#fff";
    const warmColor = cssVar("--chart-warm") || "#f09048";
    const criticalColor = cssVar("--status-critical") || "#f43f5e";
    const mutedColor = cssVar("--ink-muted") || "#7c7c7c";
    const baselineColor = cssVar("--baseline") || "#3a3a3a";

    const yaw = yawRef.current;
    const cameraElevation = elevationRef.current;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sinCamera = Math.sin(cameraElevation);
    const cosCamera = Math.cos(cameraElevation);
    const center = sizePx / 2;
    const radius = sizePx * 0.46;

    const project = (pointX: number, pointY: number, pointZ: number) => {
      const rotatedX = pointX * cosYaw - pointY * sinYaw;
      const rotatedY = pointX * sinYaw + pointY * cosYaw;
      return {
        screenX: center + rotatedX * radius,
        screenY: center + 0.13 * sizePx - (rotatedY * sinCamera + pointZ * cosCamera) * radius,
        depth: rotatedY * cosCamera - pointZ * sinCamera,
      };
    };

    context.clearRect(0, 0, sizePx, sizePx);

    // dashed compass ring
    const ringSegments = 96;
    context.lineWidth = 1.4 * pixelRatio;
    for (let segmentIndex = 0; segmentIndex < ringSegments; segmentIndex += 2) {
      const angleStart = (segmentIndex / ringSegments) * Math.PI * 2;
      const angleEnd = ((segmentIndex + 1) / ringSegments) * Math.PI * 2;
      const startPoint = project(Math.sin(angleStart), Math.cos(angleStart), 0);
      const endPoint = project(Math.sin(angleEnd), Math.cos(angleEnd), 0);
      context.strokeStyle = baselineColor;
      context.globalAlpha = Math.max(0.55 - 0.35 * ((startPoint.depth + 1) / 2), 0.12);
      context.beginPath();
      context.moveTo(startPoint.screenX, startPoint.screenY);
      context.lineTo(endPoint.screenX, endPoint.screenY);
      context.stroke();
    }
    context.globalAlpha = 1;

    // compass letters
    const compassMarks = [
      { label: "N", azimuthRad: 0 },
      { label: "E", azimuthRad: Math.PI / 2 },
      { label: "S", azimuthRad: Math.PI },
      { label: "W", azimuthRad: (3 * Math.PI) / 2 },
    ];
    context.font = `600 ${11 * pixelRatio}px ${cssVar("--font-ui") || "sans-serif"}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const mark of compassMarks) {
      const markPoint = project(Math.sin(mark.azimuthRad) * 1.14, Math.cos(mark.azimuthRad) * 1.14, 0);
      context.fillStyle = mutedColor;
      context.globalAlpha = 1 - 0.45 * ((markPoint.depth + 1) / 2);
      context.fillText(mark.label, markPoint.screenX, markPoint.screenY);
    }
    context.globalAlpha = 1;

    // dome dots, far to near
    const projectedDots = pointsRef.current.map((domePoint) => ({
      kind: domePoint.kind,
      ...project(domePoint.x, domePoint.y, domePoint.z),
    }));
    projectedDots.sort((first, second) => second.depth - first.depth);
    for (const dot of projectedDots) {
      const nearness = 1 - (dot.depth + 1) / 2;
      const dotRadius = (dot.kind === "obstructed" ? 2.4 : 1.7) * pixelRatio * (0.72 + 0.5 * nearness);
      if (dot.kind === "unmapped") {
        context.fillStyle = mutedColor;
        context.globalAlpha = 0.16 + 0.12 * nearness;
      } else if (dot.kind === "obstructed") {
        context.fillStyle = criticalColor;
        context.globalAlpha = 0.85 + 0.15 * nearness;
      } else {
        context.fillStyle = inkColor;
        context.globalAlpha = 0.5 + 0.5 * nearness;
      }
      context.beginPath();
      context.arc(dot.screenX, dot.screenY, dotRadius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    // dish marker at the center
    const dishPoint = project(0, 0, 0.02);
    context.fillStyle = inkColor;
    context.save();
    context.translate(dishPoint.screenX, dishPoint.screenY);
    context.rotate(-yaw * 0.35);
    const dishWidth = 15 * pixelRatio;
    const dishHeight = 9.5 * pixelRatio;
    context.beginPath();
    context.moveTo(-dishWidth / 2, 0);
    context.lineTo(-dishWidth / 2 + dishHeight * 0.45, -dishHeight);
    context.lineTo(dishWidth / 2, -dishHeight * 0.82);
    context.lineTo(dishWidth / 2 - dishHeight * 0.45, dishHeight * 0.18);
    context.closePath();
    context.fill();
    context.restore();

    // satellites: immersive live view only (historical sky had different satellites)
    if (isImmersive && !isViewingHistory && satellites.sampleSky) {
      const inViewSatellites = satellites.sampleSky();
      const nowMs = Date.now();

      // maintain per-satellite trails
      const trails = trailsRef.current;
      const inViewNames = new Set<string>();
      for (const sky of inViewSatellites) {
        inViewNames.add(sky.name);
        const trail = trails.get(sky.name) ?? [];
        const newestTrailPoint = trail[trail.length - 1];
        if (!newestTrailPoint || nowMs - newestTrailPoint.atMs >= TRAIL_POINT_INTERVAL_MS) {
          trail.push({ azimuthDeg: sky.azimuthDeg, elevationDeg: sky.elevationDeg, atMs: nowMs });
          if (trail.length > TRAIL_MAX_POINTS) trail.shift();
          trails.set(sky.name, trail);
        }
      }
      for (const trailName of trails.keys()) {
        if (!inViewNames.has(trailName)) trails.delete(trailName);
      }

      for (const sky of inViewSatellites) {
        const world = skyToWorld(sky.azimuthDeg, sky.elevationDeg);
        const satellitePoint = project(world.x, world.y, world.z);
        const isServing = sky.name === satellites.servingCandidateName;

        // trail
        const trail = trails.get(sky.name) ?? [];
        if (trail.length > 1) {
          context.lineWidth = 1 * pixelRatio;
          for (let trailIndex = 1; trailIndex < trail.length; trailIndex++) {
            const fromWorld = skyToWorld(trail[trailIndex - 1].azimuthDeg, trail[trailIndex - 1].elevationDeg);
            const toWorld = skyToWorld(trail[trailIndex].azimuthDeg, trail[trailIndex].elevationDeg);
            const fromPoint = project(fromWorld.x, fromWorld.y, fromWorld.z);
            const toPoint = project(toWorld.x, toWorld.y, toWorld.z);
            context.strokeStyle = isServing ? warmColor : inkColor;
            context.globalAlpha = 0.35 * (trailIndex / trail.length);
            context.beginPath();
            context.moveTo(fromPoint.screenX, fromPoint.screenY);
            context.lineTo(toPoint.screenX, toPoint.screenY);
            context.stroke();
          }
          context.globalAlpha = 1;
        }

        // beam from the dish to the likely serving satellite
        if (isServing) {
          context.strokeStyle = warmColor;
          context.lineWidth = 3.5 * pixelRatio;
          context.globalAlpha = 0.18;
          context.beginPath();
          context.moveTo(dishPoint.screenX, dishPoint.screenY);
          context.lineTo(satellitePoint.screenX, satellitePoint.screenY);
          context.stroke();
          context.lineWidth = 1.2 * pixelRatio;
          context.globalAlpha = 0.9;
          context.beginPath();
          context.moveTo(dishPoint.screenX, dishPoint.screenY);
          context.lineTo(satellitePoint.screenX, satellitePoint.screenY);
          context.stroke();
          context.globalAlpha = 1;
        }

        // the satellite itself: halo + core
        const coreRadius = (isServing ? 3.2 : 2.3) * pixelRatio;
        context.fillStyle = isServing ? warmColor : inkColor;
        context.globalAlpha = 0.22;
        context.beginPath();
        context.arc(satellitePoint.screenX, satellitePoint.screenY, coreRadius * 2.2, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(satellitePoint.screenX, satellitePoint.screenY, coreRadius, 0, Math.PI * 2);
        context.fill();

        if (isServing) {
          context.font = `500 ${9 * pixelRatio}px ${cssVar("--font-mono") || "monospace"}`;
          context.textAlign = "left";
          context.fillStyle = inkColor;
          context.fillText(
            sky.name,
            satellitePoint.screenX + 8 * pixelRatio,
            satellitePoint.screenY - 6 * pixelRatio,
          );
        }
      }
    }
  }, [satellites, isViewingHistory, isImmersive, canvasSize]);

  // rebuild dome points when the data source (live map or scrubbed snapshot) changes
  useEffect(() => {
    if (isViewingHistory) {
      const snapshot = snapshots[scrubIndex];
      pointsRef.current = buildDomePoints(
        snapshot.gridSize,
        obstructionMap?.maxThetaDeg ?? 80,
        snapshotKindAtCell(unpackCells(snapshot), snapshot.gridSize),
      );
    } else if (obstructionMap?.snr) {
      const gridSize = obstructionMap.numRows ?? Math.round(Math.sqrt(obstructionMap.snr.length));
      pointsRef.current = buildDomePoints(
        gridSize,
        obstructionMap.maxThetaDeg ?? 80,
        liveKindAtCell(obstructionMap.snr, gridSize),
      );
    }
    drawDome();
  }, [obstructionMap, theme, drawDome, isViewingHistory, scrubIndex, snapshots]);

  // persist hourly snapshots as new maps arrive
  useEffect(() => {
    if (obstructionMap?.snr) setSnapshots(saveSnapshotIfDue(obstructionMap));
  }, [obstructionMap]);

  // animation loop while satellites are live (immersive only)
  useEffect(() => {
    if (!isImmersive || !satellites.sampleSky || isViewingHistory) return;
    let animationFrameId = 0;
    let lastFrameAt = 0;
    const animate = (frameTime: number) => {
      if (frameTime - lastFrameAt > 40) {
        lastFrameAt = frameTime;
        drawDome();
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [satellites.sampleSky, isViewingHistory, drawDome]);

  const handlePointerDown = (downEvent: React.PointerEvent<HTMLCanvasElement>) => {
    downEvent.currentTarget.setPointerCapture(downEvent.pointerId);
    dragStateRef.current = { pointerId: downEvent.pointerId, lastX: downEvent.clientX, lastY: downEvent.clientY };
  };

  const handlePointerMove = (moveEvent: React.PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== moveEvent.pointerId) return;
    yawRef.current += (moveEvent.clientX - dragState.lastX) * 0.011;
    elevationRef.current = Math.min(
      1.35,
      Math.max(0.18, elevationRef.current + (moveEvent.clientY - dragState.lastY) * 0.008),
    );
    dragState.lastX = moveEvent.clientX;
    dragState.lastY = moveEvent.clientY;
    requestAnimationFrame(drawDome);
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
  };

  const fractionObstructed = obstructionStats?.fractionObstructed ?? 0;
  const validHours = (obstructionStats?.validS ?? 0) / 3600;
  const { stats, feedState } = satellites;

  const immersiveNote = isViewingHistory
    ? `Viewing the obstruction map as of ${new Date(snapshots[scrubIndex].takenAtMs).toLocaleString()}.`
    : feedState === "loading"
      ? "Loading SpaceX's published constellation ephemerides…"
      : feedState === "error"
        ? "Couldn't load satellite ephemerides — check the internet connection and reload."
        : fractionObstructed < 0.005
          ? "Your Starlink has an unobstructed view of the sky. Satellites shown are propagated live from SpaceX's published ephemerides; the orange beam marks the best unobstructed satellite."
          : "Obstructed patches cause brief interruptions as satellites pass behind them. The orange beam marks the best unobstructed satellite.";
  const standardNote =
    fractionObstructed < 0.005
      ? "Your Starlink has an unobstructed view of the sky. The map becomes more accurate as the dish collects data."
      : "Obstructed patches cause brief interruptions as satellites pass behind them.";

  const domeCanvas =
    obstructionMap?.snr || isViewingHistory ? (
      <canvas
        ref={canvasRef}
        style={{ width: canvasSize, height: canvasSize }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    ) : (
      <div className="empty-note">waiting for obstruction data…</div>
    );

  const baseLegend = (
    <>
      <span className="legend-item">
        <span className="legend-cell" style={{ background: "var(--ink-muted)", opacity: 0.45 }} />
        Unmapped
      </span>
      <span className="legend-item">
        <span className="legend-cell" style={{ background: "var(--chart-ink)" }} />
        Clear view
      </span>
      <span className="legend-item">
        <span className="legend-cell" style={{ background: "var(--status-critical)" }} />
        Obstructions
      </span>
    </>
  );

  const baseStats = (
    <>
      <div className="skydome-stat">
        <span className="stat-caption">Sky obstructed</span>
        <span className="mono-value">{(fractionObstructed * 100).toFixed(2)}%</span>
      </div>
      <div className="skydome-stat">
        <span className="stat-caption">Observed for</span>
        <span className="mono-value">{validHours.toFixed(1)} h</span>
      </div>
    </>
  );

  if (!isImmersive) {
    return (
      <div className="card row-span-2 span-4">
        <div className="card-header">
          <span className="card-title">Obstructions</span>
          <button className="card-link" onClick={onOpenImmersive}>
            Sky view ›
          </button>
        </div>
        <div className="skydome-canvas-wrap">{domeCanvas}</div>
        <div className="skydome-legend">{baseLegend}</div>
        <div className="skydome-stats">{baseStats}</div>
        <div className="skydome-note">
          <span aria-hidden="true">ⓘ</span>
          <span>{standardNote}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="skydome-immersive">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <span className="card-meta">{isViewingHistory ? "time-lapse" : "drag to orbit"}</span>
        {feedState === "active" && observerLocation && (
          <span className="site-line" style={{ marginTop: 0 }}>
            <span className="stat-caption">
              site {observerLocation.latitudeDeg.toFixed(4)}, {observerLocation.longitudeDeg.toFixed(4)}
            </span>
            <button className="site-change" onClick={onClearLocation}>
              change
            </button>
          </span>
        )}
      </div>
      <div className="skydome-canvas-wrap">{domeCanvas}</div>
      {snapshots.length >= 2 && (
        <div className="skydome-scrub">
          <span className="stat-caption" style={{ whiteSpace: "nowrap" }}>
            Obstruction time-lapse
          </span>
          <input
            type="range"
            min={0}
            max={snapshots.length}
            value={scrubIndex ?? snapshots.length}
            onChange={(changeEvent) => {
              const sliderValue = Number(changeEvent.target.value);
              setScrubIndex(sliderValue >= snapshots.length ? null : sliderValue);
            }}
            aria-label="Obstruction time-lapse"
          />
          <span className="stat-caption" style={{ whiteSpace: "nowrap" }}>
            {isViewingHistory
              ? new Date(snapshots[scrubIndex].takenAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "LIVE"}
          </span>
        </div>
      )}
      <div className="skydome-legend">
        {baseLegend}
        <span className="legend-item">
          <span className="legend-cell" style={{ background: "var(--chart-warm)" }} />
          Serving satellite
        </span>
      </div>
      <div className="skydome-stats">
        {baseStats}
        {feedState === "active" && (
          <>
            <div className="skydome-stat">
              <span className="stat-caption">Satellites overhead</span>
              <span className="mono-value">
                {stats.inViewCount} · {stats.serviceableCount} serviceable
              </span>
            </div>
            <div className="skydome-stat">
              <span className="stat-caption">Next 30 min minimum</span>
              <span className="mono-value">
                {stats.forecastMinServiceable30m === null ? "…" : `${stats.forecastMinServiceable30m} serviceable`}
              </span>
            </div>
            <div className="skydome-stat" style={{ gridColumn: "1 / -1" }}>
              <span className="stat-caption">Likely serving satellite</span>
              <span className="mono-value">
                {stats.servingCandidate
                  ? `${stats.servingCandidate.name} · ${stats.servingCandidate.elevationDeg.toFixed(0)}° el · ${stats.servingCandidate.rangeKm.toFixed(0)} km`
                  : "none above 25°"}
              </span>
            </div>
          </>
        )}
      </div>
      {feedState === "location-needed" && !isViewingHistory ? (
        <LocationSetup onLocationSaved={onLocationSaved} />
      ) : (
        <div className="skydome-note">
          <span aria-hidden="true">ⓘ</span>
          <span>{immersiveNote}</span>
        </div>
      )}
    </div>
  );
}
