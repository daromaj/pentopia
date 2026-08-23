/** Public surface of the Pentopia solver. */

export { BitBoard } from './board';
export { buildModel } from './model';
export type { Model, PieceType, Placement, ClueInfo } from './model';
export {
  initState,
  cloneState,
  commitPlacement,
  unknownCells,
  freeShaded,
} from './state';
export type { SolveState } from './state';
export { propagateToFixpoint } from './propagate';
export type { PropagationResult, Step, RuleId, PropagateOptions } from './propagate';
export { solve, solveModel } from './search';
export type { SolveResult, SolveOptions } from './search';
export { deduce, deduceModel, explainSteps, TIER } from './deduce';
export { probeWalk } from './walk';
export type { ProbeWalkResult, ProbeWalkOptions } from './walk';
export type { DeduceResult } from './deduce';
