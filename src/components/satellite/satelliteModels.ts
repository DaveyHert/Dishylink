import { buildSatellite, type SatelliteMesh } from "./satelliteGeometry";
import { buildSatelliteVariant } from "./satelliteVariantGeometry";

export type SatelliteModel = "legacy" | "v1.5" | "v2-mini" | "v3";

/** Only explicit hardware metadata selects a new model. */
export function resolveSatelliteModel(version: string | undefined): SatelliteModel {
  switch (version) {
    case "V1.5":
      return "v1.5";
    case "V2 Mini":
    case "V2 Mini DTC":
    case "V2 Mini Optimized":
      return "v2-mini";
    case "V3":
      return "v3";
    default:
      return "legacy";
  }
}

export function buildSatelliteModels(): Record<SatelliteModel, SatelliteMesh> {
  const legacy = buildSatellite("distant");
  // Match the old model's longest span. Shapes are illustrative, not physical scale.
  const span = (positions: Float32Array) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    positions.forEach((value, index) => {
      const axis = index % 3;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    });
    return Math.max(...max.map((value, axis) => value - min[axis]));
  };
  const target = span(legacy.positions);
  const variant = (model: "v1.5" | "v2-mini" | "v3") => {
    const mesh = buildSatelliteVariant(model, "distant");
    const scale = target / span(mesh.positions);
    mesh.positions = mesh.positions.map((value) => value * scale);
    if (model === "v2-mini" || model === "v3") {
      // Shader X is cross-track, Z is along-track. Turn opposing wings onto X.
      for (const vectors of [mesh.positions, mesh.normals]) {
        for (let i = 0; i < vectors.length; i += 3) {
          const x = vectors[i];
          vectors[i] = vectors[i + 2];
          vectors[i + 2] = -x;
        }
      }
    }
    return mesh;
  };
  return {
    legacy,
    "v1.5": variant("v1.5"),
    "v2-mini": variant("v2-mini"),
    v3: variant("v3"),
  };
}
