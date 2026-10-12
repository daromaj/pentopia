/**
 * The first-what-if position gate (`GenerateOptions.firstProbeWindow` and the
 * minimizer gate under it, `MinimizeGates.firstProbeWindow`). See
 * flip/experiments/generator-search-report.md, section "Sterowanie pozycją
 * pierwszego „co jeśli”".
 *
 * Production sets it on the extra-hard band only, so the properties that
 * matter most are that leaving it unset deals the boards the generator always
 * dealt, and that setting it deals the boards recorded when it was first
 * written (the GATED table), before it was cut down from a set of experimental
 * modes to this one option.
 */

import { describe, it, expect } from 'vitest';
import { PRESETS } from '@core/bank';
import { type Puzzle, type Solution } from '@core/types';
import { solveModel } from '@solver/search';
import { deduceModel, TIER } from '@solver/deduce';
import { buildModel } from '@solver/model';
import { probeWalk } from '@solver/walk';
import { createRng } from '@generator/rng';
import { placeShapes } from '@generator/place';
import { deriveMaximalClues } from '@generator/clues';
import { minimizeClues, sameSolution, type MinimizeGates } from '@generator/minimize';
import { generatePuzzle, withinProbeBudget, HARD_PROBE_CAP } from '@generator/generate';

const NODE_CAP = 200_000;

interface Layout { puzzle: Puzzle; answer: Solution; seed: number }

function layoutFor(cols: number, rows: number, seed: number): Layout | null {
  const rng = createRng(seed);
  const answer = placeShapes(cols, rows, PRESETS.p!, rng);
  if (answer === null) return null;
  const puzzle: Puzzle = { cols, rows, clues: deriveMaximalClues(cols, rows, answer.shaded), bank: PRESETS.p!, transparent: false };
  const model = buildModel(puzzle);
  const res = solveModel(model, { maxSolutions: 2, nodeCap: NODE_CAP });
  if (res.capped || res.solutions.length !== 1 || !sameSolution(res.solutions[0]!, answer)) return null;
  const ded = deduceModel(model);
  return ded.solved && ded.maxTier <= 6 ? { puzzle, answer, seed } : null;
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

function minimize(l: Layout, gates: MinimizeGates = {}): Puzzle {
  const rng = createRng(l.seed);
  placeShapes(l.puzzle.cols, l.puzzle.rows, PRESETS.p!, rng);
  return minimizeClues(l.puzzle, l.answer, rng, { maxTier: 6, nodeCap: NODE_CAP, opening: 'narrow', probeCap: HARD_PROBE_CAP, ...gates });
}

describe('minimizer gate on the first what-if', () => {
  it('a board that ends with a what-if has it inside the window', () => {
    let gated = 0;
    for (const l of layouts(8, 8, 6)) {
      const out = minimize(l, { firstProbeWindow: { lo: 0, hi: 0.7 } });
      const at = probeWalk(buildModel(out), { cap: HARD_PROBE_CAP }).firstProbeAt;
      if (at === null) continue;
      expect(at, `seed ${l.seed}`).toBeLessThanOrEqual(0.7);
      gated++;
    }
    expect(gated).toBeGreaterThan(0);
  });

  it('an empty window leaves a probe-free board', () => {
    for (const l of layouts(6, 6, 3)) {
      const out = minimize(l, { firstProbeWindow: { lo: 1, hi: 0 } });
      expect(deduceModel(buildModel(out)).maxTier, `seed ${l.seed}`).toBeLessThan(TIER['probe-forcing']);
    }
  });
});

describe('generatePuzzle with firstProbeWindow', () => {
  const base = { cols: 6, rows: 6, difficulty: 'hard' as const, maxAttempts: 400, opening: 'narrow' as const, probeCapInLoop: true };
  const window = { lo: 0.35, hi: 0.65 };

  it('deals a deterministic board with its first what-if inside the window and its chains inside the bound', () => {
    for (const seed of [1, 2]) {
      const a = generatePuzzle({ ...base, seed, firstProbeWindow: window });
      expect(generatePuzzle({ ...base, seed, firstProbeWindow: window }).url).toBe(a.url);
      const model = buildModel(a.puzzle);
      expect(withinProbeBudget('hard', model), `seed ${seed}`).toBe(true);
      const at = probeWalk(model).firstProbeAt;
      expect(a.stats.firstProbeAt).toBe(at);
      expect(at, `seed ${seed}`).toBeGreaterThanOrEqual(window.lo);
      expect(at, `seed ${seed}`).toBeLessThanOrEqual(window.hi);
    }
  });

  it('is ignored below hard', () => {
    for (const difficulty of ['easy', 'medium'] as const) {
      const plain = generatePuzzle({ cols: 6, rows: 6, seed: 3, difficulty });
      const gated = generatePuzzle({ cols: 6, rows: 6, seed: 3, difficulty, firstProbeWindow: window });
      expect(gated.url).toBe(plain.url);
    }
  });

  it('unset, deals the boards it dealt before the option existed', () => {
    // Recorded at a334cc0, before the option. flip/experiments/engine-cleanup-fingerprint.ts
    // covers every rung; these pin the extra-hard request shape at 6x6 and 8x8.
    for (const [cols, rows, seed, url] of UNGATED) {
      expect(generatePuzzle({ ...base, cols, rows, seed }).url, `${cols}x${rows} seed ${seed}`).toBe(url);
    }
  });

  it('set, deals the boards recorded when the gate was first written', () => {
    // Recorded with the experimental `firstProbeSteer: { mode: 'gate', window }`, which
    // this option replaced; the same gate, so the same boards.
    for (const [cols, rows, seed, url] of GATED) {
      expect(generatePuzzle({ ...base, cols, rows, seed, firstProbeWindow: window }).url, `${cols}x${rows} seed ${seed}`).toBe(url);
    }
  });
});

/** `generatePuzzle(base)` URLs recorded with the engine at a334cc0. */
const UNGATED: [number, number, number, string][] = [
  [6, 6, 1, 'pentopia/6/6/8i642kat55g1k//p'],
  [6, 6, 2, 'pentopia/6/6/q68ndn8g4i//p'],
  [6, 6, 3, 'pentopia/6/6/ap6h3i9h6n1k//p'],
  [8, 8, 1, 'pentopia/8/8/8nak6jch6p3j3h6v5g9h//p'],
  [8, 8, 2, 'pentopia/8/8/m6har5k7j5k1iat89g4g//p'],
];

/** `generatePuzzle({ ...base, firstProbeWindow: { lo: 0.35, hi: 0.65 } })` URLs; first what-if at 0.59, 0.42, 0.57, 0.36, 0.46, 0.59. */
const GATED: [number, number, number, string][] = [
  [6, 6, 1, 'pentopia/6/6/8i64h9x55h1j//p'],
  [6, 6, 2, 'pentopia/6/6/q68ndn8g4i//p'],
  [6, 6, 3, 'pentopia/6/6/ap6h3i9h6n1k//p'],
  [8, 8, 1, 'pentopia/8/8/gaaai6u3zg6t9h5//p'],
  [8, 8, 2, 'pentopia/8/8/k6g41zg5i9l9hcx4//p'],
  [8, 8, 3, 'pentopia/8/8/ahag4g4aybx48m1g9k//p'],
];
