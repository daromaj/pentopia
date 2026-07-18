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
 *  - arrow-forced-shade    (§5, positive): when the tie distance is pinned to a
 *    single value each arrowed ray's cell at that distance is forced shaded.
 *  - no-touch-halo         (§5.1): a committed placement's halo is excluded.
 *  - placement-filtering   (§5.5 etc.): kill placements that hit excluded,
 *    overlap a committed placement, or whose piece-type is exhausted.
 *  - forced-placement      (positive engine): a free shaded cell coverable by
 *    exactly one alive placement commits it.
 *  - cover-analysis        (§5, cross-placement): reasoning over the set of
 *    still-alive placements — zero-cover exclusion, common-cell forcing, and
 *    common-halo exclusion; see its block comment. This is the expensive rule,
 *    run only after the cheap rules saturate.
 *  - clue-candidate        (§5, per-clue placement reasoning): for each arrow
 *    clue, the placements that could realise each arrowed ray's tie hit are
 *    limited; cells common to *all* of them are forced (shade the shared cells,
 *    exclude the shared halo). See its block comment. Expensive ("outer ring").
 *  - probe-forcing / probe-forcing-2 (deducer-only failed-literal analysis):
 *    try a value for an undecided cell; if it forces a contradiction under sound
 *    propagation, force the opposite. Depth-2 lets the inner propagation itself
 *    probe (still sound, inductively). See their block comments.
 *
 * ─── ARROW-DISTANCE INFERENCE (roadmap risk #5) ──────────────────────────
 * For a clue let t be the (unknown) tie distance: every arrowed ray's nearest
 * shaded cell is at exactly t; every unarrowed ray's nearest shaded cell (if
 * any) is strictly farther than t. Given the current shaded (S) / excluded (E)
 * knowledge, for a ray define:
 *   firstShaded(ray)      = min distance d with cell_d ∈ S           (∞ if none)
 *   firstNonExcluded(ray) = min distance d with cell_d ∉ E           (∞ if all
 *                           cells excluded to the board edge)
 *   ray.length            = number of cells from the clue to the board edge
 *                           in that direction (the last reachable distance).
 *
 * Bounds on t:
 *   hi = min over arrowed rays of min(firstShaded(ray), ray.length)
 *        · t can't sit beyond a shaded cell already on the ray (that shaded
 *          cell would be nearer-or-equal), AND
 *        · [RAY-LENGTH CAP, keystone] every arrowed ray MUST hit a shaded cell
 *          within the board (format §2 rule 3: an arrowed direction must have a
 *          shape), and that hit IS the tie distance, so t ≤ ray.length for
 *          every arrowed ray. This is what makes hi finite from an empty board
 *          — without it a from-empty run can never pin any tie.
 *   lo = max over arrowed rays of firstNonExcluded(ray)    (t can't be nearer
 *                                                           than the first cell
 *                                                           that could ever be
 *                                                           shaded)
 * An unarrowed ray's shaded cell at distance d forces t < d:
 *   hi = min(hi, d - 1)          for each unarrowed firstShaded = d
 *
 * [FEASIBLE-HIT INTERSECTION] t is one distance that must work on EVERY arrowed
 * ray at once. On an arrowed ray the tie cell (distance t) is shaded, so it may
 * not be excluded. Hence the per-ray feasible set is
 *   F(ray) = { d ∈ [lo, hi] : cell_d ∉ E }
 * and t ∈ ⋂ over arrowed rays F(ray) = { d ∈ [lo, hi] : cell_d ∉ E on *every*
 * arrowed ray }. We tighten lo/hi to the min/max of that intersection (a sound
 * superset: t lies in each F(ray), so in their intersection). If exactly one d
 * survives, t is pinned.
 *
 * Contradictions:
 *   - an arrowed ray fully excluded to the edge (firstNonExcluded = ∞)
 *   - an arrowed ray shorter than lo (can never reach the tie)
 *   - lo > hi, or the feasible intersection is empty
 * Exclusions derived (each sound for *every* feasible t ∈ [lo, hi]):
 *   - arrowed ray, distance < lo  → excluded (before any feasible hit)
 *   - unarrowed ray, distance ≤ lo → excluded (d ≤ lo ≤ t ⇒ must be unshaded)
 * Positive forcing when the intersection pins t to a single value: every
 * arrowed ray's cell at distance t is its nearest shaded cell → force shade.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { ClueInfo, Model } from './model';
