/**
 * Targeted unit tests for the strengthened constraint propagators
 * (propagate.ts). Each exercises ONE new inference in isolation:
 *  - ray-length cap pins a tie from an empty board;
 *  - feasible-hit intersection forces a single candidate on a partially
 *    excluded ray (a pin the raw [lo,hi] interval alone would miss);
 *  - separation placement-filter (a shaded cell in a placement's halo kills it);
 *  - cover-analysis: zero-cover exclusion, common-cell forcing, common-halo
 *    exclusion;
 *  - probe-forcing is off by default (search) and closes real boards when on.
 *
 * These assert on the resulting SolveState bits / status directly, which is
 * unambiguous, and on the emitted step rule ids where relevant.
 */

import { describe, it, expect } from 'vitest';
import { buildModel } from '@solver/model';
import { initState } from '@solver/state';
import { propagateToFixpoint, type RuleId, type Step } from '@solver/propagate';
import { decodeUrl } from '@core/codec/url';
import { shapeFromStrings } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, dirBit, Dir, type Bank, type Puzzle } from '@core/types';

function mkPuzzle(cols: number, rows: number, clues: Record<number, number>, bank: Bank, transparent = false): Puzzle {
  const c = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const k of Object.keys(clues)) c[+k] = clues[+k]!;
  return { cols, rows, clues: c, bank, transparent };
}

const mono: Bank = { pieces: [shapeFromStrings(['#'])] };
const monoX2: Bank = { pieces: [shapeFromStrings(['#']), shapeFromStrings(['#'])] };
const domino: Bank = { pieces: [shapeFromStrings(['##'])] };
const iTromino: Bank = { pieces: [shapeFromStrings(['###'])] };
const iPento: Bank = { pieces: [shapeFromStrings(['#####'])] };

function hasRule(steps: readonly Step[], rule: RuleId, cell: number): boolean {
  return steps.some((s) => s.rule === rule && s.cells.includes(cell));
}

// ── 1. Ray-length cap: a tie pins from an EMPTY board ─────────────────────────
describe('ray-length cap', () => {
  it('pins a tie from an empty board when the shortest arrowed ray has length 1', () => {
    // 5x5, clue (2,1) arrows UP. The UP ray is just (2,0) (length 1), so the tie
    // t ≤ 1, and t ≥ 1, so t=1 is pinned even with NOTHING shaded yet → (2,0) is
    // forced shaded. This is the keystone deduction the old engine could not make.
    const model = buildModel(mkPuzzle(5, 5, { [idx(2, 1, 5)]: dirBit(Dir.Up) }, mono));
    const st = initState(model);
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.shaded.test(idx(2, 0, 5))).toBe(true);
    expect(hasRule(r.steps, 'arrow-forced-shade', idx(2, 0, 5))).toBe(true);
  });
});

// ── 2. Feasible-hit intersection: a single candidate on a partially excluded ray
describe('feasible-hit intersection', () => {
  it('pins the tie when exclusions carve the feasible set to one value inside [lo,hi]', () => {
    // 5x7, clue (2,3) arrows UP+DOWN; two monominoes so the forced shades are
    // coverable. Raw bounds are lo=2 (UP d1 excluded), hi=3 (ray-length cap), so
    // [lo,hi]={2,3} is NOT a singleton. But excluding DOWN d3 (2,6) makes d=3
    // infeasible (its DOWN cell is excluded), leaving the intersection {2} → the
    // tie pins at 2, forcing UP (2,1) and DOWN (2,5) shaded. Only the feasible-hit
    // intersection (not the raw interval) makes this pin.
    const model = buildModel(mkPuzzle(5, 7, { [idx(2, 3, 5)]: dirBit(Dir.Up) | dirBit(Dir.Down) }, monoX2));
    const st = initState(model);
    st.excluded.set(idx(2, 2, 5)); // UP d1 → lo=2
    st.excluded.set(idx(2, 6, 5)); // DOWN d3 → removes 3 from the intersection
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.shaded.test(idx(2, 1, 5))).toBe(true); // UP tie cell at d=2
    expect(st.shaded.test(idx(2, 5, 5))).toBe(true); // DOWN tie cell at d=2
    expect(hasRule(r.steps, 'arrow-forced-shade', idx(2, 1, 5))).toBe(true);
  });
});

