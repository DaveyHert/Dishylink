import type { SatelliteDetail, SatelliteMesh } from "./satelliteGeometry";
import { buildStarlinkCandidate } from "./starlinkCandidateGeometry";

type Vec3 = [number, number, number];
export type SatellitePreviewVariant = "v1.5" | "v2-mini" | "v3";

/** Approved illustrative shapes; hardware identity comes only from explicit metadata. */
export function buildSatelliteVariant(
  variant: SatellitePreviewVariant,
  detail: SatelliteDetail = "full",
): SatelliteMesh {
  if (variant === "v1.5") return buildStarlinkCandidate(detail);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const box = (center: Vec3, size: Vec3, color: Vec3) => {
    const points: Vec3[] = [];
    for (const z of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const x of [-1, 1]) {
          points.push([
            center[0] + (x * size[0]) / 2,
            center[1] + (y * size[1]) / 2,
            center[2] + (z * size[2]) / 2,
          ]);
        }
      }
    }
    for (const face of [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
      [2, 6, 7, 3],
      [0, 1, 5, 4],
    ]) {
      for (const [a, b, c] of [
        [face[0], face[1], face[2]],
        [face[0], face[2], face[3]],
      ]) {
        const u = points[b].map((value, axis) => value - points[a][axis]);
        const v = points[c].map((value, axis) => value - points[a][axis]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...n);
        if (length < 1e-10) throw new Error("Degenerate variant triangle");
        for (const point of [points[a], points[b], points[c]]) {
          positions.push(...point);
          normals.push(...n.map((value) => value / length));
          colors.push(...color);
        }
      }
    }
  };
  const frame: Vec3 = [0.35, 0.39, 0.44];
  const silver: Vec3 = [0.78, 0.81, 0.84];
  const nextGeneration = variant === "v3";
  const wingLength = nextGeneration ? 12 : 6;
  const wingWidth = nextGeneration ? 3.4 : 2.6;
  const bodyWidth = nextGeneration ? 3 : 2.5;
  const bodyDepth = nextGeneration ? 2 : 1.6;
  box([0, 0, 0], [bodyWidth, 0.24, bodyDepth], silver);
  box([0, -0.18, 0], [bodyWidth * 0.9, 0.08, bodyDepth * 0.9], frame);
  // Opposing wings make the newer silhouettes distinct from the single-wing candidate.
  for (const side of [-1, 1]) {
    const start = bodyDepth / 2 + 0.35;
    box([0, 0, side * (bodyDepth / 2 + 0.175)], [0.8, 0.1, 0.4], frame);
    box([0, 0, side * (start + wingLength / 2)], [wingWidth, 0.055, wingLength], frame);
    const columns = detail === "full" ? 6 : 2;
    const rows = detail === "full" ? 16 : 4;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const pitchX = (wingWidth - 0.1) / columns;
        const pitchZ = (wingLength - 0.1) / rows;
        box(
          [
            -(wingWidth - 0.1) / 2 + (column + 0.5) * pitchX,
            0,
            side * (start + 0.05 + (row + 0.5) * pitchZ),
          ],
          [pitchX - 0.025, 0.065, pitchZ - 0.025],
          row % 4 === 0 ? [0.045, 0.15, 0.34] : [0.035, 0.12, 0.29],
        );
      }
    }
  }
  for (const x of [-bodyWidth * 0.27, bodyWidth * 0.27]) {
    box([x, 0.16, 0], [bodyWidth * 0.32, 0.07, bodyDepth * 0.7], [0.92, 0.93, 0.91]);
  }
  if (nextGeneration) {
    for (const x of [-1.55, 1.55]) box([x, 0, 0], [0.14, 0.3, 1.6], frame);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    triangleCount: positions.length / 9,
  };
}
