/**
 * Grid geometry helpers shared by codec, validator, solver, and generator.
 * Cells are addressed by row-major index `i = y * cols + x`.
 */

import { Dir } from './types';

export function idx(x: number, y: number, cols: number): number {
  return y * cols + x;
}

export function xOf(i: number, cols: number): number {
  return i % cols;
}

export function yOf(i: number, cols: number): number {
  return Math.floor(i / cols);
}

export function inBounds(x: number, y: number, cols: number, rows: number): boolean {
  return x >= 0 && x < cols && y >= 0 && y < rows;
}

/** (dx, dy) unit step for a direction. */
export function dirDelta(dir: Dir): readonly [number, number] {
  switch (dir) {
    case Dir.Up:
      return [0, -1];
    case Dir.Down:
      return [0, 1];
    case Dir.Left:
      return [-1, 0];
    case Dir.Right:
      return [1, 0];
  }
}

/** The 4 orthogonal neighbor deltas (rook adjacency). */
export const ORTH4: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** The 8 king-move neighbor deltas (orthogonal + diagonal). */
export const KING8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Walk from (x, y) in `dir`, one cell at a time, until `stop` returns true or
 * the board edge is passed. Returns the distance (in cells) to the first cell
 * where `stop` held, or null if the edge was reached first.
 * Distance 1 is the immediate neighbor — matching the reference engine's
 * arrow-distance measurement (format §4.3).
 */
export function rayDistance(
  x: number,
  y: number,
  dir: Dir,
  cols: number,
  rows: number,
  stop: (i: number) => boolean,
): number | null {
  const [dx, dy] = dirDelta(dir);
  let cx = x + dx;
  let cy = y + dy;
  let dist = 1;
  while (inBounds(cx, cy, cols, rows)) {
    if (stop(idx(cx, cy, cols))) return dist;
    cx += dx;
    cy += dy;
    dist++;
  }
  return null;
}
