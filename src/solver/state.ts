/**
 * SolveState — the mutable per-node knowledge the propagators operate on and
 * the search clones when it branches.
 *
 * Cell knowledge lives in two BitBoards:
 *  - `shaded`: cells known to be part of *some* placed shape.
 *  - `excluded`: cells proven unshaded.
 * A cell in neither is *unknown*. `shaded ∩ excluded ≠ ∅` is a contradiction.
 *
 * Placement viability:
 *  - `remaining[t]`: how many of piece-type `t` are still available.
 *  - `alive[p]`: 1 while placement `p` is still a candidate. A placement dies
 *    when its cells hit `excluded`, overlap an already-committed placement, or
 *    its piece-type is exhausted (see propagate.ts `placement-filtering`).
 *  - `committed`: placements actually placed, in commit order, for solution
 *    extraction; `committedCells` is their union.
 *
 * Note the deliberate asymmetry (per the task's SEMANTICS): a placement is
 * *not* killed merely for containing a shaded cell — shaded cells can be
 * arrow-forced before any piece covers them. It is killed only for hitting
 * `excluded` or overlapping a *committed* placement's cells.
 */

import type { Model } from './model';
import { BitBoard } from './board';

export interface SolveState {
  shaded: BitBoard;
  excluded: BitBoard;
  remaining: Int32Array;
  alive: Uint8Array;
  committed: number[];
  committedCells: BitBoard;
}

export function initState(model: Model): SolveState {
  return {
    shaded: new BitBoard(model.cols, model.rows),
    excluded: new BitBoard(model.cols, model.rows),
    remaining: Int32Array.from(model.pieceTypes.map((pt) => pt.count)),
    alive: new Uint8Array(model.placements.length).fill(1),
    committed: [],
    committedCells: new BitBoard(model.cols, model.rows),
  };
}

export function cloneState(state: SolveState): SolveState {
  return {
    shaded: state.shaded.clone(),
    excluded: state.excluded.clone(),
    remaining: state.remaining.slice(),
    alive: state.alive.slice(),
    committed: state.committed.slice(),
    committedCells: state.committedCells.clone(),
  };
}

/** Cells still unknown: neither shaded nor excluded. Returns a fresh BitBoard. */
export function unknownCells(model: Model, state: SolveState): BitBoard {
  return BitBoard.full(model.cols, model.rows)
    .andNotAssign(state.shaded)
    .andNotAssign(state.excluded);
}

/** Free shaded cells: shaded but not yet part of a committed placement. Returns a fresh BitBoard. */
export function freeShaded(state: SolveState): BitBoard {
  return state.shaded.clone().andNotAssign(state.committedCells);
}

/**
 * Commit a placement into the state: shade its cells, exclude its no-touch
 * halo, decrement its piece count, and record it. Does *not* run propagation
 * — the caller (search, or the forced-placement rule) re-propagates after.
 * Returns nothing; contradictions (e.g. a halo cell already shaded) surface on
 * the next propagation sweep via the `shaded ∩ excluded` check.
 */
export function commitPlacement(model: Model, state: SolveState, p: number): void {
  const placement = model.placements[p]!;
  state.shaded.orAssign(placement.cells);
  state.excluded.orAssign(placement.halo);
  state.committedCells.orAssign(placement.cells);
  state.remaining[placement.piece]! -= 1;
  state.alive[p] = 0;
  state.committed.push(p);
}
