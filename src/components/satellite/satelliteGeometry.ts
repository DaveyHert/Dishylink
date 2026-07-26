// The Starlink satellite as flat-shaded triangles, built from primitives rather
// than loaded from a mesh file — the reference viewer it came from was itself
// procedural (spheres, cylinders, boxes), so there is nothing to import.
//
// Two detail levels. `full` matches the reference exactly, for a satellite the
// user has zoomed or selected. `distant` keeps every part and proportion but
// drops the segment counts, for the couple of hundred drawn across the sky at a
// few pixels each — where the reference's 32x16 nose cone alone would cost 992
// triangles that no display can resolve.

export type SatelliteDetail = "full" | "distant";

export interface SatelliteMesh {
  /** xyz per vertex, three vertices per triangle (no index buffer — flat shaded). */
  positions: Float32Array;
  /** Face normal, repeated per vertex. */
  normals: Float32Array;
  /** Material tint per vertex; the shader applies the scene's light. */
  colors: Float32Array;
  triangleCount: number;
}

type Vec3 = [number, number, number];

/** Body white and the darker core, carried over from the reference materials. */
const BODY: Vec3 = [0.867, 0.867, 0.867];
const DARK: Vec3 = [0.267, 0.267, 0.267];
const PANEL: Vec3 = [0.8, 0.8, 0.8];

interface Segments {
  /** Sides on the main body tube. */
  body: number;
  /** Sides on thin parts — struts, arms, the feed horn. */
  thin: number;
  /** Latitude bands on the nose cone. */
  rings: number;
}

const SEGMENTS: Record<SatelliteDetail, Segments> = {
  full: { body: 32, thin: 16, rings: 16 },
  distant: { body: 10, thin: 5, rings: 3 },
};

class Builder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];

  /** One triangle, with the flat normal derived from its winding. */
  tri(a: Vec3, b: Vec3, c: Vec3, tint: Vec3) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(tint[0], tint[1], tint[2]);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, tint: Vec3) {
    this.tri(a, b, c, tint);
    this.tri(a, c, d, tint);
  }

  finish(): SatelliteMesh {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      colors: new Float32Array(this.col),
      triangleCount: this.pos.length / 9,
    };
  }
}

/**
 * A cone/cylinder lying along +z. `zBack`/`zFront` are the two ends and
 * `rBack`/`rFront` their radii, so a plain cylinder just passes equal radii.
 */
function tube(
  b: Builder,
  zBack: number,
  zFront: number,
  rBack: number,
  rFront: number,
  segments: number,
  tint: Vec3,
  caps: { back?: boolean; front?: boolean } = {},
  offsetX = 0,
  offsetY = 0,
) {
  const at = (i: number, r: number, z: number): Vec3 => {
    const t = (i / segments) * Math.PI * 2;
    return [offsetX + Math.cos(t) * r, offsetY + Math.sin(t) * r, z];
  };
  for (let i = 0; i < segments; i++) {
    const j = i + 1;
    b.quad(
      at(i, rBack, zBack),
      at(i, rFront, zFront),
      at(j, rFront, zFront),
      at(j, rBack, zBack),
      tint,
    );
    if (caps.front)
      b.tri([offsetX, offsetY, zFront], at(j, rFront, zFront), at(i, rFront, zFront), tint);
    if (caps.back) b.tri([offsetX, offsetY, zBack], at(i, rBack, zBack), at(j, rBack, zBack), tint);
  }
}

/** Nose cone: a hemisphere capping the front, opening back toward -z. */
function hemisphere(
  b: Builder,
  z: number,
  radius: number,
  segments: number,
  rings: number,
  tint: Vec3,
) {
  const at = (ring: number, seg: number): Vec3 => {
    const phi = (ring / rings) * (Math.PI / 2);
    const theta = (seg / segments) * Math.PI * 2;
    const r = Math.sin(phi) * radius;
    return [Math.cos(theta) * r, Math.sin(theta) * r, z + Math.cos(phi) * radius];
  };
  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const a = at(ring, seg),
        c = at(ring, seg + 1);
      const d = at(ring + 1, seg),
        e = at(ring + 1, seg + 1);
      if (ring === 0)
        b.tri(a, e, d, tint); // pole fan
      else b.quad(a, c, e, d, tint);
    }
  }
}