import { Dir } from '../core/types';
import { BitBoard } from './board';
import { cloneState, commitPlacement, type SolveState } from './state';

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
  | 'forced-placement'
  | 'cover-analysis'
  | 'clue-candidate'
  | 'probe-forcing'
  | 'probe-forcing-2';

export interface Step {
  readonly rule: RuleId;
  readonly cells: number[];
  readonly detail?: string;
  /**
   * Whether this step *shaded* or *excluded* its cells. Most rules are
   * unambiguous by `rule` alone (see deduce's `SHADE_RULES`); `cover-analysis`
   * does both, so it always sets this explicitly.
   */
  readonly kind?: 'shade' | 'exclude';
}

export interface PropagationResult {
  readonly status: 'ok' | 'contradiction';
  readonly steps: Step[];
  /** When `status === 'contradiction'`, a human-readable reason (for debugging/deducer). */
  readonly reason?: string;
}

export interface PropagateOptions {
  /**
   * Run the expensive cross-placement `cover-analysis` rule (default `true`).
   * The complete solver may disable it if it slows search per-node more than
   * the pruning it buys; the human deducer always wants it (it is a standard
   * human deduction and its steps carry difficulty signal).
   */
  readonly coverAnalysis?: boolean;
  /**
   * Run the per-clue `clue-candidate` rule (default `true`). Like
   * `cover-analysis` it is an "outer ring" expensive rule enabled in both the
   * deducer and the complete search (it prunes at every node and its steps
   * carry difficulty signal). See {@link ruleClueCandidate}.
   */
  readonly clueCandidate?: boolean;
  /**
   * Failed-literal probing depth (default `0` — the search path). For each
   * undecided cell the rule tries each value and, if one leads to a
   * contradiction, forces the other:
   *  - `0`: no probing.
   *  - `1`: probe with the inner propagation using every rule *except* probing
   *    (`probe-forcing`). This is a human's "if this were shaded, that
   *    arrow/shape breaks, so it can't be" step.
   *  - `2`: probe with the inner propagation itself allowed to probe at depth 1
   *    (`probe-forcing-2`). Sound by induction — the inner (depth-1) propagation
   *    is sound, so an inner contradiction is real. Never recurses deeper than
   *    the requested depth, so there is no unbounded recursion.
   * Only the deducer raises this above 0 (search already branches; probing at
   * every node is pure overhead). Subsumes the old `probe` boolean
   * (`probe:true` ≡ `probeDepth:1`).
   */
  readonly probeDepth?: 0 | 1 | 2;
  /**
   * Optional wall-clock deadline (a `performance.now()` timestamp). The
   * expensive probe loops check it and bail early once passed, so a caller
   * (e.g. `deduce()`, which is user-facing via hints) can bound how long an
   * O(cells² × propagation) depth-2 sweep runs. When the deadline trips,
   * propagation returns `ok` with whatever it had already decided (never a
   * spurious contradiction).
   */
  readonly deadline?: number;
}

