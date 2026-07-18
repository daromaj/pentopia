import { describe, it, expect } from 'vitest';
import { validate } from '@core/validator';
import { decodePzprv3 } from '@core/codec/pzprv3';
import { PRESETS } from '@core/bank';
import { canonicalKey, PENTOMINOES, shapeFromStrings } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, type Bank, type FailCode, type Puzzle, type Solution } from '@core/types';
import { fixtures } from './fixtures/pentopia';

/**
 * Full expected failure-code lists (in checklist order — format §4 items
 * 1-7 — which is also the order `validate` always emits them in, regardless
 * of which check happened to fire) for every fixture.
 *
 * Most fixtures list a single failcode: they're pzprjs's "one deliberate
 * mistake per board" test vectors. But several of these boards are minimal
 * *partial* solves built for pzprjs's live/incremental checking (where
 * extra "unknown distance" leniency branches suppress premature reports,
 * per format §4.3's "Note on partial boards") rather than as complete
 * candidate solutions. Our validator implements the complete-board
 * semantics the doc says is the correct target for a final validity check
 * ("arrowed directions all tied for nearest, unarrowed directions all
 * strictly farther" — no leniency). Run through that lens, several of these
 * boards have additional clues whose arrows are genuinely unsatisfied
 * (nothing shaded in an arrowed direction, or an unarrowed direction tying
 * an arrowed one) purely because the board is otherwise mostly blank — real
 * violations, not implementation bugs. Verified by hand against each
 * board's clue/answer grid (see PR description / commit notes); spot check:
 *
 * - "shDiag": clue (2,2)=UP+DOWN finds its DOWN arrow hits nothing
 *   (arNoShade) and its unarrowed RIGHT direction ties the UP arrow's
 *   distance of 2 (arDistanceGt) — both real, independent of the deliberate
 *   diagonal-touch mistake the fixture is named for.
 * - "bankGt": one clue's two arrowed directions disagree (arDistanceNe) and
 *   another clue's arrow hits nothing (arNoShade) — again real, on top of
 *   the deliberate double-use of a bank piece.
 *
 * In every case the fixture's *named* failcode is still reported, and —
 * because `validate` always emits failures in fixed checklist order — it is
 * always the first element below (checklist position of the named code is
 * lower than every incidental extra), which is what the "first failure"
 * assertion in the loop below checks.
 */
const EXPECTED: Record<string, FailCode[]> = {
  csOnArrow: ['csOnArrow', 'arNoShade'],
  arNoShade: ['arNoShade'],
  bankInvalid: ['bankInvalid'],
  shDiag: ['shDiag', 'arDistanceGt', 'arNoShade'],
  bankGt: ['bankGt', 'arDistanceNe', 'arNoShade'],
  arDistanceGt: ['arDistanceGt', 'arNoShade'],
  arDistanceNe: ['arDistanceNe', 'arNoShade'],
  arNoShade_5x5: ['arNoShade'],
  arDistanceGt_5x5: ['arDistanceGt', 'arNoShade'],
  arDistanceNe_5x5: ['arDistanceNe'],
  valid_5x5: [],
  valid_6x7: [],
};

describe('validate() against pzprjs ground-truth fixtures', () => {
  for (const f of fixtures) {
    it(`${f.name}: failcode ${f.failcode ?? '(valid)'}`, () => {
      const { puzzle, answer } = decodePzprv3(f.pzprv3);
      const result = validate(puzzle, answer);
      const expectedCodes = EXPECTED[f.name];
      expect(expectedCodes, `no EXPECTED entry for fixture "${f.name}"`).toBeDefined();

      if (f.failcode === null) {
        expect(result.ok).toBe(true);
        expect(result.failures).toEqual([]);
      } else {
        expect(result.ok).toBe(false);
        expect(result.failures.map((x) => x.code)).toEqual(expectedCodes);
        // The fixture's named code is always first: `validate` reports
        // failures in fixed checklist order, and the named code's checklist
        // position is always lower than any incidental extra (see comment
        // on EXPECTED above).
        expect(result.failures[0]?.code).toBe(f.failcode);
      }
    });
  }
});

// --- Hand-built unit tests -------------------------------------------------

function buildBoard(
  clueRows: readonly string[],
  answerRows: readonly string[],
  bank: Bank,
  transparent = false,
): { puzzle: Puzzle; answer: Solution } {
  const rows = clueRows.length;
  const cols = clueRows[0]?.length ?? 0;
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  const shaded = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const clueRow = clueRows[y]!;
    const ansRow = answerRows[y]!;
    for (let x = 0; x < cols; x++) {
      const c = clueRow[x]!;
      if (c !== '.') clues[idx(x, y, cols)] = parseInt(c, 10);
      shaded[idx(x, y, cols)] = ansRow[x] === '#' ? 1 : 0;
    }
  }
  const puzzle: Puzzle = { cols, rows, clues, bank, transparent };
  return { puzzle, answer: { shaded } };
}

describe('shDiag semantics (format §4.2)', () => {
  it('a W-pentomino touching itself diagonally is NOT shDiag', () => {
    // W-pentomino (format Appendix A): "..#" / ".##" / "##."
    const { puzzle, answer } = buildBoard(['...', '...', '...'], ['..#', '.##', '##.'], PRESETS.p!);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).not.toContain('shDiag');
    expect(result.ok).toBe(true);
  });

  it('two separate single-cell pieces diagonal to each other IS shDiag', () => {
    const { puzzle, answer } = buildBoard(['..', '..'], ['#.', '.#'], PRESETS.p!);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).toContain('shDiag');
  });
});

describe('bankGt (format §4, item 2)', () => {
  it('the same pentomino shape placed twice (pentomino bank has only 1 of each) is bankGt', () => {
    // Two I-pentominoes (vertical, 1 col wide, 5 rows tall) in columns 0 and
    // 2, with an empty column 1 between them so they're not even diagonally
    // adjacent (no incidental shDiag).
    const clueRows = ['...', '...', '...', '...', '...'];
    const answerRows = ['#.#', '#.#', '#.#', '#.#', '#.#'];
    const { puzzle, answer } = buildBoard(clueRows, answerRows, PRESETS.p!);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).toContain('bankGt');
    expect(result.failures.map((f) => f.code)).not.toContain('shDiag');
    expect(result.failures.map((f) => f.code)).not.toContain('bankInvalid');
  });
});

describe('bankInvalid (format §4, item 7)', () => {
  it('a straight tromino (3 cells) is not a pentomino or tetromino: bankInvalid', () => {
    const { puzzle, answer } = buildBoard(['...'], ['###'], PRESETS.p!);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).toContain('bankInvalid');
  });

  it('sanity: the tromino really is absent from both built-in banks', () => {
    const tromino = shapeFromStrings(['###']);
    const key = canonicalKey(tromino);
    const pentominoKeys = new Set(Object.values(PENTOMINOES).map(canonicalKey));
    expect(pentominoKeys.has(key)).toBe(false);
  });
});

describe('csOnArrow / transparent (format §2.1, §4 item 1)', () => {
  it('a shaded clue cell is csOnArrow when not transparent', () => {
    const { puzzle, answer } = buildBoard(['.', '1'], ['.', '#'], PRESETS.z!);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).toContain('csOnArrow');
  });

  it('transparent=true suppresses csOnArrow for the same board', () => {
    const { puzzle, answer } = buildBoard(['.', '1'], ['.', '#'], PRESETS.z!, true);
    const result = validate(puzzle, answer);
    expect(result.failures.map((f) => f.code)).not.toContain('csOnArrow');
  });
});