/** Axis-aligned box, used for the solar boards and their raised sections. */
function box(
  b: Builder,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  tint: Vec3,
) {
  const x0 = cx - w / 2,
    x1 = cx + w / 2;
  const y0 = cy - h / 2,
    y1 = cy + h / 2;
  const z0 = cz - d / 2,
    z1 = cz + d / 2;
  const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
  b.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), tint); // +z
  b.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), tint); // -z
  b.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), tint); // -x
  b.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), tint); // +x
  b.quad(v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0), tint); // +y
  b.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), tint); // -y
}

/** A strut between two points, as a thin tube. */
function strut(b: Builder, from: Vec3, to: Vec3, radius: number, segments: number, tint: Vec3) {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(...d) || 1;
  const dir: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  const ref: Vec3 = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const px = ref[1] * dir[2] - ref[2] * dir[1];
  const py = ref[2] * dir[0] - ref[0] * dir[2];
  const pz = ref[0] * dir[1] - ref[1] * dir[0];
  const pl = Math.hypot(px, py, pz) || 1;
  const u: Vec3 = [px / pl, py / pl, pz / pl];
  const v: Vec3 = [
    dir[1] * u[2] - dir[2] * u[1],
    dir[2] * u[0] - dir[0] * u[2],
    dir[0] * u[1] - dir[1] * u[0],
  ];
  const ring = (o: Vec3, i: number): Vec3 => {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t) * radius,
      s = Math.sin(t) * radius;
    return [o[0] + u[0] * c + v[0] * s, o[1] + u[1] * c + v[1] * s, o[2] + u[2] * c + v[2] * s];
  };
  for (let i = 0; i < segments; i++) {
    b.quad(ring(from, i), ring(to, i), ring(to, i + 1), ring(from, i + 1), tint);
  }
}

/** One solar wing: the arm out to the board, the board, and its raised sections. */
function solarWing(b: Builder, side: 1 | -1, z: number, seg: Segments) {
  const armEnd = side * 3;
  strut(b, [0, 0, z], [armEnd, 0, z], 0.2, seg.thin, BODY);

  const width = 8,
    height = 2.5,
    thickness = 0.2;
  const cx = side * (3 + width / 2);
  box(b, cx, 0, z, width, height, thickness, BODY);

  // four raised sections per face, matching the reference's panel detail
  const sections = 4,
    sw = 1.6,
    sh = 2.1;
  for (let i = 0; i < sections; i++) {
    const x = cx - width / 2 + (width / sections) * (i + 0.5);
    for (const face of [1, -1]) {
      box(b, x, 0, z + face * (thickness / 2 + 0.05), sw, sh, 0.1, PANEL);
    }
  }
}

/**
 * Build the satellite, centred on the origin and pointing along +z, roughly
 * 10 units nose to tail and 22 wide across the deployed wings.
 */
export function buildSatellite(detail: SatelliteDetail = "full"): SatelliteMesh {
  const seg = SEGMENTS[detail];
  const b = new Builder();

  // --- body, front to back ---
  hemisphere(b, 4, 2, seg.body, seg.rings, BODY);
  tube(b, 2, 4, 2.5, 2, seg.body, BODY); // front cone
  tube(b, 1, 2, 2.5, 2.5, seg.body, BODY); // front barrel
  tube(b, 0, 1, 1.5, 1.5, seg.body, DARK, { back: true }); // recessed core
  for (let i = 0; i < 6; i++) {
    // struts bridging the gap
    const t = (i / 6) * Math.PI * 2;
    tube(
      b,
      0,
      1,
      0.15,
      0.15,
      seg.thin,
      BODY,
      { back: true, front: true },
      Math.cos(t) * 2.1,
      Math.sin(t) * 2.1,
    );
  }
  tube(b, -2.25, 0, 2.5, 2.5, seg.body, BODY); // rear barrel
  tube(b, -3.75, -2.25, 1.5, 2.5, seg.body, BODY); // rear taper
  tube(b, -4.25, -3.75, 1.5, 1.5, seg.body, BODY, { back: true });

  // --- solar wings, on the rear barrel ---
  solarWing(b, 1, -1, seg);
  solarWing(b, -1, -1, seg);

  // --- rear antenna: a dish opening backwards, with its feed on three struts ---
  tube(b, -5.75, -4.25, 2.5, 0.5, seg.body, BODY); // open cone
  tube(b, -4.3, -4.25, 0.5, 0.5, seg.body, BODY, { back: true });
  tube(b, -6.35, -5.15, 0.2, 0.2, seg.thin, BODY, { back: true, front: true });
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2;
    strut(b, [Math.cos(t) * 2.4, Math.sin(t) * 2.4, -5.75], [0, 0, -6.25], 0.05, seg.thin, BODY);
  }

  return b.finish();
}
