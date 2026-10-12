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
  /** Longest ray length over the four directions (sizes the mask arrays). */
  readonly maxRayLen: number;
  /**
   * `nearerArrowedMask[t]` = the set of cells on this clue's *arrowed* rays at
   * distances strictly less than `t` (i.e. 1..t-1). Static (depends only on the
   * clue geometry). Used by the `clue-candidate` rule: a placement that hits any
   * of these cells would give an arrowed ray a shaded cell *nearer* than the tie
   * distance `t`, so it cannot be the placement realising the tie at `t`.
   */
  readonly nearerArrowedMask: readonly BitBoard[];
  /**
   * `leUnarrowedMask[t]` = the set of cells on this clue's *unarrowed* rays at
   * distances ≤ `t` (i.e. 1..t). Static. Used by `clue-candidate`: a placement
   * that hits any of these cells would give an unarrowed ray a shaded cell at
   * distance ≤ the tie `t`, which rule 3 forbids (unarrowed must be strictly
   * farther).
   */
  readonly leUnarrowedMask: readonly BitBoard[];
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
  /**
   * Union of every cell lying on any clue's ray (all four directions, all
   * clues). Used only as a *heuristic* to prioritise probe candidates — cells
   * on clue rays are where arrow reasoning bites, so probing them first tends
   * to force a value (or a contradiction) sooner. Not load-bearing for
   * soundness.
   */
  readonly clueRayMask: BitBoard;
}

/**
 * Piece types depend only on the bank, and banks are shared objects (PRESETS,
 * or one object reused across a generator run), while `buildModel` runs once
 * per clue-removal trial during minimization — so the canonicalKey/orientations
 * work is memoized per bank identity.
 */
const pieceTypesByBank = new WeakMap<Puzzle['bank'], PieceType[]>();

function groupPieceTypes(puzzle: Puzzle): PieceType[] {
  const cached = pieceTypesByBank.get(puzzle.bank);
  if (cached !== undefined) return cached;
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
  pieceTypesByBank.set(puzzle.bank, types);
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
    let maxRayLen = 0;
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
      maxRayLen = Math.max(maxRayLen, ray.length);
    }

    // Static per-clue masks for the clue-candidate rule (see ClueInfo above).
    // Both are cumulative over distance, so build them incrementally.
    const nearerArrowedMask: BitBoard[] = [];
    const leUnarrowedMask: BitBoard[] = [];
    // Index by t in 0..maxRayLen. nearer[t] = arrowed cells at dist 1..t-1;
    // leUnarrowed[t] = unarrowed cells at dist 1..t.
    let nearerAcc = new BitBoard(cols, rows);
    let leAcc = new BitBoard(cols, rows);
    nearerArrowedMask[0] = nearerAcc.clone();
    leUnarrowedMask[0] = leAcc.clone();
    for (let t = 1; t <= maxRayLen; t++) {
      // nearer[t] adds arrowed cells at distance t-1 (relative to nearer[t-1]).
      nearerAcc = nearerAcc.clone();
      if (t - 1 >= 1) {
        for (const dir of arrowedDirs) {
          const ray = rays.get(dir)!;
          const c = ray[t - 2]; // distance t-1
          if (c !== undefined) nearerAcc.set(c);
        }
      }
      nearerArrowedMask[t] = nearerAcc;
      // leUnarrowed[t] adds unarrowed cells at distance t.
      leAcc = leAcc.clone();
      for (const dir of unarrowedDirs) {
        const ray = rays.get(dir)!;
        const c = ray[t - 1]; // distance t
        if (c !== undefined) leAcc.set(c);
      }
      leUnarrowedMask[t] = leAcc;
    }

    infos.push({
      index: i,
      x,
      y,
      bitmask: v,
      arrowedDirs,
      unarrowedDirs,
      rays,
      maxRayLen,
      nearerArrowedMask,
      leUnarrowedMask,
    });
  }
  return infos;
}

/** The clue-derived parts of a model, shared by the cached and reference builders. */
function buildClueParts(puzzle: Puzzle): { clueCellMask: BitBoard; clues: ClueInfo[]; clueRayMask: BitBoard } {
  const clueCellMask = buildClueCellMask(puzzle);
  const clues = buildClues(puzzle);
  const clueRayMask = new BitBoard(puzzle.cols, puzzle.rows);
  for (const clue of clues) for (const ray of clue.rays.values()) for (const c of ray) clueRayMask.set(c);
  return { clueCellMask, clues, clueRayMask };
}

/**
 * One candidate placement before the clue filter: everything a `Placement`
 * holds except its `index`, which depends on how many earlier candidates the
 * clues filtered out.
 */
interface PlacementShape {
  readonly piece: number;
  readonly cells: BitBoard;
  readonly halo: BitBoard;
  readonly cellList: readonly number[];
}