// ── 3. Separation placement-filter (shaded cell in a placement's halo) ────────
describe('separation placement-filter', () => {
  it('a shaded cell in a placement’s halo kills it (king-adjacent shaded ⇒ same shape)', () => {
    // 1x6, TWO dominoes (so nothing is killed by bank exhaustion), seed shaded
    // cell 3 only (never committed, so nothing dies by commit-overlap either).
    // Placement {4,5} covers neither shaded cell and hits no excluded cell, but
    // its halo is {3} — which is shaded and NOT part of {4,5}. So {4,5} would be
    // a different shape touching the shape at cell 3 (rule 2 violation) → its ONLY
    // cause of death is the separation filter.
    const dominoX2: Bank = { pieces: [shapeFromStrings(['##']), shapeFromStrings(['##'])] };
    const model = buildModel(mkPuzzle(6, 1, {}, dominoX2));
    const st = initState(model);
    st.shaded.set(3);
    const p45 = model.placements.findIndex((p) => [...p.cellList].join(',') === '4,5');
    const p23 = model.placements.findIndex((p) => [...p.cellList].join(',') === '2,3');
    expect(p45).toBeGreaterThanOrEqual(0);
    propagateToFixpoint(model, st);
    expect(st.alive[p45]).toBe(0); // killed purely by separation (halo ∩ shaded)
    expect(st.alive[p23]).toBe(1); // {2,3} actually covers the shaded cell → alive
  });
});

// ── 4a. Cover-analysis: zero-cover exclusion ──────────────────────────────────
describe('cover-analysis: zero-cover', () => {
  it('a cell no alive placement can cover is excluded', () => {
    // 3x3 with an I-pentomino bank: the 5-long piece fits nowhere on a 3x3 board,
    // so every cell is covered by zero placements → all cells excluded.
    const model = buildModel(mkPuzzle(3, 3, {}, iPento));
    const st = initState(model);
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.excluded.test(idx(1, 1, 3))).toBe(true);
    expect(hasRule(r.steps, 'cover-analysis', idx(1, 1, 3))).toBe(true);
  });
});

// ── 4b. Cover-analysis: common-cell forcing ───────────────────────────────────
describe('cover-analysis: common-cell forcing', () => {
  it('a cell covered by EVERY placement of a free shaded cell is shaded', () => {
    // 1x5, one I-tromino, seed shaded cell 1. The only trominoes covering cell 1
    // are {0,1,2} and {1,2,3}; both also cover cell 2, so cell 2 must be shaded.
    const model = buildModel(mkPuzzle(5, 1, {}, iTromino));
    const st = initState(model);
    st.shaded.set(1);
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.shaded.test(2)).toBe(true);
    expect(hasRule(r.steps, 'cover-analysis', 2)).toBe(true);
  });
});

// ── 4c. Cover-analysis: common-halo exclusion ─────────────────────────────────
describe('cover-analysis: common-halo exclusion', () => {
  it('a cell in the halo of every placement covering a free shaded cell is excluded', () => {
    // 3x3, one domino, seed shaded corner (0,0). The dominoes covering (0,0) are
    // {(0,0),(1,0)} and {(0,0),(0,1)}; the diagonal cell (1,1) is in BOTH of their
    // halos, so it is excluded no matter which one is used.
    const model = buildModel(mkPuzzle(3, 3, {}, domino));
    const st = initState(model);
    st.shaded.set(idx(0, 0, 3));
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.excluded.test(idx(1, 1, 3))).toBe(true);
    expect(hasRule(r.steps, 'cover-analysis', idx(1, 1, 3))).toBe(true);
  });
});

// ── 5. Probe-forcing is deducer-only and closes a real board ──────────────────
describe('probe-forcing', () => {
  const url = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
  function unresolved(probe: boolean): number {
    const model = buildModel(decodeUrl(url));
    const st = initState(model);
    propagateToFixpoint(model, st, { probe });
    let u = 0;
    for (let i = 0; i < model.cols * model.rows; i++)
      if (!st.shaded.test(i) && !st.excluded.test(i)) u++;
    return u;
  }
  it('is OFF by default (search path) and leaves cells unresolved on the 10x10', () => {
    expect(unresolved(false)).toBeGreaterThan(0);
  });
  it('resolves every cell on the 10x10 when enabled (deducer path)', () => {
    expect(unresolved(true)).toBe(0);
  });
});
