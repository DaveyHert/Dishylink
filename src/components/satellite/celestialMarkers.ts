import type { LookAngles } from "../../lib/celestial";

export const MARKER_RADIUS = 4;
export const SUN_RADIUS = 4.3;
/** Outer shell plus camera-facing disk/label extents, rounded outward. */
export const MARKER_FRAMING_RADIUS = 4.7;

/** ENU mapped to scene axes: east +X, up +Y, north −Z. Cosmetic radius. */
export function markerPosition(
  { azimuth, elevation }: LookAngles,
  radius = MARKER_RADIUS,
): [number, number, number] | null {
  if (elevation <= 0) return null;
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    -radius * Math.cos(el) * Math.cos(az),
  ];
}

const glyphs: Record<string, string[]> = {
  S: ["111", "100", "111", "001", "111"],
  U: ["101", "101", "101", "101", "111"],
  N: ["101", "111", "111", "111", "101"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  O: ["111", "101", "101", "101", "111"],
};

/** Camera-facing disks and bitmap labels, built as depth-tested world triangles. */
export function markerMesh(sun: LookAngles, moon: LookAngles, eye: number[]): Float32Array {
  const vertices: number[] = [];
  for (const [name, angles, color] of [
    ["SUN", sun, [1, 0.85, 0.15]],
    ["MOON", moon, [0.85, 0.93, 1]],
  ] as const) {
    const radius = name === "SUN" ? SUN_RADIUS : MARKER_RADIUS;
    const scale = radius / 2;
    const center = markerPosition(angles, radius);
    if (!center) continue;
    const forward = eye.map((v, i) => v - center[i]);
    const length = Math.hypot(...forward);
    forward.forEach((_, i) => (forward[i] /= length));
    const horizontal = Math.hypot(forward[0], forward[2]);
    const right =
      horizontal < 1e-6 ? [1, 0, 0] : [forward[2] / horizontal, 0, -forward[0] / horizontal];
    const up = [
      forward[1] * right[2],
      forward[2] * right[0] - forward[0] * right[2],
      -forward[1] * right[0],
    ];
    const vertex = (x: number, y: number) => {
      vertices.push(...center.map((v, i) => v + scale * (right[i] * x + up[i] * y)), ...color);
    };
    for (let i = 0; i < 32; i++) {
      vertex(0, 0);
      vertex(0.055 * Math.cos((i * Math.PI) / 16), 0.055 * Math.sin((i * Math.PI) / 16));
      vertex(
        0.055 * Math.cos(((i + 1) * Math.PI) / 16),
        0.055 * Math.sin(((i + 1) * Math.PI) / 16),
      );
    }
    const pixel = 0.009;
    const width = [...name].reduce((sum, letter) => sum + glyphs[letter][0].length + 1, -1);
    let column = -width / 2;
    for (const letter of name) {
      const glyph = glyphs[letter];
      glyph.forEach((row, y) =>
        [...row].forEach((bit, x) => {
          if (bit !== "1") return;
          const left = (column + x) * pixel;
          const top = -0.08 - y * pixel;
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, -1],
            [1, 0],
            [1, -1],
            [0, -1],
          ])
            vertex(left + dx * pixel, top + dy * pixel);
        }),
      );
      column += glyph[0].length + 1;
    }
  }
  return new Float32Array(vertices);
}
