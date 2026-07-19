/**
 * Learning-mode "Hint" logic (pure, no DOM — app.ts wires this to the UI).
 *
 * `computeHint` never mutates `cellState` and never auto-applies a cell: it
 * only *tells* the player what to do next, in the order a human tutor would:
 *
 *  1. If the puzzle itself isn't uniquely solvable (shouldn't happen for a
 *     generated puzzle, but the player accepts arbitrary pasted URLs), say so.
 *  2. Point out any mistake already on the board (fixing errors before new
 *     information is the teaching-correct order).
 *  3. Otherwise walk the human-style deducer's step log (`solver/deduce.ts`)
 *     for the first step that still has something new to tell the player.
 *  4. If the deducer's steps are exhausted but cells remain undecided
 *     (probe-heavy boards), fall back to the (memoized) unique solution for
 *     one more cell — honest, if less pedagogical.
 *  5. If nothing is left to say, the board is correct so far.
 *
 * Solving `puzzle` (`solve`) and deducing it (`deduce`) are both re-run at
 * most once per distinct puzzle: results are memoized in a module-level Map
 * keyed by the puzzle's canonical share-URL string (`encodeUrl`), since the
 * player may click "Hint" repeatedly on the same board.
 *
 * Cell-reference convention: `ref()` below prints `r<row>c<col>` **1-indexed**
 * for humans. Note this differs from `solver/deduce.ts`'s `explainSteps`,
 * which prints the same references 0-indexed for its (developer-facing) log.
 */

import { encodeUrl } from '../core/codec/url';
import { NO_CLUE } from '../core/types';
import type { Puzzle, Solution } from '../core/types';
import { solve } from '../solver/search';
import type { SolveResult } from '../solver/search';
import { deduce } from '../solver/deduce';
import type { DeduceResult } from '../solver/deduce';
import type { RuleId, Step } from '../solver/propagate';
import { SHADED, MARKED_EMPTY, UNTOUCHED } from './state';

export interface Hint {
  readonly kind: 'error' | 'shade' | 'exclude' | 'solved' | 'stuck';
  /** Cell indices to highlight (row-major). A hint focuses on one cell at a time (`error`/`shade`/`exclude` return exactly one); `solved`/`stuck` return none. */
  readonly cells: number[];
  readonly message: string;
}

interface CacheEntry {
  readonly solveResult: SolveResult;
  /** Present only when `solveResult` found exactly one solution (deducing an ambiguous/unsolvable puzzle is meaningless here). */
  readonly deduceResult: DeduceResult | null;
}

/** Solve+deduce cache, keyed by the puzzle's canonical share-URL string. Exported read-only for tests that want to confirm a repeat call doesn't re-solve. */
const cache = new Map<string, CacheEntry>();

/** Test-only: current number of distinct puzzles memoized (never re-solved on a repeat `computeHint` call for the same puzzle). */
export function _hintCacheSizeForTests(): number {
  return cache.size;
}

function getCacheEntry(puzzle: Puzzle): CacheEntry {
  const key = encodeUrl(puzzle);
  let entry = cache.get(key);
  if (!entry) {
    const solveResult = solve(puzzle, { maxSolutions: 2 });
    const unique = solveResult.solutions.length === 1 && solveResult.complete;
    const deduceResult = unique ? deduce(puzzle) : null;
    entry = { solveResult, deduceResult };
    cache.set(key, entry);
  }
  return entry;
}

/** `r<row>c<col>`, 1-indexed for humans (see file header — internal cell math elsewhere in the codebase is 0-indexed). */
function ref(i: number, cols: number): string {
  const row = Math.floor(i / cols) + 1;
  const col = (i % cols) + 1;
  return `r${row}c${col}`;
}

/** Pull a `r<row>c<col>` reference out of a step's `detail` string via `re` (whose first capture group is the 0-indexed cell index), or null if it doesn't match. */
function refFromDetail(detail: string | undefined, re: RegExp, cols: number): string | null {
  if (!detail) return null;
  const m = detail.match(re);
  if (!m) return null;
  return ref(Number(m[1]), cols);
}

/** Mirrors deduce.ts's own fallback map, for the (currently always-absent-in-practice) case a Step omits `kind`. */
const SHADE_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['arrow-forced-shade', 'forced-placement']);

function stepKind(step: Step): 'shade' | 'exclude' {
  return step.kind ?? (SHADE_RULES.has(step.rule) ? 'shade' : 'exclude');
}

