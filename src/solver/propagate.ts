/**
 * The shared constraint engine (roadmap §3 / format §5). `propagateToFixpoint`
 * runs every rule in a worklist loop until nothing changes or a contradiction
 * is found. It mutates the given `SolveState` and returns what it changed (a
 * step log) or `contradiction` — it never branches. Phase 4's human deducer
 * runs exactly this to a fixed point; the complete solver in search.ts runs it
 * at every node. THIS FILE MUST NOT IMPORT search.ts.
 *
 * Rules (all from format §5):
 *  - clue-cell-exclusion   (§5.4): clue/HATENA cells excluded when !transparent.
 *  - arrow-distance-bounds (§5.2/§5.3): per clue, maintain the tie-distance
 *    interval [lo, hi] and derive exclusions; see the block comment below.
 *  - arrow-forced-shade    (§5, positive): when lo === hi the tie distance is
 *    pinned and each arrowed ray's cell at that distance is forced shaded.
 *  - no-touch-halo         (§5.1): a committed placement's halo is excluded.
 *  - placement-filtering   (§5.5 etc.): kill placements that hit excluded,
 *    overlap a committed placement, or whose piece-type is exhausted.
 *  - forced-placement      (positive engine): a free shaded cell coverable by
 *    exactly one alive placement commits it.
 *
 * ─── ARROW-DISTANCE INFERENCE (roadmap risk #5) ──────────────────────────
 * For a clue let t be the (unknown) tie distance: every arrowed ray's nearest
 * shaded cell is at exactly t; every unarrowed ray's nearest shaded cell (if
 * any) is strictly farther than t. Given the current shaded (S) / excluded (E)
 * knowledge, for a ray define:
 *   firstShaded(ray)      = min distance d with cell_d ∈ S           (∞ if none)
 *   firstNonExcluded(ray) = min distance d with cell_d ∉ E           (∞ if all
 *                           cells excluded to the board edge)
 * Then, because an arrowed ray's eventual hit lies in
 * [firstNonExcluded, firstShaded] and equals t:
 *   hi = min over arrowed rays of firstShaded(ray)         (t can't exceed a
 *                                                           shaded cell already
 *                                                           sitting on the ray)
 *   lo = max over arrowed rays of firstNonExcluded(ray)    (t can't be nearer
 *                                                           than the first cell
 *                                                           that could ever be
 *                                                           shaded)
 * An unarrowed ray's shaded cell at distance d forces t < d:
 *   hi = min(hi, d - 1)          for each unarrowed firstShaded = d
 * Contradictions:
 *   - an arrowed ray fully excluded to the edge (firstNonExcluded = ∞)
 *   - lo > hi
 *   - lo > (an arrowed ray's length): that ray can never reach the tie
 * Exclusions derived (each sound for *every* feasible t ∈ [lo, hi]):
 *   - arrowed ray, distance < lo  → excluded (before any feasible hit)
 *   - unarrowed ray, distance ≤ lo → excluded (d ≤ lo ≤ t ⇒ must be unshaded)
 * Positive forcing when lo === hi === t (t pinned): every arrowed ray's cell
 * at distance t must be shaded (its cells before t are already excluded, and
 * its first shaded is exactly t) → force shade cell_t.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Model } from './model';
import { Dir } from '../core/types';
import { commitPlacement, type SolveState } from './state';

/** Human-readable direction name (const enums have no reverse mapping). */
function dirName(dir: Dir): string {
  switch (dir) {
    case Dir.Up:
      return 'Up';
    case Dir.Down:
      return 'Down';
    case Dir.Left:
      return 'Left';
    case Dir.Right:
      return 'Right';
  }
}

export type RuleId =
  | 'clue-cell-exclusion'
  | 'arrow-distance-bounds'
  | 'arrow-forced-shade'
  | 'no-touch-halo'
  | 'placement-filtering'
  | 'forced-placement';

export interface Step {
  readonly rule: RuleId;
  readonly cells: number[];
  readonly detail?: string;
}

export interface PropagationResult {
  readonly status: 'ok' | 'contradiction';
  readonly steps: Step[];
  /** When `status === 'contradiction'`, a human-readable reason (for debugging/deducer). */
  readonly reason?: string;
}

/** Mutable bookkeeping threaded through one propagation run. */
interface Ctx {
  readonly model: Model;
  readonly state: SolveState;
  readonly steps: Step[];
  changed: boolean;
  contradiction: string | null;
}

