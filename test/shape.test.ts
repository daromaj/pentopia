import { describe, it, expect } from 'vitest';
import { canonicalKey, orientations, PENTOMINOES, TETROMINOES, shapeFromStrings } from '@core/shape';
import { serializeBankPiece, deserializeBankPiece } from '@core/bank';

describe('shapeFromStrings', () => {
  it('parses # as filled, else empty', () => {
    const s = shapeFromStrings(['.#.', '###']);
    expect(s.w).toBe(3);
    expect(s.h).toBe(2);
    expect(Array.from(s.bits)).toEqual([0, 1, 0, 1, 1, 1]);
  });
});

describe('canonicalKey', () => {
  it('is invariant under all 8 dihedral transforms, per shape', () => {
    for (const [name, shape] of Object.entries({ ...PENTOMINOES, ...TETROMINOES })) {
      const key = canonicalKey(shape);
      for (const variant of orientations(shape)) {
        expect(canonicalKey(variant), `${name} variant`).toBe(key);
      }
    }
  });

  it('gives 12 distinct keys for the 12 free pentominoes', () => {
    const keys = new Set(Object.values(PENTOMINOES).map(canonicalKey));
    expect(keys.size).toBe(12);
  });

  it('gives 5 distinct keys for the 5 free tetrominoes', () => {
    const keys = new Set(Object.values(TETROMINOES).map(canonicalKey));
    expect(keys.size).toBe(5);
  });
});

describe('orientations', () => {
  it('yields at most 8 variants, fewer for symmetric shapes (X pentomino has 4-fold symmetry)', () => {
    expect(orientations(PENTOMINOES.X!).length).toBe(1);
    expect(orientations(PENTOMINOES.I!).length).toBe(2);
    expect(orientations(TETROMINOES.O!).length).toBe(1);
    // F has no symmetry: all 8 distinct.
    expect(orientations(PENTOMINOES.F!).length).toBe(8);
  });
});

describe('Appendix A catalog codes', () => {
  const pentominoCodes: Record<string, string> = {
    F: '337k',
    I: '15v',
    L: '24as',
    N: '24bo',
    P: '23fg',
    T: '337i',
    U: '23rg',
    V: '334u',
    W: '335s',
    X: '33bk',
    Y: '24bk',
    Z: '337o',
  };

  const tetrominoCodes: Record<string, string> = {
    I: '14u',
    L: '23bg',
    O: '22u',
    S: '23f',
    T: '23eg',
  };

  for (const [letter, code] of Object.entries(pentominoCodes)) {
    it(`pentomino ${letter} (${code}) deserializes to the drawn shape and round-trips`, () => {
      const shape = deserializeBankPiece(code);
      const expected = PENTOMINOES[letter]!;
      expect(shape.w).toBe(expected.w);
      expect(shape.h).toBe(expected.h);
      expect(Array.from(shape.bits)).toEqual(Array.from(expected.bits));
      expect(serializeBankPiece(shape)).toBe(code);
    });
  }

  for (const [letter, code] of Object.entries(tetrominoCodes)) {
    it(`tetromino ${letter} (${code}) deserializes to the drawn shape and round-trips`, () => {
      const shape = deserializeBankPiece(code);
      const expected = TETROMINOES[letter]!;
      expect(shape.w).toBe(expected.w);
      expect(shape.h).toBe(expected.h);
      expect(Array.from(shape.bits)).toEqual(Array.from(expected.bits));
      expect(serializeBankPiece(shape)).toBe(code);
    });
  }
});
