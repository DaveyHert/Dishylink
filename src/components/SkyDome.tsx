// Draggable 3D sky dome, in the style of the Starlink app's Obstructions
// view, extended well past it:
//   - the dish's 123×123 obstruction grid as a hemisphere of dots
//     (ink = clear, red = obstructed, faint gray = unmapped)
//   - live Starlink satellites crossing the sky (SGP4 from SpaceX ephemeris),
//     with motion trails and a beam to the likely serving satellite
//   - a time-lapse scrubber over hourly obstruction snapshots
// Hand-rolled orthographic projection on 2D canvas; drag to orbit and tilt.

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import type {
  DishObstructionMapJson,
  DishObstructionStatsJson,
  DishStatusJson,
} from "../lib/dishClient";
import { specForHardware, buildDishMesh, type MeshTriangle } from "../lib/dishMesh";
import { StatLabel } from "./InfoDot";
import type { SatelliteFeed } from "../hooks/useSatellites";
import type { ObserverLocation, SatelliteSky } from "../lib/satellites";
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
  /** Live status — drives the dish mesh model + its real orientation. */
  status: DishStatusJson | null;
  theme: "light" | "dark";
  satellites: SatelliteFeed;
  observerLocation: ObserverLocation | null;
  onLocationSaved: (location: ObserverLocation) => void;
  onClearLocation: () => void;
  /** "standard" = compact obstructions card; "immersive" = full satellite view in a sheet. */
  variant?: "standard" | "immersive";
  onOpenImmersive?: () => void;
  /** Immersive only: sub-text under the sheet title, sharing the row with the site line. */
  caption?: string;
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
/** One turn every two minutes: present when you look at it, never the thing
 *  moving in the corner of your eye. Dashboard dome only — the immersive view is
 *  the one you aim and inspect with, so it stays where you put it. */
