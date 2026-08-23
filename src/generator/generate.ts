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
 *   hard   → require ≥1 probe-forcing step, and an interleaved solver must
 *            spend at least one what-if of its own, each forcing at most
 *            HARD_PROBE_CAP cells before it breaks (see `withinProbeBudget`)
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
 * unbounded for the other tiers) bounds this: a deadline abandons the current
 * candidate rather than returning a puzzle before local-minimality fixed point.
 */

import type { Bank, Puzzle, Solution } from '../core/types';
import { NO_CLUE } from '../core/types';
import { PRESETS } from '../core/bank';
import { validate } from '../core/validator';
import { encodeUrl, decodeUrl } from '../core/codec/url';
import { solveModel } from '../solver/search';
import { deduceModel, type DeduceResult } from '../solver/deduce';
import { buildModel, type Model } from '../solver/model';
import { probeWalk } from '../solver/walk';
import type { RuleId } from '../solver/propagate';
import { createRng } from './rng';
import { placeShapes } from './place';
import { deriveMaximalClues } from './clues';
import { minimizeClues, sameSolution } from './minimize';
import { timed } from './observe';
import { signatureOf, type FlowProfile, type RatedCandidate } from './flow';

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
   * entry. Once passed, minimization abandons its current candidate and the
   * usual "exhausted attempts" error is thrown rather than accepting partial
   * minimization. Default:
   * effectively unbounded (`Infinity`) for easy/medium — their ceilings never
   * reach any probe path — ~240_000ms for hard, whose probe bound rejects most
   * candidates, and ~60_000ms for expert, where depth-2 deduce() calls are the
   * hot path during minimize.
   */
  readonly timeBudgetMs?: number;
  /** Optional diagnostics hook; it never changes candidate selection. */
  readonly observer?: GenerationObserver;
  /** Biases only clue-removal order; candidate zero callers omit it for legacy stability. */
  readonly flowProfile?: FlowProfile;
}

export type GeneratorPhase = 'placing-shapes' | 'checking-uniqueness' | 'minimizing';

export interface GenerationObserver {
  onPhase?(phase: GeneratorPhase): void;
  onSolve?(elapsedMs: number, purpose?: 'gate' | 'codec'): void;
  onDeduce?(elapsedMs: number, purpose?: 'gate' | 'scoring'): void;
  onRemoval?(accepted: boolean): void;
  onModelBuilt?(elapsedMs: number, purpose?: 'gate' | 'codec' | 'scoring'): void;
  onScoring?(elapsedMs: number): void;
}

/** Frozen spacing for candidate RNG substreams; candidate zero remains legacy seed. */
export const SEED_BUMPS = 8;
export const BUMP_STRIDE = 7919;

export function candidateSeed(base: number, candidateIndex: number, bumpIndex = 0): number {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0) throw new Error('candidateIndex must be non-negative');
  if (!Number.isInteger(bumpIndex) || bumpIndex < 0 || bumpIndex >= SEED_BUMPS) {
    throw new Error(`bumpIndex must be between 0 and ${SEED_BUMPS - 1}`);
  }
  return (base + (candidateIndex * SEED_BUMPS + bumpIndex) * BUMP_STRIDE) >>> 0;
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
  // `hard` now has to clear the probe bound too, which rejects roughly nine in
  // ten otherwise-valid candidates, so its attempt count went up with it. The
  // wall-clock cap keeps a pathological seed from spinning a worker forever;
  // 12x12 needs a median 18s and has a long tail, and a budget that expires is
  // a board the caller has to replace, so the cap sits well past the tail.
  hard: 240_000,
  expert: 60_000,
};