/**
 * Turn a probe step's raw inner-contradiction reason (the tail of its `detail`,
 * e.g. `clue 27: arrowed ray Down cannot reach pinned tie 3`) into a
 * player-facing clause that names the concrete clue/cell the what-if breaks —
 * the useful "which piece/clue" link, not just "it contradicts". Indices in the
 * reason are 0-indexed flat cell numbers, rendered here as 1-indexed refs.
 * Falls back to a generic clause when the reason matches no known shape.
 */
function humanizeContradiction(reason: string | undefined, cols: number): string {
  if (!reason) return 'the board can no longer be completed';

  // Clue contradictions (tie-distance and per-clue candidate rules): name the
  // clue, and its arrow direction when the reason mentions one. Covers every
  // `clue N: …` reason those rules emit.
  let m = reason.match(/clue (\d+):.*arrowed ray (\w+)/);
  if (m) return `the clue at ${ref(Number(m[1]), cols)} could no longer satisfy its ${m[2]!.toLowerCase()} arrow`;
  m = reason.match(/clue (\d+):/);
  if (m) return `the clue at ${ref(Number(m[1]), cols)} could no longer be satisfied`;

  // A shaded cell no remaining piece can complete.
  m = reason.match(/shaded cell (\d+) cannot be covered/);
  if (m) return `the shaded cell at ${ref(Number(m[1]), cols)} could not be completed by any remaining piece`;

  // A nested probe left some cell with no legal value.
  m = reason.match(/cell (\d+): both shading and leaving it unshaded/);
  if (m) return `the cell at ${ref(Number(m[1]), cols)} would be left with no legal value`;

  if (/both shaded and excluded/.test(reason)) return 'a cell would have to be both filled and empty';

  return 'the board can no longer be completed';
}

/**
 * Beginner-friendly one-liner for `step`, adapted from `explainSteps`'
 * per-rule phrasing. `primaryCell` is the first still-undecided cell of the
 * step (the one actually highlighted); some rules also reference a *second*
 * cell recovered from the step's `detail` (e.g. the clue that pinned a tie,
 * or the already-shaded cell that forced a placement) when available.
 */
function buildStepMessage(step: Step, kind: 'shade' | 'exclude', primaryCell: number, cols: number): string {
  const primary = ref(primaryCell, cols);
  switch (step.rule) {
    case 'clue-cell-exclusion':
      // In practice never reached (see findDeduceHint — clue cells are UI-inert,
      // so they never count as "undecided"); kept for completeness/documentation.
      return `Cells with arrows are never part of a shape — mark ${primary} empty.`;
    case 'no-touch-halo':
      return `Shapes can't touch, not even diagonally — ${primary}, next to a placed shape, must stay empty.`;
    case 'arrow-distance-bounds': {
      const clueRef = refFromDetail(step.detail, /clue (\d+)/, cols) ?? primary;
      return `The arrows at ${clueRef} point to the nearest shape. Cells closer than that (or in unmarked directions at that distance) must be empty — mark ${primary} empty.`;
    }
    case 'arrow-forced-shade': {
      const clueRef = refFromDetail(step.detail, /clue (\d+)/, cols) ?? primary;
      return `The clue at ${clueRef} must reach its nearest shape at one fixed distance in every arrowed direction — ${primary} is the only cell its arrows can still land on, so it must be shaded.`;
    }
    case 'forced-placement': {
      const shadedRef = refFromDetail(step.detail, /^cell (\d+)/, cols) ?? primary;
      return `Only one piece can cover the shaded cell at ${shadedRef} — complete it by shading ${primary}.`;
    }
    case 'cover-analysis':
      return kind === 'shade'
        ? `Every possible piece covering a shaded cell also covers ${primary} — shade it.`
        : `No piece can reach ${primary} — mark it empty.`;
    case 'clue-candidate': {
      const clueRef = refFromDetail(step.detail, /clue (\d+)/, cols) ?? primary;
      return kind === 'shade'
        ? `Only a few pieces can satisfy the arrows at ${clueRef} — all of them cover ${primary}, so it must be shaded.`
        : `Only a few pieces can satisfy the arrows at ${clueRef} — all of them leave ${primary} as empty border, so mark it empty.`;
    }
    case 'probe-forcing':
    case 'probe-forcing-2': {
      const reason = step.detail?.match(/contradiction \(depth \d+\): (.+)$/)?.[1];
      const because = humanizeContradiction(reason, cols);
      return kind === 'exclude'
        ? `Look ahead: if ${primary} were shaded, ${because} — so ${primary} must stay empty.`
        : `Look ahead: if ${primary} stays empty, ${because} — so ${primary} must be shaded.`;
    }
    case 'placement-filtering':
    default:
      return kind === 'shade' ? `Deduction: ${primary} must be shaded.` : `Deduction: ${primary} must stay empty.`;
  }
}