/** Mutable bookkeeping threaded through one propagation run. */
interface Ctx {
  readonly model: Model;
  readonly state: SolveState;
  readonly steps: Step[];
  changed: boolean;
  contradiction: string | null;
  /** Wall-clock deadline for the expensive probe loops (Infinity = none). */
  readonly deadline: number;
  /** Set once the deadline tripped, so the outer loop stops escalating. */
  timedOut: boolean;
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
    ctx.steps.push({ rule: 'clue-cell-exclusion', kind: 'exclude', cells: newly, detail: 'clue cells cannot be shaded' });
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

interface TieBounds {
  readonly lo: number;
  readonly hi: number;
  /** The feasible tie distances in [lo,hi] (non-excluded on every arrowed ray). */
  readonly feasible: number[];
}

/**
 * Compute the tie-distance bounds [lo,hi] and the feasible tie-distance set for
 * one clue given the current shaded/excluded knowledge. This is the shared
 * kernel of the ARROW-DISTANCE INFERENCE described in the block comment at the
 * top of this file, factored out so both `arrow-distance-bounds` and
 * `clue-candidate` reason over the *same* interval. Returns a contradiction
 * reason string (instead of bounds) when the clue is already unsatisfiable.
 */
function computeTie(state: SolveState, clue: ClueInfo): TieBounds | { contradiction: string } {
  let lo = 1;
  let hi = Infinity;

  // Bounds from arrowed rays. The `ray.length` term is the keystone RAY-LENGTH
  // CAP: an arrowed direction must hit a shaded cell within the board and that
  // hit is the tie, so t ≤ ray.length.
  for (const dir of clue.arrowedDirs) {
    const ray = clue.rays.get(dir)!;
    const fne = firstNonExcluded(state, ray);
    if (fne === Infinity) return { contradiction: `clue ${clue.index}: arrowed ray ${dirName(dir)} fully excluded` };
    lo = Math.max(lo, fne);
    hi = Math.min(hi, firstShaded(state, ray), ray.length);
  }
  // An unarrowed ray's shaded cell at distance d forces the tie strictly nearer.
  for (const dir of clue.unarrowedDirs) {
    const ray = clue.rays.get(dir)!;
    const fs = firstShaded(state, ray);
    if (fs !== Infinity) hi = Math.min(hi, fs - 1);
  }
  // The tie must be reachable on every arrowed ray (precise message; also
  // implied by the ray-length cap above).
  for (const dir of clue.arrowedDirs) {
    const ray = clue.rays.get(dir)!;
    if (lo > ray.length)
      return { contradiction: `clue ${clue.index}: arrowed ray ${dirName(dir)} too short to reach tie distance ${lo}` };
  }
  if (lo > hi) return { contradiction: `clue ${clue.index}: tie-distance interval empty (lo=${lo} > hi=${hi})` };

  // FEASIBLE-HIT INTERSECTION: t must be a distance whose cell is non-excluded
  // on EVERY arrowed ray (that cell is the shaded tie). Collect those distances
  // in [lo, hi]; t is one of them. (hi ≤ ray.length for every arrowed ray, so
  // `ray[d-1]` is always defined here.)
  const feasible: number[] = [];
  for (let d = lo; d <= hi; d++) {
    let ok = true;
    for (const dir of clue.arrowedDirs) {
      const ray = clue.rays.get(dir)!;
      if (state.excluded.test(ray[d - 1]!)) {
        ok = false;
        break;
      }
    }
    if (ok) feasible.push(d);
  }
  if (feasible.length === 0) return { contradiction: `clue ${clue.index}: no tie distance is non-excluded on every arrowed ray` };
  // Tighten to the min/max of the intersection (sound: t lies in it).
  return { lo: feasible[0]!, hi: feasible[feasible.length - 1]!, feasible };
}

function ruleArrowDistance(ctx: Ctx): void {
  const { model, state } = ctx;
  for (const clue of model.clues) {
    const tie = computeTie(state, clue);
    if ('contradiction' in tie) {
      ctx.contradiction = tie.contradiction;
      return;
    }
    const { lo, hi, feasible } = tie;

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
        kind: 'exclude',
        cells: excludedCells,
        detail: `clue ${clue.index}: tie ∈ [${lo}, ${hi}]`,
      });
    }

    // Positive forcing when the feasible intersection pins t to a single value:
    // every arrowed ray's cell at that distance is its nearest shaded cell.
    if (feasible.length === 1) {
      const t = lo; // === hi
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
          kind: 'shade',
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
      placement.cells.intersects(state.committedCells) ||
      // Separation (format §5.1, placement level): a shaded cell inside this
      // placement's no-touch halo is king-adjacent to it but NOT part of it, so
      // it belongs to a *different* shape — two shapes touching, which rule 2
      // forbids. Hence this placement can never be used. Sound in every
      // completion, and it is what forces king-adjacent shaded cells to be the
      // same shape (any placement covering one but not its neighbour dies here).
      placement.halo.intersects(state.shaded);
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
        kind: 'shade',
        cells: [...placement.cellList],
        detail: `cell ${c} coverable only by placement ${sole} (piece ${placement.piece})`,
      });
      // commitPlacement already OR'd this placement's halo into excluded
      // (format §5.1 no-touch); report those cells for the deducer's log.
      const haloCells = placement.halo.toArray();
      if (haloCells.length > 0) {
        ctx.steps.push({
          rule: 'no-touch-halo',
          kind: 'exclude',
          cells: haloCells,
          detail: `halo of committed placement ${sole}`,
        });
      }
    }
  });
}

