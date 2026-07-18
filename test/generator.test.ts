/**
 * Generator tests (roadmap Phase 5 acceptance criteria).
 *
 * Covers: determinism, the full AC set over a small batch, the difficulty knob
 * measurably moving the deduction tiers, and local minimality of the clue set.
 * A sample puzzle (URL + grids) is logged for one 6x6 and the 8x8 so the lead
 * can eyeball it and open the URL on puzz.link.
 */

import { describe, it, expect } from 'vitest';
import { generatePuzzle } from '@generator/generate';
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

describe('generator: minimize is locally minimal', () => {
  it('output clue set ⊆ maximal set, and remaining clues are load-bearing', () => {
    const cols = 6;
    const rows = 6;
    const gateTier = 5;
    // Use a real generated puzzle: it is minimized against the medium gate.
    const { puzzle: minimized, answer } = generatePuzzle({ cols, rows, seed: 3, difficulty: 'medium' });

    // The maximal legal clue set for this answer (superset by construction).
    const maxClues = deriveMaximalClues(cols, rows, answer.shaded);

    // Subset: every kept clue existed (with the same value) in the maximal set.
    for (let i = 0; i < minimized.clues.length; i++) {
      if (minimized.clues[i] !== NO_CLUE) expect(minimized.clues[i]).toBe(maxClues[i]);
    }

    // Local minimality: sample up to 3 remaining clues; removing any one must break a gate.
    const kept: number[] = [];
    for (let i = 0; i < minimized.clues.length; i++) if (minimized.clues[i] !== NO_CLUE) kept.push(i);
    const sample = kept.slice(0, 3);
    expect(sample.length).toBeGreaterThan(0);
    for (const pos of sample) {
      const probeClues = minimized.clues.slice();
      probeClues[pos] = NO_CLUE;
      const probe: Puzzle = { ...minimized, clues: probeClues };
      const res = solve(probe, { maxSolutions: 2, nodeCap: 200_000 });
      const uniqueToAnswer = res.solutions.length === 1 && sameSolution(res.solutions[0]!, answer!);
      const ded = deduce(probe);
      const gatesHold = uniqueToAnswer && ded.solved && ded.maxTier <= gateTier;
      expect(gatesHold).toBe(false); // removing a kept clue must break some gate
    }
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
