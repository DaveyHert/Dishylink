// The sky view's GLSL and the one step that turns it into linked programs.
//
// Kept apart from the scene because shader source is content, not control flow:
// it changes for visual reasons, on its own rhythm, and reading the frame loop
// should not mean scrolling past 80 lines of GLSL to reach it.
//
// Five programs over four passes — `sat` deliberately reuses the mesh fragment
// shader, so satellites fog into the distance exactly as the terrain does.

const DOT_VERTEX = `
attribute vec4 aData; uniform mat4 uMvp; uniform float uPointScale; varying float vKind;
void main() {
  gl_Position = uMvp * vec4(aData.xyz, 1.0);
  float base = aData.w > 2.5 ? 1.7 : aData.w > 1.5 ? 1.45 : 1.0;
  gl_PointSize = clamp(uPointScale * base / gl_Position.w, 1.5, 14.0);
  vKind = aData.w;
}`;

// The four survey colours arrive as uniforms rather than living here: they are
// the --sky-* tokens, shared with the dashboard dome and the legend. Baked in,
// they drifted — this shader held an orange-red the rest of the app never used.
// Unmapped is the one that still needs a strength: it is context, not a
// reading, so it sinks most of the way back into the sky before it is drawn.
// Mixed, not faded: the dot is opaque, so it reads as the same grey wherever it
// lands rather than thinning out over the brighter parts of the scene.
const DOT_FRAGMENT = `
precision mediump float; varying float vKind;
uniform vec3 uUnmapped; uniform vec3 uClear; uniform vec3 uPartial; uniform vec3 uObstructed;
uniform vec3 uFog;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  vec3 col = vKind < 0.5 ? mix(uUnmapped, uFog, 0.7)
           : vKind < 1.5 ? uClear
           : vKind < 2.5 ? uPartial
           : uObstructed;
  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERTEX = `
attribute vec4 aStar; uniform mat4 uMvp;
void main() { gl_Position = uMvp * vec4(aStar.xyz, 1.0); gl_PointSize = aStar.w; }`;

const STAR_FRAGMENT = `
precision mediump float;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  gl_FragColor = vec4(0.85, 0.88, 0.95, 0.75);
}`;

const MESH_VERTEX = `
attribute vec3 aPos; attribute vec3 aColor; uniform mat4 uMvp;
varying vec3 vColor; varying float vDepth;
void main() { gl_Position = uMvp * vec4(aPos, 1.0); vColor = aColor; vDepth = gl_Position.w; }`;

const MESH_FRAGMENT = `
precision mediump float; varying vec3 vColor; varying float vDepth; uniform vec3 uFog;
void main() {
  float f = clamp((vDepth - 4.0) / 14.0, 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFog, f), 1.0);
}`;

// Satellites carry normals and a per-instance frame, so one uploaded model is
// drawn for the whole constellation and still lit correctly as each one turns.
const SAT_VERTEX = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
attribute vec3 iOffset; attribute vec3 iRight; attribute vec3 iUp; attribute vec3 iForward;
uniform mat4 uMvp; uniform float uScale; uniform vec3 uLight;
varying vec3 vColor; varying float vDepth;
void main() {
  mat3 basis = mat3(iRight, iUp, iForward);
  vec3 world = iOffset + basis * (aPos * uScale);
  float lam = max(0.0, dot(normalize(basis * aNormal), uLight));
  vColor = aColor * (0.34 + 0.66 * lam);
  gl_Position = uMvp * vec4(world, 1.0);
  vDepth = gl_Position.w;
}`;

// A soft-edged ribbon from the dish to the serving satellite. Additive blending
// and a squared falloff across its width give the glow, rather than a hard line.
const BEAM_VERTEX = `
attribute vec3 aPos; attribute float aAcross; attribute float aAlong; uniform mat4 uMvp;
varying float vAcross; varying float vAlong;
void main() { vAcross = aAcross; vAlong = aAlong; gl_Position = uMvp * vec4(aPos, 1.0); }`;

const BEAM_FRAGMENT = `
precision mediump float; varying float vAcross; varying float vAlong;
void main() {
  float edge = 1.0 - abs(vAcross);
  float core = pow(clamp(edge, 0.0, 1.0), 2.2);
  // Fade the base so the ribbon emerges from the dish instead of blooming a bright
  // blob where it overlaps the panel (additive over the white face).
  core *= smoothstep(0.0, 0.06, vAlong);
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * core, core);
}`;

// The satellite trail: a camera-facing ribbon down each path, feathered across
// its width and faded along its length so it reads as a wisp of light rather
// than a drawn line. Additive, like the beam — light in the dark, not paint.
// White for every craft: sunlight off the hull, not an exhaust flame, so the
// serving satellite is told apart by its dot alone. `aAcross` is -1..1
// edge-to-edge; `aGlow` is the combined length-fade and head brightness.
const TRAIL_VERTEX = `
attribute vec3 aPos; attribute float aAcross; attribute float aGlow;
uniform mat4 uMvp;
varying float vAcross; varying float vGlow;
void main() {
  vAcross = aAcross; vGlow = aGlow;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

const TRAIL_FRAGMENT = `
precision mediump float; varying float vAcross; varying float vGlow;
void main() {
  // Soft-shouldered across the width: full down the spine, feathering to nothing
  // at the edges, so the ribbon has no hard rim.
  float edge = 1.0 - abs(vAcross);
  float across = pow(clamp(edge, 0.0, 1.0), 1.6);
  float a = across * vGlow;
  // Additive blend multiplies rgb by this alpha, so one factor of a is enough.
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}`;

export interface SkyPrograms {
  dot: WebGLProgram;
  star: WebGLProgram;
  mesh: WebGLProgram;
  sat: WebGLProgram;
  beam: WebGLProgram;
  trail: WebGLProgram;
}

/** Compile and link every program the scene draws with, in one pass. */
export function createPrograms(gl: WebGLRenderingContext): SkyPrograms {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = (vertex: string, fragment: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    return p;
  };

  return {
    dot: program(DOT_VERTEX, DOT_FRAGMENT),
    star: program(STAR_VERTEX, STAR_FRAGMENT),
    mesh: program(MESH_VERTEX, MESH_FRAGMENT),
    sat: program(SAT_VERTEX, MESH_FRAGMENT),
    beam: program(BEAM_VERTEX, BEAM_FRAGMENT),
    trail: program(TRAIL_VERTEX, TRAIL_FRAGMENT),
  };
}
