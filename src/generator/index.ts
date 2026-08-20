/** Public surface of the Pentopia generator. */

export { createRng, randInt, shuffle } from './rng';
export { placeShapes, defaultPieceCount } from './place';
export type { PlaceOptions } from './place';
export { deriveMaximalClues } from './clues';
export { minimizeClues } from './minimize';
export type { MinimizeGates } from './minimize';
export { generatePuzzle, generateRatedCandidate, candidateSeed, expertProbeFloor, satisfiesDifficulty, SEED_BUMPS, BUMP_STRIDE } from './generate';
export type { Difficulty, GenerateOptions, GenerateStats, GenerateResult, GenerationObserver, GeneratorPhase } from './generate';
export { signatureOf, scoreFlow, distanceFlow, selectCandidate } from './flow';
export type { FlowProfile, FlowSignature, FlowContext, RatedCandidate } from './flow';
