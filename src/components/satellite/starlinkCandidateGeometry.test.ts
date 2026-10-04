import { describe, expect, it } from "vitest";
import { buildStarlinkCandidate } from "./starlinkCandidateGeometry";

describe("local Starlink candidate", () => {
  for (const detail of ["full", "distant"] as const) {
    it(`${detail}: finite nondegenerate triangles, unit normals and bounded colors`, () => {
      const mesh = buildStarlinkCandidate(detail);
      expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(mesh.colors.length).toBe(mesh.positions.length);
      for (const value of [...mesh.positions, ...mesh.normals, ...mesh.colors])
        expect(Number.isFinite(value)).toBe(true);
      for (const value of mesh.colors) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of mesh.colors) expect(value).toBeLessThanOrEqual(1);
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
        for (let vertex = 0; vertex < 9; vertex += 3) {
          const n = Array.from(mesh.normals.slice(i + vertex, i + vertex + 3));
          expect(Math.hypot(...n)).toBeCloseTo(1, 5);
          expect(cross.reduce((sum, c, axis) => sum + c * n[axis], 0)).toBeGreaterThan(0);
        }
      }
      expect(mesh.triangleCount).toBeLessThanOrEqual(detail === "full" ? 1900 : 300);
    });
  }
  it("keeps flat bus and single long wing silhouette across detail levels", () => {
    const bounds = (detail: "full" | "distant") => {
      const p = buildStarlinkCandidate(detail).positions;
      return [0, 1, 2].map((axis) => {
        const values = Array.from(p).filter((_, i) => i % 3 === axis);
        return [Math.min(...values), Math.max(...values)];
      });
    };
    expect(bounds("full")).toEqual(bounds("distant"));
    const [x, y, z] = bounds("full");
    expect(x[1] - x[0]).toBeCloseTo(2.8);
    expect(y[1] - y[0]).toBeCloseTo(1.65);
    expect(z[0]).toBeCloseTo(0.6375);
    // Bus first box: its broad face is vertical; panel stays horizontal.
    const p = buildStarlinkCandidate().positions;
    const bus = Array.from(p.slice(0, 108));
    const extent = (axis: number) => {
      const values = bus.filter((_, i) => i % 3 === axis);
      return Math.max(...values) - Math.min(...values);
    };
    expect(extent(1)).toBeCloseTo(1.6);
    expect(extent(2)).toBeCloseTo(0.24);
    expect(z[1]).toBeCloseTo(7);
    expect(buildStarlinkCandidate("distant").triangleCount).toBeLessThan(
      buildStarlinkCandidate("full").triangleCount / 5,
    );
  });
});