/**
 * Cross-placement cover reasoning (format §5, cross-placement). Every shaded
 * cell in ANY completion of the current state lies inside some placement that
 * is still *alive* — its cells avoid `excluded`, don't overlap a committed
 * placement, and its piece-type isn't exhausted. "Usable in a completion" is a
 * subset of "alive" (alive ignores the arrow constraints, so it is a sound
 * superset), which is exactly what the three sub-rules below rely on.
 *
 *  (a) Zero-cover exclusion. A cell that NO alive placement covers can never be
 *      shaded → exclude it. (Empty alive-cover ⇒ empty usable-cover.) This also
 *      clears dead space far from any clue, and may legitimately exclude a
 *      potential arrow-hit cell — sound, because arrow hits are placed-piece
 *      cells and every shaded cell belongs to a placement.
 *  (b) Common-cell forcing. For a FREE shaded cell c (shaded, not yet
 *      committed), c belongs to exactly one of its alive covering placements in
 *      any completion. Any cell d covered by EVERY such placement is therefore
 *      shaded in every completion → shade d. (Intersection of the coverers'
 *      cells.)
 *  (c) Common-halo exclusion. Whichever covering placement is the one used, its
 *      no-touch halo is excluded. A cell in the halo of EVERY alive placement
 *      covering c is excluded in every completion → exclude it. (Intersection of
 *      the coverers' halos; disjoint from (b) since a placement's halo and cells
 *      are disjoint.)
 *
 * Cost O(free-shaded × coverers + cells × coverers); run only after the cheap
 * rules reach a fixed point (see `propagateToFixpoint`).
 */
function ruleCoverAnalysis(ctx: Ctx): void {
  const { model, state } = ctx;
  const n = model.cols * model.rows;

  // (a) Zero-cover exclusion. (A *shaded* cell with no alive cover is a
  // contradiction handled by forced-placement with a clearer message, so we
  // only touch currently-unknown cells here.)
  const zero: number[] = [];
  for (let c = 0; c < n; c++) {
    if (state.excluded.test(c) || state.shaded.test(c)) continue;
    let anyAlive = false;
    for (const p of model.placementsCoveringCell[c]!) {
      if (state.alive[p] === 1) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive && exclude(ctx, c)) zero.push(c);
  }
  if (zero.length > 0) {
    ctx.steps.push({
      rule: 'cover-analysis',
      kind: 'exclude',
      cells: zero,
      detail: 'no alive placement can cover these cells',
    });
  }

  // (b)/(c) Common-cell forcing and common-halo exclusion over free shaded cells.
  const free = state.shaded.clone();
  free.andNotAssign(state.committedCells);
  const forcedShade: number[] = [];
  const forcedExclude: number[] = [];
  free.forEach((c) => {
    let interCells: BitBoard | null = null;
    let interHalo: BitBoard | null = null;
    for (const p of model.placementsCoveringCell[c]!) {
      if (state.alive[p] !== 1) continue;
      const pl = model.placements[p]!;
      if (interCells === null) {
        interCells = pl.cells.clone();
        interHalo = pl.halo.clone();
      } else {
        interCells.andAssign(pl.cells);
        interHalo!.andAssign(pl.halo);
      }
    }
    // No alive coverer → forced-placement reports the contradiction; skip.
    if (interCells === null) return;
    interCells.forEach((d) => {
      if (d !== c && shade(ctx, d)) forcedShade.push(d);
    });
    interHalo!.forEach((d) => {
      if (exclude(ctx, d)) forcedExclude.push(d);
    });
  });
  if (forcedShade.length > 0) {
    ctx.steps.push({
      rule: 'cover-analysis',
      kind: 'shade',
      cells: forcedShade,
      detail: 'cell shared by every placement covering a shaded cell',
    });
  }
  if (forcedExclude.length > 0) {
    ctx.steps.push({
      rule: 'cover-analysis',
      kind: 'exclude',
      cells: forcedExclude,
      detail: 'cell in the halo of every placement covering a shaded cell',
    });
  }
  checkShadedExcludedDisjoint(ctx);
}

