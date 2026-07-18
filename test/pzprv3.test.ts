import { describe, it, expect } from 'vitest';
import { decodePzprv3 } from '@core/codec/pzprv3';
import { decodeUrl } from '@core/codec/url';
import { idx } from '@core/grid';
import { NO_CLUE } from '@core/types';
import { fixtures } from './fixtures/pentopia';

function fixtureByName(name: string) {
  const f = fixtures.find((x) => x.name === name);
  if (!f) throw new Error(`no such fixture: ${name}`);
  return f;
}

describe('decodePzprv3', () => {
  describe('6x7-family fixture (rows=6, cols=7, tetromino bank, not transparent)', () => {
    const { puzzle, answer } = decodePzprv3(fixtureByName('valid_6x7').pzprv3);

    it('has the right dims and flags', () => {
      // pzprv3 lists rows before cols (opposite of the URL envelope) - see
      // src/core/codec/pzprv3.ts header comment.
      expect(puzzle.rows).toBe(6);
      expect(puzzle.cols).toBe(7);
      expect(puzzle.transparent).toBe(false);
      expect(puzzle.bank.pieces.length).toBe(5); // tetromino preset
    });

    it('decodes the documented clue values', () => {
      const expectedByCell: [number, number, number][] = [
        [6, 0, 6],
        [2, 2, 3],
        [3, 2, 11],
        [0, 3, 8],
        [5, 4, 9],
        [5, 5, 5],
      ];
      const byCell = new Map<number, number>();
      for (const [x, y, v] of expectedByCell) byCell.set(idx(x, y, puzzle.cols), v);
      for (let i = 0; i < puzzle.clues.length; i++) {
        expect(puzzle.clues[i], `cell ${i}`).toBe(byCell.get(i) ?? NO_CLUE);
      }
    });

    it('decodes shaded cells from the answer grid ("+" and "." both unshaded)', () => {
      // valid_6x7 answer rows (row-major):
      // + # # # + + +
      // + # + + + + +
      // + + + + + # +
      // + + + + + # #
      // + + # # + + #
      // + + # # + + +
      const expectedShaded = new Set<number>(
        [
          [1, 0], [2, 0], [3, 0],
          [1, 1],
          [5, 2],
          [5, 3], [6, 3],
          [2, 4], [3, 4], [6, 4],
          [2, 5], [3, 5],
        ].map(([x, y]) => idx(x!, y!, puzzle.cols)),
      );
      for (let i = 0; i < answer.shaded.length; i++) {
        expect(answer.shaded[i], `cell ${i}`).toBe(expectedShaded.has(i) ? 1 : 0);
      }
    });
  });

  describe('5x5-family fixture (rows=5, cols=5, pentomino bank, transparent)', () => {
    const { puzzle } = decodePzprv3(fixtureByName('valid_5x5').pzprv3);

    it('has the right dims and flags', () => {
      expect(puzzle.rows).toBe(5);
      expect(puzzle.cols).toBe(5);
      expect(puzzle.transparent).toBe(true);
      expect(puzzle.bank.pieces.length).toBe(12); // pentomino preset
    });

    it('decodes the single clue', () => {
      expect(puzzle.clues[idx(2, 2, puzzle.cols)]).toBe(5);
      let clueCount = 0;
      for (let i = 0; i < puzzle.clues.length; i++) {
        if (puzzle.clues[i] !== NO_CLUE) clueCount++;
      }
      expect(clueCount).toBe(1);
    });
  });

  describe('cross-check against the URL codec', () => {
    it('pentopia/7/6/l6o3bi8q9l5g//t decodes to the same clue grid as the equivalent pzprv3 fixture', () => {
      const fromUrl = decodeUrl('pentopia/7/6/l6o3bi8q9l5g//t');
      const { puzzle: fromPzprv3 } = decodePzprv3(fixtureByName('valid_6x7').pzprv3);

      expect(fromUrl.cols).toBe(fromPzprv3.cols);
      expect(fromUrl.rows).toBe(fromPzprv3.rows);
      expect(Array.from(fromUrl.clues)).toEqual(Array.from(fromPzprv3.clues));
    });
  });
});