const AUTO_ROTATE_RAD_PER_SEC = (2 * Math.PI) / 120;
/** Rotation yields after a drag, so it isn't fighting the angle you just set. */
const RESUME_AFTER_DRAG_MS = 4_000;
/** ~25fps: enough for a motion this slow, a quarter of the frames of 60. */
const AUTO_ROTATE_FRAME_MS = 40;

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
  status,
  theme,
  satellites,
  observerLocation,
  onLocationSaved,
  onClearLocation,
  variant = "standard",
  onOpenImmersive,
  caption,
}: SkyDomeProps) {
  const isImmersive = variant === "immersive";
  const canvasSize = isImmersive ? IMMERSIVE_CANVAS_SIZE : STANDARD_CANVAS_SIZE;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<DomePoint[]>([]);
  const yawRef = useRef(INITIAL_YAW);
  const elevationRef = useRef(INITIAL_ELEVATION);
  const dragStateRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const trailsRef = useRef(new Map<string, TrailPoint[]>());
  /** When the user last touched the dome; auto-rotation waits this out. */
  const lastInteractionRef = useRef(0);
  // Satellite click-to-inspect: hit positions collected each frame, the
  // selected name, and the anchored callout element (moved imperatively per
  // frame so it tracks the satellite without React re-renders).
  const satelliteHitsRef = useRef<Array<{ sky: SatelliteSky; screenX: number; screenY: number }>>(
    [],
  );
  const selectedNameRef = useRef<string | null>(null);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const pixelRatioRef = useRef(1);
  const [selectedSatellite, setSelectedSatellite] = useState<{
    sky: SatelliteSky;
    isServing: boolean;
  } | null>(null);
  const [snapshots, setSnapshots] = useState<ObstructionSnapshot[]>(listSnapshots);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null); // null = live

  const isViewingHistory = scrubIndex !== null && scrubIndex < snapshots.length;

  // Parametric mesh for THIS user's hardware, tilted to the live boresight
  // elevation; rebuilt only when model or elevation meaningfully changes.
  const hardwareVersion = status?.deviceInfo?.hardwareVersion;
  const boresightElevation = Math.round(status?.boresightElevationDeg ?? 70);
  const boresightAzimuthRef = useRef(0);
  boresightAzimuthRef.current = ((status?.boresightAzimuthDeg ?? 0) * Math.PI) / 180;
  const dishMesh = useMemo<MeshTriangle[]>(
    () => buildDishMesh(specForHardware(hardwareVersion), boresightElevation),
    [hardwareVersion, boresightElevation],
  );
  const dishMeshRef = useRef(dishMesh);
  dishMeshRef.current = dishMesh;

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
    const satelliteAccent = cssVar("--satellite") || "#e0a422";

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
      const markPoint = project(
        Math.sin(mark.azimuthRad) * 1.14,
        Math.cos(mark.azimuthRad) * 1.14,
        0,
      );
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
      const dotRadius =
        (dot.kind === "obstructed" ? 2.4 : 1.7) * pixelRatio * (0.72 + 0.5 * nearness);
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

    // The user's actual dish model at the center: parametric mesh in meters,
    // yawed to the live boresight azimuth, painter's-algorithm shaded.
    // Display scale exaggerates the ~0.6 m panel against the unit-sphere sky.
    const dishPoint = project(0, 0, 0.02);
    const meshScale = isImmersive ? 0.55 : 0.68;
    const boresightYaw = boresightAzimuthRef.current;
    const sinBoresight = Math.sin(boresightYaw);
    const cosBoresight = Math.cos(boresightYaw);
    const projectMeshVertex = (vertex: [number, number, number]) => {
      // mesh forward (+y) points toward the boresight azimuth (world north = azimuth 0)
      const worldX = (vertex[0] * cosBoresight + vertex[1] * sinBoresight) * meshScale;
      const worldY = (-vertex[0] * sinBoresight + vertex[1] * cosBoresight) * meshScale;
      const worldZ = vertex[2] * meshScale;
      return project(worldX, worldY, worldZ);
    };
    const shadedTriangles = dishMeshRef.current
      .map((triangle) => {
        const projected = triangle.vertices.map(projectMeshVertex);
        return {
          points: projected,
          depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3,
          shade: triangle.shade,
          doubleSided: triangle.doubleSided ?? false,
        };
      })
      // Back-face culling: mesh winding is CCW seen from outside, which this
      // projection maps to positive signed area in screen space. Without this,
      // the depth sort lets the back face and far rim bleed through the panel.
      .filter((triangle) => {
        if (triangle.doubleSided) return true;
        const [a, b, c] = triangle.points;
        const signedArea =
          (b.screenX - a.screenX) * (c.screenY - a.screenY) -
          (c.screenX - a.screenX) * (b.screenY - a.screenY);
        return signedArea > 0;
      })
      .sort((first, second) => second.depth - first.depth);
    const isDarkInk = inkColor.toLowerCase() === "#ffffff" || inkColor.toLowerCase() === "#fff";
    for (const triangle of shadedTriangles) {
      // The physical dish is white/silver hardware — never a black silhouette.
      // Dark theme: shade 20→255 (white on black). Light theme: shade 150→210
      // (silver on the light panel), so bright faces still read as hardware.
      const lightness = Math.round(
        triangle.shade * (isDarkInk ? 235 : 60) + (isDarkInk ? 20 : 150),
      );
      context.fillStyle = `rgb(${lightness},${lightness},${lightness})`;
      context.strokeStyle = context.fillStyle;
      context.lineWidth = 0.6;
      context.beginPath();
      context.moveTo(triangle.points[0].screenX, triangle.points[0].screenY);
      context.lineTo(triangle.points[1].screenX, triangle.points[1].screenY);
      context.lineTo(triangle.points[2].screenX, triangle.points[2].screenY);
      context.closePath();
      context.fill();
      context.stroke(); // paint over hairline antialiasing seams between triangles
    }

    // satellites: immersive live view only (historical sky had different satellites)
    satelliteHitsRef.current = [];
    pixelRatioRef.current = pixelRatio;
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
          context.lineWidth = 1.15 * pixelRatio;
          for (let trailIndex = 1; trailIndex < trail.length; trailIndex++) {
            const fromWorld = skyToWorld(
              trail[trailIndex - 1].azimuthDeg,
              trail[trailIndex - 1].elevationDeg,
            );
            const toWorld = skyToWorld(
              trail[trailIndex].azimuthDeg,
              trail[trailIndex].elevationDeg,
            );
            const fromPoint = project(fromWorld.x, fromWorld.y, fromWorld.z);
            const toPoint = project(toWorld.x, toWorld.y, toWorld.z);
            context.strokeStyle = isServing ? warmColor : satelliteAccent;
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

        // The satellite reads as a distinct object against the dot grid: a
        // colored core with a crisp ring (a little reticle). Non-serving
        // satellites are cool blue; the serving one is warm + gets a real glow
        // so it stands out among the crowd. The ring grows slightly with
        // elevation so overhead/closer satellites feel nearer.
        const satelliteColor = isServing ? warmColor : satelliteAccent;
        const coreRadius = (isServing ? 3 : 2) * pixelRatio;
        const ringRadius = coreRadius + (1.6 + (sky.elevationDeg / 90) * 1.6) * pixelRatio;

        // glow: only the serving satellite (a field of hundreds can't all glow)
        if (isServing) {
          context.fillStyle = satelliteColor;
          context.globalAlpha = 0.16;
          context.beginPath();
          context.arc(
            satellitePoint.screenX,
            satellitePoint.screenY,
            ringRadius * 2.2,
            0,
            Math.PI * 2,
          );
          context.fill();
        }

        // core
        context.fillStyle = satelliteColor;
        context.globalAlpha = 1;
        context.beginPath();
        context.arc(satellitePoint.screenX, satellitePoint.screenY, coreRadius, 0, Math.PI * 2);
        context.fill();

        // crisp ring
        context.strokeStyle = satelliteColor;
        context.lineWidth = 1 * pixelRatio;
        context.globalAlpha = isServing ? 0.95 : 0.55;
        context.beginPath();
        context.arc(satellitePoint.screenX, satellitePoint.screenY, ringRadius, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = 1;

        satelliteHitsRef.current.push({
          sky,
          screenX: satellitePoint.screenX,
          screenY: satellitePoint.screenY,
        });
        if (sky.name === selectedNameRef.current) {
          // selection: a second, wider ring
          context.strokeStyle = inkColor;
          context.lineWidth = 1.4 * pixelRatio;
          context.globalAlpha = 0.9;
          context.beginPath();
          context.arc(
            satellitePoint.screenX,
            satellitePoint.screenY,
            ringRadius + 4 * pixelRatio,
            0,
            Math.PI * 2,
          );
          context.stroke();
          context.globalAlpha = 1;
        }

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

    // anchored callout: track the selected satellite every frame, leader line included
    const callout = calloutRef.current;
    if (callout) {
      const selectedHit = selectedNameRef.current
        ? satelliteHitsRef.current.find((hit) => hit.sky.name === selectedNameRef.current)
        : undefined;
      if (selectedHit) {
        // canvas-relative → offsetParent-relative (canvas may be centered in the wrap)
        const cssX = selectedHit.screenX / pixelRatio + canvas.offsetLeft;
        const cssY = selectedHit.screenY / pixelRatio + canvas.offsetTop;
        const flipLeft = cssX > canvasSize - 230;
        const anchorOffset = 18;
        callout.style.display = "block";
        callout.style.left = `${flipLeft ? cssX - anchorOffset : cssX + anchorOffset}px`;
        callout.style.top = `${Math.min(Math.max(cssY - 30, 6), canvasSize - 150)}px`;
        callout.style.transform = flipLeft ? "translateX(-100%)" : "none";
        context.strokeStyle = inkColor;
        context.globalAlpha = 0.5;
        context.lineWidth = 1 * pixelRatio;
        context.beginPath();
        context.moveTo(selectedHit.screenX, selectedHit.screenY);
        context.lineTo(
          selectedHit.screenX + (flipLeft ? -anchorOffset : anchorOffset) * pixelRatio * 0.85,
          selectedHit.screenY,
        );
        context.stroke();
        context.globalAlpha = 1;
      } else {
        callout.style.display = "none";
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

  // redraw when the dish mesh changes (model detected / boresight moved) —
  // matters in the standard view, which has no animation loop
  useEffect(() => {
    drawDome();
  }, [dishMesh, drawDome]);

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

  // Slow drift for the dashboard dome, as the Starlink app does it. Skipped for
  // anyone who asked the OS to reduce motion — this one never stops on its own.
  useEffect(() => {
    if (isImmersive) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let animationFrameId = 0;
    let lastFrameAt = 0;
    const animate = (frameTime: number) => {
      animationFrameId = requestAnimationFrame(animate);
      if (frameTime - lastFrameAt < AUTO_ROTATE_FRAME_MS) return;
      const elapsedMs = lastFrameAt === 0 ? 0 : frameTime - lastFrameAt;
      lastFrameAt = frameTime;
      const idle =
        !dragStateRef.current && performance.now() - lastInteractionRef.current > RESUME_AFTER_DRAG_MS;
      if (!idle) return;
      yawRef.current += AUTO_ROTATE_RAD_PER_SEC * (elapsedMs / 1000);
      drawDome();
    };
    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isImmersive, drawDome]);

  const handlePointerDown = (downEvent: React.PointerEvent<HTMLCanvasElement>) => {
    lastInteractionRef.current = performance.now();
    downEvent.currentTarget.setPointerCapture(downEvent.pointerId);
    dragStateRef.current = {
      pointerId: downEvent.pointerId,
      lastX: downEvent.clientX,
      lastY: downEvent.clientY,
      startX: downEvent.clientX,
      startY: downEvent.clientY,
    };
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
    lastInteractionRef.current = performance.now();
    requestAnimationFrame(drawDome);
  };

  const handlePointerUp = (upEvent: React.PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    lastInteractionRef.current = performance.now();
    if (!dragState || !isImmersive || isViewingHistory) return;
    // a real click, not the tail of an orbit drag
    const movedPx = Math.hypot(
      upEvent.clientX - dragState.startX,
      upEvent.clientY - dragState.startY,
    );
    if (movedPx > 6) return;
    const canvasRect = upEvent.currentTarget.getBoundingClientRect();
    const clickX = upEvent.clientX - canvasRect.left;
    const clickY = upEvent.clientY - canvasRect.top;
    const pixelRatio = pixelRatioRef.current;
    let nearest: { sky: SatelliteSky; distancePx: number } | null = null;
    for (const hit of satelliteHitsRef.current) {
      const distancePx = Math.hypot(
        hit.screenX / pixelRatio - clickX,
        hit.screenY / pixelRatio - clickY,
      );
      if (distancePx < 14 && (!nearest || distancePx < nearest.distancePx)) {
        nearest = { sky: hit.sky, distancePx };
      }
    }
    selectedNameRef.current = nearest?.sky.name ?? null;
    setSelectedSatellite(
      nearest
        ? { sky: nearest.sky, isServing: nearest.sky.name === satellites.servingCandidateName }
        : null,
    );
    requestAnimationFrame(drawDome);
  };

  // keep the callout's numbers live while one is open; close it when the
  // satellite drops below the horizon
  useEffect(() => {
    if (!selectedSatellite) return;
    const timerId = window.setInterval(() => {
      const hit = satelliteHitsRef.current.find(
        (candidate) => candidate.sky.name === selectedNameRef.current,
      );
      if (hit) {
        setSelectedSatellite({
          sky: hit.sky,
          isServing: hit.sky.name === satellites.servingCandidateName,
        });
      } else {
        selectedNameRef.current = null;
        setSelectedSatellite(null);
      }
    }, 1000);
    return () => window.clearInterval(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSatellite !== null, satellites.servingCandidateName]);

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
          ? "Your Starlink has an unobstructed view of the sky. The orange beam marks the best unobstructed satellite."
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
      <div className='empty-note'>waiting for obstruction data…</div>
    );

  const baseLegend = (
    <>
      <span className='legend-item'>
        <span className='legend-cell' style={{ background: "var(--ink-muted)", opacity: 0.45 }} />
        Unmapped
      </span>
      <span className='legend-item'>
        <span className='legend-cell' style={{ background: "var(--chart-ink)" }} />
        Clear view
      </span>
      <span className='legend-item'>
        <span className='legend-cell' style={{ background: "var(--status-critical)" }} />
        Obstructions
      </span>
    </>
  );

  const baseStats = (
    <>
      <div className='skydome-stat'>
        <span className='stat-caption'>Sky obstructed</span>
        <span className='mono-value'>{(fractionObstructed * 100).toFixed(2)}%</span>
      </div>
      <div className='skydome-stat'>
        <span className='stat-caption'>Observed for</span>
        <span className='mono-value'>{validHours.toFixed(1)} h</span>
      </div>
    </>
  );

  if (!isImmersive) {
    return (
      <div className='card row-span-2 span-4'>
        <div className='card-header'>
          <span className='card-title'>Obstructions</span>
          <button className='card-link' onClick={onOpenImmersive}>
            Satellite view ›
          </button>
        </div>
        <div className='skydome-canvas-wrap'>{domeCanvas}</div>
        <div className='skydome-legend'>{baseLegend}</div>
        <div className='skydome-stats'>{baseStats}</div>
        <div className='skydome-note'>
          <span aria-hidden='true'>ⓘ</span>
          <span>{standardNote}</span>
        </div>
      </div>
    );
  }

  return (
    <div className='skydome-immersive'>
      {(caption || (feedState === "active" && observerLocation)) && (
        // Caption and site line are ends of one row: the caption is the sheet's
        // sub-title, so it must sit on the title's baseline row, not above it.
        <div
          className='card-header'
          style={{ marginBottom: 0, justifyContent: "space-between", gap: 12 }}
        >
          <span className='stat-caption'>{caption}</span>
          {feedState === "active" && observerLocation && (
            <span className='site-line' style={{ marginTop: 0, flexShrink: 0 }}>
              <span className='stat-caption'>
                site {observerLocation.latitudeDeg.toFixed(4)},{" "}
                {observerLocation.longitudeDeg.toFixed(4)}
              </span>
              <button className='site-change' onClick={onClearLocation}>
                change
              </button>
            </span>
          )}
        </div>
      )}
      <div className='skydome-canvas-wrap' style={{ position: "relative" }}>
        {domeCanvas}
        <div ref={calloutRef} className='sat-callout' style={{ display: "none" }}>
          {selectedSatellite && (
            <>
              <div className='sat-callout-head'>
                <span
                  className='sat-callout-name mono-value'
                  style={{
                    color: selectedSatellite.isServing ? "var(--chart-warm)" : "var(--satellite)",
                  }}
                >
                  {selectedSatellite.sky.name.replace(/\s*\[DTC\]\s*/, "")}
                </span>
                {/\[DTC\]/.test(selectedSatellite.sky.name) && (
                  <span className='sat-callout-tag'>DTC</span>
                )}
                {selectedSatellite.isServing && (
                  <span className='sat-callout-tag serving'>serving</span>
                )}
                <button
                  className='sat-callout-close'
                  aria-label='Close satellite details'
                  onClick={() => {
                    selectedNameRef.current = null;
                    setSelectedSatellite(null);
                  }}
                >
                  ×
                </button>
              </div>
              <div className='sat-callout-grid mono-value'>
                <span>elevation</span>
                <span>{selectedSatellite.sky.elevationDeg.toFixed(1)}°</span>
                <span>azimuth</span>
                <span>{((selectedSatellite.sky.azimuthDeg + 360) % 360).toFixed(1)}°</span>
                <span>altitude</span>
                <span>
                  {selectedSatellite.sky.altitudeKm !== undefined
                    ? `${selectedSatellite.sky.altitudeKm.toFixed(0)} km`
                    : "—"}
                </span>
                <span>distance</span>
                <span>{selectedSatellite.sky.rangeKm.toFixed(0)} km</span>
                <span>speed</span>
                <span>
                  {selectedSatellite.sky.speedKmS !== undefined
                    ? `${selectedSatellite.sky.speedKmS.toFixed(1)} km/s`
                    : "—"}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className='skydome-hint card-meta'>
        {isViewingHistory ? "time-lapse" : "drag to orbit · tap a satellite for details"}
      </div>
      {snapshots.length >= 2 && (
        <div className='skydome-scrub'>
          <span className='stat-caption' style={{ whiteSpace: "nowrap" }}>
            Obstruction time-lapse
          </span>
          <div className='scrub-track'>
            <div className='scrub-ticks' aria-hidden='true'>
              {/* one tick per hourly snapshot + the LIVE stop, so the slidable points are visible */}
              {Array.from({ length: snapshots.length + 1 }, (_, tickIndex) => (
                <span
                  key={tickIndex}
                  className={`scrub-tick${tickIndex === (scrubIndex ?? snapshots.length) ? " active" : ""}${tickIndex === snapshots.length ? " live" : ""}`}
                />
              ))}
            </div>
            <input
              type='range'
              min={0}
              max={snapshots.length}
              step={1}
              value={scrubIndex ?? snapshots.length}
              onChange={(changeEvent) => {
                const sliderValue = Number(changeEvent.target.value);
                setScrubIndex(sliderValue >= snapshots.length ? null : sliderValue);
              }}
              aria-label='Obstruction time-lapse'
            />
          </div>
          <span
            className='stat-caption'
            style={{ whiteSpace: "nowrap", minWidth: 44, textAlign: "right" }}
          >
            {isViewingHistory
              ? new Date(snapshots[scrubIndex].takenAtMs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "LIVE"}
          </span>
        </div>
      )}
      <div className='skydome-legend'>
        {baseLegend}
        <span className='legend-item'>
          <span className='legend-cell' style={{ background: "var(--satellite)" }} />
          Satellite
        </span>
        <span className='legend-item'>
          <span className='legend-cell' style={{ background: "var(--chart-warm)" }} />
          Serving satellite
        </span>
      </div>
      <div className='skydome-stats'>
        {baseStats}
        {feedState === "active" && (
          <>
            <div className='skydome-stat'>
              <StatLabel tip="Starlink satellites currently above your horizon. 'Serviceable' ones are high enough (above ~25° elevation) that your dish could actually lock onto them.">
                Satellites overhead
              </StatLabel>
              <span className='mono-value'>
                {stats.inViewCount} · {stats.serviceableCount} serviceable
              </span>
            </div>
            <div className='skydome-stat'>
              <StatLabel tip="The fewest serviceable satellites at any moment over the next 30 minutes, from SpaceX's published orbits. A low number can mean brief drops as satellites hand off.">
                Next 30 min minimum
              </StatLabel>
              <span className='mono-value'>
                {stats.forecastMinServiceable30m === null
                  ? "…"
                  : `${stats.forecastMinServiceable30m} serviceable`}
              </span>
            </div>
            <div className='skydome-stat' style={{ gridColumn: "1 / -1" }}>
              <StatLabel tip='Our best guess at the satellite your dish is talking to right now — the highest, unobstructed one, inferred from live orbits.'>
                Likely serving satellite
              </StatLabel>
              <span className='mono-value'>
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
        <div className='skydome-note'>
          <span aria-hidden='true'>ⓘ</span>
          <span>{immersiveNote}</span>
        </div>
      )}
    </div>
  );
}