/** Exclude cell `c` if not already excluded; record the change. Returns true if newly set. */
function exclude(ctx: Ctx, c: number): boolean {
  if (ctx.state.excluded.test(c)) return false;
  ctx.state.excluded.set(c);
  ctx.changed = true;
  return true;
}

/** Shade cell `c` if not already shaded; record the change. Returns true if newly set. */
function shade(ctx: Ctx, c: number): boolean {
  if (ctx.state.shaded.test(c)) return false;
  ctx.state.shaded.set(c);
  ctx.changed = true;
  return true;
}

/** shaded ∩ excluded ≠ ∅ is a hard contradiction (a cell can't be both). */
function checkShadedExcludedDisjoint(ctx: Ctx): void {
  if (ctx.state.shaded.intersects(ctx.state.excluded)) {
    ctx.contradiction = 'a cell is both shaded and excluded';
  }
}

function ruleClueCellExclusion(ctx: Ctx): void {
  if (ctx.model.puzzle.transparent) return;
  const newly: number[] = [];
  ctx.model.clueCellMask.forEach((c) => {
    if (exclude(ctx, c)) newly.push(c);
  });
  if (newly.length > 0) {
    ctx.steps.push({ rule: 'clue-cell-exclusion', cells: newly, detail: 'clue cells cannot be shaded' });
  }
}

function firstShaded(state: SolveState, ray: readonly number[]): number {
  for (let d = 0; d < ray.length; d++) if (state.shaded.test(ray[d]!)) return d + 1;
  return Infinity;
}

function firstNonExcluded(state: SolveState, ray: readonly number[]): number {
  for (let d = 0; d < ray.length; d++) if (!state.excluded.test(ray[d]!)) return d + 1;
  return Infinity;
}

function ruleArrowDistance(ctx: Ctx): void {
  const { model, state } = ctx;
  for (const clue of model.clues) {
    let lo = 1;
    let hi = Infinity;

    // Bounds from arrowed rays.
    for (const dir of clue.arrowedDirs) {
      const ray = clue.rays.get(dir)!;
      const fne = firstNonExcluded(state, ray);
      if (fne === Infinity) {
        ctx.contradiction = `clue ${clue.index}: arrowed ray ${dirName(dir)} fully excluded`;
        return;
      }
      lo = Math.max(lo, fne);
      hi = Math.min(hi, firstShaded(state, ray));
    }
    // An unarrowed ray's shaded cell at distance d forces the tie strictly nearer.
    for (const dir of clue.unarrowedDirs) {
      const ray = clue.rays.get(dir)!;
      const fs = firstShaded(state, ray);
      if (fs !== Infinity) hi = Math.min(hi, fs - 1);
    }
    // The tie must also be reachable on every arrowed ray.
    for (const dir of clue.arrowedDirs) {
      const ray = clue.rays.get(dir)!;
      if (lo > ray.length) {
        ctx.contradiction = `clue ${clue.index}: arrowed ray ${dirName(dir)} too short to reach tie distance ${lo}`;
        return;
      }
    }
    if (lo > hi) {
      ctx.contradiction = `clue ${clue.index}: tie-distance interval empty (lo=${lo} > hi=${hi})`;
      return;
    }

    // Exclusions.
    const excludedCells: number[] = [];
    for (const dir of clue.arrowedDirs) {
      const ray = clue.rays.get(dir)!;
      for (let d = 1; d < lo; d++) {
        const c = ray[d - 1];
        if (c !== undefined && exclude(ctx, c)) excludedCells.push(c);
      }
    }
    for (const dir of clue.unarrowedDirs) {
      const ray = clue.rays.get(dir)!;
      for (let d = 1; d <= lo; d++) {
        const c = ray[d - 1];
        if (c !== undefined && exclude(ctx, c)) excludedCells.push(c);
      }
    }
    if (excludedCells.length > 0) {
      ctx.steps.push({
        rule: 'arrow-distance-bounds',
        cells: excludedCells,
        detail: `clue ${clue.index}: tie ∈ [${lo}, ${hi === Infinity ? '∞' : hi}]`,
      });
    }

    // Positive forcing when the tie distance is pinned.
    if (lo === hi) {
      const t = lo;
      const forced: number[] = [];
      for (const dir of clue.arrowedDirs) {
        const ray = clue.rays.get(dir)!;
        const c = ray[t - 1];
        if (c === undefined) {
          ctx.contradiction = `clue ${clue.index}: arrowed ray ${dirName(dir)} cannot reach pinned tie ${t}`;
          return;
        }
        if (shade(ctx, c)) forced.push(c);
      }
      if (forced.length > 0) {
        ctx.steps.push({
          rule: 'arrow-forced-shade',
          cells: forced,
          detail: `clue ${clue.index}: tie pinned at ${t}`,
        });
      }
    }
  }
  checkShadedExcludedDisjoint(ctx);
}

