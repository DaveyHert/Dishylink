import type { SatelliteDetail, SatelliteMesh } from "./satelliteGeometry";

type Vec3 = [number, number, number];
const SILVER: Vec3 = [0.78, 0.81, 0.84];
const FRAME: Vec3 = [0.35, 0.39, 0.44];
const CELL: Vec3 = [0.035, 0.12, 0.29];

/** Approved V1.5 silhouette shared by preview and production. Units are illustrative. */
export function buildStarlinkCandidate(detail: SatelliteDetail = "full"): SatelliteMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3, tint: Vec3) => {
    const u = b.map((v, i) => v - a[i]);
    const v = c.map((n, i) => n - a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    if (length < 1e-10) throw new Error("Degenerate candidate triangle");
    for (const p of [a, b, c]) {
      positions.push(...p);
      normals.push(...n.map((component) => component / length));
      colors.push(...tint);
    }
  };
  const box = (center: Vec3, size: Vec3, tint: Vec3, upright = false) => {
    const [x, y, z] = center;
    const [w, h, d] = size.map((v) => v / 2);
    const points: Vec3[] = [
      [x - w, y - h, z - d],
      [x + w, y - h, z - d],
      [x + w, y + h, z - d],
      [x - w, y + h, z - d],
      [x - w, y - h, z + d],
      [x + w, y - h, z + d],
      [x + w, y + h, z + d],
      [x - w, y + h, z + d],
    ];
    if (upright) {
      // Rotate around the panel hinge, keeping the bus and its antennas together.
      for (const point of points) {
        const oldY = point[1];
        point[1] = 0.8 - point[2];
        point[2] = 0.8 + oldY;
      }
    }
    for (const [a, b, c, d] of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [3, 7, 6, 2],
      [0, 1, 5, 4],
    ]) {
      tri(points[a], points[b], points[c], tint);
      tri(points[a], points[c], points[d], tint);
    }
  };

  box([0, 0, 0], [2.8, 0.24, 1.6], SILVER, true);
  box([0, -0.14, 0], [2.55, 0.045, 1.36], FRAME, true);
  // Two short hinges connect one continuous deployed wing, not two opposing wings.
  for (const x of [-0.85, 0.85]) box([x, 0, 0.9], [0.12, 0.1, 0.3], FRAME);
  box([0, 0, 4], [2.6, 0.055, 6], FRAME);
  const columns = detail === "full" ? 8 : 2;
  const rows = detail === "full" ? 18 : 6;
  const pitchX = 2.5 / columns;
  const pitchZ = 5.9 / rows;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = -1.25 + (column + 0.5) * pitchX;
      const z = 1.05 + (row + 0.5) * pitchZ;
      const tint: Vec3 = row % 3 === 0 ? [0.045, 0.15, 0.34] : CELL;
      // Thin boxes keep cells visible on both faces when orbiting underneath.
      box([x, 0, z], [pitchX - 0.018, 0.065, pitchZ - 0.018], tint);
    }
  }
  // Low-profile antenna patches and two small edge-mounted antenna stalks.
  for (const x of [-0.8, 0.8]) {
    box([x, 0.155, -0.15], [0.65, 0.07, 0.7], [0.92, 0.93, 0.91], true);
    box([x, 0.31, -0.64], [0.055, 0.38, 0.055], FRAME, true);
    box([x, 0.52, -0.64], [0.2, 0.04, 0.12], SILVER, true);
  }
  box([0, 0.16, 0.35], [0.42, 0.08, 0.24], FRAME, true);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    triangleCount: positions.length / 9,
  };
}
