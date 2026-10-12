/**
 * Greedy clue minimizer (roadmap §5.3). Shuffles the clue positions and, for
 * each, tentatively removes its clue — keeping the removal iff the puzzle
 * remains BOTH:
 *   (a) uniquely solvable (complete solver, early-exit at 2 solutions), and
 *   (b) guess-free human-solvable (`deduce()` resolves every cell), within an
 *       optional deduction-tier cap.
 * Otherwise the clue is restored. The result is locally minimal for those gates.
 *
 * Correctness note (roadmap §5.3): removing a clue from a *cell* makes that cell
 * shadeable in principle for OTHER solutions (in non-transparent mode a clue
 * cell excludes itself). `solve()` accounts for this automatically — the clue
 * grid is part of the puzzle model — so there is no monotonicity to exploit and
 * no special handling needed. Because the answer only ever satisfies *more*
 * clues than the candidate, it always remains a valid solution; hence if the
 * candidate is uniquely solvable, that unique solution must equal the answer.
 */

import type { Puzzle, Solution } from '../core/types';
import { NO_CLUE } from '../core/types';
import { solveModel } from '../solver/search';
import { deduceModel, TIER } from '../solver/deduce';
import { buildModel } from '../solver/model';
import { approxFirstProbe, probeWalk } from '../solver/walk';
import { shuffle } from './rng';
import { timed } from './observe';
import type { GenerationObserver } from './generate';
import { tieDistance, type FlowProfile } from './flow';

export interface MinimizeGates {
  /** Cap on `deduce().maxTier` — a removal is kept only if the result stays at or below it. */
  readonly maxTier?: number;
  /** `nodeCap` handed to every internal `solve()` call (bounds worst case). Default 200_000. */
  readonly nodeCap?: number;
  /**
   * A `performance.now()` timestamp. Checked before each candidate removal;
   * once passed, minimization throws so its caller abandons this candidate;
   * it never returns a partially minimized clue set. Exists because depth-2
   * `probe-forcing-2` deduce() calls are O(cells² × propagation). Default:
   * unbounded (no deadline).
   */
  readonly deadline?: number;
  readonly observer?: GenerationObserver;
  /** Optional deterministic first-pass bias; correctness gates stay identical. */
  readonly flowProfile?: FlowProfile;
  /**
   * `'narrow'`: try removing first the clues that give the most away on an
   * empty board — the ones with the most in-board neighbours on arrow-less
   * sides, each of which is empty the moment the clue is read. See
   * `GenerateOptions.opening`. Overrides `flowProfile`'s order, which is left
   * to break ties. Correctness gates stay identical.
   */
  readonly opening?: 'narrow';
  /**
   * Grade gate (b) as if the bank were unlimited (default `false`); see
   * `DeduceOptions.ignoreBank`. Gate (a) always proves uniqueness under the
   * real bank.
   */
  readonly ignoreBank?: boolean;
  /**
   * In-loop probe-chain budget (default: off). After a removal passes the
   * other gates, if the deduction used a `probe-forcing` step (`maxTier >= 6`,
   * the only way a what-if enters a board), run `probeWalk(model, { cap })` on
   * the model the gate just built and restore the clue unless the walk
   * finished with every chain at most `probeCap` long. That is the check
   * `generatePuzzle` makes on the finished board (`withinProbeBudget`), moved
   * in front of every removal so minimization does not walk past the budget and
   * get the whole candidate thrown away at the end. The final check stays, and
   * still catches boards the loop never walked (a maximal clue set nothing could
   * be removed from, or a board with no what-if at all).
   *
   * A walk the `deadline` cuts short is an abandoned walk and counts as a
   * refusal like any other, but the deadline is then past, so this throws the
   * same error the loop throws up front instead of restoring: a clue kept only
   * because the clock ran out would end a round with the set not locally
   * minimal, and the caller abandons the candidate either way.
   */
  readonly probeCap?: number;
  /**
   * In-loop first-what-if position gate (default: off). After a removal passes
   * the other gates, if its deduction used a `probe-forcing` step, restore the
   * clue unless the board's first-what-if share (`approxFirstProbe` off the
   * gate's own deduction log, which equals `probeWalk().firstProbeAt`) lies
   * inside `[lo, hi]`. A removal that leaves the board without a what-if is
   * never gated, so a minimization can end without one; the caller's floor
   * rejects that board. See `GenerateOptions.firstProbeWindow`.
   */
  readonly firstProbeWindow?: FirstProbeWindow;
}

/** A closed interval on `probeWalk().firstProbeAt` (both ends inclusive). */
export interface FirstProbeWindow {
  readonly lo: number;
  readonly hi: number;
}

const arrowCount = (mask: number): number =>
  (mask & 1) + ((mask >>> 1) & 1) + ((mask >>> 2) & 1) + ((mask >>> 3) & 1);

