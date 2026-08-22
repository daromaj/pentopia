/**
 * Characterization ("golden") tests — a safety net for refactoring the solver,
 * generator, and hint layers.
 *
 * Unlike the property tests elsewhere (which check invariants: "is it valid?",
 * "is it unique?", "is it sound?"), these pin the EXACT observable output of the
 * current implementation:
 *   - the generator's produced puzzle URL, clue count, difficulty tier, and full
 *     deduction-tier histogram for fixed (size, seed, difficulty) inputs;
 *   - deduce()'s exact histogram / maxTier / maxProbeChain / step count on the
 *     published benchmark boards;
 *   - the Hint engine's exact chosen cell + kind on a known board.
 *
 * All three pipelines are pure and fully deterministic (seeded RNG, no Date /
 * Math.random, integer + bitboard math), so these values are reproducible.
 *
 * WHY: a behaviour-preserving refactor MUST keep every golden below green. If a
 * change is *intended* to alter output (a new heuristic, a rule tweak), these
 * fail loudly and the new values are re-captured deliberately — never silently.
 * The goldens were captured from the implementation at the time this file was
 * added; to refresh them after an intentional change, run the values through the
 * same calls and paste the results back in.
 */

import { describe, it, expect } from 'vitest';
import { generatePuzzle, type Difficulty } from '@generator/generate';
import { deduce } from '@solver/deduce';
import { computeHint } from '../src/ui/hint';
import { SHADED, MARKED_EMPTY } from '../src/ui/state';
import { solve } from '@solver/search';
import { decodeUrl } from '@core/codec/url';
import { NO_CLUE } from '@core/types';
import type { RuleId } from '@solver/propagate';

/** Drop the always-present zero buckets so a golden reads as just what fired. */
function nonzero(hist: Record<RuleId, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(hist).filter(([, n]) => n > 0));
}

// ── 1. Generator: fixed inputs → exact puzzle ────────────────────────────────
// Each row is a full golden: same seed must reproduce this exact URL (which
// encodes the whole placement + minimized-clue pipeline) and difficulty profile.
interface GenGolden {
  cols: number;
  rows: number;
  difficulty: Difficulty;
  seed: number;
  url: string;
  clueCount: number;
  maxTier: number;
  hist: Record<string, number>;
  /** Per-test timeout (ms); generation wall-time varies even though output does not. */
  timeout: number;
}

const GEN_GOLDENS: GenGolden[] = [
  {
    cols: 6, rows: 6, difficulty: 'easy', seed: 1, url: 'pentopia/6/6/j6j4h8g4g2j8m48k//p',
    clueCount: 8, maxTier: 4,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 10, 'arrow-forced-shade': 4, 'forced-placement': 2 },
    timeout: 5000,
  },
  {
    cols: 6, rows: 6, difficulty: 'easy', seed: 2, url: 'pentopia/6/6/g2gaj8n5i6g1m1j//p',
    clueCount: 7, maxTier: 4,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 5, 'arrow-forced-shade': 4, 'forced-placement': 2 },
    timeout: 5000,
  },
  {
    cols: 6, rows: 6, difficulty: 'medium', seed: 1, url: 'pentopia/6/6/j6m8g4g2j8m4l//p',
    clueCount: 6, maxTier: 5,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 7, 'arrow-forced-shade': 3, 'forced-placement': 2, 'cover-analysis': 1 },
    timeout: 5000,
  },
  {
    cols: 6, rows: 6, difficulty: 'medium', seed: 2, url: 'pentopia/6/6/8has5i61h9k1j//p',
    clueCount: 7, maxTier: 5,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 8, 'arrow-forced-shade': 3, 'forced-placement': 2, 'cover-analysis': 2 },
    timeout: 5000,
  },
  {
    cols: 6, rows: 6, difficulty: 'medium', seed: 3, url: 'pentopia/6/6/hajaq1i6m9i5//p',
    clueCount: 6, maxTier: 5,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 5, 'arrow-forced-shade': 5, 'forced-placement': 2, 'cover-analysis': 1 },
    timeout: 5000,
  },
  {
    cols: 6, rows: 6, difficulty: 'hard', seed: 1, url: 'pentopia/6/6/h2l2r3g12ao//p',
    clueCount: 6, maxTier: 6,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 7, 'arrow-forced-shade': 3, 'forced-placement': 2, 'cover-analysis': 1, 'clue-candidate': 1, 'probe-forcing': 7 },
    timeout: 8000,
  },
  {
    cols: 6, rows: 6, difficulty: 'hard', seed: 2, url: 'pentopia/6/6/m3j8h2r1g1k//p',
    clueCount: 5, maxTier: 6,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 5, 'arrow-forced-shade': 3, 'forced-placement': 2, 'cover-analysis': 4, 'probe-forcing': 3 },
    timeout: 8000,
  },
  {
    cols: 8, rows: 8, difficulty: 'medium', seed: 1, url: 'pentopia/8/8/2o4h4r8i6k5iai2h4o9gcj//p',
    clueCount: 11, maxTier: 5,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 4, 'arrow-distance-bounds': 12, 'arrow-forced-shade': 5, 'forced-placement': 4, 'cover-analysis': 2, 'clue-candidate': 3 },
    timeout: 8000,
  },
  {
    cols: 8, rows: 8, difficulty: 'hard', seed: 7, url: 'pentopia/8/8/r5j3hak4o9g5j4j3j1p//p',
    clueCount: 9, maxTier: 6,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 4, 'arrow-distance-bounds': 10, 'arrow-forced-shade': 7, 'forced-placement': 4, 'cover-analysis': 2, 'probe-forcing': 8 },
    timeout: 10000,
  },
  {
    // The one expert row: small enough to stay fast, and it exercises the
    // depth-2 probe path (probe-forcing-2) that this branch's optimization
    // touched — the single most important case to characterize.
    cols: 6, rows: 6, difficulty: 'expert', seed: 7, url: 'pentopia/6/6/megczh8i//p',
    clueCount: 3, maxTier: 7,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 2, 'arrow-distance-bounds': 3, 'arrow-forced-shade': 2, 'forced-placement': 2, 'cover-analysis': 1, 'probe-forcing': 12, 'probe-forcing-2': 1 },
    timeout: 20000,
  },
];

