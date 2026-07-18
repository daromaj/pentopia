import { describe, it, expect } from 'vitest';
import { NO_CLUE, type Puzzle } from '@core/types';
import { PRESETS } from '@core/bank';
import { canonicalKey, shapeFromStrings } from '@core/shape';
import {
  createPlayState,
  loadPuzzle,
  isClueCell,
  startStroke,
  continueStroke,
  endStroke,
  undo,
  redo,
  computeShadedComponents,
  FAILCODE_MESSAGES,
  UNTOUCHED,
  SHADED,
  MARKED_EMPTY,
} from '../src/ui/state';
import type { FailCode } from '@core/types';

function makePuzzle(cols: number, rows: number, clueCells: readonly number[] = []): Puzzle {
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const c of clueCells) clues[c] = 1; // any non-NO_CLUE arrow value marks a clue cell
  return { cols, rows, clues, bank: PRESETS.p!, transparent: false };
}

describe('PlayState cycle', () => {
  it('a plain tap (stroke of one cell, no forced value) cycles untouched -> shaded -> marked-empty -> untouched', () => {
    const state = createPlayState(makePuzzle(3, 3));
    const i = 4;
    expect(state.cellState[i]).toBe(UNTOUCHED);

    startStroke(state, i);
    endStroke(state);
    expect(state.cellState[i]).toBe(SHADED);

    startStroke(state, i);
    endStroke(state);
    expect(state.cellState[i]).toBe(MARKED_EMPTY);

    startStroke(state, i);
    endStroke(state);
    expect(state.cellState[i]).toBe(UNTOUCHED);
  });

  it('startStroke with a forcedValue paints that value directly instead of cycling', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0, MARKED_EMPTY);
    endStroke(state);
    expect(state.cellState[0]).toBe(MARKED_EMPTY);
    // Doing it again with the same forced value stays put (not a cycle).
    startStroke(state, 0, MARKED_EMPTY);
    endStroke(state);
    expect(state.cellState[0]).toBe(MARKED_EMPTY);
  });

  it('clue cells are inert: startStroke never mutates them', () => {
    const state = createPlayState(makePuzzle(3, 3, [4]));
    expect(isClueCell(state, 4)).toBe(true);
    startStroke(state, 4);
    endStroke(state);
    expect(state.cellState[4]).toBe(UNTOUCHED);
    expect(state.undoStack.length).toBe(0);
  });

  it('a drag paints every cell it crosses with the value chosen at stroke start', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0); // untouched -> shaded, paint value = shaded
    continueStroke(state, 1);
    continueStroke(state, 2);
    endStroke(state);
    expect(Array.from(state.cellState.slice(0, 3))).toEqual([SHADED, SHADED, SHADED]);
  });

  it('continueStroke skips clue cells mid-drag', () => {
    const state = createPlayState(makePuzzle(3, 1, [1]));
    startStroke(state, 0);
    continueStroke(state, 1); // clue cell, should stay untouched
    continueStroke(state, 2);
    endStroke(state);
    expect(Array.from(state.cellState)).toEqual([SHADED, UNTOUCHED, SHADED]);
  });
});

describe('undo/redo', () => {
  it('undo reverts a whole stroke (drag) as one step', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0);
    continueStroke(state, 1);
    continueStroke(state, 2);
    endStroke(state);
    expect(Array.from(state.cellState.slice(0, 3))).toEqual([SHADED, SHADED, SHADED]);

    expect(undo(state)).toBe(true);
    expect(Array.from(state.cellState.slice(0, 3))).toEqual([UNTOUCHED, UNTOUCHED, UNTOUCHED]);
    expect(undo(state)).toBe(false); // nothing left to undo
  });

  it('redo re-applies an undone stroke', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0);
    endStroke(state);
    undo(state);
    expect(redo(state)).toBe(true);
    expect(state.cellState[0]).toBe(SHADED);
    expect(redo(state)).toBe(false);
  });

  it('a new stroke clears the redo stack', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0);
    endStroke(state);
    undo(state);
    expect(state.redoStack.length).toBe(1);

    startStroke(state, 1);
    endStroke(state);
    expect(state.redoStack.length).toBe(0);
    expect(redo(state)).toBe(false);
  });

  it('loadPuzzle resets cell state and history in place (keeps object identity)', () => {
    const state = createPlayState(makePuzzle(3, 3));
    startStroke(state, 0);
    endStroke(state);
    const sameRef = state;
    loadPuzzle(state, makePuzzle(4, 4));
    expect(state).toBe(sameRef);
    expect(state.puzzle.cols).toBe(4);
    expect(state.cellState.length).toBe(16);
    expect(state.undoStack.length).toBe(0);
    expect(state.redoStack.length).toBe(0);
  });
});

describe('FAILCODE_MESSAGES', () => {
  it('covers all 7 FailCode values with a non-empty human-readable message', () => {
    const codes: FailCode[] = [
      'csOnArrow',
      'bankGt',
      'bankInvalid',
      'shDiag',
      'arDistanceGt',
      'arDistanceNe',
      'arNoShade',
    ];
    expect(Object.keys(FAILCODE_MESSAGES).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      expect(typeof FAILCODE_MESSAGES[code]).toBe('string');
      expect(FAILCODE_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});

describe('computeShadedComponents', () => {
  it('agrees with canonicalKey for a P-pentomino placed away from the origin', () => {
    const puzzle = makePuzzle(6, 6);
    const state = createPlayState(puzzle);
    // P-pentomino (see core/shape.ts PENTOMINOES.P: '.#','##','##') translated to top-left (2,1):
    //   .#
    //   ##
    //   ##
    const cells: [number, number][] = [
      [3, 1],
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ];
    for (const [x, y] of cells) state.cellState[y * 6 + x] = SHADED;

    const components = computeShadedComponents(puzzle, state.cellState);
    expect(components.length).toBe(1);
    const expectedKey = canonicalKey(shapeFromStrings(['.#', '##', '##']));
    expect(components[0]!.key).toBe(expectedKey);
    expect(components[0]!.cells.length).toBe(5);
  });

  it('splits non-touching shapes into separate components, each with its own canonical key', () => {
    const puzzle = makePuzzle(8, 4);
    const state = createPlayState(puzzle);
    // A 2x2 square (O-tetromino-shaped) at top-left...
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    for (const [x, y] of square) {
      state.cellState[y * 8 + x] = SHADED;
    }
    // ...and a straight line of 3, far enough away not to touch (even diagonally).
    for (const x of [5, 6, 7]) state.cellState[3 * 8 + x] = SHADED;

    const components = computeShadedComponents(puzzle, state.cellState);
    expect(components.length).toBe(2);
    const keys = components.map((c) => c.key).sort();
    const expected = [
      canonicalKey(shapeFromStrings(['##', '##'])),
      canonicalKey(shapeFromStrings(['###'])),
    ].sort();
    expect(keys).toEqual(expected);
  });

  it('marked-empty cells are not shaded and do not form components', () => {
    const puzzle = makePuzzle(3, 3);
    const state = createPlayState(puzzle);
    state.cellState[0] = MARKED_EMPTY;
    state.cellState[1] = MARKED_EMPTY;
    expect(computeShadedComponents(puzzle, state.cellState)).toEqual([]);
  });
});