/**
 * Per-clue candidate-placement analysis (§5, the "reservation" deduction —
 * TIER 5, the same league as cover-analysis).
 *
 * Fix an arrow clue with feasible tie interval [lo,hi] and feasible tie-distance
 * set F (see `computeTie`). In any completion the clue has one tie distance
 * t* ∈ F, and on each ARROWED ray the nearest shaded cell (at distance t*) is
 * covered by exactly one used placement p*. That p* necessarily:
 *   - is ALIVE *or already COMMITTED* — a used placement is either still a live
 *     candidate (never hits `excluded`, never overlaps a committed placement,
 *     piece not over-used) or one already placed. Note `alive` ALONE is NOT a
 *     superset of "used": a committed placement has `alive = 0`, yet it is used,
 *     and every still-alive placement covering one of its cells is killed by the
 *     overlap filter — so a candidate set drawn from `alive` only would go empty
 *     exactly where a ray's hit is already committed, a false contradiction. We
 *     therefore draw candidates from `alive ∪ committed`; and
 *   - covers the ray's cell at distance t*; and
 *   - covers NO cell nearer than t* on ANY arrowed ray of this clue (else that
 *     ray would have a shaded cell nearer than the tie); and
 *   - covers NO cell at distance ≤ t* on ANY unarrowed ray (rule 3: unarrowed
 *     directions must have their shape strictly farther than the tie).
 * (For a non-transparent puzzle p* also cannot cover the clue cell — guaranteed
 * at model build, where clue-covering placements are dropped. Transparent
 * puzzles allow it, and none of the ray-distance conditions above reference the
 * clue cell, so the analysis is sound in either mode.)
 *
 * So the CANDIDATE SET for an arrowed ray R — every (t, p) with t ∈ F, p alive
 * or committed, p covering R's cell at distance t, and p passing the two mask tests
 * (`cells ∩ nearerArrowedMask[t] = ∅` and `cells ∩ leUnarrowedMask[t] = ∅`) — is
 * guaranteed to contain the real (t*, p*). Every derivation below is therefore
 * sound (each holds for that real placement, hence in every completion):
 *   - empty candidate set for a ray ⇒ no completion ⇒ contradiction;
 *   - t* is a candidate t-value on EVERY arrowed ray, so it lies in their
 *     intersection T; T = ∅ ⇒ contradiction. Restricting each ray's candidates
 *     to t ∈ T keeps the real (t*, p*) (t* ∈ T);
 *   - a cell covered by EVERY surviving candidate of ray R lies in p*.cells ⇒
 *     force SHADE (when |T| = 1 the tie hit cell R[t] itself is such a cell and
 *     falls out here automatically);
 *   - a cell in the halo of EVERY surviving candidate lies in p*.halo, and a
 *     used placement's no-touch halo is unshaded ⇒ force EXCLUDE (the user's
 *     "common border" reservation).
 *
 * Note the intersections only ever *shrink* when spurious (not-actually-usable)
 * placements sneak into the candidate set — so an over-broad candidate set can
 * never force a wrong cell, only miss a right one. Cost is an "outer ring" rule
 * run alongside cover-analysis, using the clue's precomputed static masks.
 */
