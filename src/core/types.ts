/**
 * Core data model for Pentopia, following the puzz.link/pzprjs conventions
 * documented in docs/pentopia-puzzlink-format.md (referenced as "format §N").
 */

/** Cardinal directions, numbered as in pzprjs (format §3.2). */
export const enum Dir {
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
}

export const DIRS: readonly Dir[] = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

/** Bit for a direction inside an arrow-clue bitmask: UP=1, DOWN=2, LEFT=4, RIGHT=8. */
export function dirBit(dir: Dir): number {
  return 1 << (dir - 1);
}

/**
 * Per-cell clue value (format §3.2):
 *  - NO_CLUE (-1): empty cell, no clue.
 *  - HATENA (-2): "?" placeholder clue — not solvable; rejected by solver/generator.
 *  - 1..15: arrow bitmask (OR of dirBit for each drawn arrow). 0 never occurs.
 */
export type ClueValue = number;
export const NO_CLUE: ClueValue = -1;
export const HATENA: ClueValue = -2;

/**
 * A polyomino shape as a 0/1 bitmap over its bounding box, row-major.
 * `bits.length === w * h`; `bits[y * w + x]` is 1 iff the cell is filled.
 * This mirrors the BankPiece wire representation (format §3.3).
 */
export interface Shape {
  readonly w: number;
  readonly h: number;
  readonly bits: Uint8Array;
}

/**
 * The shape bank: a verbatim list of pieces, duplicates allowed (matches the
 * explicit piece-list encoding, format §3.3b; preset `d` simply lists each
 * tetromino twice). Group by canonical key to get per-shape counts.
 */
export interface Bank {
  readonly pieces: readonly Shape[];
}

/** A Pentopia puzzle instance (problem only — no answer state). */
export interface Puzzle {
  readonly cols: number;
  readonly rows: number;
  /** Length cols*rows, row-major; values are ClueValue. */
  readonly clues: Int16Array;
  readonly bank: Bank;
  /** The `t` pflag: clue cells may be covered by shapes (format §2.1). */
  readonly transparent: boolean;
}

/** A (candidate) answer: which cells are shaded. Length cols*rows, 0/1, row-major. */
export interface Solution {
  readonly shaded: Uint8Array;
}

/** Validator failure codes, exactly as pzprjs names them (format §4.4). */
export type FailCode =
  | 'csOnArrow'
  | 'bankGt'
  | 'shDiag'
  | 'arDistanceGt'
  | 'arDistanceNe'
  | 'arNoShade'
  | 'bankInvalid';

export interface Failure {
  readonly code: FailCode;
  /** Cell indices (row-major) implicated in the failure, when identifiable. */
  readonly cells?: readonly number[];
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly failures: readonly Failure[];
}
