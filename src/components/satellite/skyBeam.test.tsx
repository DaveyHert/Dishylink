import { expect, test } from "vitest";
import { createPrograms } from "./skyPrograms";
import { DOME_LIFT } from "./skyGeometry";

test("beam passes separate inside and outside at the lifted dome surface", () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext("webgl", { antialias: false });
  if (!gl) throw new Error("WebGL unavailable");
  const programs = createPrograms(gl);
  const program = programs.beam;
  expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(true);
  gl.useProgram(program);
  gl.viewport(0, 0, 64, 64);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniformMatrix4fv(
    uniform("uMvp"),
    false,
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  );
  gl.uniform3f(uniform("uBeamStart"), 0, DOME_LIFT, 0);
  gl.uniform3f(uniform("uBeamEnd"), 2, DOME_LIFT, 0);
  gl.uniform1f(uniform("uDomeLift"), DOME_LIFT);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, -1, 0, 1, -1, 0, -1, 1, 1, 1, 0, 1, 1, -1, -1, 0, -1, 0, 1, 1, 0, 1, 1, -1, 1, 0,
      1, 0,
    ]),
    gl.STATIC_DRAW,
  );
  for (const [name, size, offset] of [
    ["aPos", 3, 0],
    ["aAcross", 1, 12],
    ["aAlong", 1, 16],
  ] as const) {
    const attribute = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 20, offset);
  }
  const pixel = (x: number) => {
    const color = new Uint8Array(4);
    gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
    return color[0];
  };
  try {
    gl.uniform1i(uniform("uOutsidePass"), 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(16)).toBeGreaterThan(0);
    expect(pixel(48)).toBe(0);
    gl.uniform1i(uniform("uOutsidePass"), 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(16)).toBe(0);
    expect(pixel(48)).toBeGreaterThan(0);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  } finally {
    gl.deleteBuffer(buffer);
    for (const linked of Object.values(programs)) gl.deleteProgram(linked);
  }
});