function ruleClueCandidate(ctx: Ctx): void {
  const { model, state } = ctx;
  // Committed placements are "used" but have alive=0; candidates range over
  // alive ∪ committed (see the block comment). committed lists are tiny.
  const committedSet = new Set(state.committed);

  for (const clue of model.clues) {
    const tie = computeTie(state, clue);
    if ('contradiction' in tie) {
      ctx.contradiction = tie.contradiction;
      return;
    }
    const { feasible } = tie;
    const arrowed = clue.arrowedDirs;

    // Pass 1: per arrowed ray, the alive placements (grouped by tie distance t)
    // that could realise its tie hit, plus that ray's set of feasible t-values.
    const perRay: Map<number, number[]>[] = [];
    const tSets: Set<number>[] = [];
    for (const dir of arrowed) {
      const ray = clue.rays.get(dir)!;
      const byT = new Map<number, number[]>();
      const tSet = new Set<number>();
      for (const t of feasible) {
        const hit = ray[t - 1];
        if (hit === undefined) continue; // t ≤ hi ≤ ray.length ⇒ defined; guard anyway
        const nearer = clue.nearerArrowedMask[t]!;
        const leUnarrowed = clue.leUnarrowedMask[t]!;
        const list: number[] = [];
        for (const p of model.placementsCoveringCell[hit]!) {
          if (state.alive[p] !== 1 && !committedSet.has(p)) continue;
          const pl = model.placements[p]!;
          if (pl.cells.intersects(nearer)) continue; // would hit an arrowed ray nearer than t
          if (pl.cells.intersects(leUnarrowed)) continue; // would tie/beat an unarrowed ray
          list.push(p);
        }
        if (list.length > 0) {
          byT.set(t, list);
          tSet.add(t);
        }
      }
      if (tSet.size === 0) {
        ctx.contradiction = `clue ${clue.index}: arrowed ray ${dirName(dir)} has no candidate placement for any feasible tie`;
        return;
      }
      perRay.push(byT);
      tSets.push(tSet);
    }

    // Cross-ray tie intersection T: t* must be a candidate t on every arrowed ray.
    let T: Set<number> | null = null;
    for (const s of tSets) {
      if (T === null) {
        T = new Set(s);
      } else {
        for (const t of [...T]) if (!s.has(t)) T.delete(t);
      }
    }
    if (T === null || T.size === 0) {
      ctx.contradiction = `clue ${clue.index}: no tie distance is realisable on every arrowed ray at once`;
      return;
    }
    const tInfo =
      T.size === 1 ? `, tie pinned at ${[...T][0]}` : `, tie ∈ {${[...T].sort((a, b) => a - b).join(',')}}`;

    // Pass 2: per arrowed ray, intersect cells / halos over candidates with t ∈ T.
    for (let k = 0; k < arrowed.length; k++) {
      const byT = perRay[k]!;
      let interCells: BitBoard | null = null;
      let interHalo: BitBoard | null = null;
      let count = 0;
      for (const t of T) {
        const list = byT.get(t);
        if (list === undefined) continue;
        for (const p of list) {
          const pl = model.placements[p]!;
          count++;
          if (interCells === null) {
            interCells = pl.cells.clone();
            interHalo = pl.halo.clone();
          } else {
            interCells.andAssign(pl.cells);
            interHalo!.andAssign(pl.halo);
          }
        }
      }
      // `count === 0` is impossible: T ⊆ tSets[k], so byT has ≥1 candidate at some t ∈ T.
      if (interCells === null) continue;
      const dir = arrowed[k]!;
      const shadeCells: number[] = [];
      interCells.forEach((d) => {
        if (shade(ctx, d)) shadeCells.push(d);
      });
      if (shadeCells.length > 0) {
        ctx.steps.push({
          rule: 'clue-candidate',
          kind: 'shade',
          cells: shadeCells,
          detail: `clue ${clue.index}: ${count} candidate placement(s) for the ${dirName(dir)} ray${tInfo}`,
        });
      }
      const exclCells: number[] = [];
      interHalo!.forEach((d) => {
        if (exclude(ctx, d)) exclCells.push(d);
      });
      if (exclCells.length > 0) {
        ctx.steps.push({
          rule: 'clue-candidate',
          kind: 'exclude',
          cells: exclCells,
          detail: `clue ${clue.index}: common border of ${count} candidate placement(s) for the ${dirName(dir)} ray${tInfo}`,
        });
      }
    }
  }
  checkShadedExcludedDisjoint(ctx);
}

