// Parametric 3D dish meshes, keyed by the hardwareVersion the dish reports.
// Each model is generated procedurally from SpaceX's published physical
// dimensions, so the mesh at the center of the sky dome is dimensionally
// exact for the user's actual hardware — no CAD files, works for every model.
//
// Mesh space: x = dish-right, y = dish-forward (toward boresight azimuth),
// z = up, in meters, origin at the mount pivot. The renderer tilts the panel
// by the live boresight elevation and yaws it by the live azimuth.

import type { DishStatusJson } from "./dishClient";

/** The kit models SpaceX's own web app distinguishes (their `zl`). One id per
 *  model, resolved once, so geometry and alignment can't disagree about which
 *  dish this is. */
export type DishModel = "v2" | "v3" | "v4" | "v5" | "hp" | "flatHp" | "hpV4" | "mini";

/**
 * Their `Vl`, ported: the model from the hardware string plus the actuator flag.
 *
 * Prefix tests, in their order, and the order carries meaning — every HP Gen 4
 * reports a `rev4_hp…` string, so testing `rev4` first would swallow it. A
 * substring match does the same thing, which is why this is prefix-based rather
 * than a list of regexes.
 *
 * Some families spell the revision with a redundant `rev_` before the real token
 * — `rev_hp1_proto0` (Performance Gen 1 and 2), `rev_rev1_proto3` (a V1
 * prototype). Stripping it lets the one prefix table below cover both spellings;
 * without it those strings match nothing and fall through to `v4`, drawing a
 * mast-mounted High Performance kit as a Standard on a kickstand.
 *
 * An earlier version of this table also matched `high_perf` and `flat_hp`
 * anywhere in the string; no dish has been observed reporting either, and a dish
 * that did would resolve to `v4` here exactly as it would in their app.
 */
export function resolveDishModel(
  hardwareVersion: string | undefined,
  motorised: boolean,
): DishModel {
  const hardware = (hardwareVersion?.toLowerCase() ?? "").replace(/^rev_/, "");
  if (hardware === "") return "v4";
  if (hardware.startsWith("hp")) return motorised ? "hp" : "flatHp";
  if (hardware.startsWith("rev3") || hardware.startsWith("dishy")) return "v3";
  if (hardware.startsWith("rev1") || hardware.startsWith("rev2")) return "v2";
  if (hardware.startsWith("rev4_hp")) return "hpV4";
  if (hardware.startsWith("rev4")) return "v4";
  if (hardware.startsWith("rev5")) return "v5";
  if (hardware.startsWith("mini1") || hardware.startsWith("mini2")) return "mini";
  return "v4";
}

/** The kit to draw, straight from a status reply. Every surface that renders
 *  hardware resolves through here, so the dome, the speed test and the alignment
 *  card cannot disagree about which dish this is. */
export function dishModelFor(status: DishStatusJson | null): DishModel {
  return resolveDishModel(
    status?.deviceInfo?.hardwareVersion,
    status?.hasActuators === "HAS_ACTUATORS_YES",
  );
}

export interface DishModelSpec {
  /** Marketing name shown in UI tooltips. */
  displayName: string;
  /** Panel size in meters: across (width) × along boresight (height). */
  panelWidthM: number;
  panelHeightM: number;
  cornerRadiusM: number;
  mount: "kickstand" | "mast" | "flat";
  /** Default plate tilt, from their `Gl`. Kits that sit near flat (under 8°)
   *  are allowed to aim all the way to zenith — see alignmentMath.ts. */
  defaultTiltDeg: number;
}

