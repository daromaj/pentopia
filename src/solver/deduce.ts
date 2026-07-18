/**
 * Human-style deduction engine (roadmap §Phase 4 / format §5).
 *
 * `deduce` is a THIN SHELL over the shared constraint engine in propagate.ts:
 * it builds the model, seeds an empty state, and runs `propagateToFixpoint`
 * exactly ONCE (that function already loops every §5 rule to a fixed point with
 * zero branching). It then classifies the outcome and tags each emitted step
 * with a difficulty tier — the currency the Phase-5 generator uses to rate a
 * puzzle. It never branches, never guesses, and duplicates none of the
 * constraint logic: everything decided here is decided by propagate.ts.
 *
 * A note on completeness (measured, see test/deduce.test.ts): the propagators
 * are now strong enough to fully solve real published puzzles from an empty
 * board. The keystone is the arrow ray-length cap (propagate.ts): every arrowed
 * ray must hit a shaded cell within the board, so the tie distance is bounded
 * above from an empty board, which lets ties pin and shades appear; those feed
 * cross-placement `cover-analysis`, the positive/negative rules, and finally
 * `probe-forcing` (failed-literal "what-if" analysis) in a loop until the board
 * is decided. `deduce()` remains sound — every cell it decides matches the
 * unique solution (a probe only forces a value whose negation a *sound*
 * propagator refuted),
 * the property the generator relies on. All constraint logic lives in
 * propagate.ts; this file adds none (it only tiers the emitted steps).
 */

import type { Puzzle, Solution } from '../core/types';
import { validate } from '../core/validator';
import { buildModel } from './model';
import { initState, unknownCells } from './state';
import { propagateToFixpoint, type RuleId, type Step } from './propagate';

export interface DeduceResult {
  /** True iff the board is fully solved by pure propagation (see §soundness). */
  readonly solved: boolean;
  /** The solution when `solved`; otherwise `null`. */
  readonly solution: Solution | null;
  /** Every deduction the propagators emitted, in application order. */
  readonly steps: Step[];
  /** Cells still neither shaded nor excluded after propagation. */
  readonly unresolved: number;
  /** Highest tier over emitted steps (0 when nothing was emitted). */
  readonly maxTier: number;
  /** Count of emitted steps per rule. */
  readonly tierHistogram: Record<RuleId, number>;
  /** Present iff propagation reported a contradiction; the human-readable reason. */
  readonly contradiction?: string;
}

/**
 * Difficulty tier per rule — the generator's difficulty currency. Higher = a
 * deduction a human finds harder / later. `placement-filtering` is internal
 * bookkeeping (it emits no step, so it never actually reaches the histogram),
 * but is tiered so `TIER` totals over `RuleId`.
 */
export const TIER: Record<RuleId, number> = {
  'clue-cell-exclusion': 0,
  'no-touch-halo': 1,
  'placement-filtering': 1,
  'arrow-distance-bounds': 2,
  'arrow-forced-shade': 3,
  'forced-placement': 4,
  'cover-analysis': 5,
  'probe-forcing': 6,
};

/**
 * Rules whose steps *shade* cells (the rest *exclude*), used by explainSteps as
 * a fallback. `cover-analysis` does both, so its steps carry an explicit
 * `kind`; a step's own `kind` always wins over this map when present.
 */
const SHADE_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['arrow-forced-shade', 'forced-placement']);

function emptyHistogram(): Record<RuleId, number> {
  return {
    'clue-cell-exclusion': 0,
    'no-touch-halo': 0,
    'placement-filtering': 0,
    'arrow-distance-bounds': 0,
    'arrow-forced-shade': 0,
    'forced-placement': 0,
    'cover-analysis': 0,
    'probe-forcing': 0,
  };
}

/**
 * Run the shared propagators once to a fixed point and report the outcome.
 * Pure function of `puzzle`: it is deterministic, so calling it twice yields
 * identical `steps`.
 */
export function deduce(puzzle: Puzzle): DeduceResult {
  const model = buildModel(puzzle);
  const state = initState(model);
  // The deducer runs the full engine including the expensive `cover-analysis`
  // and `probe-forcing` rules (search leaves probing off to stay fast).
  const result = propagateToFixpoint(model, state, { coverAnalysis: true, probe: true });
  const steps = result.steps;

  const tierHistogram = emptyHistogram();
  let maxTier = 0;
  for (const step of steps) {
    tierHistogram[step.rule] += 1;
    if (TIER[step.rule] > maxTier) maxTier = TIER[step.rule];
  }

  const unresolved = unknownCells(model, state).popcount();

  if (result.status === 'contradiction') {
    // A contradiction on a well-formed puzzle means this candidate can't be
    // completed — the generator treats that as a broken candidate.
    return {
      solved: false,
      solution: null,
      steps,
      unresolved,
      maxTier,
      tierHistogram,
      contradiction: result.reason,
    };
  }

  const solution = solutionFromState(model.cols * model.rows, state);

  // Solved iff: no unknown cells remain, every shaded cell is covered by a
  // committed placement, and the full validator agrees.
  const free = state.shaded.clone();
  free.andNotAssign(state.committedCells);
  const solved = unresolved === 0 && free.isEmpty() && validate(puzzle, solution).ok;

  return {
    solved,
    solution: solved ? solution : null,
    steps,
    unresolved,
    maxTier,
    tierHistogram,
  };
}

function solutionFromState(n: number, state: { shaded: { forEach(cb: (i: number) => void): void } }): Solution {
  const shaded = new Uint8Array(n);
  state.shaded.forEach((i) => {
    shaded[i] = 1;
  });
  return { shaded };
}

/**
 * Human-readable one-liners for the future UI hint system. Each step becomes a
 * single line using `r<row>c<col>` cell references (0-based, from the flat cell
 * index and `cols`), e.g.
 *   `[arrow-forced-shade] clue r1c4: tie pinned at 2 -> shade r3c4`
 * Kept deliberately simple: it reuses each step's own `detail` and just tags
 * the rule, humanizes any `clue <index>` reference, and lists the cells with
 * the right verb (shade vs exclude).
 */
export function explainSteps(steps: Step[], cols: number): string[] {
  const ref = (i: number): string => `r${Math.floor(i / cols)}c${i % cols}`;
  return steps.map((step) => {
    const verb = step.kind ?? (SHADE_RULES.has(step.rule) ? 'shade' : 'exclude');
    const cells = step.cells.map(ref).join(', ');
    const detail = (step.detail ?? step.rule).replace(/clue (\d+)/g, (_m, n: string) => `clue ${ref(Number(n))}`);
    return `[${step.rule}] ${detail} -> ${verb} ${cells}`;
  });
}
