/** Public surface of the Pentopia solver. */

export { BitBoard } from './board';
export { buildModel } from './model';
export type { Model, PieceType, Placement, ClueInfo } from './model';
export {
  initState,
  cloneState,
  commitPlacement,
  unknownCells,
  isFullyDecided,
} from './state';
export type { SolveState } from './state';
export { propagateToFixpoint } from './propagate';
export type { PropagationResult, Step, RuleId, PropagateOptions } from './propagate';
export { solve, solveModel } from './search';
export type { SolveResult, SolveOptions } from './search';
export { deduce, deduceModel, explainSteps, TIER } from './deduce';
export type { DeduceResult } from './deduce';
