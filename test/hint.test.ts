/**
 * Tests for the learning-mode "Hint" logic (src/ui/hint.ts). Pure functions,
 * no DOM — every scenario builds a Uint8Array `cellState` by hand (or derives
 * one from the puzzle's own unique solution) and calls `computeHint` directly.
 */

import { describe, it, expect } from 'vitest';
import { computeHint, _hintCacheSizeForTests } from '../src/ui/hint';
import { SHADED, MARKED_EMPTY } from '../src/ui/state';
import { solve } from '@solver/search';
import { decodeUrl } from '@core/codec/url';
import { shapeFromStrings } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, dirBit, Dir, type Bank, type Puzzle, type Solution } from '@core/types';

function mkPuzzle(cols: number, rows: number, clues: Record<number, number>, bank: Bank): Puzzle {
  const c = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const k of Object.keys(clues)) c[+k] = clues[+k]!;
  return { cols, rows, clues: c, bank, transparent: false };
}

const mono: Bank = { pieces: [shapeFromStrings(['#'])] };

/** The format §3.4 10x10 sample puzzle — known uniquely solvable (see test/deduce.test.ts). */
const SAMPLE: Puzzle = decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');

function uniqueSolution(puzzle: Puzzle): Solution {
  const res = solve(puzzle, { maxSolutions: 2 });
  expect(res.solutions.length).toBe(1);
  expect(res.complete).toBe(true);
  return res.solutions[0]!;
}

const CELL_REF = /r\d+c\d+/;

describe('computeHint', () => {
  it('errors beat next-step deduction: a wrongly shaded cell is flagged before any new deduction', () => {
    const solution = uniqueSolution(SAMPLE);
    const cellState = new Uint8Array(SAMPLE.cols * SAMPLE.rows);
    // Pick a cell the solution leaves unshaded and shade it — a mistake.
    const badCell = Array.from(solution.shaded).findIndex((v, i) => v === 0 && SAMPLE.clues[i] === NO_CLUE);
    expect(badCell).toBeGreaterThanOrEqual(0);
    cellState[badCell] = SHADED;

    const hint = computeHint(SAMPLE, cellState);
    expect(hint).not.toBeNull();
    expect(hint!.kind).toBe('error');
    expect(hint!.cells).toContain(badCell);
    expect(hint!.message).toMatch(CELL_REF);
    expect(hint!.message).toMatch(/shouldn't be shaded/);
  });

  it('a marked-empty cell that the solution actually shades is also an error (not a shade suggestion)', () => {
    const solution = uniqueSolution(SAMPLE);
    const cellState = new Uint8Array(SAMPLE.cols * SAMPLE.rows);
    const badCell = Array.from(solution.shaded).findIndex((v, i) => v === 1 && SAMPLE.clues[i] === NO_CLUE);
    expect(badCell).toBeGreaterThanOrEqual(0);
    cellState[badCell] = MARKED_EMPTY;

    const hint = computeHint(SAMPLE, cellState);
    expect(hint!.kind).toBe('error');
    expect(hint!.cells).toContain(badCell);
    expect(hint!.message).toMatch(CELL_REF);
    expect(hint!.message).toMatch(/part of a shape/);
  });

  it('the first hint on a fresh puzzle is a sensible shade/exclude step with a non-empty, cell-referencing message', () => {
    const cellState = new Uint8Array(SAMPLE.cols * SAMPLE.rows);
    const hint = computeHint(SAMPLE, cellState);
    expect(hint).not.toBeNull();
    expect(['shade', 'exclude']).toContain(hint!.kind);
    expect(hint!.cells.length).toBeGreaterThan(0);
    expect(hint!.cells.length).toBeLessThanOrEqual(2);
    expect(hint!.message.length).toBeGreaterThan(0);
    expect(hint!.message).toMatch(CELL_REF);
    // Every highlighted cell must be one the player can actually act on.
    for (const c of hint!.cells) expect(SAMPLE.clues[c]).toBe(NO_CLUE);
  });

  it('a fully and correctly decided board returns kind "solved"', () => {
    // Small deterministic puzzle: 3x3, monomino bank, one clue (Up only) at
    // the centre — the arrowed ray has a single cell (1,0), so the unique
    // solution shades exactly that cell.
    const clue = idx(1, 1, 3);
    const puzzle = mkPuzzle(3, 3, { [clue]: dirBit(Dir.Up) }, mono);
    const solution = uniqueSolution(puzzle);

    const cellState = new Uint8Array(9);
    for (let i = 0; i < 9; i++) {
      if (puzzle.clues[i] !== NO_CLUE) continue; // clue cells stay untouched — inert in the UI
      cellState[i] = solution.shaded[i] === 1 ? SHADED : MARKED_EMPTY;
    }

    const hint = computeHint(puzzle, cellState);
    expect(hint!.kind).toBe('solved');
    expect(hint!.message.length).toBeGreaterThan(0);
  });

  it('an ambiguous (non-unique-solution) puzzle returns kind "stuck" with an honest message', () => {
    // No clues at all + a single monomino: any of the 9 cells could hold it,
    // so this has many solutions, not one.
    const puzzle = mkPuzzle(3, 3, {}, mono);
    const cellState = new Uint8Array(9);
    const hint = computeHint(puzzle, cellState);
    expect(hint!.kind).toBe('stuck');
    expect(hint!.cells).toEqual([]);
    expect(hint!.message.toLowerCase()).toMatch(/unique solution/);
  });

  it('malformed input (cellState length mismatch) returns null rather than throwing', () => {
    const puzzle = mkPuzzle(3, 3, {}, mono);
    expect(computeHint(puzzle, new Uint8Array(3))).toBeNull();
  });

  it('memoizes solve/deduce per puzzle: repeated calls on the same puzzle do not grow the cache, a new puzzle does', () => {
    const puzzleA = mkPuzzle(4, 4, {}, mono);
    const puzzleB = mkPuzzle(5, 4, {}, mono); // distinct shape -> distinct canonical URL

    computeHint(puzzleA, new Uint8Array(16));
    const sizeAfterFirst = _hintCacheSizeForTests();

    // Same puzzle content, a *different* (but equal) cellState array — still
    // the same canonical puzzle URL, so no new cache entry should appear.
    computeHint(puzzleA, new Uint8Array(16));
    computeHint(puzzleA, new Uint8Array(16));
    expect(_hintCacheSizeForTests()).toBe(sizeAfterFirst);

    computeHint(puzzleB, new Uint8Array(20));
    expect(_hintCacheSizeForTests()).toBe(sizeAfterFirst + 1);
  });

  it('repeated calls on an identical board return equal (deterministic) hints', () => {
    const cellState = new Uint8Array(SAMPLE.cols * SAMPLE.rows);
    const first = computeHint(SAMPLE, cellState);
    const second = computeHint(SAMPLE, cellState);
    expect(second).toEqual(first);
  });
});