/**
 * Failed-literal probing (a.k.a. "what-if" / singleton consistency). For each
 * still-undecided cell u, tentatively try each value and re-propagate (with the
 * cheap + cover rules, but NOT probing again — bounded recursion):
 *  - if assuming u is shaded yields a contradiction, u must be excluded;
 *  - if assuming u is unshaded yields a contradiction, u must be shaded;
 *  - if BOTH contradict, the current state has no completion → contradiction.
 * Sound because every propagator is sound: a reported contradiction is real, so
 * the value that produces it is genuinely impossible in every completion. This
 * is the deduction a human makes to finish a shape ("if I don't shade here, this
 * clue can't be satisfied"), and it is what closes real published boards that
 * the local rules stall on. Expensive (two propagations per undecided cell), so
 * it runs only when the cheaper rules are saturated, and only in the deducer.
 *
 * `depth` selects how strong the inner propagation is:
 *  - depth 1 (`probe-forcing`): the inner propagation runs every rule EXCEPT
 *    probing. Full sweep over all undecided cells in natural order.
 *  - depth 2 (`probe-forcing-2`): the inner propagation is itself allowed to
 *    probe at depth 1. Sound by induction (the depth-1 propagation is sound, so
 *    an inner contradiction is real). This is O(cells² × propagation), so it is
 *    tightly cost-controlled: candidates are visited in a "near the action"
 *    order, and it RETURNS as soon as it forces one cell — the caller then falls
 *    back to the cheap fixpoint (and depth-1 probing) before the next depth-2
 *    sweep, so the expensive work only runs when nothing cheaper can progress.
 * Both honour `ctx.deadline`: once wall-clock passes it the sweep bails (setting
 * `ctx.timedOut`) and propagation returns whatever it decided — never a spurious
 * contradiction (a not-yet-found contradiction just means "no force here").
 */
interface ProbeInnerOpts {
  readonly coverAnalysis: boolean;
  readonly clueCandidate: boolean;
}

/** Undecided cells in natural (ascending) order. */
function undecidedNatural(ctx: Ctx): number[] {
  const { model, state } = ctx;
  const n = model.cols * model.rows;
  const out: number[] = [];
  for (let u = 0; u < n; u++) if (!state.shaded.test(u) && !state.excluded.test(u)) out.push(u);
  return out;
}

/**
 * Undecided cells ordered for depth-2 probing: cells adjacent to an
 * already-decided cell, or lying on some clue's ray, come first — those are
 * where a "what-if" is likeliest to cascade into a contradiction quickly. Pure
 * heuristic (deterministic); it never affects soundness or the final fixpoint.
 */
function probeOrder(ctx: Ctx): number[] {
  const { model, state } = ctx;
  const n = model.cols * model.rows;
  const decidedAdj = state.shaded.clone().orAssign(state.excluded).kingHalo();
  const priority: number[] = [];
  const rest: number[] = [];
  for (let u = 0; u < n; u++) {
    if (state.shaded.test(u) || state.excluded.test(u)) continue;
    if (decidedAdj.test(u) || model.clueRayMask.test(u)) priority.push(u);
    else rest.push(u);
  }
  return priority.concat(rest);
}

function ruleProbe(ctx: Ctx, opts: ProbeInnerOpts, depth: 1 | 2): void {
  const { model, state } = ctx;
  const ruleId: RuleId = depth === 2 ? 'probe-forcing-2' : 'probe-forcing';
  const inner: PropagateOptions = {
    coverAnalysis: opts.coverAnalysis,
    clueCandidate: opts.clueCandidate,
    probeDepth: (depth - 1) as 0 | 1,
    deadline: ctx.deadline,
  };
  const cells = depth === 2 ? probeOrder(ctx) : undecidedNatural(ctx);
  for (const u of cells) {
    // A cell decided by an earlier force in this same sweep is no longer a probe.
    if (state.shaded.test(u) || state.excluded.test(u)) continue;
    if (performance.now() > ctx.deadline) {
      ctx.timedOut = true;
      return;
    }

    const ifShaded = cloneState(state);
    ifShaded.shaded.set(u);
    const shadeContra = propagateToFixpoint(model, ifShaded, inner).status === 'contradiction';

    const ifExcluded = cloneState(state);
    ifExcluded.excluded.set(u);
    const excludeContra = propagateToFixpoint(model, ifExcluded, inner).status === 'contradiction';

    if (shadeContra && excludeContra) {
      ctx.contradiction = `cell ${u}: both shading and leaving it unshaded lead to a contradiction`;
      return;
    }
    if (shadeContra) {
      if (exclude(ctx, u)) {
        ctx.steps.push({ rule: ruleId, kind: 'exclude', cells: [u], detail: `shading cell ${u} forces a contradiction (depth ${depth})` });
        if (depth === 2) return; // fall back to the cheap fixpoint before more depth-2 work
      }
    } else if (excludeContra) {
      if (shade(ctx, u)) {
        ctx.steps.push({ rule: ruleId, kind: 'shade', cells: [u], detail: `leaving cell ${u} unshaded forces a contradiction (depth ${depth})` });
        if (depth === 2) return;
      }
    }
  }
  checkShadedExcludedDisjoint(ctx);
}