/**
 * Default `maxAttempts` per difficulty. Easy/medium keep the original flat 50
 * (their floors are common enough that 50 attempts is ample headroom). Hard
 * left that company when its probe bound landed: measured acceptance is ~10%
 * of otherwise-valid candidates, and a 12x12 board took 5-46 attempts to find
 * one, so 50 starved. Expert's floor is a deliberate tail event: ad-hoc sampling
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
  hard: 400,
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

/** Is this finished puzzle hard *enough* for the requested difficulty? */
export function satisfiesDifficulty(
  difficulty: Difficulty,
  ded: Pick<DeduceResult, 'solved' | 'maxTier' | 'tierHistogram'>,
  cols: number,
  rows: number,
): boolean {
  if (!ded.solved || ded.maxTier > GATE_TIER[difficulty]) return false;
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

/**
 * How far a `hard` what-if may run: assume one cell, and the contradiction has
 * to land within this many forced cells. The bound exists because the hint
 * layer has to be able to say *why* a probe breaks, and an argument that traces
 * a dozen cells is not a sentence anybody can check.
 *
 * Measured over 30 seeds per size, a cap of 4 accepts 13% / 7% / 10% of
 * otherwise-valid hard candidates at 8x8 / 10x10 / 12x12 — costly but flat in
 * board size, which is why `hard` can still climb. Relaxing it to 8 would
 * accept ~40%, at the price of what a hint can put into one sentence.
 */
export const HARD_PROBE_CAP = 4;

/**
 * Does this puzzle's probing stay inside what a hint can explain?
 *
 * Only `hard` is bounded. `easy`/`medium` never probe (their ceiling forbids
 * it), and `expert` is the tier that deliberately asks for what-ifs a human has
 * to grind — bounding it would erase the difference between the two.
 *
 * Kept out of `satisfiesDifficulty` on purpose: that one reads a finished
 * `DeduceResult` and is cheap enough for any caller, while this re-propagates
 * the board once per probe. It belongs at the single final acceptance point,
 * never in the minimize loop.
 */
export function withinProbeBudget(difficulty: Difficulty, model: Model, deadline = Infinity): boolean {
  if (difficulty !== 'hard') return true;
  const walk = probeWalk(model, { cap: HARD_PROBE_CAP, deadline });
  if (walk.abandoned || walk.worst > HARD_PROBE_CAP) return false;
  // `satisfiesDifficulty` counts probe steps off the greedy log, which fires
  // what-ifs on cells the cheap rules were about to hand over anyway. Requiring
  // the interleaved walk to spend one too is what makes "hard" mean the player
  // has to reason hypothetically, not that the solver felt like it.
  return walk.probes > 0;
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
    if (performance.now() > deadline) break; // a timed-out attempt is never accepted

    // 1. Random separated layout → answer.
    opts.observer?.onPhase?.('placing-shapes');
    const answer = placeShapes(cols, rows, bank, rng, { pieceCount: opts.pieceCount });
    if (answer === null) continue; // wedged; retry with fresh randomness

    // 2. Maximal legal clue set.
    const maxClues = deriveMaximalClues(cols, rows, answer.shaded);
    const maxPuzzle: Puzzle = { cols, rows, clues: maxClues, bank, transparent: false };

    // 3. Ceiling check at maximal clues: must solve uniquely to the answer and
    //    deduce-solve within the difficulty cap. If even the fullest clue set
    //    overshoots the ceiling, this layout is hopeless — new layout.
    opts.observer?.onPhase?.('checking-uniqueness');
    const maxModel = timed(() => buildModel(maxPuzzle), (ms) => opts.observer?.onModelBuilt?.(ms));
    const maxSolve = timed(
      () => solveModel(maxModel, { maxSolutions: 2, nodeCap: NODE_CAP }),
      (ms) => opts.observer?.onSolve?.(ms),
    );
    if (maxSolve.capped || maxSolve.solutions.length !== 1 || !sameSolution(maxSolve.solutions[0]!, answer)) continue;
    const maxDed = timed(() => deduceModel(maxModel), (ms) => opts.observer?.onDeduce?.(ms));
    if (!maxDed.solved || maxDed.maxTier > gateTier) continue;

    // 4. Minimize to a fixed point. A deadline abandons this candidate.
    opts.observer?.onPhase?.('minimizing');
    let puzzle: Puzzle;
    try {
      puzzle = minimizeClues(maxPuzzle, answer, rng, {
        maxTier: gateTier, nodeCap: NODE_CAP, deadline, observer: opts.observer, flowProfile: opts.flowProfile,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('minimizeClues: deadline exceeded')) continue;
      throw error;
    }

    // 5/6. Solve first, then deduce, from one immutable compiled model.
    if (!validate(puzzle, answer).ok) continue;
    const finalModel = timed(() => buildModel(puzzle), (ms) => opts.observer?.onModelBuilt?.(ms));
    const finalSolve = timed(
      () => solveModel(finalModel, { maxSolutions: 2, nodeCap: NODE_CAP }),
      (ms) => opts.observer?.onSolve?.(ms),
    );
    if (finalSolve.capped || finalSolve.solutions.length !== 1 || !sameSolution(finalSolve.solutions[0]!, answer)) continue;
    const ded = timed(() => deduceModel(finalModel), (ms) => opts.observer?.onDeduce?.(ms));
    if (!satisfiesDifficulty(difficulty, ded, cols, rows)) continue;
    if (!withinProbeBudget(difficulty, finalModel, deadline)) continue;

    const url = encodeUrl(puzzle);
    const reDecoded = decodeUrl(url);
    const codecModel = timed(() => buildModel(reDecoded), (ms) => opts.observer?.onModelBuilt?.(ms, 'codec'));
    const reSolve = timed(
      () => solveModel(codecModel, { maxSolutions: 2, nodeCap: NODE_CAP }),
      (ms) => opts.observer?.onSolve?.(ms, 'codec'),
    );
    if (reSolve.capped || reSolve.solutions.length !== 1 || !sameSolution(reSolve.solutions[0]!, answer)) continue;
    if (performance.now() > deadline) continue;

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

/** Generate one independently seeded tournament candidate. Candidate zero is byte-stable legacy generation. */
export function generateRatedCandidate(opts: GenerateOptions, candidateIndex: number): RatedCandidate {
  const seed = candidateSeed(opts.seed, candidateIndex);
  const result = generatePuzzle({ ...opts, seed });
  return { ...result, candidateIndex, signature: signatureOf(result, opts.observer) };
}
