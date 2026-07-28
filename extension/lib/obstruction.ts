// Pack the dish's obstruction grid to base64, 2 bits per cell, for the hourly
// snapshot. The browser counterpart of the historian's packCells: identical
// quantization (the client's unpack path renders both, so the thresholds must
// agree), but btoa instead of Node's Buffer.

const OBSTRUCTED_FRACTION_FLOOR = 0.005;
const PARTIAL_FRACTION_CEILING = 0.25;

const CELL_UNMAPPED = 0;
const CELL_CLEAR = 1;
const CELL_PARTIAL = 2;
const CELL_OBSTRUCTED = 3;

function quantizeCell(fractionUsable: number): number {
  if (fractionUsable < 0) return CELL_UNMAPPED;
  const obstructed = 1 - fractionUsable;
  if (obstructed <= OBSTRUCTED_FRACTION_FLOOR) return CELL_CLEAR;
  return obstructed <= PARTIAL_FRACTION_CEILING ? CELL_PARTIAL : CELL_OBSTRUCTED;
}

export function packObstructionCells(grid: number[]): string {
  const packed = new Uint8Array(Math.ceil(grid.length / 4));
  grid.forEach((fractionUsable, index) => {
    packed[index >> 2] |= quantizeCell(fractionUsable) << ((index & 3) * 2);
  });
  let binary = "";
  for (const byte of packed) binary += String.fromCharCode(byte);
  return btoa(binary);
}
