/**
 * Generator tests (roadmap Phase 5 acceptance criteria).
 *
 * Covers: determinism, the full AC set over a small batch, the difficulty knob
 * measurably moving the deduction tiers, and local minimality of the clue set.
 * A sample puzzle (URL + grids) is logged for one 6x6 and the 8x8 so the lead
 * can eyeball it and open the URL on puzz.link.
 */

import { describe, it, expect } from 'vitest';
import { generatePuzzle, expertProbeFloor, satisfiesDifficulty, withinProbeBudget, HARD_PROBE_CAP } from '@generator/generate';
import { probeWalk } from '@solver/walk';
import { buildModel } from '@solver/model';
import { deriveMaximalClues } from '@generator/clues';
import { solve } from '@solver/search';
import { deduce } from '@solver/deduce';
import { validate } from '@core/validator';
import { encodeUrl, decodeUrl } from '@core/codec/url';
import { NO_CLUE, type Puzzle, type Solution } from '@core/types';
import { renderClues, renderCombined } from '../src/cli/ascii';

function sameSolution(a: Solution, b: Solution): boolean {
  if (a.shaded.length !== b.shaded.length) return false;
  for (let i = 0; i < a.shaded.length; i++) if (a.shaded[i] !== b.shaded[i]) return false;
  return true;
}

/** The full Phase-5 AC set for one generated puzzle. `gateTier` is the difficulty ceiling. */
function assertAcceptanceCriteria(puzzle: Puzzle, answer: Solution, gateTier: number): void {
  // validate(answer).ok
  expect(validate(puzzle, answer).ok).toBe(true);

  // unique solution equal to the answer
  const res = solve(puzzle, { maxSolutions: 2 });
  expect(res.solutions.length).toBe(1);
  expect(sameSolution(res.solutions[0]!, answer)).toBe(true);

  // deduce().solved within the difficulty gate
  const ded = deduce(puzzle);
  expect(ded.solved).toBe(true);
  expect(ded.maxTier).toBeLessThanOrEqual(gateTier);

  // URL round-trip re-solves to the same answer
  const round = solve(decodeUrl(encodeUrl(puzzle)), { maxSolutions: 2 });
  expect(round.solutions.length).toBe(1);
  expect(sameSolution(round.solutions[0]!, answer)).toBe(true);

  // every clue cell is unshaded in the answer (rule 4, non-transparent)
  for (let i = 0; i < puzzle.clues.length; i++) {
    if (puzzle.clues[i] !== NO_CLUE) expect(answer.shaded[i]).toBe(0);
  }
}

describe('generator: determinism', () => {
  it('same seed + opts → identical url twice', () => {
    const opts = { cols: 6, rows: 6, seed: 12345, difficulty: 'medium' as const };
    const a = generatePuzzle(opts);
    const b = generatePuzzle(opts);
    expect(a.url).toBe(b.url);
    expect(a.stats.clueCount).toBe(b.stats.clueCount);
    expect(sameSolution(a.answer, b.answer)).toBe(true);
  });
});

describe('generator: batch acceptance criteria', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const seed of seeds) {
    it(`6x6 medium seed ${seed} satisfies all AC`, () => {
      const { puzzle, answer } = generatePuzzle({ cols: 6, rows: 6, seed, difficulty: 'medium' });
      assertAcceptanceCriteria(puzzle, answer, 5);
    });
  }

  it('8x8 medium (slower smoke)', () => {
    const t0 = performance.now();
    const { puzzle, answer, stats } = generatePuzzle({ cols: 8, rows: 8, seed: 1, difficulty: 'medium' });
    assertAcceptanceCriteria(puzzle, answer, 5);
    console.log(`[8x8 medium] elapsed=${(performance.now() - t0).toFixed(0)}ms clues=${stats.clueCount} maxTier=${stats.maxTier}`);
  });
});

