import { describe, expect, it } from "vitest";
import { buildSatellite } from "./satelliteGeometry";
import { buildSatelliteModels, resolveSatelliteModel } from "./satelliteModels";
import { buildSatelliteVariant } from "./satelliteVariantGeometry";

const longestSpan = (positions: Float32Array) =>
  Math.max(
    ...[0, 1, 2].map((axis) => {
      const values = Array.from(positions).filter((_, i) => i % 3 === axis);
      return Math.max(...values) - Math.min(...values);
    }),
  );

describe("production satellite models", () => {
  it.each(["v2-mini", "v3"] as const)(
    "turns %s wings cross-track with matching normals",
    (model) => {
      const source = buildSatelliteVariant(model, "distant");
      const mesh = buildSatelliteModels()[model];
      const scale =
        longestSpan(buildSatellite("distant").positions) / longestSpan(source.positions);
      for (let i = 0; i < mesh.positions.length; i += 3) {
        expect(mesh.positions[i]).toBe(Math.fround(source.positions[i + 2] * scale));
        expect(mesh.positions[i + 1]).toBe(Math.fround(source.positions[i + 1] * scale));
        expect(mesh.positions[i + 2]).toBe(-Math.fround(source.positions[i] * scale));
        expect(Array.from(mesh.normals.slice(i, i + 3))).toEqual([
          source.normals[i + 2],
          source.normals[i + 1],
          -source.normals[i],
        ]);
      }
      expect(mesh.colors).toEqual(source.colors);
      const wingCenters = [-1, 1].map((side) => {
        const points = Array.from({ length: mesh.positions.length / 3 }, (_, i) =>
          Array.from(mesh.positions.slice(i * 3, i * 3 + 3)),
        ).filter((point) => side * point[0] > 2);
        return [0, 1, 2].map((axis) => {
          const values = points.map((point) => point[axis]);
          return (Math.min(...values) + Math.max(...values)) / 2;
        });
      });
      const span = wingCenters[1].map((value, axis) => value - wingCenters[0][axis]);
      expect(span[0]).toBeGreaterThan(10);
      expect(span[1]).toBeCloseTo(0);
      expect(span[2]).toBeCloseTo(0);
      // Shader mat3(iRight, iUp, iForward): X spans perpendicular to velocity Z.
      const forward = [0.6, 0, 0.8];
      const right = [-0.8, 0, 0.6];
      const up = [0, 1, 0];
      const worldSpan = [0, 1, 2].map(
        (axis) => right[axis] * span[0] + up[axis] * span[1] + forward[axis] * span[2],
      );
      expect(worldSpan.reduce((dot, value, axis) => dot + value * forward[axis], 0)).toBeCloseTo(0);
    },
  );
  it("preserves V1.5 scaled positions and exact normals/colors", () => {
    const source = buildSatelliteVariant("v1.5", "distant");
    const scale = longestSpan(buildSatellite("distant").positions) / longestSpan(source.positions);
    expect(buildSatelliteModels()["v1.5"]).toEqual({
      ...source,
      positions: source.positions.map((value) => value * scale),
    });
    expect(buildSatelliteModels()[resolveSatelliteModel("Unknown")]).toEqual(
      buildSatellite("distant"),
    );
  });
  it.each([
    ["V1.5", "v1.5"],
    ["V2 Mini", "v2-mini"],
    ["V2 Mini DTC", "v2-mini"],
    ["V2 Mini Optimized", "v2-mini"],
    ["V3", "v3"],
    [undefined, "legacy"],
    ["Unknown", "legacy"],
    ["V1.0", "legacy"],
    ["V2", "legacy"],
    ["", "legacy"],
  ])("maps explicit %s to %s", (version, model) => {
    expect(resolveSatelliteModel(version)).toBe(model);
  });
  it("preserves old geometry exactly and keeps variants distinct with bounded scale", () => {
    const models = buildSatelliteModels();
    expect(models.legacy).toEqual(buildSatellite("distant"));
    expect(
      new Set(Object.values(models).map((mesh) => JSON.stringify(Array.from(mesh.positions)))).size,
    ).toBe(4);
    for (const mesh of Object.values(models)) {
      expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
      expect(mesh.colors.length).toBe(mesh.positions.length);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
      const spans = [0, 1, 2].map((axis) => {
        const values = Array.from(mesh.positions).filter((_, i) => i % 3 === axis);
        return Math.max(...values) - Math.min(...values);
      });
      expect(Math.max(...spans)).toBeCloseTo(22, 1);
    }
  });
});
