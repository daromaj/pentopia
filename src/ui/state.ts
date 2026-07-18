/**
 * Player state: pure logic, no DOM. A `PlayState` wraps a `Puzzle` plus the
 * player's in-progress shading (`cellState`), an undo/redo history of full
 * snapshots, and the bookkeeping for click-vs-drag "stroke" painting
 * (interaction.ts drives this; render.ts reads `cellState` to draw).
 *
 * Cell values: 0 = untouched, 1 = shaded, 2 = marked-empty (an annotation,
 * like puzz.link's '+' — never counts as shaded for solved-detection).
 */

import { idx, ORTH4 } from '../core/grid';
import { canonicalKey } from '../core/shape';
import { NO_CLUE } from '../core/types';
import type { FailCode, Puzzle, Shape } from '../core/types';

export const UNTOUCHED = 0;
export const SHADED = 1;
export const MARKED_EMPTY = 2;
export type CellValue = typeof UNTOUCHED | typeof SHADED | typeof MARKED_EMPTY;

export interface PlayState {
  puzzle: Puzzle;
  cellState: Uint8Array;
  undoStack: Uint8Array[];
  redoStack: Uint8Array[];
  dirty: boolean;
  /** True while a click/drag stroke is in progress (interaction.ts owns the pointer events). */
  strokeActive: boolean;
  /** The cell value being painted for the current stroke, chosen at stroke start. */
  strokePaintValue: CellValue | null;
}

const MAX_HISTORY = 200;

export function createPlayState(puzzle: Puzzle): PlayState {
  return {
    puzzle,
    cellState: new Uint8Array(puzzle.cols * puzzle.rows),
    undoStack: [],
    redoStack: [],
    dirty: false,
    strokeActive: false,
    strokePaintValue: null,
  };
}

/** Reset an existing PlayState in place to a freshly-loaded puzzle (keeps object identity for listeners). */
export function loadPuzzle(state: PlayState, puzzle: Puzzle): void {
  state.puzzle = puzzle;
  state.cellState = new Uint8Array(puzzle.cols * puzzle.rows);
  state.undoStack = [];
  state.redoStack = [];
  state.dirty = false;
  state.strokeActive = false;
  state.strokePaintValue = null;
}

export function isClueCell(state: PlayState, i: number): boolean {
  return state.puzzle.clues[i] !== NO_CLUE;
}

function pushHistory(state: PlayState): void {
  state.undoStack.push(state.cellState.slice());
  if (state.undoStack.length > MAX_HISTORY) state.undoStack.shift();
  state.redoStack = [];
}

/**
 * Begin a click/drag stroke at cell `i`. Clue cells are inert (skipped
 * entirely — never shaded, never marked). A single tap is a stroke with just
 * one cell: it cycles untouched -> shaded -> marked-empty -> untouched.
 * `forcedValue` (used for right-click / two-finger) paints that exact value
 * instead of cycling. One history snapshot is taken per stroke, so a whole
 * drag undoes as one step.
 */
export function startStroke(state: PlayState, i: number, forcedValue?: CellValue): void {
  if (isClueCell(state, i)) return;
  pushHistory(state);
  const cur = state.cellState[i] as CellValue;
  const value: CellValue = forcedValue ?? (((cur + 1) % 3) as CellValue);
  state.strokeActive = true;
  state.strokePaintValue = value;
  state.cellState[i] = value;
  state.dirty = true;
}

/**
 * Continue an active stroke onto cell `i`, painting the stroke's fixed value.
 * Returns whether a cell actually changed — false for no active stroke, clue
 * cells, and cells already holding the stroke value, so callers can skip
 * re-rendering on the pointermove flood a single press produces.
 */
export function continueStroke(state: PlayState, i: number): boolean {
  if (!state.strokeActive || state.strokePaintValue === null) return false;
  if (isClueCell(state, i)) return false;
  if (state.cellState[i] === state.strokePaintValue) return false;
  state.cellState[i] = state.strokePaintValue;
  return true;
}

export function endStroke(state: PlayState): void {
  state.strokeActive = false;
  state.strokePaintValue = null;
}

/**
 * Clear the board back to all-untouched, taking one undo snapshot first (so
 * a Reset is a single undoable step, same as any other stroke). Clue cells
 * were never represented in `cellState` to begin with, so a flat fill is
 * enough — no special-casing needed.
 */
export function resetBoard(state: PlayState): void {
  pushHistory(state);
  state.cellState.fill(UNTOUCHED);
  state.strokeActive = false;
  state.strokePaintValue = null;
  state.dirty = true;
}

export function undo(state: PlayState): boolean {
  if (state.undoStack.length === 0) return false;
  state.redoStack.push(state.cellState.slice());
  state.cellState = state.undoStack.pop()!;
  state.dirty = true;
  return true;
}

export function redo(state: PlayState): boolean {
  if (state.redoStack.length === 0) return false;
  state.undoStack.push(state.cellState.slice());
  state.cellState = state.redoStack.pop()!;
  state.dirty = true;
  return true;
}

export interface ShadedComponent {
  readonly cells: readonly number[];
  readonly key: string;
}

/**
 * 4-connected flood fill of `cellState === SHADED` cells into components,
 * each reduced to the same canonical-key algorithm as core/shape.ts
 * (bounding box -> 0/1 grid -> canonicalKey). This mirrors
 * validator.ts's internal `findComponents`, which core does not export —
 * re-derived here (deliberately, per the UI's scope) purely for bank-panel
 * "which pieces are currently used" display; it does not replace validate().
 */
export function computeShadedComponents(puzzle: Puzzle, cellState: Uint8Array): ShadedComponent[] {
  const { cols, rows } = puzzle;
  const seen = new Uint8Array(cols * rows);
  const components: ShadedComponent[] = [];

  for (let start = 0; start < cols * rows; start++) {
    if (cellState[start] !== SHADED || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      cells.push(cur);
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      for (const [dx, dy] of ORTH4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = idx(nx, ny, cols);
        if (cellState[ni] !== SHADED || seen[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }

    let minX = cols;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    for (const c of cells) {
      const x = c % cols;
      const y = Math.floor(c / cols);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const bits = new Uint8Array(w * h);
    for (const c of cells) {
      const x = (c % cols) - minX;
      const y = Math.floor(c / cols) - minY;
      bits[y * w + x] = 1;
    }
    const shape: Shape = { w, h, bits };
    components.push({ cells, key: canonicalKey(shape) });
  }

  return components;
}

/** Human-readable text for each FailCode (format §4.4), used by the "Check" button. */
export const FAILCODE_MESSAGES: Record<FailCode, string> = {
  csOnArrow: 'A cell with a clue is shaded.',
  bankGt: 'A piece appears too many times on the board.',
  bankInvalid: 'The board contains an invalid piece.',
  shDiag: 'Two pieces are diagonally adjacent.',
  arDistanceGt: 'There is a shaded cell closer to a clue in an unmarked direction.',
  arDistanceNe: 'The shaded cells pointed to by a clue are at different distances.',
  arNoShade: 'There is no shaded cell in the direction of an arrow.',
};
