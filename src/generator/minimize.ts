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
import { dirBit, Dir, NO_CLUE } from '../core/types';
import { solveModel } from '../solver/search';
import { deduceModel } from '../solver/deduce';
import { buildModel } from '../solver/model';
import { shuffle } from './rng';
import type { GenerationObserver } from './generate';
import type { FlowProfile } from './flow';

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
}

const arrowCount = (mask: number): number =>
  (mask & 1) + ((mask >>> 1) & 1) + ((mask >>> 2) & 1) + ((mask >>> 3) & 1);

function tieDistance(puzzle: Puzzle, answer: Solution, clue: number): number {
  const x = clue % puzzle.cols, y = Math.floor(clue / puzzle.cols), mask = puzzle.clues[clue]!;
  const directions: readonly [number, number, Dir][] = [[0, -1, Dir.Up], [0, 1, Dir.Down], [-1, 0, Dir.Left], [1, 0, Dir.Right]];
  for (const [dx, dy, dir] of directions) if ((mask & dirBit(dir)) !== 0) {
    for (let distance = 1;; distance++) {
      const xx = x + dx * distance, yy = y + dy * distance;
      if (xx < 0 || yy < 0 || xx >= puzzle.cols || yy >= puzzle.rows) break;
      if (answer.shaded[yy * puzzle.cols + xx]) return distance;
    }
  }
  return 0;
}

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

function sameSolution(a: Solution, b: Solution): boolean {
  const x = a.shaded;
  const y = b.shaded;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

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

  let removed: boolean;
  do {
    removed = false;
    for (const pos of positions) {
      if (clues[pos] === NO_CLUE) continue;
      if (gates.deadline !== undefined && performance.now() > gates.deadline) {
        throw new Error('minimizeClues: deadline exceeded before local minimality fixed point');
      }

    const saved = clues[pos]!;
    clues[pos] = NO_CLUE;
    const candidate: Puzzle = { ...puzzle, clues };

    // Gate (a): uniquely solvable, and that unique solution is the answer.
    // A capped search proves nothing — "found 1 so far" when the node cap
    // cut the search short must never count as unique, or an ambiguous
    // puzzle slips through the gate.
    const modelStart = performance.now();
    const model = buildModel(candidate);
    gates.observer?.onModelBuilt?.(performance.now() - modelStart);
    const solveStart = performance.now();
    const res = solveModel(model, { maxSolutions: 2, nodeCap });
    gates.observer?.onSolve?.(performance.now() - solveStart);
    let keep =
      !res.capped && res.solutions.length === 1 && sameSolution(res.solutions[0]!, answer);

    // Gate (b): guess-free human-solvable, within the tier cap when specified.
    if (keep) {
      const deduceStart = performance.now();
      const d = deduceModel(model);
      gates.observer?.onDeduce?.(performance.now() - deduceStart);
      keep = d.solved && (gates.maxTier === undefined || d.maxTier <= gates.maxTier);
    }

      gates.observer?.onRemoval?.(keep);
      if (keep) removed = true;
      else clues[pos] = saved; // restore — this clue is load-bearing
    }
  } while (removed);

  return { ...puzzle, clues };
}
