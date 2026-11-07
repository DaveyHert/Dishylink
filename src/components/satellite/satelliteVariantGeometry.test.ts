import { describe, expect, it } from "vitest";
import { buildSatelliteVariant, type SatellitePreviewVariant } from "./satelliteVariantGeometry";

const variants: SatellitePreviewVariant[] = ["v1.5", "v2-mini", "v3"];
const bounds = (positions: Float32Array) =>
  [0, 1, 2].map((axis) => {
    const values = Array.from(positions).filter((_, index) => index % 3 === axis);
    return [Math.min(...values), Math.max(...values)];
  });

describe("local satellite variant studies", () => {
  for (const variant of variants) {
    it(`${variant}: valid triangles and matching detail silhouettes`, () => {
      const full = buildSatelliteVariant(variant);
      const distant = buildSatelliteVariant(variant, "distant");
      expect(bounds(full.positions)).toEqual(bounds(distant.positions));
      expect(distant.triangleCount).toBeLessThan(full.triangleCount / 4);
      expect(full.triangleCount).toBeLessThan(3200);
      for (const mesh of [full, distant]) {
        expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
        expect(mesh.normals.length).toBe(mesh.positions.length);
        expect(mesh.colors.length).toBe(mesh.positions.length);
        expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
        expect(Array.from(mesh.colors).every((value) => value >= 0 && value <= 1)).toBe(true);
        for (let i = 0; i < mesh.positions.length; i += 9) {
          const p = mesh.positions;
          const u = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
          const v = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
          const cross = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ];
          expect(Math.hypot(...cross)).toBeGreaterThan(1e-8);
          for (let vertex = 0; vertex < 3; vertex++) {
            const n = mesh.normals.slice(i + vertex * 3, i + vertex * 3 + 3);
            expect(Math.hypot(...n)).toBeCloseTo(1);
            expect(cross.reduce((sum, value, axis) => sum + value * n[axis], 0)).toBeGreaterThan(0);
          }
        }
      }
    });
  }
  it("newer studies have opposing wings; single-wing candidate stays asymmetric", () => {
    const one = bounds(buildSatelliteVariant("v1.5").positions)[2];
    expect(one[0]).toBeGreaterThan(0);
    for (const variant of variants.slice(1)) {
      const z = bounds(buildSatelliteVariant(variant).positions)[2];
      expect(z[0]).toBeLessThan(-6);
      expect(z[1]).toBeCloseTo(-z[0]);
    }
    expect(
      new Set(
        variants.map((variant) => JSON.stringify(bounds(buildSatelliteVariant(variant).positions))),
      ).size,
    ).toBe(3);
  });
});
