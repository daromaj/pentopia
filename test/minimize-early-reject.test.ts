/**
 * The minimizer's early-reject options (flip/experiments/generator-early-reject-report.md):
 *
 *   - `skipSettled` / `GenerateOptions.skipSettledRemovals`: exact — skips only
 *     re-checks whose answer is already known, so every board must be the one
 *     the plain loop deals, with fewer removal checks.
 *   - `abandonProbeFreeAfterPass` / `GenerateOptions.abandonProbeFreeAfterPass`:
 *     heuristic — abandons a minimization that has kept no what-if after N passes.
 *   - `GenerateOptions.fixedLayout`: every attempt re-minimizes one given answer.
 */

import { describe, it, expect } from 'vitest';
import { PRESETS } from '@core/bank';
import { type Puzzle, type Solution } from '@core/types';
import { solveModel } from '@solver/search';
import { deduceModel } from '@solver/deduce';
import { buildModel } from '@solver/model';
import { createRng } from '@generator/rng';
import { placeShapes } from '@generator/place';
import { deriveMaximalClues } from '@generator/clues';
import { minimizeClues, sameSolution, MINIMIZE_ABANDONED, type MinimizeGates } from '@generator/minimize';
import { generatePuzzle, HARD_PROBE_CAP, type GenerateOptions } from '@generator/generate';

const NODE_CAP = 200_000;

interface Layout { puzzle: Puzzle; answer: Solution; seed: number }

function layoutFor(cols: number, rows: number, seed: number, cap: number): Layout | null {
  const rng = createRng(seed);
  const answer = placeShapes(cols, rows, PRESETS.p!, rng);
  if (answer === null) return null;
  const puzzle: Puzzle = { cols, rows, clues: deriveMaximalClues(cols, rows, answer.shaded), bank: PRESETS.p!, transparent: false };
  const model = buildModel(puzzle);
  const res = solveModel(model, { maxSolutions: 2, nodeCap: NODE_CAP });
  if (res.capped || res.solutions.length !== 1 || !sameSolution(res.solutions[0]!, answer)) return null;
  const ded = deduceModel(model);
  return ded.solved && ded.maxTier <= cap ? { puzzle, answer, seed } : null;
}

function layouts(cols: number, rows: number, count: number, cap: number): Layout[] {
  const out: Layout[] = [];
  for (let seed = 1; out.length < count && seed < 500; seed++) {
    const l = layoutFor(cols, rows, seed, cap);
    if (l) out.push(l);
  }
  expect(out.length).toBe(count);
  return out;
}

/** The minimizer on the RNG stream `generatePuzzle` would hand it; returns the clues and the checks it ran. */
function minimize(l: Layout, gates: MinimizeGates): { clues: number[]; checks: number } {
  const rng = createRng(l.seed);
  placeShapes(l.puzzle.cols, l.puzzle.rows, PRESETS.p!, rng);
  let checks = 0;
  const out = minimizeClues(l.puzzle, l.answer, rng, { nodeCap: NODE_CAP, observer: { onRemoval: () => checks++ }, ...gates });
  return { clues: [...out.clues], checks };
}

const EXTRA_HARD: MinimizeGates = { maxTier: 6, opening: 'narrow', probeCap: HARD_PROBE_CAP, firstProbeWindow: { lo: 0.35, hi: 0.65 } };

describe('skipSettled', () => {
  it('returns the plain minimizer’s clue set (skipSettled: false) with fewer checks, by default (6x6 / 8x8, three gate sets)', () => {
    let plainChecks = 0, skipChecks = 0;
    for (const [cols, gates] of [[6, { maxTier: 4 }], [8, { maxTier: 5 }], [6, EXTRA_HARD], [8, EXTRA_HARD]] as const) {
      for (const l of layouts(cols, cols, 3, gates.maxTier!)) {
        const plain = minimize(l, { ...gates, skipSettled: false });
        const skip = minimize(l, gates);
        expect(skip.clues, `${cols}x${cols} seed ${l.seed}`).toEqual(plain.clues);
        expect(skip.checks).toBeLessThanOrEqual(plain.checks);
        plainChecks += plain.checks;
        skipChecks += skip.checks;
      }
    }
    expect(skipChecks).toBeLessThan(plainChecks);
  });

  it('generatePuzzle deals the same board by default, as with skipSettledRemovals: false (extra-hard options, 6x6 and 8x8)', () => {
    for (const [cols, seed] of [[6, 11], [6, 12], [8, 21], [8, 22]] as const) {
      const opts: GenerateOptions = {
        cols, rows: cols, seed, difficulty: 'hard', opening: 'narrow', probeCapInLoop: true,
        firstProbeWindow: { lo: 0.35, hi: 0.65 },
      };
      const plain = generatePuzzle({ ...opts, skipSettledRemovals: false });
      const skip = generatePuzzle(opts);
      expect(skip.url, `${cols}x${cols} seed ${seed}`).toBe(plain.url);
      expect(skip.stats.attempts).toBe(plain.stats.attempts);
    }
  });
});

describe('abandonProbeFreeAfterPass', () => {
  it('throws once a pass ends with no what-if kept, and never when a cap rules what-ifs out of reach of the floor anyway', () => {
    // Tier cap 5: no removal can keep a what-if, so any minimization that gets
    // to a second pass is abandoned.
    let abandoned = 0;
    for (const l of layouts(6, 6, 4, 5)) {
      try {
        minimize(l, { maxTier: 5, abandonProbeFreeAfterPass: 1 });
      } catch (error) {
        expect((error as Error).message).toBe(MINIMIZE_ABANDONED);
        abandoned++;
      }
    }
    expect(abandoned).toBeGreaterThan(0);
  });

  it('generatePuzzle still deals a valid hard board, and ignores the option below hard', () => {
    const hard = generatePuzzle({
      cols: 6, rows: 6, seed: 7, difficulty: 'hard', opening: 'narrow', probeCapInLoop: true,
      firstProbeWindow: { lo: 0.35, hi: 0.65 }, abandonProbeFreeAfterPass: 1,
    });
    expect(hard.stats.tierHistogram['probe-forcing']).toBeGreaterThan(0);
    const medium = { cols: 6, rows: 6, seed: 7, difficulty: 'medium' as const };
    expect(generatePuzzle({ ...medium, abandonProbeFreeAfterPass: 1 }).url).toBe(generatePuzzle(medium).url);
  });
});

describe('fixedLayout', () => {
  it('minimizes the given answer on every attempt, so only the removal order differs', () => {
    const opts: GenerateOptions = {
      cols: 6, rows: 6, seed: 7, difficulty: 'hard', opening: 'narrow', probeCapInLoop: true,
      firstProbeWindow: { lo: 0.35, hi: 0.65 },
    };
    const first = generatePuzzle(opts);
    const again = generatePuzzle({ ...opts, seed: 1234, fixedLayout: first.answer });
    expect(sameSolution(again.answer, first.answer)).toBe(true);
    expect(again.stats.tierHistogram['probe-forcing']).toBeGreaterThan(0);
  });
});