function rulePlacementFiltering(ctx: Ctx): void {
  const { model, state } = ctx;
  const { placements } = model;
  for (let p = 0; p < placements.length; p++) {
    if (state.alive[p] === 0) continue;
    const placement = placements[p]!;
    const exhausted = state.remaining[placement.piece]! <= 0;
    const dead =
      exhausted ||
      placement.cells.intersects(state.excluded) ||
      placement.cells.intersects(state.committedCells);
    if (dead) {
      state.alive[p] = 0;
      ctx.changed = true;
    }
  }
}

function ruleForcedPlacement(ctx: Ctx): void {
  const { model, state } = ctx;
  // Free shaded cells: shaded but not yet part of a committed placement.
  const free = state.shaded.clone();
  free.andNotAssign(state.committedCells);
  let contradiction = false;
  free.forEach((c) => {
    if (contradiction) return;
    // A placement committed earlier in THIS loop may already cover `c`
    // (the snapshot is stale). Such a cell is no longer free — skip it, or
    // its now-committed covering placement would look "not alive" and be
    // misread as uncoverable.
    if (state.committedCells.test(c)) return;
    let sole = -1;
    let alive = 0;
    for (const p of model.placementsCoveringCell[c]!) {
      if (state.alive[p] === 1) {
        alive++;
        sole = p;
        if (alive > 1) break;
      }
    }
    if (alive === 0) {
      ctx.contradiction = `shaded cell ${c} cannot be covered by any alive placement`;
      contradiction = true;
      return;
    }
    if (alive === 1) {
      const placement = model.placements[sole]!;
      commitPlacement(model, state, sole);
      ctx.changed = true;
      ctx.steps.push({
        rule: 'forced-placement',
        cells: [...placement.cellList],
        detail: `cell ${c} coverable only by placement ${sole} (piece ${placement.piece})`,
      });
      // commitPlacement already OR'd this placement's halo into excluded
      // (format §5.1 no-touch); report those cells for the deducer's log.
      const haloCells = placement.halo.toArray();
      if (haloCells.length > 0) {
        ctx.steps.push({
          rule: 'no-touch-halo',
          cells: haloCells,
          detail: `halo of committed placement ${sole}`,
        });
      }
    }
  });
}

/**
 * Run all §5 propagators to a fixed point over `state`. Mutates `state`;
 * returns `{status, steps}`. `contradiction` means the current partial
 * assignment cannot extend to any valid solution.
 */
export function propagateToFixpoint(model: Model, state: SolveState): PropagationResult {
  const ctx: Ctx = { model, state, steps: [], changed: false, contradiction: null };

  // Clue-cell exclusion is idempotent; apply it up front.
  ruleClueCellExclusion(ctx);
  checkShadedExcludedDisjoint(ctx);
  if (ctx.contradiction !== null)
    return { status: 'contradiction', steps: ctx.steps, reason: ctx.contradiction };

  do {
    ctx.changed = false;

    checkShadedExcludedDisjoint(ctx);
    if (ctx.contradiction !== null) break;

    rulePlacementFiltering(ctx);

    ruleArrowDistance(ctx);
    if (ctx.contradiction !== null) break;

    // Re-filter after arrow exclusions may have killed placements, so
    // forced-placement sees an up-to-date alive set.
    rulePlacementFiltering(ctx);

    ruleForcedPlacement(ctx);
    if (ctx.contradiction !== null) break;

    checkShadedExcludedDisjoint(ctx);
    if (ctx.contradiction !== null) break;
  } while (ctx.changed);

  return {
    status: ctx.contradiction !== null ? 'contradiction' : 'ok',
    steps: ctx.steps,
    reason: ctx.contradiction ?? undefined,
  };
}
