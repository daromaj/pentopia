/**
 * The minimizer's in-loop probe-chain budget (generator-search experiment E8,
 * `MinimizeGates.probeCap` / `GenerateOptions.probeCapInLoop`), and the free
 * first-probe readings that go with it (`approxFirstProbe`,
 * `GenerateStats.firstProbeAt`). The other minimizer variants measured
 * alongside it (E1-E4, E10) gained nothing and were removed; see
 * flip/experiments/generator-search-report.md.
 *
 * Most tests call `minimizeClues` directly on a freshly placed layout with the
 * hard ceiling (tier 6) and no floor/probe sieve, so one seed costs one
 * minimization instead of the ~10 attempts `generatePuzzle` needs on hard.
 */

import { describe, it, expect } from 'vitest';
import { PRESETS } from '@core/bank';
import { type Puzzle, type Solution } from '@core/types';
import { solveModel } from '@solver/search';
import { deduceModel, TIER } from '@solver/deduce';
import { buildModel } from '@solver/model';
import { createRng } from '@generator/rng';
import { placeShapes } from '@generator/place';
import { deriveMaximalClues } from '@generator/clues';
import { minimizeClues, sameSolution, type MinimizeGates } from '@generator/minimize';
import { generatePuzzle, satisfiesDifficulty, withinProbeBudget, HARD_PROBE_CAP } from '@generator/generate';
import { approxFirstProbe, probeWalk } from '@solver/walk';

const CAP = 6;
const NODE_CAP = 200_000;

interface Layout { puzzle: Puzzle; answer: Solution; seed: number }

/** Steps 1-3 of `generatePuzzle` for one seed: a placed layout whose maximal clue set clears the ceiling, or null. */
function layoutFor(cols: number, rows: number, seed: number): Layout | null {
  const rng = createRng(seed);
  const answer = placeShapes(cols, rows, PRESETS.p!, rng);
  if (answer === null) return null;
  const puzzle: Puzzle = { cols, rows, clues: deriveMaximalClues(cols, rows, answer.shaded), bank: PRESETS.p!, transparent: false };
  const model = buildModel(puzzle);
  const res = solveModel(model, { maxSolutions: 2, nodeCap: NODE_CAP });
  if (res.capped || res.solutions.length !== 1 || !sameSolution(res.solutions[0]!, answer)) return null;
  const ded = deduceModel(model);
  return ded.solved && ded.maxTier <= CAP ? { puzzle, answer, seed } : null;
}

function layouts(cols: number, rows: number, count: number): Layout[] {
  const out: Layout[] = [];
  for (let seed = 1; out.length < count && seed < 500; seed++) {
    const l = layoutFor(cols, rows, seed);
    if (l) out.push(l);
  }
  expect(out.length).toBe(count);
  return out;
}

/** Same RNG stream `generatePuzzle` hands the minimizer: whatever `placeShapes` left of `createRng(seed)`. */
function minimize(l: Layout, gates: MinimizeGates = {}, observer?: MinimizeGates['observer']): Puzzle {
  const rng = createRng(l.seed);
  placeShapes(l.puzzle.cols, l.puzzle.rows, PRESETS.p!, rng);
  return minimizeClues(l.puzzle, l.answer, rng, { maxTier: CAP, nodeCap: NODE_CAP, observer, ...gates });
}

const clueList = (clues: Int16Array): number[] => [...clues];

