/**
 * Generator orchestration (roadmap §5, Phase 5 acceptance criteria).
 *
 * Pipeline per attempt (bounded by `maxAttempts`):
 *   placeShapes → deriveMaximalClues → build candidate Puzzle → ceiling check
 *   (maximal-clue puzzle must solve uniquely to the answer AND deduce-solve
 *   within the difficulty cap) → minimizeClues (gated on unique AND guess-free)
 *   → difficulty-floor check → full AC verification (validate, unique,
 *   deduce-solved, URL round-trip). Returns the puzzle, its answer, URL, stats.
 *
 * ── DIFFICULTY SEMANTICS ─────────────────────────────────────────────────────
 * Tiers come from deduce()'s per-rule TIER map: no-touch=1, arrow-distance=2,
 * arrow-forced-shade=3, forced-placement=4, cover-analysis=5, probe-forcing=6.
 *
 * GATE (ceiling — cap on deduce().maxTier during minimize and at maximal clues):
 *   easy   → maxTier ≤ 4  (no cover-analysis, no probes; ⇒ zero probe steps)
 *   medium → maxTier ≤ 5  (cover-analysis allowed, no probes)
 *   hard   → maxTier ≤ 6  (probes allowed)
 *
 * FLOOR (reject too-trivial finished puzzles):
 *   easy   → none
 *   medium → require ≥1 cover-analysis OR arrow-forced-shade step
 *   hard   → require ≥1 probe-forcing step
 *
 * The gate keeps a difficulty from exceeding its ceiling; the floor keeps it
 * from falling below its intended tier. Together they make the difficulty knob
 * measurably move the deduction-tier distribution (and clue count).
 */

import type { Bank, Puzzle, Solution } from '../core/types';
import { NO_CLUE } from '../core/types';
import { PRESETS } from '../core/bank';
import { validate } from '../core/validator';
import { encodeUrl, decodeUrl } from '../core/codec/url';
import { solve } from '../solver/search';
import { deduce, type DeduceResult } from '../solver/deduce';
import type { RuleId } from '../solver/propagate';
import { createRng } from './rng';
import { placeShapes } from './place';
import { deriveMaximalClues } from './clues';
import { minimizeClues } from './minimize';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GenerateOptions {
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
  /** Default 'medium'. */
  readonly difficulty?: Difficulty;
  /** Default PRESETS.p (the 12 free pentominoes). */
  readonly bank?: Bank;
  /** Layout+minimize attempts before throwing. Default 50. */
  readonly maxAttempts?: number;
  /** Override the placed-piece count (else derived from board size). */
  readonly pieceCount?: number;
}

export interface GenerateStats {
  readonly attempts: number;
  readonly clueCount: number;
  readonly maxTier: number;
  readonly tierHistogram: Record<RuleId, number>;
  readonly elapsedMs: number;
}

export interface GenerateResult {
  readonly puzzle: Puzzle;
  readonly answer: Solution;
  /** `encodeUrl(puzzle)` — the puzz.link body (prefix with https://puzz.link/p? to open). */
  readonly url: string;
  readonly stats: GenerateStats;
}

const GATE_TIER: Record<Difficulty, number> = { easy: 4, medium: 5, hard: 6 };
const NODE_CAP = 200_000;

function sameSolution(a: Solution, b: Solution): boolean {
  const x = a.shaded;
  const y = b.shaded;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Is this finished puzzle hard *enough* for the requested difficulty? */
function floorSatisfied(difficulty: Difficulty, ded: DeduceResult): boolean {
  const h = ded.tierHistogram;
  switch (difficulty) {
    case 'easy':
      return true;
    case 'medium':
      return h['cover-analysis'] >= 1 || h['arrow-forced-shade'] >= 1;
    case 'hard':
      return h['probe-forcing'] >= 1;
  }
}

function clueCount(clues: Int16Array): number {
  let c = 0;
  for (let i = 0; i < clues.length; i++) if (clues[i] !== NO_CLUE) c++;
  return c;
}

export function generatePuzzle(opts: GenerateOptions): GenerateResult {
  const { cols, rows, seed } = opts;
  const difficulty = opts.difficulty ?? 'medium';
  const bank = opts.bank ?? PRESETS.p!;
  const maxAttempts = opts.maxAttempts ?? 50;
  const gateTier = GATE_TIER[difficulty];
  const rng = createRng(seed);
  const t0 = performance.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1. Random separated layout → answer.
    const answer = placeShapes(cols, rows, bank, rng, { pieceCount: opts.pieceCount });
    if (answer === null) continue; // wedged; retry with fresh randomness

    // 2. Maximal legal clue set.
    const maxClues = deriveMaximalClues(cols, rows, answer.shaded);
    const maxPuzzle: Puzzle = { cols, rows, clues: maxClues, bank, transparent: false };

    // 3. Ceiling check at maximal clues: must solve uniquely to the answer and
    //    deduce-solve within the difficulty cap. If even the fullest clue set
    //    overshoots the ceiling, this layout is hopeless — new layout.
    const maxSolve = solve(maxPuzzle, { maxSolutions: 2, nodeCap: NODE_CAP });
    if (maxSolve.capped || maxSolve.solutions.length !== 1 || !sameSolution(maxSolve.solutions[0]!, answer)) continue;
    const maxDed = deduce(maxPuzzle);
    if (!maxDed.solved || maxDed.maxTier > gateTier) continue;

    // 4. Minimize against both gates.
    const puzzle = minimizeClues(maxPuzzle, answer, rng, { maxTier: gateTier, nodeCap: NODE_CAP });

    // 5. Difficulty floor: reject puzzles too trivial for the requested tier.
    const ded = deduce(puzzle);
    if (!ded.solved) continue;
    if (!floorSatisfied(difficulty, ded)) continue;

    // 6. Full AC verification.
    if (!validate(puzzle, answer).ok) continue;
    const finalSolve = solve(puzzle, { maxSolutions: 2, nodeCap: NODE_CAP });
    if (finalSolve.capped || finalSolve.solutions.length !== 1 || !sameSolution(finalSolve.solutions[0]!, answer)) continue;

    const url = encodeUrl(puzzle);
    const reDecoded = decodeUrl(url);
    const reSolve = solve(reDecoded, { maxSolutions: 2, nodeCap: NODE_CAP });
    if (reSolve.capped || reSolve.solutions.length !== 1 || !sameSolution(reSolve.solutions[0]!, answer)) continue;

    return {
      puzzle,
      answer,
      url,
      stats: {
        attempts: attempt,
        clueCount: clueCount(puzzle.clues),
        maxTier: ded.maxTier,
        tierHistogram: ded.tierHistogram,
        elapsedMs: performance.now() - t0,
      },
    };
  }

  throw new Error(
    `generatePuzzle: exhausted ${maxAttempts} attempts for ${cols}x${rows} ${difficulty} (seed ${seed}). ` +
      `Try a larger board, a different seed, or more attempts.`,
  );
}
