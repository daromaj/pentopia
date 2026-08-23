/**
 * Complete DFS solver (roadmap §4 "Search"). Enumerates every solution, with
 * early-exit once `maxSolutions` (default 2, for uniqueness testing) is found.
 * Runs the shared propagators (propagate.ts) to a fixed point at every node;
 * branching is the only search — the propagators do the deduction.
 *
 * BRANCHING SCHEME (provably complete; see the report):
 *  1. If a *free* shaded cell exists (shaded but not yet covered by a committed
 *     placement), it MUST be covered by exactly one piece. Branch over the
 *     alive placements covering it — these alternatives are exhaustive (there
 *     is no "leave it uncovered" branch), so this is complete. Propagation has
 *     already committed the case of a single covering placement, so here there
 *     are ≥2. This is the tight, placement-level branch (roadmap MRV variant b).
 *  2. Otherwise pick an unknown cell (neither shaded nor excluded) and branch
 *     shade-vs-exclude — a complete binary split. Cell choice is an MRV
 *     heuristic (the most constrained arrow clue's nearest feasible hit),
 *     which only affects speed, not correctness.
 *  3. Otherwise the board is fully decided and every shaded cell is committed:
 *     a candidate. `validate()` is the final gate (guards any propagator
 *     soundness gap) before the solution is recorded.
 */

import type { Puzzle, Solution } from '../core/types';
import { validate } from '../core/validator';
import { buildModel, type Model } from './model';
import {
  cloneState,
  commitPlacement,
  freeShaded,
  initState,
  unknownCells,
  type SolveState,
} from './state';
import { propagateToFixpoint } from './propagate';

export interface SolveResult {
  readonly solutions: Solution[];
  readonly nodes: number;
  /** True iff the whole search space was explored (not cut off by maxSolutions or the node cap). */
  readonly complete: boolean;
  /** True iff the node cap was hit (search abandoned mid-way). */
  readonly capped: boolean;
}

export interface SolveOptions {
  /** Stop after this many solutions (default 2). */
  readonly maxSolutions?: number;
  /** Abort after this many search nodes (default 1e6). */
  readonly nodeCap?: number;
}

interface SearchCtx {
  readonly model: Model;
  readonly solutions: Solution[];
  readonly sigs: Set<string>;
  readonly maxSolutions: number;
  readonly nodeCap: number;
  nodes: number;
  capped: boolean;
  stopped: boolean;
}

/**
 * MRV branch-cell selection for case 2. Prefer the nearest still-unknown cell
 * on the arrowed rays of the most constrained arrow clue (fewest arrowed rays
 * still needing a hit). Fall back to any unknown cell (preferring one adjacent
 * to a shaded cell, to fail fast). Returns -1 only when no unknown cell exists.
 */
function pickBranchCell(model: Model, state: SolveState): number {
  let best = -1;
  let bestScore = Infinity;
  for (const clue of model.clues) {
    let count = 0;
    let first = -1;
    for (const dir of clue.arrowedDirs) {
      const ray = clue.rays.get(dir)!;
      for (const c of ray) {
        if (state.excluded.test(c)) continue;
        if (state.shaded.test(c)) break; // this ray already has its nearest hit
        // Nearest unknown cell on this arrowed ray.
        if (count === 0) first = c;
        count++;
        break;
      }
    }
    if (count === 0) continue;
    if (count < bestScore) {
      bestScore = count;
      best = first;
    }
  }
  if (best >= 0) return best;

  const unknown = unknownCells(model, state);
  if (unknown.isEmpty()) return -1;
  // Prefer an unknown cell adjacent to a shaded cell (shading it is likely to
  // fail quickly via separation, pruning the branch).
  const adjacent = state.shaded.kingHalo();
  adjacent.andAssign(unknown);
  if (!adjacent.isEmpty()) return adjacent.firstSet();
  return unknown.firstSet();
}

function recordSolution(ctx: SearchCtx, state: SolveState): void {
  const sig = Array.from(state.shaded.w).join(',');
  if (ctx.sigs.has(sig)) return;
  const solution: Solution = { shaded: state.shaded.toUint8Array() };
  // Final gate: only accept boards the validator agrees are solved.
  if (!validate(ctx.model.puzzle, solution).ok) return;
  ctx.sigs.add(sig);
  ctx.solutions.push(solution);
  if (ctx.solutions.length >= ctx.maxSolutions) ctx.stopped = true;
}

function dfs(ctx: SearchCtx, state: SolveState): void {
  if (ctx.stopped) return;
  ctx.nodes++;
  if (ctx.nodes > ctx.nodeCap) {
    ctx.capped = true;
    ctx.stopped = true;
    return;
  }

  const res = propagateToFixpoint(ctx.model, state);
  if (res.status === 'contradiction') return;

  // Case 1: cover a free shaded cell.
  const c = freeShaded(state).firstSet();
  if (c >= 0) {
    const covers = ctx.model.placementsCoveringCell[c]!.filter((p) => state.alive[p] === 1);
    for (const p of covers) {
      if (ctx.stopped) break;
      const ns = cloneState(state);
      commitPlacement(ctx.model, ns, p);
      dfs(ctx, ns);
    }
    return;
  }

  // Case 2/3: decide an unknown cell, or record a leaf.
  const u = pickBranchCell(ctx.model, state);
  if (u < 0) {
    recordSolution(ctx, state);
    return;
  }
  // Exclude branch first (tends to prune faster), then shade branch.
  {
    const ns = cloneState(state);
    ns.excluded.set(u);
    dfs(ctx, ns);
  }
  if (!ctx.stopped) {
    const ns = cloneState(state);
    ns.shaded.set(u);
    dfs(ctx, ns);
  }
}

export function solve(puzzle: Puzzle, opts?: SolveOptions): SolveResult {
  return solveModel(buildModel(puzzle), opts);
}

/** Solve a precompiled immutable puzzle model. */
export function solveModel(model: Model, opts?: SolveOptions): SolveResult {
  const ctx: SearchCtx = {
    model,
    solutions: [],
    sigs: new Set(),
    maxSolutions: opts?.maxSolutions ?? 2,
    nodeCap: opts?.nodeCap ?? 1_000_000,
    nodes: 0,
    capped: false,
    stopped: false,
  };
  const state = initState(model);
  dfs(ctx, state);
  // complete iff we explored everything: not cut off by the solution cap and
  // not by the node cap.
  const cutByMax = ctx.solutions.length >= ctx.maxSolutions;
  return {
    solutions: ctx.solutions,
    nodes: ctx.nodes,
    complete: !ctx.capped && !cutByMax,
    capped: ctx.capped,
  };
}
