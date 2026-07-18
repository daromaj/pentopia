/**
 * Tests for the human-style deduction engine (roadmap Phase 4).
 *
 * The strengthened propagators (arrow ray-length cap, feasible-hit
 * intersection, cross-placement cover-analysis, separation placement-filter,
 * and probe-forcing) now FULLY solve real published boards from an empty board
 * by pure deduction — see the "completion report" describe block, which asserts
 * `solved === true` for both valid_6x7 and the §3.4 10x10 sample. We also assert
 * SOUNDNESS everywhere: every cell deduce() decides matches the unique solution.
 *
 * A few micro-puzzles below still seed a `SolveState` directly to isolate a
 * single propagator (the identical code path `deduce` wraps) where an
 * empty-board start would engage several rules at once.
 */

import { describe, it, expect } from 'vitest';
import { deduce, explainSteps, TIER } from '@solver/deduce';
import { buildModel, type Model } from '@solver/model';
import { initState } from '@solver/state';
import { propagateToFixpoint, type RuleId, type Step } from '@solver/propagate';
import { solve } from '@solver/search';
import { decodeUrl } from '@core/codec/url';
import { decodePzprv3 } from '@core/codec/pzprv3';
import { shapeFromStrings } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, HATENA, dirBit, Dir, type Bank, type Puzzle, type Solution } from '@core/types';
import { fixtures } from './fixtures/pentopia';

// ── helpers ─────────────────────────────────────────────────────────────────
function mkPuzzle(cols: number, rows: number, clues: Record<number, number>, bank: Bank, transparent = false): Puzzle {
  const c = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const k of Object.keys(clues)) c[+k] = clues[+k]!;
  return { cols, rows, clues: c, bank, transparent };
}
const mono: Bank = { pieces: [shapeFromStrings(['#'])] };
const domino: Bank = { pieces: [shapeFromStrings(['##'])] };
const dominoX2: Bank = { pieces: [shapeFromStrings(['##']), shapeFromStrings(['##'])] };

const SHADE_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['arrow-forced-shade', 'forced-placement']);

/** Reconstruct the cells deduce() shaded / excluded from its step log. */
function decidedCells(steps: readonly Step[]): { shaded: Set<number>; excluded: Set<number> } {
  const shaded = new Set<number>();
  const excluded = new Set<number>();
  for (const s of steps) {
    // `cover-analysis` shades AND excludes, so its steps carry an explicit
    // `kind`; the rule-name fallback covers the single-kind rules.
    const kind = s.kind ?? (SHADE_RULES.has(s.rule) ? 'shade' : 'exclude');
    const target = kind === 'shade' ? shaded : excluded;
    for (const c of s.cells) target.add(c);
  }
  return { shaded, excluded };
}

/** A rule appears in the step log and its (aggregated) cells include all of `cells`. */
function stepFor(steps: readonly Step[], rule: RuleId, cells: number[]): boolean {
  const got = new Set<number>();
  for (const s of steps) if (s.rule === rule) for (const c of s.cells) got.add(c);
  return steps.some((s) => s.rule === rule) && cells.every((c) => got.has(c));
}

function findPlacement(model: Model, cells: number[]): number {
  const want = [...cells].sort((a, b) => a - b).join(',');
  for (const p of model.placements) if ([...p.cellList].sort((a, b) => a - b).join(',') === want) return p.index;
  return -1;
}

function uniqueSolution(puzzle: Puzzle): Solution {
  const res = solve(puzzle, { maxSolutions: 2 });
  expect(res.solutions.length).toBe(1);
  expect(res.complete).toBe(true);
  return res.solutions[0]!;
}