describe('characterization: generator output is byte-stable per seed', () => {
  for (const g of GEN_GOLDENS) {
    it(
      `${g.cols}x${g.rows} ${g.difficulty} seed ${g.seed} → ${g.url}`,
      () => {
        const { url, stats } = generatePuzzle({
          cols: g.cols,
          rows: g.rows,
          seed: g.seed,
          difficulty: g.difficulty,
        });
        expect({ url, clueCount: stats.clueCount, maxTier: stats.maxTier, hist: nonzero(stats.tierHistogram) }).toEqual({
          url: g.url,
          clueCount: g.clueCount,
          maxTier: g.maxTier,
          hist: g.hist,
        });
      },
      g.timeout,
    );
  }
});

// ── 2. deduce(): exact deduction profile on the published boards ─────────────
interface DeduceGolden {
  name: string;
  url: string;
  solved: boolean;
  unresolved: number;
  maxTier: number;
  maxProbeChain: number;
  steps: number;
  hist: Record<string, number>;
  timeout: number;
}

const DEDUCE_GOLDENS: DeduceGolden[] = [
  {
    name: '§3.4 10x10 sample',
    url: 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p',
    solved: true, unresolved: 0, maxTier: 6, maxProbeChain: 33, steps: 72,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 7, 'arrow-distance-bounds': 10, 'arrow-forced-shade': 4, 'forced-placement': 7, 'cover-analysis': 4, 'clue-candidate': 1, 'probe-forcing': 38 },
    timeout: 10000,
  },
  {
    name: '15x11 published benchmark',
    url: 'pentopia/15/11/h6i6i6i6u9i9i9i9zmczi4zm4i4i4i4u8i8i8i8h//p',
    solved: true, unresolved: 0, maxTier: 6, maxProbeChain: 65, steps: 138,
    hist: { 'clue-cell-exclusion': 1, 'no-touch-halo': 10, 'arrow-distance-bounds': 19, 'arrow-forced-shade': 3, 'forced-placement': 10, 'cover-analysis': 1, 'clue-candidate': 6, 'probe-forcing': 88 },
    timeout: 40000,
  },
];

describe('characterization: deduce() profile is stable on published boards', () => {
  for (const g of DEDUCE_GOLDENS) {
    it(
      `${g.name} deduces with the recorded tier profile`,
      () => {
        const r = deduce(decodeUrl(g.url));
        expect({
          solved: r.solved,
          unresolved: r.unresolved,
          maxTier: r.maxTier,
          maxProbeChain: r.maxProbeChain,
          steps: r.steps.length,
          hist: nonzero(r.tierHistogram),
        }).toEqual({
          solved: g.solved,
          unresolved: g.unresolved,
          maxTier: g.maxTier,
          maxProbeChain: g.maxProbeChain,
          steps: g.steps,
          hist: g.hist,
        });
      },
      g.timeout,
    );
  }
});

// ── 3. Hint: exact chosen cell + kind on a known board ───────────────────────
const SAMPLE = decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');

describe('characterization: hint picks the recorded cell', () => {
  it('first hint on the empty §3.4 board excludes r1c2 (index 1)', () => {
    const hint = computeHint(SAMPLE, new Uint8Array(SAMPLE.cols * SAMPLE.rows))!;
    expect({ kind: hint.kind, cells: hint.cells }).toEqual({ kind: 'exclude', cells: [1] });
  });

  it(
    'with everything but the first probe cell known, that cell gets a cheap (non-look-ahead) exclude',
    () => {
      // Board seeded to the unique solution except the single cell that, from an
      // empty board, would need probe-forcing — from here a cheap rule decides it.
      const probeCell = deduce(SAMPLE).steps.find((s) => s.rule === 'probe-forcing' || s.rule === 'probe-forcing-2')!.cells[0]!;
      const solution = solve(SAMPLE, { maxSolutions: 2 }).solutions[0]!;
      const cellState = new Uint8Array(SAMPLE.cols * SAMPLE.rows);
      for (let i = 0; i < cellState.length; i++) {
        if (SAMPLE.clues[i] !== NO_CLUE || i === probeCell) continue;
        cellState[i] = solution.shaded[i] === 1 ? SHADED : MARKED_EMPTY;
      }
      const hint = computeHint(SAMPLE, cellState)!;
      expect(probeCell).toBe(8);
      expect({ kind: hint.kind, cells: hint.cells }).toEqual({ kind: 'exclude', cells: [8] });
      expect(hint.message.startsWith('Look ahead:')).toBe(false);
    },
    30000,
  );
});
