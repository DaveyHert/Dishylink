// All of the dome's canvas state: the projection, the frame, the animation
// loops and the drag/tap handling.
//
// `drawDome` is deliberately ONE routine. Its steps look separable — ring, dots,
// dish mesh, satellites, callout leader — but they share the `project` closure,
// a running `globalAlpha`, a strict back-to-front draw order, and two refs the
// satellite pass mutates (trails and hit positions). Splitting it would buy line
// count and cost correctness in ways a screenshot cannot catch, so it stays
// whole; what is extracted instead is everything around it, which is why the two
// variants can now be two small components rather than one long body.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DishObstructionMapJson,
  DishStatusJson,
} from "../../lib/dishClient";
import { specForHardware, buildDishMesh, type MeshTriangle } from "../../lib/dishMesh";
import type { SatelliteFeed } from "../../hooks/useSatellites";
import type { SatelliteSky } from "../../lib/satellites";
import {
  listSnapshots,
  saveSnapshotIfDue,
  unpackCells,
  type ObstructionSnapshot,
} from "../../lib/obstructionSnapshots";
import type { SelectedSatellite } from "./SatelliteCallout";
import {
  AUTO_ROTATE_FRAME_MS,
  AUTO_ROTATE_RAD_PER_SEC,
  INITIAL_ELEVATION,
  INITIAL_YAW,
  RESUME_AFTER_DRAG_MS,
  TRAIL_MAX_POINTS,
  TRAIL_POINT_INTERVAL_MS,
  buildDomePoints,
  cssVar,
  liveKindAtCell,
  skyToWorld,
  snapshotKindAtCell,
  type DomePoint,
  type TrailPoint,
} from "./domeGeometry";

export function useSkyDomeCanvas({
  obstructionMap,
  status,
  theme,
  satellites,
  isImmersive,
  canvasSize,
}: {
  obstructionMap: DishObstructionMapJson | null;
  status: DishStatusJson | null;
  theme: "light" | "dark";
  satellites: SatelliteFeed;
  isImmersive: boolean;
  canvasSize: number;
}) {
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
  const [selectedSatellite, setSelectedSatellite] = useState<SelectedSatellite | null>(null);
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
      // Partial sits between clear and obstructed on both size and weight, so
      // a thin branch reads as lighter than a roofline instead of identical.
      const kindRadius = dot.kind === "obstructed" ? 2.4 : dot.kind === "partial" ? 2.05 : 1.7;
      const dotRadius = kindRadius * pixelRatio * (0.72 + 0.5 * nearness);
      if (dot.kind === "unmapped") {
        context.fillStyle = mutedColor;
        context.globalAlpha = 0.16 + 0.12 * nearness;
      } else if (dot.kind === "obstructed") {
        context.fillStyle = criticalColor;
        context.globalAlpha = 0.85 + 0.15 * nearness;
      } else if (dot.kind === "partial") {
        // Same hue as a full obstruction, carried lighter — warm is spoken for
        // by the serving satellite, and partial belongs in the obstruction family.
        context.fillStyle = criticalColor;
        context.globalAlpha = 0.4 + 0.2 * nearness;
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
            const toWorld = skyToWorld(trail[trailIndex].azimuthDeg, trail[trailIndex].elevationDeg);
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
        // The angle this grid was captured at. Snapshots taken before that was
        // recorded fall back to the live map, which is the best guess available.
        snapshot.maxThetaDeg ?? obstructionMap?.maxThetaDeg ?? 80,
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
    // `theme` is not read by drawDome directly — it resolves colors through
    // cssVar() at draw time — so it must stay a dependency here or a theme
    // switch leaves the last frame's colors on screen.
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
  }, [isImmersive, satellites.sampleSky, isViewingHistory, drawDome]);

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
        !dragStateRef.current &&
        performance.now() - lastInteractionRef.current > RESUME_AFTER_DRAG_MS;
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

  const clearSelection = useCallback(() => {
    selectedNameRef.current = null;
    setSelectedSatellite(null);
  }, []);

  return {
    canvasRef,
    calloutRef,
    canvasHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
    selectedSatellite,
    clearSelection,
    snapshots,
    scrubIndex,
    setScrubIndex,
    isViewingHistory,
  };
}
