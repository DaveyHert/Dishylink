// Parametric 3D dish meshes, keyed by the hardwareVersion the dish reports.
// Each model is generated procedurally from SpaceX's published physical
// dimensions, so the mesh at the center of the sky dome is dimensionally
// exact for the user's actual hardware — no CAD files, works for every model.
//
// Mesh space: x = dish-right, y = dish-forward (toward boresight azimuth),
// z = up, in meters, origin at the mount pivot. The renderer tilts the panel
// by the live boresight elevation and yaws it by the live azimuth.

export interface DishModelSpec {
  /** Marketing name shown in UI tooltips. */
  displayName: string;
  /** Panel size in meters: across (width) × along boresight (height). */
  panelWidthM: number;
  panelHeightM: number;
  cornerRadiusM: number;
  mount: "kickstand" | "mast" | "flat";
}

// Published dimensions per model (starlink.com specs pages).
const MODEL_SPECS: Array<{ match: RegExp; spec: DishModelSpec }> = [
  {
    match: /rev4/i,
    spec: { displayName: "Standard (Gen 3)", panelWidthM: 0.594, panelHeightM: 0.383, cornerRadiusM: 0.04, mount: "kickstand" },
  },
  {
    match: /rev3|dishy/i,
    spec: { displayName: "Standard Actuated (Gen 2)", panelWidthM: 0.513, panelHeightM: 0.303, cornerRadiusM: 0.15, mount: "mast" },
  },
  {
    match: /rev1|rev2/i,
    spec: { displayName: "Original (round)", panelWidthM: 0.59, panelHeightM: 0.59, cornerRadiusM: 0.295, mount: "mast" },
  },
  {
    match: /mini/i,
    spec: { displayName: "Mini", panelWidthM: 0.298, panelHeightM: 0.259, cornerRadiusM: 0.03, mount: "kickstand" },
  },
  {
    match: /hp1|high_perf|flat_hp/i,
    spec: { displayName: "High Performance", panelWidthM: 0.575, panelHeightM: 0.511, cornerRadiusM: 0.045, mount: "flat" },
  },
];

const FALLBACK_SPEC: DishModelSpec = {
  displayName: "Starlink",
  panelWidthM: 0.55,
  panelHeightM: 0.38,
  cornerRadiusM: 0.04,
  mount: "kickstand",
};

export function specForHardware(hardwareVersion: string | undefined): DishModelSpec {
  if (hardwareVersion) {
    for (const entry of MODEL_SPECS) {
      if (entry.match.test(hardwareVersion)) return entry.spec;
    }
  }
  return FALLBACK_SPEC;
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
