/** Public surface of the Pentopia generator. */

export { createRng, randInt, shuffle } from './rng';
export { placeShapes, defaultPieceCount } from './place';
export type { PlaceOptions } from './place';
export { deriveMaximalClues } from './clues';
export { minimizeClues } from './minimize';
export type { MinimizeGates } from './minimize';
export { generatePuzzle, expertProbeFloor } from './generate';
export type { Difficulty, GenerateOptions, GenerateStats, GenerateResult } from './generate';
