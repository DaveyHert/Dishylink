import { expect, test } from "vitest";
import { createPrograms } from "./skyPrograms";

test("beam crossing highlights and enlarges dots without changing survey kinds", () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext("webgl", { antialias: false });
  expect(gl).not.toBeNull();
  if (!gl) throw new Error("WebGL unavailable");
  const programs = createPrograms(gl);
  const program = programs.dot;
  for (const linked of Object.values(programs)) {
    expect(gl.getProgramParameter(linked, gl.LINK_STATUS), gl.getProgramInfoLog(linked) ?? "").toBe(
      true,
    );
  }
  gl.useProgram(program);
  gl.viewport(0, 0, 64, 64);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniformMatrix4fv(
    uniform("uMvp"),
    false,
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  );
  gl.uniform1f(uniform("uPointScale"), 6);
  gl.uniform3f(uniform("uBeamStart"), 0, 0, -0.5);
  gl.uniform3f(uniform("uBeamEnd"), 0, 0, 0.5);
  gl.uniform3f(uniform("uClear"), 1, 1, 1);
  gl.uniform3f(uniform("uObstructed"), 1, 0, 0);
  gl.uniform3f(uniform("uBeamHighlight"), 77 / 255, 180 / 255, 80 / 255);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const attribute = gl.getAttribLocation(program, "aData");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 16, 0);
  const draw = (radius: number, kind = 1, x = 0, z = 0) => {
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, 0, z, kind]), gl.STATIC_DRAW);
    gl.uniform1f(uniform("uBeamRadius"), radius);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, 1);
    const pixels = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const colors = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) colors.push([...pixels.slice(i, i + 3)]);
    }
    return colors;
  };
  try {
    const original = draw(0);
    const highlighted = draw(0.1);
    expect(highlighted.length).toBeGreaterThan(original.length);
    expect(highlighted.every((color) => color.join() === "77,180,80")).toBe(true);
    expect(draw(0)).toEqual(original);
    gl.uniform3f(uniform("uUnmapped"), 0.5, 0.5, 0.5);
    gl.uniform3f(uniform("uPartial"), 0.4, 0.05, 0.05);
    for (const kind of [0, 2, 3]) {
      const unchanged = draw(0, kind);
      expect(unchanged.length).toBeGreaterThan(0);
      expect(draw(0.1, kind)).toEqual(unchanged);
    }
    expect(draw(0, 3).every((color) => color.join() === "255,0,0")).toBe(true);
    expect(draw(0.1, 1, 0.3).every((color) => color.join() === "255,255,255")).toBe(true);
    // Same screen position, outside the finite segment: no false green overlap.
    expect(draw(0.1, 1, 0, 0.8)).toEqual(original);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  } finally {
    gl.deleteBuffer(buffer);
    for (const linked of Object.values(programs)) gl.deleteProgram(linked);
  }
});
