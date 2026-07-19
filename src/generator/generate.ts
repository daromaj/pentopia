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
 * arrow-forced-shade=3, forced-placement=4, cover-analysis=5, probe-forcing=6,
 * probe-forcing-2=7.
 *
 * GATE (ceiling — cap on deduce().maxTier during minimize and at maximal clues):
 *   easy   → maxTier ≤ 4  (no cover-analysis, no probes; ⇒ zero probe steps)
 *   medium → maxTier ≤ 5  (cover-analysis allowed, no probes)
 *   hard   → maxTier ≤ 6  (probes allowed, depth-1 only)
 *   expert → maxTier ≤ 7  (depth-2 probes allowed too)
 *
 * FLOOR (reject too-trivial finished puzzles):
 *   easy   → none
 *   medium → require ≥1 cover-analysis OR arrow-forced-shade step
 *   hard   → require ≥1 probe-forcing step
 *   expert → require ≥1 probe-forcing-2 step, OR probe-forcing steps at or
 *            above a per-size threshold measured to sit comfortably above
 *            hard's distribution (see `expertProbeFloor` below and
 *            experiments/tune-expert-floor.ts for the tuning data).
 *
 * The gate keeps a difficulty from exceeding its ceiling; the floor keeps it
 * from falling below its intended tier. Together they make the difficulty knob
 * measurably move the deduction-tier distribution (and clue count).
 *
 * ── EXPERT PERFORMANCE ───────────────────────────────────────────────────────
 * deduce()'s depth-2 probe-forcing-2 sweep only engages once depth-1 stalls,
 * but with expert's ceiling raised to tier 7, minimize's per-removal deduce()
 * calls hit exactly that stall constantly — it's the hot path, not a rare
 * escape hatch. `opts.timeBudgetMs` (default ~60s for expert, effectively
 * unbounded for the other tiers) bounds this: minimizeClues checks the
 * deadline before each candidate removal and, once passed, stops removing
 * clues and returns the puzzle as-is — a partially-minimized clue set can
 * still satisfy the floor, it's just not locally minimal. If the deadline
 * passes across attempts with no accepted puzzle, generation falls through to
 * the existing "exhausted N attempts" error.
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

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface GenerateOptions {
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
  /** Default 'medium'. */
  readonly difficulty?: Difficulty;
  /** Default PRESETS.p (the 12 free pentominoes). */
  readonly bank?: Bank;
  /** Layout+minimize attempts before throwing. Default 50 (400 for expert — see DEFAULT_MAX_ATTEMPTS). */
  readonly maxAttempts?: number;
  /** Override the placed-piece count (else derived from board size). */
  readonly pieceCount?: number;
  /**
   * Wall-clock budget (ms) for the whole `generatePuzzle` call, measured from
   * entry. Once passed, minimize stops removing clues mid-attempt (see
   * MinimizeGates.deadline) and, if no puzzle has been accepted by the time
   * it's checked again at the top of the attempt loop, generation throws the
   * usual "exhausted attempts" error rather than grinding on. Default:
   * effectively unbounded (`Infinity`) for easy/medium/hard — their ceilings
   * never reach the expensive depth-2 probe path — and ~60_000ms for expert,
   * where depth-2 deduce() calls are the hot path during minimize.
   */
  readonly timeBudgetMs?: number;
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

const GATE_TIER: Record<Difficulty, number> = { easy: 4, medium: 5, hard: 6, expert: 7 };
const NODE_CAP = 200_000;

/** Default `timeBudgetMs` per difficulty — see GenerateOptions.timeBudgetMs. */
const DEFAULT_TIME_BUDGET_MS: Record<Difficulty, number> = {
  easy: Infinity,
  medium: Infinity,
  hard: Infinity,
  expert: 60_000,
};

/**
 * Default `maxAttempts` per difficulty. Easy/medium/hard keep the original
 * flat 50 (unchanged — their floors are common enough that 50 attempts is
 * ample headroom). Expert's floor is a deliberate tail event: ad-hoc sampling
 * of raw cap-7-minimized 8x8 puzzles (unfiltered by the floor) showed only
 * ~30% clear the expert probe floor at all, and per-attempt cost is
 * ~130-190ms, so 50 attempts (50-100 were observed needed at 8x8 in practice)
 * frequently starved out before finding one. 400 gives that headroom — in
 * practice `timeBudgetMs` (60s default) is what actually stops an unlucky
 * run before the attempt cap on larger boards, where per-attempt cost climbs.
 */
const DEFAULT_MAX_ATTEMPTS: Record<Difficulty, number> = {
  easy: 50,
  medium: 50,
  hard: 50,
  expert: 400,
};

/**
 * Expert per-size probe-forcing floor (measured — see
 * experiments/tune-expert-floor.ts). That script generated 15 'hard' puzzles
 * (ceiling maxTier<=6, so their only probe rule is tier-6 probe-forcing) at
 * each of 8x8 and 10x10 and recorded probe-forcing step counts:
 *
 *   8x8   (64 cells):  min=6  median=22  p90=30  max=41  (mean 20.9)
 *   10x10 (100 cells): min=11 median=26  p90=42  max=50  (mean 27.9)
 *
 * A line through those two p90 points, rounded to clean coefficients —
 * `0.4 * cells + 12` — gives 37.6≈38 @ 64 cells and 52 @ 100 cells: ~8-10
 * steps clear of hard's own p90 at both sizes, i.e. comfortably above the
 * bulk of the hard distribution, not just its median.
 *
 * Sanity check against the empirical target that motivated this tier: the
 * user's reference "very hard" published 15x11 (165 cells) deduces with 88
 * probe-forcing steps (no depth-2 needed). This formula's threshold there is
 * round(0.4*165+12)=78 — comfortably below 88, so that real puzzle would
 * clear the expert floor.
 */
export function expertProbeFloor(cols: number, rows: number): number {
  return Math.round(0.4 * cols * rows + 12);
}

function sameSolution(a: Solution, b: Solution): boolean {
  const x = a.shaded;
  const y = b.shaded;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Is this finished puzzle hard *enough* for the requested difficulty? */
function floorSatisfied(difficulty: Difficulty, ded: DeduceResult, cols: number, rows: number): boolean {
  const h = ded.tierHistogram;
  switch (difficulty) {
    case 'easy':
      return true;
    case 'medium':
      return h['cover-analysis'] >= 1 || h['arrow-forced-shade'] >= 1;
    case 'hard':
      return h['probe-forcing'] >= 1;
    case 'expert':
      // Depth-2-requiring puzzles are a bonus acceptor — rare under random
      // layout+minimize — but the realistic path is enough depth-1 probing.
      return h['probe-forcing-2'] >= 1 || h['probe-forcing'] >= expertProbeFloor(cols, rows);
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
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS[difficulty];
  const gateTier = GATE_TIER[difficulty];
  const rng = createRng(seed);
  const t0 = performance.now();
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS[difficulty];
  const deadline = t0 + timeBudgetMs; // may be Infinity — fine, always > now()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (performance.now() > deadline) break; // budget exhausted across attempts — fall through to the error below

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

    // 4. Minimize against both gates. `deadline` lets minimize bail early on
    //    the expensive expert (tier-7) hot path and hand back a
    //    partially-minimized-but-still-floor-eligible puzzle rather than
    //    grinding past the overall time budget.
    const puzzle = minimizeClues(maxPuzzle, answer, rng, { maxTier: gateTier, nodeCap: NODE_CAP, deadline });

    // 5. Difficulty floor: reject puzzles too trivial for the requested tier.
    const ded = deduce(puzzle);
    if (!ded.solved) continue;
    if (!floorSatisfied(difficulty, ded, cols, rows)) continue;

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

  const timedOut = performance.now() > deadline;
  throw new Error(
    `generatePuzzle: exhausted ${maxAttempts} attempts for ${cols}x${rows} ${difficulty} (seed ${seed})` +
      (timedOut ? ` — timeBudgetMs (${timeBudgetMs}ms) exceeded before finding an accepted puzzle.` : '.') +
      ` Try a larger board, a different seed, or more attempts${timedOut ? ', or a larger timeBudgetMs' : ''}.`,
  );
}
