// All of the dome's canvas state: the projection, the frame, the drift loop and
// the drag handling.
//
// `drawDome` is deliberately ONE routine. Its steps look separable — ring,
// compass, dots, dish mesh — but they share the `project` closure, a running
// `globalAlpha` and a strict back-to-front draw order. Splitting it would buy
// line count and cost correctness in ways a screenshot cannot catch, so it stays
// whole; what is extracted instead is everything around it.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  DishObstructionMapJson,
  DishStatusJson,
} from "../../lib/dishClient";
import { specForHardware, buildDishMesh, type MeshTriangle } from "../../lib/dishMesh";
import {
  AUTO_ROTATE_FRAME_MS,
  AUTO_ROTATE_RAD_PER_SEC,
  INITIAL_ELEVATION,
  INITIAL_YAW,
  RESUME_AFTER_DRAG_MS,
  buildDomePoints,
  cssVar,
  liveKindAtCell,
  type DomePoint,
} from "./domeGeometry";

export function useSkyDomeCanvas({
  obstructionMap,
  status,
  theme,
  canvasSize,
}: {
  obstructionMap: DishObstructionMapJson | null;
  status: DishStatusJson | null;
  theme: "light" | "dark";
  canvasSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<DomePoint[]>([]);
  // The survey's grid size sets dot spacing, which sets dot radius — without it
  // full-resolution dots overlap into a solid surface at small canvas sizes.
  const gridSizeRef = useRef(123);
  const yawRef = useRef(INITIAL_YAW);
  const elevationRef = useRef(INITIAL_ELEVATION);
  const dragStateRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
  } | null>(null);
  /** When the user last touched the dome; auto-rotation waits this out. */
  const lastInteractionRef = useRef(0);

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
    const mutedColor = cssVar("--ink-muted") || "#7c7c7c";
    const baselineColor = cssVar("--baseline") || "#3a3a3a";
    // The survey's own palette — see --sky-* in index.css. The dots used to
    // borrow --status-critical and --chart-ink, which is why the WebGL sky and
    // the legend each ended up with a different red.
    const clearColor = cssVar("--sky-clear") || inkColor;
    const partialColor = cssVar("--sky-partial") || "#6e0f0f";
    const obstructedColor = cssVar("--sky-obstructed") || "#f51e1e";
    const unmappedColor = cssVar("--sky-unmapped") || mutedColor;

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
      // Dot radius follows cell spacing so the full-resolution survey renders
      // as distinct dots, not a fused sheet: a clear dot never exceeds half the
      // distance to its neighbour at any canvas size. Partial sits between
      // clear and obstructed on both size and weight, so a thin branch reads
      // as lighter than a roofline instead of identical.
      const cellSpacing = (2 * radius) / gridSizeRef.current;
      const kindScale = dot.kind === "obstructed" ? 1.35 : dot.kind === "partial" ? 1.18 : 1;
      const dotRadius = cellSpacing * kindScale * (0.3 + 0.12 * nearness);
      if (dot.kind === "unmapped") {
        context.fillStyle = unmappedColor;
        context.globalAlpha = 0.16 + 0.12 * nearness;
      } else if (dot.kind === "obstructed") {
        context.fillStyle = obstructedColor;
        context.globalAlpha = 0.85 + 0.15 * nearness;
      } else if (dot.kind === "partial") {
        // The partial token already carries the obstruction colour at half
        // weight, so this alpha is only the depth cue the other kinds get —
        // not the second place the "lighter" was being decided.
        context.fillStyle = partialColor;
        context.globalAlpha = 0.8 + 0.2 * nearness;
      } else {
        context.fillStyle = clearColor;
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
    const meshScale = 0.68;
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
  }, [canvasSize]);

  // rebuild dome points when the live obstruction map changes
  useEffect(() => {
    if (obstructionMap?.snr) {
      const gridSize = obstructionMap.numRows ?? Math.round(Math.sqrt(obstructionMap.snr.length));
      gridSizeRef.current = gridSize;
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
  }, [obstructionMap, theme, drawDome]);

  // redraw when the dish mesh changes (model detected / boresight moved) —
  // matters in the standard view, which has no animation loop
  useEffect(() => {
    drawDome();
  }, [dishMesh, drawDome]);

  // Slow drift for the dashboard dome, as the Starlink app does it. Skipped for
  // anyone who asked the OS to reduce motion — this one never stops on its own.
  useEffect(() => {
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
  }, [drawDome]);

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

  const handlePointerUp = () => {
    dragStateRef.current = null;
    lastInteractionRef.current = performance.now();
  };

  return {
    canvasRef,
    canvasHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}