describe('generator: difficulty knob', () => {
  it('easy has zero probe-forcing steps; hard has >=1', () => {
    const easy = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'easy', maxAttempts: 80 });
    const hard = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'hard', maxAttempts: 120 });

    expect(easy.stats.tierHistogram['probe-forcing']).toBe(0);
    expect(easy.stats.maxTier).toBeLessThanOrEqual(4);
    expect(hard.stats.tierHistogram['probe-forcing']).toBeGreaterThanOrEqual(1);
    expect(hard.stats.maxTier).toBe(6);

    // Both are still valid, unique, human-solvable.
    assertAcceptanceCriteria(easy.puzzle, easy.answer, 4);
    assertAcceptanceCriteria(hard.puzzle, hard.answer, 6);

    console.log(
      `[difficulty knob 6x6] easy: clues=${easy.stats.clueCount} maxTier=${easy.stats.maxTier} probes=${easy.stats.tierHistogram['probe-forcing']} | ` +
        `hard: clues=${hard.stats.clueCount} maxTier=${hard.stats.maxTier} probes=${hard.stats.tierHistogram['probe-forcing']}`,
    );
  });
});

describe('generator: expert difficulty', () => {
  // Seeds hand-verified (experiments/tune-expert-floor.ts + ad-hoc sweeps) to
  // generate an 8x8 expert puzzle in well under 3s each with today's defaults
  // (maxAttempts=400, timeBudgetMs=60000) — expert's floor is a deliberate
  // tail event (see generate.ts's expertProbeFloor doc comment), so most
  // seeds work but some take much longer or time out; these three don't.
  const fastSeeds = [5, 8, 11];

  for (const seed of fastSeeds) {
    it(`8x8 expert seed ${seed} satisfies all AC + the expert floor`, () => {
      const t0 = performance.now();
      const { puzzle, answer, stats } = generatePuzzle({ cols: 8, rows: 8, seed, difficulty: 'expert' });
      const elapsed = performance.now() - t0;

      assertAcceptanceCriteria(puzzle, answer, 7);

      const floor = expertProbeFloor(8, 8);
      const floorMet = stats.tierHistogram['probe-forcing-2'] >= 1 || stats.tierHistogram['probe-forcing'] >= floor;
      expect(floorMet).toBe(true);

      console.log(
        `[expert 8x8 seed ${seed}] elapsed=${elapsed.toFixed(0)}ms attempts=${stats.attempts} ` +
          `clues=${stats.clueCount} maxTier=${stats.maxTier} probe-forcing=${stats.tierHistogram['probe-forcing']} ` +
          `probe-forcing-2=${stats.tierHistogram['probe-forcing-2']} floor=${floor}`,
      );
    });
  }

  it('expert has strictly more probe-forcing steps than easy at the same size (seed 5)', () => {
    const easy = generatePuzzle({ cols: 8, rows: 8, seed: 5, difficulty: 'easy' });
    const expert = generatePuzzle({ cols: 8, rows: 8, seed: 5, difficulty: 'expert' });

    // Easy's ceiling (maxTier<=4) excludes probing entirely.
    expect(easy.stats.tierHistogram['probe-forcing']).toBe(0);
    expect(expert.stats.tierHistogram['probe-forcing']).toBeGreaterThan(easy.stats.tierHistogram['probe-forcing']);

    console.log(
      `[difficulty ordering 8x8 seed 5] easy: probes=${easy.stats.tierHistogram['probe-forcing']} maxTier=${easy.stats.maxTier} | ` +
        `expert: probes=${expert.stats.tierHistogram['probe-forcing']} maxTier=${expert.stats.maxTier}`,
    );
  });
});

describe('generator: local minimality corpus', () => {
  for (const { cols, rows, seed, difficulty } of [
    { cols: 6, rows: 6, seed: 3, difficulty: 'easy' as const },
    { cols: 6, rows: 6, seed: 4, difficulty: 'medium' as const },
    { cols: 6, rows: 6, seed: 1, difficulty: 'hard' as const },
  ]) it(`${cols}x${rows} ${difficulty} seed ${seed} has only load-bearing clues`, () => {
    const gateTier = difficulty === 'easy' ? 4 : difficulty === 'medium' ? 5 : 6;
    const { puzzle: minimized, answer } = generatePuzzle({ cols, rows, seed, difficulty });

    // The maximal legal clue set for this answer (superset by construction).
    const maxClues = deriveMaximalClues(cols, rows, answer.shaded);

    // Subset: every kept clue existed (with the same value) in the maximal set.
    for (let i = 0; i < minimized.clues.length; i++) {
      if (minimized.clues[i] !== NO_CLUE) expect(minimized.clues[i]).toBe(maxClues[i]);
    }

    // Local minimality: every remaining clue must break uniqueness, deduction,
    // or the ceiling. The difficulty floor is intentionally not a removal gate.
    const kept: number[] = [];
    for (let i = 0; i < minimized.clues.length; i++) if (minimized.clues[i] !== NO_CLUE) kept.push(i);
    expect(kept.length).toBeGreaterThan(0);
    for (const pos of kept) {
      const probeClues = minimized.clues.slice();
      probeClues[pos] = NO_CLUE;
      const probe: Puzzle = { ...minimized, clues: probeClues };
      const res = solve(probe, { maxSolutions: 2, nodeCap: 200_000 });
      const uniqueToAnswer = !res.capped && res.solutions.length === 1 && sameSolution(res.solutions[0]!, answer!);
      const ded = deduce(probe);
      const gatesHold = uniqueToAnswer && ded.solved && ded.maxTier <= gateTier;
      expect(gatesHold).toBe(false); // removing a kept clue must break some gate
    }
  });
});