/** Clue (and HATENA) cells are inert in the UI — the player can never shade or mark them — so they're never a meaningful hint target. */
function isActionable(puzzle: Puzzle, cell: number): boolean {
  return puzzle.clues[cell] === NO_CLUE;
}

/** The first cell the player SHADED that the solution leaves unshaded, or MARKED_EMPTY that the solution shades. A hint points at one cell at a time, so we stop at the first offender and key the message off its error type. */
function findErrorHint(cellState: Uint8Array, solution: Solution, cols: number): Hint | null {
  for (let i = 0; i < cellState.length; i++) {
    const wronglyShaded = cellState[i] === SHADED && solution.shaded[i] !== 1;
    const wronglyMarked = cellState[i] === MARKED_EMPTY && solution.shaded[i] === 1;
    if (!wronglyShaded && !wronglyMarked) continue;
    const primary = ref(i, cols);
    const message = wronglyShaded
      ? `Something's off: ${primary} shouldn't be shaded — no shape covers it, so it should stay empty.`
      : `Something's off: ${primary} shouldn't have been marked empty — it's actually part of a shape, so it should be shaded.`;
    return { kind: 'error', cells: [i], message };
  }
  return null;
}

/**
 * Walk the deducer's step log in order for the first step that still has
 * something new to say to the player: at least one of its cells is
 * "undecided" (shade-kind: not already SHADED; exclude-kind: not already
 * MARKED_EMPTY) *and* actionable (not a clue cell). `placement-filtering`
 * never actually emits a step, but is skipped explicitly as documented
 * bookkeeping regardless.
 */
function findDeduceHint(puzzle: Puzzle, deduceResult: DeduceResult, cellState: Uint8Array, cols: number): Hint | null {
  for (const step of deduceResult.steps) {
    if (step.rule === 'placement-filtering') continue;
    const kind = stepKind(step);
    const undecided = step.cells.filter((c) => {
      if (!isActionable(puzzle, c)) return false;
      return kind === 'shade' ? cellState[c] !== SHADED : cellState[c] !== MARKED_EMPTY;
    });
    if (undecided.length === 0) continue;
    const cells = undecided.slice(0, 1);
    const message = buildStepMessage(step, kind, cells[0]!, cols);
    return { kind, cells, message };
  }
  return null;
}

/**
 * Compute the next hint for `puzzle` given the player's current `cellState`
 * (see `ui/state.ts` for cell-value semantics). Pure and side-effect free
 * apart from the module-level solve/deduce memoization cache. Returns `null`
 * only on malformed input (a `cellState` that doesn't match the puzzle's
 * cell count) — every other case returns a `Hint`, see the priority order in
 * the file header.
 */
export function computeHint(puzzle: Puzzle, cellState: Uint8Array): Hint | null {
  if (cellState.length !== puzzle.cols * puzzle.rows) return null;

  const { solveResult, deduceResult } = getCacheEntry(puzzle);
  const unique = solveResult.solutions.length === 1 && solveResult.complete;
  if (!unique) {
    return {
      kind: 'stuck',
      cells: [],
      message: "This puzzle doesn't have a unique solution — hints unavailable.",
    };
  }
  const solution = solveResult.solutions[0]!;
  const cols = puzzle.cols;

  const errorHint = findErrorHint(cellState, solution, cols);
  if (errorHint) return errorHint;

  const deduceHint = findDeduceHint(puzzle, deduceResult!, cellState, cols);
  if (deduceHint) return deduceHint;

  // Deducer exhausted; fall back to the unique solution for one more cell.
  for (let i = 0; i < cellState.length; i++) {
    if (!isActionable(puzzle, i)) continue;
    if (cellState[i] !== UNTOUCHED) continue;
    const kind: 'shade' | 'exclude' = solution.shaded[i] === 1 ? 'shade' : 'exclude';
    const message =
      kind === 'shade' ? `Deduction: ${ref(i, cols)} is part of a shape.` : `Deduction: ${ref(i, cols)} must stay empty.`;
    return { kind, cells: [i], message };
  }

  return { kind: 'solved', cells: [], message: 'Everything so far is correct — the board is solved!' };
}