/** Order removals to make alternate local minima express the requested flow. */
export function prioritizeClueRemovals(
  positions: number[],
  puzzle: Puzzle,
  answer: Solution,
  profile?: FlowProfile,
): void {
  if (!profile) return;
  const centreX = (puzzle.cols - 1) / 2, centreY = (puzzle.rows - 1) / 2;
  const priority = (cell: number): number => {
    if (profile === 'crossfire') return arrowCount(puzzle.clues[cell]!);
    if (profile === 'long-range') return tieDistance(puzzle, answer, cell);
    if (profile === 'shape-chain') return -arrowCount(puzzle.clues[cell]!);
    return Math.hypot(cell % puzzle.cols - centreX, Math.floor(cell / puzzle.cols) - centreY);
  };
  positions.sort((a, b) => priority(a) - priority(b));
}

export function sameSolution(a: Solution, b: Solution): boolean {
  const x = a.shaded;
  const y = b.shaded;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

const DEADLINE_EXCEEDED = 'minimizeClues: deadline exceeded before local minimality fixed point';

export function minimizeClues(
  puzzle: Puzzle,
  answer: Solution,
  rng: () => number,
  gates: MinimizeGates,
): Puzzle {
  const nodeCap = gates.nodeCap ?? 200_000;
  const clues = puzzle.clues.slice(); // mutable working copy

  const positions: number[] = [];
  for (let i = 0; i < clues.length; i++) if (clues[i] !== NO_CLUE) positions.push(i);
  shuffle(positions, rng);
  prioritizeClueRemovals(positions, puzzle, answer, gates.flowProfile);
  if (gates.opening === 'narrow') {
    const giveaway = (cell: number): number => {
      const x = cell % puzzle.cols, y = Math.floor(cell / puzzle.cols), mask = puzzle.clues[cell]!;
      let n = 0;
      if (!(mask & 1) && y > 0) n++;
      if (!(mask & 2) && y < puzzle.rows - 1) n++;
      if (!(mask & 4) && x > 0) n++;
      if (!(mask & 8) && x < puzzle.cols - 1) n++;
      return n;
    };
    positions.sort((a, b) => giveaway(b) - giveaway(a)); // stable: the profile order breaks ties
  }

  let removed: boolean;
  do {
    removed = false;
    for (const pos of positions) {
      if (clues[pos] === NO_CLUE) continue;
      if (gates.deadline !== undefined && performance.now() > gates.deadline) throw new Error(DEADLINE_EXCEEDED);

      const saved = clues[pos]!;
      clues[pos] = NO_CLUE;
      const candidate: Puzzle = { ...puzzle, clues };

      // Gate (a): uniquely solvable, and that unique solution is the answer.
      // A capped search proves nothing — "found 1 so far" when the node cap
      // cut the search short must never count as unique, or an ambiguous
      // puzzle slips through the gate.
      const model = timed(() => buildModel(candidate), (ms) => gates.observer?.onModelBuilt?.(ms));
      const res = timed(() => solveModel(model, { maxSolutions: 2, nodeCap }), (ms) => gates.observer?.onSolve?.(ms));
      let keep =
        !res.capped && res.solutions.length === 1 && sameSolution(res.solutions[0]!, answer);

      // Gate (b): guess-free human-solvable, within the tier cap when specified.
      let maxTierUsed = 0; // of the gate's deduction; stays 0 when it never ran
      if (keep) {
        const d = timed(() => deduceModel(model, { ignoreBank: gates.ignoreBank }), (ms) => gates.observer?.onDeduce?.(ms));
        maxTierUsed = d.maxTier;
        keep = d.solved && (gates.maxTier === undefined || d.maxTier <= gates.maxTier);
        // Free off the deduction log, so it runs before the probe walk and
        // spares the walk on every removal it refuses.
        if (keep && gates.firstProbeWindow && d.maxTier >= TIER['probe-forcing']) {
          const at = approxFirstProbe(model, d.steps);
          keep = at !== null && at >= gates.firstProbeWindow.lo && at <= gates.firstProbeWindow.hi;
        }
      }

      // Probe-chain budget, last because it is the dearest gate: only a deduction
      // that used a what-if can have a chain, and `probeWalk` re-propagates once
      // per probe. Reuses the model built above.
      if (keep && gates.probeCap !== undefined && maxTierUsed >= TIER['probe-forcing']) {
        const walk = probeWalk(model, { cap: gates.probeCap, deadline: gates.deadline });
        if (walk.abandoned || walk.worst > gates.probeCap) {
          if (gates.deadline !== undefined && performance.now() > gates.deadline) throw new Error(DEADLINE_EXCEEDED);
          keep = false;
        }
      }

      gates.observer?.onRemoval?.(keep);
      if (keep) removed = true;
      else clues[pos] = saved; // restore — this clue is load-bearing
    }
  } while (removed);

  return { ...puzzle, clues };
}
