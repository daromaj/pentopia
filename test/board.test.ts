import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BitBoard } from '@solver/board';

/** Naive reference: king-move halo of a set of cells (excluding the cells). */
function naiveKingHalo(cols: number, rows: number, set: Set<number>): Set<number> {
  const halo = new Set<number>();
  for (const i of set) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (!set.has(ni)) halo.add(ni);
      }
    }
  }
  return halo;
}

/** Naive reference: directional shift of a set of cells with edge clamping. */
function naiveShift(cols: number, rows: number, set: Set<number>, dx: number, dy: number): Set<number> {
  const out = new Set<number>();
  for (const i of set) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
    out.add(ny * cols + nx);
  }
  return out;
}

function boardOf(cols: number, rows: number, cells: Iterable<number>): BitBoard {
  const b = new BitBoard(cols, rows);
  for (const c of cells) b.set(c);
  return b;
}

const DIRS8: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

describe('BitBoard basic ops', () => {
  it('set / test / clear / popcount / isEmpty', () => {
    const b = new BitBoard(10, 10);
    expect(b.isEmpty()).toBe(true);
    b.set(0);
    b.set(45);
    b.set(99);
    expect(b.test(0)).toBe(true);
    expect(b.test(45)).toBe(true);
    expect(b.test(99)).toBe(true);
    expect(b.test(1)).toBe(false);
    expect(b.popcount()).toBe(3);
    expect(b.isEmpty()).toBe(false);
    b.clear(45);
    expect(b.test(45)).toBe(false);
    expect(b.popcount()).toBe(2);
  });

  it('or/and/andNot assign, intersects, equals, clone', () => {
    const a = boardOf(8, 8, [0, 1, 2, 3]);
    const b = boardOf(8, 8, [2, 3, 4, 5]);
    expect(a.intersects(b)).toBe(true);
    const c = a.clone();
    expect(c.equals(a)).toBe(true);
    c.set(63);
    expect(c.equals(a)).toBe(false);

    const orab = a.clone().orAssign(b);
    expect(orab.toArray()).toEqual([0, 1, 2, 3, 4, 5]);
    const andab = a.clone().andAssign(b);
    expect(andab.toArray()).toEqual([2, 3]);
    const andnot = a.clone().andNotAssign(b);
    expect(andnot.toArray()).toEqual([0, 1]);

    const disjoint = boardOf(8, 8, [6, 7]);
    expect(a.intersects(disjoint)).toBe(false);
  });

  it('forEach / toArray visit set bits ascending, spanning word boundaries', () => {
    const b = boardOf(10, 10, [99, 0, 32, 31, 64, 63]);
    expect(b.toArray()).toEqual([0, 31, 32, 63, 64, 99]);
  });
});

describe('BitBoard.shift edge masks (no row/edge wrap)', () => {
  // Exhaustive single-cell test across every border and corner on a small grid.
  it('single-cell shift on every cell of a 5x4 board matches naive, all 8 dirs', () => {
    const cols = 5;
    const rows = 4;
    for (let i = 0; i < cols * rows; i++) {
      for (const [dx, dy] of DIRS8) {
        const got = boardOf(cols, rows, [i]).shift(dx, dy);
        const want = naiveShift(cols, rows, new Set([i]), dx, dy);
        expect(new Set(got.toArray())).toEqual(want);
      }
    }
  });

  it('property: random boards, all 8 dirs, several dims incl. >32-bit widths', () => {
    const dims: [number, number][] = [
      [1, 1],
      [1, 7],
      [7, 1],
      [5, 5],
      [6, 7],
      [8, 8],
      [10, 10],
      [33, 3], // width crosses a 32-bit word boundary within a row
      [12, 12],
    ];
    for (const [cols, rows] of dims) {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: cols * rows - 1 }), { maxLength: 40 }), (cells) => {
          const set = new Set(cells);
          for (const [dx, dy] of DIRS8) {
            const got = new Set(boardOf(cols, rows, set).shift(dx, dy).toArray());
            const want = naiveShift(cols, rows, set, dx, dy);
            expect(got).toEqual(want);
          }
        }),
        { numRuns: 60 },
      );
    }
  });
});

describe('BitBoard.kingHalo', () => {
  it('single-cell halo on every cell of a 5x4 board (corners/borders/interior)', () => {
    const cols = 5;
    const rows = 4;
    for (let i = 0; i < cols * rows; i++) {
      const got = new Set(boardOf(cols, rows, [i]).kingHalo().toArray());
      const want = naiveKingHalo(cols, rows, new Set([i]));
      expect(got).toEqual(want);
    }
  });

  it('corner cell has exactly 3 halo cells; edge 5; interior 8', () => {
    const cols = 6;
    const rows = 6;
    expect(boardOf(cols, rows, [0]).kingHalo().popcount()).toBe(3); // top-left corner
    expect(boardOf(cols, rows, [5]).kingHalo().popcount()).toBe(3); // top-right corner
    expect(boardOf(cols, rows, [35]).kingHalo().popcount()).toBe(3); // bottom-right corner
    expect(boardOf(cols, rows, [2]).kingHalo().popcount()).toBe(5); // top edge
    expect(boardOf(cols, rows, [14]).kingHalo().popcount()).toBe(8); // interior (2,2)
  });

  it('halo excludes the set cells themselves', () => {
    const cols = 8;
    const rows = 8;
    const set = new Set([9, 10, 17, 18]); // a 2x2 block
    const halo = boardOf(cols, rows, set).kingHalo();
    for (const c of set) expect(halo.test(c)).toBe(false);
  });

  it('property: kingHalo matches naive across dims incl. >32-bit width', () => {
    const dims: [number, number][] = [
      [1, 1],
      [1, 9],
      [9, 1],
      [5, 5],
      [6, 7],
      [10, 10],
      [33, 4],
      [12, 12],
    ];
    for (const [cols, rows] of dims) {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: cols * rows - 1 }), { maxLength: 40 }), (cells) => {
          const set = new Set(cells);
          const got = new Set(boardOf(cols, rows, set).kingHalo().toArray());
          const want = naiveKingHalo(cols, rows, set);
          expect(got).toEqual(want);
        }),
        { numRuns: 80 },
      );
    }
  });
});