describe('E8: probeCap in the minimizer loop', () => {
  it('minimizeClues with probeCap is deterministic and the result walks within the cap', () => {
    for (const l of layouts(8, 8, 4)) {
      const a = minimize(l, { opening: 'narrow', probeCap: HARD_PROBE_CAP });
      const b = minimize(l, { opening: 'narrow', probeCap: HARD_PROBE_CAP });
      expect(clueList(a.clues)).toEqual(clueList(b.clues));
      const walk = probeWalk(buildModel(a), { cap: HARD_PROBE_CAP });
      expect(walk.abandoned, `seed ${l.seed}`).toBe(false);
      expect(walk.worst).toBeLessThanOrEqual(HARD_PROBE_CAP);
    }
  });

  it('a cap no chain can meet refuses every removal that needs a what-if', () => {
    // probeCap -1: any walk that probes at all has worst >= 0 > -1, so every
    // removal whose deduction uses a probe is restored. What survives is a
    // board that never needs a probe to be solved the way `deduce` solves it.
    for (const l of layouts(6, 6, 3)) {
      const out = minimize(l, { probeCap: -1 });
      expect(deduceModel(buildModel(out)).maxTier, `seed ${l.seed}`).toBeLessThan(TIER['probe-forcing']);
    }
  });

  it('a deadline that has passed throws instead of returning a partly minimized set', () => {
    const l = layouts(6, 6, 1)[0]!;
    expect(() => minimize(l, { probeCap: HARD_PROBE_CAP, deadline: performance.now() - 1 })).toThrow(/deadline exceeded/);
  });

  it('generatePuzzle: deterministic, within the probe budget, and reports chain-too-long rejects with vs without', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let without = 0, withCap = 0, attemptsWithout = 0, attemptsWith = 0;
    for (const seed of seeds) {
      const opts = { cols: 8, rows: 8, seed, difficulty: 'hard' as const, maxAttempts: 400, opening: 'narrow' as const };
      let rejects = 0;
      const base = generatePuzzle({ ...opts, observer: { onReject: (r) => { if (r === 'floor-chain-too-long') rejects++; } } });
      without += rejects;
      attemptsWithout += base.stats.attempts;
      rejects = 0;
      const gated = generatePuzzle({ ...opts, probeCapInLoop: true, observer: { onReject: (r) => { if (r === 'floor-chain-too-long') rejects++; } } });
      withCap += rejects;
      attemptsWith += gated.stats.attempts;
      expect(generatePuzzle({ ...opts, probeCapInLoop: true }).url).toBe(gated.url);
      const model = buildModel(gated.puzzle);
      expect(withinProbeBudget('hard', model)).toBe(true);
      expect(satisfiesDifficulty('hard', deduceModel(model), 8, 8)).toBe(true);
    }
    console.log(`[E8] 8x8 hard, ${seeds.length} seeds: floor-chain-too-long rejects ${without} without vs ${withCap} with; attempts ${attemptsWithout} vs ${attemptsWith}`);
    expect(withCap).toBeLessThanOrEqual(without);
  });
});

describe('first-probe readings', () => {
  it('approxFirstProbe and stats.firstProbeAt equal probeWalk().firstProbeAt on generated hard boards', () => {
    const plan: [number, number, number[]][] = [
      [6, 6, Array.from({ length: 16 }, (_, i) => i + 1)],
      [8, 8, [1, 2, 3, 4]],
    ];
    let boards = 0;
    for (const [cols, rows, seeds] of plan) {
      for (const seed of seeds) {
        const { puzzle, stats } = generatePuzzle({
          cols, rows, seed, difficulty: 'hard', maxAttempts: 400, opening: 'narrow', probeCapInLoop: true,
        });
        const model = buildModel(puzzle);
        const walk = probeWalk(model).firstProbeAt;
        // The probe bound requires a what-if, so an accepted hard board always has one.
        expect(walk, `${cols}x${rows} seed ${seed}`).not.toBeNull();
        expect(approxFirstProbe(model, deduceModel(model).steps), `${cols}x${rows} seed ${seed}: deduce log`).toBe(walk);
        expect(stats.firstProbeAt, `${cols}x${rows} seed ${seed}: generator stats`).toBe(walk);
        boards++;
      }
    }
    expect(boards).toBe(20);
  });

  it('stats.firstProbeAt is absent below hard, where no walk runs', () => {
    for (const difficulty of ['easy', 'medium'] as const) {
      expect(generatePuzzle({ cols: 6, rows: 6, seed: 3, difficulty }).stats).not.toHaveProperty('firstProbeAt');
    }
  });
});