/** Run the cheap (per-cell / per-placement) rules to a fixed point. */
function cheapFixpoint(ctx: Ctx): void {
  do {
    ctx.changed = false;

    checkShadedExcludedDisjoint(ctx);
    if (ctx.contradiction !== null) return;

    rulePlacementFiltering(ctx);

    ruleArrowDistance(ctx);
    if (ctx.contradiction !== null) return;

    // Re-filter after arrow exclusions may have killed placements, so
    // forced-placement sees an up-to-date alive set.
    rulePlacementFiltering(ctx);

    ruleForcedPlacement(ctx);
    if (ctx.contradiction !== null) return;

    checkShadedExcludedDisjoint(ctx);
    if (ctx.contradiction !== null) return;
  } while (ctx.changed);
}

/**
 * Run all §5 propagators to a fixed point over `state`. Mutates `state`;
 * returns `{status, steps}`. `contradiction` means the current partial
 * assignment cannot extend to any valid solution.
 *
 * Structure (cheap → expensive, each only when the cheaper ones stall):
 *  1. cheap per-cell / per-placement rules to a fixed point;
 *  2. one `cover-analysis` pass — if it changed anything, go back to (1);
 *  3. otherwise one `clue-candidate` pass — if it changed anything, back to (1);
 *  4. otherwise, if `probeDepth ≥ 1`, one depth-1 `probe-forcing` sweep — if it
 *     changed anything, back to (1);
 *  5. otherwise, if `probeDepth ≥ 2`, one depth-2 `probe-forcing-2` step (it
 *     returns after a single force) — if it changed anything, back to (1).
 * This keeps the expensive rules off the hot inner loop and out of search
 * (which runs with `probeDepth: 0`), and only escalates to the pricier tool once
 * every cheaper one has saturated.
 */
export function propagateToFixpoint(
  model: Model,
  state: SolveState,
  opts?: PropagateOptions,
): PropagationResult {
  const coverAnalysis = opts?.coverAnalysis ?? true;
  const clueCandidate = opts?.clueCandidate ?? true;
  const probeDepth = opts?.probeDepth ?? 0;
  const deadline = opts?.deadline ?? Infinity;
  const ctx: Ctx = { model, state, steps: [], changed: false, contradiction: null, deadline, timedOut: false };

  // Clue-cell exclusion is idempotent; apply it up front.
  ruleClueCellExclusion(ctx);
  checkShadedExcludedDisjoint(ctx);
  if (ctx.contradiction !== null)
    return { status: 'contradiction', steps: ctx.steps, reason: ctx.contradiction };

  const innerOpts: ProbeInnerOpts = { coverAnalysis, clueCandidate };
  let outerChanged = true;
  while (outerChanged && ctx.contradiction === null && !ctx.timedOut) {
    outerChanged = false;

    cheapFixpoint(ctx);
    if (ctx.contradiction !== null) break;

    if (coverAnalysis) {
      ctx.changed = false;
      ruleCoverAnalysis(ctx);
      if (ctx.contradiction !== null) break;
      if (ctx.changed) {
        outerChanged = true;
        continue; // let the cheap rules digest the new cells first
      }
    }

    if (clueCandidate) {
      ctx.changed = false;
      ruleClueCandidate(ctx);
      if (ctx.contradiction !== null) break;
      if (ctx.changed) {
        outerChanged = true;
        continue;
      }
    }

    if (probeDepth >= 1) {
      ctx.changed = false;
      ruleProbe(ctx, innerOpts, 1);
      if (ctx.contradiction !== null) break;
      if (ctx.timedOut) break;
      if (ctx.changed) {
        outerChanged = true;
        continue; // depth-2 only once depth-1 (and everything cheaper) saturates
      }
    }

    if (probeDepth >= 2) {
      ctx.changed = false;
      ruleProbe(ctx, innerOpts, 2);
      if (ctx.contradiction !== null) break;
      if (ctx.timedOut) break;
      if (ctx.changed) outerChanged = true;
    }
  }

  return {
    status: ctx.contradiction !== null ? 'contradiction' : 'ok',
    steps: ctx.steps,
    reason: ctx.contradiction ?? undefined,
  };
}