// Dimensions from starlink.com specs pages; defaultTiltDeg from the dish web
// app's own model table. The Gen 4 HP and Gen 4 panels are unpublished, so those
// two reuse the nearest published body — the tilt figures are theirs regardless.
const MODEL_SPECS: Record<DishModel, DishModelSpec> = {
  v4: { displayName: "Standard (Gen 3)", panelWidthM: 0.594, panelHeightM: 0.383, cornerRadiusM: 0.04, mount: "kickstand", defaultTiltDeg: 20 },
  v5: { displayName: "Standard (Gen 4)", panelWidthM: 0.594, panelHeightM: 0.383, cornerRadiusM: 0.04, mount: "kickstand", defaultTiltDeg: 13 },
  v3: { displayName: "Standard Actuated (Gen 2)", panelWidthM: 0.513, panelHeightM: 0.303, cornerRadiusM: 0.15, mount: "mast", defaultTiltDeg: 25 },
  v2: { displayName: "Original (round)", panelWidthM: 0.59, panelHeightM: 0.59, cornerRadiusM: 0.295, mount: "mast", defaultTiltDeg: 25 },
  mini: { displayName: "Mini", panelWidthM: 0.298, panelHeightM: 0.259, cornerRadiusM: 0.03, mount: "kickstand", defaultTiltDeg: 20 },
  hp: { displayName: "High Performance", panelWidthM: 0.575, panelHeightM: 0.511, cornerRadiusM: 0.045, mount: "mast", defaultTiltDeg: 25 },
  flatHp: { displayName: "Flat High Performance", panelWidthM: 0.575, panelHeightM: 0.511, cornerRadiusM: 0.045, mount: "flat", defaultTiltDeg: 0 },
  hpV4: { displayName: "High Performance (Gen 4)", panelWidthM: 0.575, panelHeightM: 0.511, cornerRadiusM: 0.045, mount: "flat", defaultTiltDeg: 0 },
};

export function specForModel(model: DishModel): DishModelSpec {
  return MODEL_SPECS[model];
}

export function specForHardware(
  hardwareVersion: string | undefined,
  motorised = false,
): DishModelSpec {
  return MODEL_SPECS[resolveDishModel(hardwareVersion, motorised)];
}

export interface MeshTriangle {
  vertices: [number, number, number][]; // three [x,y,z] points, counter-clockwise seen from outside
  /** Base shade 0..1 multiplied into the ink color (panel face bright, edges dark). */
  shade: number;
  /** Thin sheet geometry (stand legs/mast) visible from both sides — exempt from back-face culling. */
  doubleSided?: boolean;
}

/** Rounded-rectangle outline in the panel plane, before tilt. */
function panelOutline(spec: DishModelSpec, pointsPerCorner = 5): [number, number][] {
  const halfWidth = spec.panelWidthM / 2;
  const halfHeight = spec.panelHeightM / 2;
  const radius = Math.min(spec.cornerRadiusM, halfWidth, halfHeight);
  const corners: Array<{ cx: number; cy: number; startAngle: number }> = [
    { cx: halfWidth - radius, cy: halfHeight - radius, startAngle: 0 },
    { cx: -halfWidth + radius, cy: halfHeight - radius, startAngle: Math.PI / 2 },
    { cx: -halfWidth + radius, cy: -halfHeight + radius, startAngle: Math.PI },
    { cx: halfWidth - radius, cy: -halfHeight + radius, startAngle: (3 * Math.PI) / 2 },
  ];
  const outline: [number, number][] = [];
  for (const corner of corners) {
    for (let step = 0; step <= pointsPerCorner; step++) {
      const angle = corner.startAngle + (step / pointsPerCorner) * (Math.PI / 2);
      outline.push([corner.cx + radius * Math.cos(angle), corner.cy + radius * Math.sin(angle)]);
    }
  }
  return outline;
}

/**
 * Build the dish mesh, tilted so the panel's normal points at `elevationDeg`
 * above the horizon (boresight), panel top edge away from the viewer.
 * Returned triangles are in mesh space (meters); yaw is applied at render time.
 */
