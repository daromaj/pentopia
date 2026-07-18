/**
 * Solver model — the puzzle compiled into the immutable, precomputed data the
 * propagators and search reuse at every node (roadmap §4 "Precomputed
 * placements").
 *
 * Built once per puzzle:
 *  - `pieceTypes`: bank pieces grouped by canonical key, with their (deduped)
 *    orientations and available count.
 *  - `placements`: every legal placement of every piece-type × orientation ×
 *    position that fits fully on the board, as a `cells` BitBoard plus its
 *    precomputed no-touch `halo`. When the puzzle is not transparent, any
 *    placement covering a clue cell is discarded (rule 4 / format §5.4).
 *  - `placementsByPiece`, `placementsCoveringCell`: reverse indices the
 *    propagators need (bank-exhaustion and forced-placement, respectively).
 *  - `clues`: each arrow clue with its arrowed/unarrowed directions and the
 *    ordered ray cells per direction (for the arrow-distance propagator).
 *  - `clueCellMask`: every clue cell (arrow clues *and* HATENA placeholders),
 *    used for the clue-cell exclusion.
 */

import type { Puzzle, Shape } from '../core/types';
import { Dir, DIRS, dirBit, NO_CLUE } from '../core/types';
import { idx, dirDelta, inBounds } from '../core/grid';
import { canonicalKey, orientations } from '../core/shape';
import { BitBoard } from './board';

export interface PieceType {
  readonly index: number;
  readonly key: string;
  /** A representative shape (first bank piece with this key). */
  readonly shape: Shape;
  /** How many of this piece the bank provides (usually 1). */
  readonly count: number;
  /** Deduped dihedral orientations (from core `orientations`). */
  readonly orientations: readonly Shape[];
}

export interface Placement {
  readonly index: number;
  /** Index into `Model.pieceTypes`. */
  readonly piece: number;
  readonly cells: BitBoard;
  readonly halo: BitBoard;
  /** Ascending cell indices covered (same content as `cells`, as a list). */
  readonly cellList: readonly number[];
}

export interface ClueInfo {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** The raw arrow bitmask (format §3.2). */
  readonly bitmask: number;
  readonly arrowedDirs: readonly Dir[];
  readonly unarrowedDirs: readonly Dir[];
  /**
   * `rays[dir]` = ordered cell indices along `dir` starting at distance 1
   * (the immediate neighbour) out to the board edge. `rays[dir][d-1]` is the
   * cell at distance `d`.
   */
  readonly rays: ReadonlyMap<Dir, readonly number[]>;
}

export interface Model {
  readonly puzzle: Puzzle;
  readonly cols: number;
  readonly rows: number;
  readonly pieceTypes: readonly PieceType[];
  readonly placements: readonly Placement[];
  readonly placementsByPiece: readonly (readonly number[])[];
  /** `placementsCoveringCell[i]` = indices of placements whose cells include cell `i`. */
  readonly placementsCoveringCell: readonly (readonly number[])[];
  readonly clues: readonly ClueInfo[];
  readonly clueCellMask: BitBoard;
}

function groupPieceTypes(puzzle: Puzzle): PieceType[] {
  const byKey = new Map<string, { shape: Shape; count: number }>();
  for (const piece of puzzle.bank.pieces) {
    const key = canonicalKey(piece);
    const cur = byKey.get(key);
    if (cur === undefined) byKey.set(key, { shape: piece, count: 1 });
    else cur.count += 1;
  }
  const types: PieceType[] = [];
  let i = 0;
  for (const [key, { shape, count }] of byKey) {
    types.push({ index: i++, key, shape, count, orientations: orientations(shape) });
  }
  return types;
}

function buildClueCellMask(puzzle: Puzzle): BitBoard {
  const mask = new BitBoard(puzzle.cols, puzzle.rows);
  for (let i = 0; i < puzzle.clues.length; i++) {
    // A clue cell is any non-empty clue: arrow clues (>0) and HATENA (-2)
    // alike are clue cells for the purpose of rule 4 (format §5.4).
    if (puzzle.clues[i] !== NO_CLUE) mask.set(i);
  }
  return mask;
}

function buildClues(puzzle: Puzzle): ClueInfo[] {
  const { cols, rows, clues } = puzzle;
  const infos: ClueInfo[] = [];
  for (let i = 0; i < clues.length; i++) {
    const v = clues[i]!;
    if (v <= 0) continue; // NO_CLUE (-1) and HATENA (-2): no arrow constraint.
    const x = i % cols;
    const y = Math.floor(i / cols);
    const arrowedDirs: Dir[] = [];
    const unarrowedDirs: Dir[] = [];
    const rays = new Map<Dir, number[]>();
    for (const dir of DIRS) {
      if ((v & dirBit(dir)) !== 0) arrowedDirs.push(dir);
      else unarrowedDirs.push(dir);
      const [dx, dy] = dirDelta(dir);
      const ray: number[] = [];
      let cx = x + dx;
      let cy = y + dy;
      while (inBounds(cx, cy, cols, rows)) {
        ray.push(idx(cx, cy, cols));
        cx += dx;
        cy += dy;
      }
      rays.set(dir, ray);
    }
    infos.push({ index: i, x, y, bitmask: v, arrowedDirs, unarrowedDirs, rays });
  }
  return infos;
}

export function buildModel(puzzle: Puzzle): Model {
  const { cols, rows, transparent } = puzzle;
  const pieceTypes = groupPieceTypes(puzzle);
  const clueCellMask = buildClueCellMask(puzzle);
  const clues = buildClues(puzzle);

  const placements: Placement[] = [];
  const placementsByPiece: number[][] = pieceTypes.map(() => []);
  const placementsCoveringCell: number[][] = Array.from({ length: cols * rows }, () => []);
  const seen = new Set<string>();

  for (const pt of pieceTypes) {
    for (const orient of pt.orientations) {
      const { w, h, bits } = orient;
      for (let oy = 0; oy + h <= rows; oy++) {
        for (let ox = 0; ox + w <= cols; ox++) {
          const cells = new BitBoard(cols, rows);
          const cellList: number[] = [];
          for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
              if (!bits[sy * w + sx]) continue;
              const ci = idx(ox + sx, oy + sy, cols);
              cells.set(ci);
              cellList.push(ci);
            }
          }
          // Rule 4: a placement may not cover a clue cell unless transparent.
          if (!transparent && cells.intersects(clueCellMask)) continue;
          // Dedup identical placements (distinct orientations can never
          // coincide, but guard so forced-placement counts stay honest).
          const sig = `${pt.index}:${cellList.join(',')}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          const index = placements.length;
          const halo = cells.kingHalo();
          const placement: Placement = { index, piece: pt.index, cells, halo, cellList };
          placements.push(placement);
          placementsByPiece[pt.index]!.push(index);
          for (const ci of cellList) placementsCoveringCell[ci]!.push(index);
        }
      }
    }
  }

  return {
    puzzle,
    cols,
    rows,
    pieceTypes,
    placements,
    placementsByPiece,
    placementsCoveringCell,
    clues,
    clueCellMask,
  };
}
