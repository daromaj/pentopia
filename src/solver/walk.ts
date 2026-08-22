/**
 * probeWalk — how deep a what-if the puzzle *actually* demands.
 *
 * `Step.probeChain` already measures one probe: how many cells the hypothesis
 * forces before it breaks. Reading it off `deduce()` overstates the puzzle,
 * though, because `ruleProbe` probes greedily — it keeps firing what-ifs on
 * cells the cheap rules would have handed over for free on the next pass. A
 * measured 8x8 board emits 15-56 probe steps where an interleaved solver spends
 * three, and the extra steps skew short, so the maximum over the greedy log
 * describes a solver nobody is.
 *
 * This walks the board the way a player does: cheap rules to a fixed point,
 * then exactly one probe, then back to the cheap rules. The chains it reports
 * are the ones somebody has to actually trace, which is what a hint has to be
 * able to put into a sentence — and therefore what the generator gates on.
 */

import type { Model } from './model';
import { propagateToFixpoint, type Step } from './propagate';
import { cloneState, initState, unknownCells } from './state';

export interface ProbeWalkResult {
  /** Probes the walk spent (0 when the cheap rules finish the board alone). */
  readonly probes: number;
  /** Longest chain over those probes — the number the generator caps. */
  readonly worst: number;
  /** True when the walk gave up early: over `cap`, out of time, or wedged. */
  readonly abandoned: boolean;
}

export interface ProbeWalkOptions {
  /**
   * Stop as soon as a chain exceeds this. The caller only ever asks "does this
   * board stay under the cap", and the depth-1 sweeps are the whole cost, so a
   * board that has already failed is not worth finishing.
   */
  readonly cap?: number;
  /** Wall-clock deadline shared with the caller; a timed-out walk is abandoned. */
  readonly deadline?: number;
}

export function probeWalk(model: Model, opts: ProbeWalkOptions = {}): ProbeWalkResult {
  const cap = opts.cap ?? Infinity;
  const deadline = opts.deadline ?? Infinity;
  const state = initState(model);
  let probes = 0;
  let worst = 0;

  for (;;) {
    if (performance.now() > deadline) return { probes, worst, abandoned: true };

    const plain = propagateToFixpoint(model, state, {
      coverAnalysis: true,
      clueCandidate: true,
      probeDepth: 0,
      deadline,
    });
    if (plain.status === 'contradiction') return { probes, worst, abandoned: true };
    if (unknownCells(model, state).popcount() === 0) return { probes, worst, abandoned: false };

    // The cheap rules are spent. Probe on a copy so only the one decision the
    // walk chooses lands on `state` — the rest of that sweep's forces are cells
    // the cheap rules will re-derive for free, and charging them to the player
    // is exactly the overstatement this walk exists to avoid.
    const probed = cloneState(state);
    const sweep = propagateToFixpoint(model, probed, {
      coverAnalysis: true,
      clueCandidate: true,
      probeDepth: 1,
      deadline,
    });
    const step = sweep.steps.find((s: Step) => s.rule === 'probe-forcing');
    // No probe fires either: the board is not deducible at depth 1 at all. That
    // is a ceiling failure, not a chain-length one, and the caller's own
    // `solved` gate already rejects it — so report what we have and stop.
    if (!step) return { probes, worst, abandoned: performance.now() > deadline };

    probes++;
    const chain = step.probeChain ?? 0;
    if (chain > worst) worst = chain;
    if (worst > cap) return { probes, worst, abandoned: true };

    const cell = step.cells[0]!;
    if (step.kind === 'shade') state.shaded.set(cell);
    else state.excluded.set(cell);
  }
}