export function buildDishMesh(spec: DishModelSpec, elevationDeg: number): MeshTriangle[] {
  const triangles: MeshTriangle[] = [];
  const outline = panelOutline(spec);
  const panelThickness = 0.035;

  // Panel plane: the panel's normal points at `elevationDeg` above the
  // horizon toward +y (the boresight azimuth): n = (0, cosE, sinE). The
  // panel's top edge leans back as the dish reclines: u = (0, −sinE, cosE).
  const elevationRad = (elevationDeg * Math.PI) / 180;
  const cosElevation = Math.cos(elevationRad);
  const sinElevation = Math.sin(elevationRad);
  const standHeight = spec.mount === "flat" ? 0.02 : spec.panelHeightM * 0.42;

  const toWorld = (panelX: number, panelY: number, offsetAlongNormal: number): [number, number, number] => [
    panelX,
    -panelY * sinElevation + offsetAlongNormal * cosElevation,
    standHeight + panelY * cosElevation + offsetAlongNormal * sinElevation,
  ];

  // Both faces of the real unit are white; only the rim reads dark. The back
  // face's winding is reversed so its normal points outward (away from front).
  for (const [offset, shade, reversed] of [
    [panelThickness / 2, 1.0, false],
    [-panelThickness / 2, 0.85, true],
  ] as Array<[number, number, boolean]>) {
    const center = toWorld(0, 0, offset);
    for (let index = 0; index < outline.length; index++) {
      const current = outline[index];
      const next = outline[(index + 1) % outline.length];
      const currentWorld = toWorld(current[0], current[1], offset);
      const nextWorld = toWorld(next[0], next[1], offset);
      triangles.push({
        vertices: reversed ? [center, nextWorld, currentWorld] : [center, currentWorld, nextWorld],
        shade,
      });
    }
  }

  // side wall strip — dark rim, like the real panel's edge trim
  for (let index = 0; index < outline.length; index++) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    const currentFront = toWorld(current[0], current[1], panelThickness / 2);
    const currentBack = toWorld(current[0], current[1], -panelThickness / 2);
    const nextFront = toWorld(next[0], next[1], panelThickness / 2);
    const nextBack = toWorld(next[0], next[1], -panelThickness / 2);
    triangles.push({ vertices: [currentFront, currentBack, nextBack], shade: 0.18 });
    triangles.push({ vertices: [currentFront, nextBack, nextFront], shade: 0.18 });
  }

  // mount
  if (spec.mount === "kickstand") {
    // The real Gen 3 stand is a thin wire A-frame: two legs from the panel's
    // lower back to the ground, joined by a crossbar at the feet. Each leg is
    // two perpendicular thin quads so it stays visible from any yaw.
    const legTopPanelY = -spec.panelHeightM * 0.18;
    const legHalfSpanTop = spec.panelWidthM * 0.14;
    const legHalfSpanFoot = spec.panelWidthM * 0.11;
    const legThickness = 0.012;
    const legShade = 0.8;
    const anchor = toWorld(0, legTopPanelY, -panelThickness / 2);
    const footY = anchor[1] - standHeight * 0.55;
    for (const side of [-1, 1]) {
      const top = toWorld(side * legHalfSpanTop, legTopPanelY, -panelThickness / 2);
      const foot: [number, number, number] = [side * legHalfSpanFoot, footY, 0];
      for (const [dx, dy] of [
        [legThickness, 0],
        [0, legThickness],
      ] as Array<[number, number]>) {
        triangles.push({
          vertices: [
            [top[0] - dx, top[1] - dy, top[2]],
            [top[0] + dx, top[1] + dy, top[2]],
            [foot[0] + dx, foot[1] + dy, 0],
          ],
          shade: legShade,
          doubleSided: true,
        });
        triangles.push({
          vertices: [
            [top[0] - dx, top[1] - dy, top[2]],
            [foot[0] + dx, foot[1] + dy, 0],
            [foot[0] - dx, foot[1] - dy, 0],
          ],
          shade: legShade,
          doubleSided: true,
        });
      }
    }
    const crossbarHeight = 0.02;
    triangles.push({
      vertices: [
        [-legHalfSpanFoot, footY, 0],
        [legHalfSpanFoot, footY, 0],
        [legHalfSpanFoot, footY, crossbarHeight],
      ],
      shade: legShade,
          doubleSided: true,
    });
    triangles.push({
      vertices: [
        [-legHalfSpanFoot, footY, 0],
        [legHalfSpanFoot, footY, crossbarHeight],
        [-legHalfSpanFoot, footY, crossbarHeight],
      ],
      shade: legShade,
          doubleSided: true,
    });
  } else if (spec.mount === "mast") {
    // vertical mast from ground to panel center
    const mastRadius = 0.018;
    const mastTop = standHeight;
    for (const [dxA, dyA, dxB, dyB] of [
      [-mastRadius, 0, mastRadius, 0],
      [0, -mastRadius, 0, mastRadius],
    ] as Array<[number, number, number, number]>) {
      triangles.push({
        vertices: [
          [dxA, dyA, 0],
          [dxB, dyB, 0],
          [dxB, dyB, mastTop],
        ],
        shade: 0.55,
        doubleSided: true,
      });
      triangles.push({
        vertices: [
          [dxA, dyA, 0],
          [dxB, dyB, mastTop],
          [dxA, dyA, mastTop],
        ],
        shade: 0.55,
        doubleSided: true,
      });
    }
  }

  return triangles;
}