// ── 1. Soundness property ────────────────────────────────────────────────────
describe('deduce: soundness (never contradicts the unique solution)', () => {
  const boards: [string, () => Puzzle][] = [
    ['valid_6x7', () => decodePzprv3(fixtures.find((x) => x.name === 'valid_6x7')!.pzprv3).puzzle],
    ['§3.4 10x10 sample', () => decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p')],
  ];
  for (const [name, mk] of boards) {
    it(`${name}: every shaded cell is shaded in the solution, every excluded cell is not — regardless of finishing`, () => {
      const puzzle = mk();
      const answer = uniqueSolution(puzzle);
      const r = deduce(puzzle);
      const { shaded, excluded } = decidedCells(r.steps);
      for (const c of shaded) expect(answer.shaded[c]).toBe(1);
      for (const c of excluded) expect(answer.shaded[c]).toBe(0);
      // If deduce() ever claims solved, its solution must match the unique one.
      if (r.solved) {
        expect(r.solution).not.toBeNull();
        expect(Array.from(r.solution!.shaded)).toEqual(Array.from(answer.shaded));
      }
    });
  }
});

// ── 2. Micro-puzzles: one per §5 exclusion, crackable only via its constraint ─
describe('deduce: §5 micro-puzzles', () => {
  it('clue-cell-exclusion: a clue cell (otherwise shadeable) is excluded by rule 4', () => {
    // 3x3, monomino bank: the centre clue cell could be a monomino, but rule 4
    // forbids it. Only clue-cell-exclusion decides (1,1).
    const clue = idx(1, 1, 3);
    const r = deduce(mkPuzzle(3, 3, { [clue]: dirBit(Dir.Up) }, mono));
    expect(stepFor(r.steps, 'clue-cell-exclusion', [clue])).toBe(true);
    expect(decidedCells(r.steps).excluded.has(clue)).toBe(true);
  });

  it('arrow-distance-bounds (arrowed): a raised lo excludes an arrowed ray prefix', () => {
    // 6x7, clue (1,4) arrows UP+RIGHT. Two HATENA cells on the UP ray (no arrows
    // of their own) are excluded by rule 4, pushing firstNonExcluded(UP)=3, so
    // lo=3 (and hi=4 from the ray-length cap, so the tie is NOT pinned). That
    // forces the RIGHT ray's prefix cells (2,4) and (3,4) — the still-empty
    // arrowed ray — to be excluded. Only arrow-distance-bounds does this. A
    // viable (mono) bank keeps the board solvable, so cover-analysis doesn't
    // (soundly) collapse an all-excluded ray into a contradiction.
    const clue = idx(1, 4, 6);
    const r = deduce(
      mkPuzzle(6, 7, { [clue]: dirBit(Dir.Up) | dirBit(Dir.Right), [idx(1, 3, 6)]: HATENA, [idx(1, 2, 6)]: HATENA }, mono),
    );
    expect(r.contradiction).toBeUndefined();
    expect(stepFor(r.steps, 'arrow-distance-bounds', [idx(2, 4, 6), idx(3, 4, 6)])).toBe(true);
    const { excluded } = decidedCells(r.steps);
    expect(excluded.has(idx(2, 4, 6))).toBe(true);
    expect(excluded.has(idx(3, 4, 6))).toBe(true);
  });

  it('arrow-distance-bounds (unarrowed): an unarrowed ray ≤ lo exclusion is decisive', () => {
    // 5x5, clue (2,2) UP only, mono bank. lo=1 ⇒ the three unarrowed neighbours
    // DOWN/LEFT/RIGHT at distance 1 must be unshaded (rule 3). Nothing else
    // touches them, so the unarrowed exclusion is the sole decider. (Mono bank so
    // the arrowed UP ray stays satisfiable — cover-analysis won't fire a contra.)
    const clue = idx(2, 2, 5);
    const down = idx(2, 3, 5);
    const left = idx(1, 2, 5);
    const right = idx(3, 2, 5);
    const r = deduce(mkPuzzle(5, 5, { [clue]: dirBit(Dir.Up) }, mono));
    expect(r.contradiction).toBeUndefined();
    expect(stepFor(r.steps, 'arrow-distance-bounds', [down, left, right])).toBe(true);
    const { excluded } = decidedCells(r.steps);
    for (const c of [down, left, right]) expect(excluded.has(c)).toBe(true);
  });

  it('no-touch-halo: a forced placement’s halo pins a neighbouring cell (seeded)', () => {
    // 3x3, monomino bank. Seed a shaded centre — forced-placement commits the
    // monomino there and its no-touch halo excludes all 8 neighbours. The corner
    // (0,0), diagonal to the centre, is pinned unshaded ONLY by the halo.
    const p = mkPuzzle(3, 3, {}, mono);
    const model = buildModel(p);
    const st = initState(model);
    st.shaded.set(idx(1, 1, 3));
    const res = propagateToFixpoint(model, st);
    expect(res.status).toBe('ok');
    expect(stepFor(res.steps, 'no-touch-halo', [idx(0, 0, 3)])).toBe(true);
    expect(st.excluded.test(idx(0, 0, 3))).toBe(true);
  });

  it('bank-exhaustion: using up the only domino kills the second region’s placements (seeded)', () => {
    // 1x6, ONE domino. Seed two far-apart shaded cells 0 and 4. forced-placement
    // commits {0,1}; that exhausts the bank (remaining→0), so placement-filtering
    // kills every other domino placement — including {3,4}, which neither
    // overlaps the commit nor sits in its halo, so exhaustion is its ONLY cause
    // of death. Cell 4 then has no alive cover ⇒ contradiction.
    // (placement-filtering is stepless bookkeeping — TIER tier 1 — so we assert
    //  its decisive EFFECT on state, not a step.)
    const model = buildModel(mkPuzzle(6, 1, {}, domino));
    const st = initState(model);
    st.shaded.set(0);
    st.shaded.set(4);
    const p34 = findPlacement(model, [3, 4]);
    expect(p34).toBeGreaterThanOrEqual(0);
    const res = propagateToFixpoint(model, st);
    expect(res.status).toBe('contradiction');
    expect(st.remaining[0]).toBe(0); // bank exhausted
    expect(st.alive[p34]).toBe(0); // second region's placement killed by exhaustion
    // Contrast: with TWO dominoes the same seed is NOT a contradiction.
    const model2 = buildModel(mkPuzzle(6, 1, {}, dominoX2));
    const st2 = initState(model2);
    st2.shaded.set(0);
    st2.shaded.set(4);
    expect(propagateToFixpoint(model2, st2).status).toBe('ok');
  });
});

// ── 3. Completion report on real boards (now FULLY solved by pure deduction) ──
describe('deduce: completion report on real boards', () => {
  function report(name: string, puzzle: Puzzle): void {
    const answer = uniqueSolution(puzzle);
    const r = deduce(puzzle);
    const nonzero = Object.fromEntries(Object.entries(r.tierHistogram).filter(([, n]) => n > 0));
    console.log(
      `\n[deduce ${name}] solved=${r.solved} unresolved=${r.unresolved}/${puzzle.cols * puzzle.rows} maxTier=${r.maxTier} histogram=${JSON.stringify(nonzero)}`,
    );
    // Soundness on the real board: no shade/exclude may contradict the answer.
    const { shaded, excluded } = decidedCells(r.steps);
    for (const c of shaded) expect(answer.shaded[c]).toBe(1);
    for (const c of excluded) expect(answer.shaded[c]).toBe(0);
    // ACCEPTANCE: the strengthened propagators solve real published boards by
    // pure deduction — no cell left unresolved, and the deduced answer matches
    // the unique solution.
    expect(r.solved).toBe(true);
    expect(r.unresolved).toBe(0);
    expect(r.solution).not.toBeNull();
    expect(Array.from(r.solution!.shaded)).toEqual(Array.from(answer.shaded));
    // Show the first few human-readable hint lines for the UI system.
    for (const line of explainSteps(r.steps, puzzle.cols).slice(0, 3)) console.log(`   ${line}`);
  }

  it('valid_6x7', () => {
    report('valid_6x7', decodePzprv3(fixtures.find((x) => x.name === 'valid_6x7')!.pzprv3).puzzle);
  });
  it('§3.4 10x10 published sample', () => {
    report('§3.4-10x10', decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p'));
  });
});

// ── 4. Determinism ────────────────────────────────────────────────────────────
describe('deduce: determinism', () => {
  it('deduce() twice on the same puzzle yields identical steps', () => {
    const puzzle = decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');
    const a = deduce(puzzle);
    const b = deduce(puzzle);
    const norm = (steps: Step[]) => steps.map((s) => ({ rule: s.rule, cells: s.cells, detail: s.detail }));
    expect(norm(a.steps)).toEqual(norm(b.steps));
    expect(a.unresolved).toBe(b.unresolved);
    expect(a.maxTier).toBe(b.maxTier);
    expect(a.tierHistogram).toEqual(b.tierHistogram);
  });
});

// ── TIER sanity ───────────────────────────────────────────────────────────────
describe('deduce: TIER map', () => {
  it('assigns the roadmap difficulty ranks', () => {
    expect(TIER).toEqual({
      'clue-cell-exclusion': 0,
      'no-touch-halo': 1,
      'placement-filtering': 1,
      'arrow-distance-bounds': 2,
      'arrow-forced-shade': 3,
      'forced-placement': 4,
      'cover-analysis': 5,
      'probe-forcing': 6,
    });
  });
});