/**
 * Placement geometry depends only on the board size and the bank's piece
 * types, yet the minimizer rebuilds the model once per clue-removal check, and
 * the BitBoard allocation plus `kingHalo` were ~80% of `buildModel`'s
 * time (flip/experiments/model-cache-bench.ts --profile, 2026-10-12). So the
 * unfiltered candidates are built once per (size, piece types) and every
 * model shares their `cells`, `halo` and `cellList`. Sharing is sound because
 * nothing mutates them: the solver only reads them or ORs them into its own
 * state boards, and `cellList` is frozen to make a slip loud.
 *
 * Keyed by content rather than bank identity, so a bank decoded afresh from a
 * URL still hits; insertion-ordered Map as a small LRU, because a 10x10
 * pentomino geometry holds 4,096 candidates (about 2 MB) and a generator run
 * only ever needs the current size.
 */
const GEOMETRY_CACHE_CAP = 8;
const geometryCache = new Map<string, readonly PlacementShape[]>();
const pieceTypesKey = new WeakMap<readonly PieceType[], string>();
let geometryCacheEnabled = true;

/**
 * Test and benchmark switch: `false` makes `buildModel` take the reference
 * path (`buildModelUncached`) and empties the cache. Production never calls it.
 */
export function setGeometryCache(enabled: boolean): void {
  geometryCacheEnabled = enabled;
  if (!enabled) geometryCache.clear();
}

function keyOfPieceTypes(pieceTypes: readonly PieceType[]): string {
  let key = pieceTypesKey.get(pieceTypes);
  if (key !== undefined) return key;
  // Orientation order decides placement order, so the key spells out every
  // orientation as stored, not just the canonical piece key.
  key = pieceTypes
    .map((pt) => pt.orientations.map((o) => `${o.w}.${o.h}.${o.bits.join('')}`).join(','))
    .join('|');
  pieceTypesKey.set(pieceTypes, key);
  return key;
}

function enumerateShapes(cols: number, rows: number, pieceTypes: readonly PieceType[]): PlacementShape[] {
  const shapes: PlacementShape[] = [];
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
          shapes.push({ piece: pt.index, cells, halo: cells.kingHalo(), cellList: Object.freeze(cellList) });
        }
      }
    }
  }
  return shapes;
}

function placementShapes(cols: number, rows: number, pieceTypes: readonly PieceType[]): readonly PlacementShape[] {
  const key = `${cols}x${rows}/${keyOfPieceTypes(pieceTypes)}`;
  let shapes = geometryCache.get(key);
  if (shapes !== undefined) {
    geometryCache.delete(key); // refresh its LRU position
  } else {
    shapes = enumerateShapes(cols, rows, pieceTypes);
    if (geometryCache.size >= GEOMETRY_CACHE_CAP) geometryCache.delete(geometryCache.keys().next().value!);
  }
  geometryCache.set(key, shapes);
  return shapes;
}

export function buildModel(puzzle: Puzzle): Model {
  if (!geometryCacheEnabled) return buildModelUncached(puzzle);
  const { cols, rows, transparent } = puzzle;
  const pieceTypes = groupPieceTypes(puzzle);
  const { clueCellMask, clues, clueRayMask } = buildClueParts(puzzle);

  const placements: Placement[] = [];
  const placementsByPiece: number[][] = pieceTypes.map(() => []);
  const placementsCoveringCell: number[][] = Array.from({ length: cols * rows }, () => []);

  for (const shape of placementShapes(cols, rows, pieceTypes)) {
    // Rule 4: a placement may not cover a clue cell unless transparent.
    if (!transparent && shape.cells.intersects(clueCellMask)) continue;
    const index = placements.length;
    const { piece, cells, halo, cellList } = shape;
    placements.push({ index, piece, cells, halo, cellList });
    placementsByPiece[piece]!.push(index);
    for (const ci of cellList) placementsCoveringCell[ci]!.push(index);
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
    clueRayMask,
  };
}

/**
 * The model built from scratch, with no geometry shared between calls — the
 * builder as it was before the cache, kept as the oracle the cache is tested
 * against (test/model-cache.test.ts) and as the benchmark's baseline.
 */
export function buildModelUncached(puzzle: Puzzle): Model {
  const { cols, rows, transparent } = puzzle;
  const pieceTypes = groupPieceTypes(puzzle);
  const { clueCellMask, clues, clueRayMask } = buildClueParts(puzzle);

  const placements: Placement[] = [];
  const placementsByPiece: number[][] = pieceTypes.map(() => []);
  const placementsCoveringCell: number[][] = Array.from({ length: cols * rows }, () => []);

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
          // No dedup needed: `orientations()` is already deduped, and a cell
          // set uniquely determines its orientation and offset.
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
    clueRayMask,
  };
}
