/**
 * Random separated shape layout (roadmap §5.1). Repeatedly drops a random
 * unused bank piece in a random orientation at a random position, accepting a
 * placement iff it is fully on the board, overlaps no placed cell, and is not
 * king-adjacent (orthogonally or diagonally) to any placed cell — reusing the
 * BitBoard king-halo machinery so separation is checked by the identical code
 * path as the validator/solver.
 *
 * Returns the shaded `Solution`, or `null` if the target piece count couldn't
 * be reached within the attempt budget (the board wedged early); the caller
 * retries with fresh randomness.
 */

import type { Bank, Shape, Solution } from '../core/types';
import { idx } from '../core/grid';
import { orientations } from '../core/shape';
import { BitBoard } from '../solver/board';
import { randInt } from './rng';

export interface PlaceOptions {
  /** How many pieces to place. Default: round(cols*rows/18), clamped to [1, bank size]. */
  readonly pieceCount?: number;
  /** Total placement attempts before giving up. Default: max(2000, target*400). */
  readonly maxAttempts?: number;
}

/** Default target piece count for a board: ~1 piece per 18 cells, clamped to the bank. */
export function defaultPieceCount(cols: number, rows: number, bankSize: number): number {
  const target = Math.round((cols * rows) / 18);
  return Math.max(1, Math.min(target, bankSize));
}

export function placeShapes(
  cols: number,
  rows: number,
  bank: Bank,
  rng: () => number,
  opts?: PlaceOptions,
): Solution | null {
  const bankSize = bank.pieces.length;
  if (bankSize === 0) return null;
  const target = opts?.pieceCount ?? defaultPieceCount(cols, rows, bankSize);
  if (target <= 0) return { shaded: new Uint8Array(cols * rows) };
  const maxAttempts = opts?.maxAttempts ?? Math.max(2000, target * 400);

  // Precompute the deduped dihedral orientations of every bank piece once.
  const pieceOrients: Shape[][] = bank.pieces.map((p) => orientations(p));

  const occupied = new BitBoard(cols, rows);
  // `forbidden` = occupied cells plus their king-halo — a new placement may not
  // touch any of these. Recomputed after each successful placement.
  let forbidden = new BitBoard(cols, rows);
  const used = new Uint8Array(bankSize);
  let placed = 0;

  for (let attempt = 0; attempt < maxAttempts && placed < target; attempt++) {
    // Pick a random still-unused bank piece.
    const avail: number[] = [];
    for (let i = 0; i < bankSize; i++) if (used[i] === 0) avail.push(i);
    if (avail.length === 0) break;
    const pi = avail[randInt(rng, 0, avail.length)]!;

    const orients = pieceOrients[pi]!;
    const orient = orients[randInt(rng, 0, orients.length)]!;
    if (orient.w > cols || orient.h > rows) continue; // piece too big in this orientation

    const ox = randInt(rng, 0, cols - orient.w + 1);
    const oy = randInt(rng, 0, rows - orient.h + 1);

    const cells = new BitBoard(cols, rows);
    for (let sy = 0; sy < orient.h; sy++) {
      for (let sx = 0; sx < orient.w; sx++) {
        if (orient.bits[sy * orient.w + sx]) cells.set(idx(ox + sx, oy + sy, cols));
      }
    }

    // Reject if it overlaps or king-touches anything already placed.
    if (cells.intersects(forbidden)) continue;

    occupied.orAssign(cells);
    used[pi] = 1;
    placed++;
    forbidden = occupied.clone().orAssign(occupied.kingHalo());
  }

  if (placed < target) return null;

  const shaded = new Uint8Array(cols * rows);
  occupied.forEach((i) => {
    shaded[i] = 1;
  });
  return { shaded };
}