describe('generator: shared difficulty predicate', () => {
  it('applies ceiling and floor together', () => {
    const easy = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'easy' });
    const hard = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'hard' });
    expect(satisfiesDifficulty('easy', deduce(easy.puzzle), 6, 6)).toBe(true);
    expect(satisfiesDifficulty('easy', deduce(hard.puzzle), 6, 6)).toBe(false);
    expect(satisfiesDifficulty('hard', deduce(hard.puzzle), 6, 6)).toBe(true);
  });
});

describe('generator: bounded hard probing', () => {
  it('keeps every what-if a hard board demands inside the cap', () => {
    for (const seed of [1, 2, 3]) {
      const { puzzle } = generatePuzzle({ cols: 8, rows: 8, seed, difficulty: 'hard' });
      const walk = probeWalk(buildModel(puzzle));
      expect(walk.abandoned, `seed ${seed}`).toBe(false);
      expect(walk.probes, `seed ${seed}`).toBeGreaterThan(0);
      expect(walk.worst, `seed ${seed}`).toBeLessThanOrEqual(HARD_PROBE_CAP);
    }
  });

  it('bounds hard alone — easy and medium never probe, expert is meant to grind', () => {
    const easy = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'easy' });
    expect(withinProbeBudget('easy', buildModel(easy.puzzle))).toBe(true);
    expect(withinProbeBudget('expert', buildModel(easy.puzzle))).toBe(true);
  });

  it('rejects a board whose what-if runs past the cap', () => {
    // Generated without the bound, so its probes are free to run long; the
    // predicate has to be what turns one into the other.
    const { puzzle } = generatePuzzle({ cols: 8, rows: 8, seed: 11, difficulty: 'expert' });
    const model = buildModel(puzzle);
    const walk = probeWalk(model);
    if (walk.worst <= HARD_PROBE_CAP) return; // this seed happens to be gentle; nothing to assert
    expect(withinProbeBudget('hard', model)).toBe(false);
  });
});

describe('generator: paired model gates', () => {
  it('builds one model for every generator-owned solve/deduce pair', () => {
    let builds = 0, solves = 0, deductions = 0;
    generatePuzzle({ cols: 6, rows: 6, seed: 3, difficulty: 'medium', observer: {
      onModelBuilt: () => { builds++; }, onSolve: () => { solves++; }, onDeduce: () => { deductions++; },
    } });
    expect(builds).toBe(solves);
    expect(deductions).toBeLessThanOrEqual(builds);
  });
});

describe('generator: logged samples (eyeball / open on puzz.link)', () => {
  it('logs a 6x6 and an 8x8 sample', () => {
    for (const [cols, rows, seed] of [
      [6, 6, 42],
      [8, 8, 1],
    ] as const) {
      const { puzzle, answer, url, stats } = generatePuzzle({ cols, rows, seed, difficulty: 'medium' });
      console.log(
        `\n=== SAMPLE ${cols}x${rows} seed ${seed} (medium) ===\n` +
          `https://puzz.link/p?${url}\n` +
          `clues=${stats.clueCount} maxTier=${stats.maxTier} elapsed=${stats.elapsedMs.toFixed(0)}ms\n` +
          `clues:\n${renderClues(puzzle)}\n` +
          `answer (# shaded, glyphs=clues):\n${renderCombined(puzzle, answer)}`,
      );
      expect(url.startsWith('pentopia/')).toBe(true);
    }
  });
});
