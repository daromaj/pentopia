import { describe, it } from 'vitest';
import fc from 'fast-check';
import { canonicalKey, orientations } from '@core/shape';
import { encodeNumber16, decodeNumber16 } from '@core/codec/number16';
import { encodePieceBank, decodePieceBank } from '@core/codec/pieceBank';
import { bankCounts } from '@core/bank';
import type { Shape, Bank } from '@core/types';

/** Build a connected polyomino by random-walking from (0,0), then normalizing to a 0,0-anchored bounding box. */
function shapeFromWalk(dirs: readonly number[]): Shape {
  let x = 0;
  let y = 0;
  const cells = new Set<string>(['0,0']);
  for (const d of dirs) {
    switch (d % 4) {
      case 0:
        x++;
        break;
      case 1:
        x--;
        break;
      case 2:
        y++;
        break;
      default:
        y--;
        break;
    }
    cells.add(`${x},${y}`);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    const [cx, cy] = c.split(',').map(Number) as [number, number];
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx);
    maxY = Math.max(maxY, cy);
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const bits = new Uint8Array(w * h);
  for (const c of cells) {
    const [cx, cy] = c.split(',').map(Number) as [number, number];
    bits[(cy - minY) * w + (cx - minX)] = 1;
  }
  return { w, h, bits };
}

const walkArb = fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength: 24 });
const shapeArb = walkArb.map(shapeFromWalk);

describe('property: canonicalKey invariant under dihedral transforms', () => {
  it('a random connected polyomino keeps the same canonicalKey under any of its own orientations', () => {
    fc.assert(
      fc.property(shapeArb, fc.integer({ min: 0, max: 7 }), (shape, pick) => {
        const variants = orientations(shape);
        const chosen = variants[pick % variants.length]!;
        return canonicalKey(chosen) === canonicalKey(shape);
      }),
    );
  });
});

const clueValueArb = fc.oneof(
  fc.constant(-2),
  fc.constant(-1),
  fc.integer({ min: 0, max: 20000 }),
);

describe('property: Number16 round-trip', () => {
  it('decode(encode(values)) === values for random clue arrays', () => {
    fc.assert(
      fc.property(fc.array(clueValueArb, { minLength: 0, maxLength: 150 }), (arr) => {
        const values = Int16Array.from(arr);
        const encoded = encodeNumber16(values);
        const { values: decoded, rest } = decodeNumber16(encoded, values.length);
        return rest === '' && Array.from(decoded).every((v, i) => v === values[i]);
      }),
    );
  });
});

describe('property: piece bank round-trip', () => {
  it('a random bank of shapes survives encodePieceBank -> decodePieceBank as the same canonical multiset', () => {
    fc.assert(
      fc.property(fc.array(shapeArb, { minLength: 0, maxLength: 15 }), (pieces) => {
        const bank: Bank = { pieces };
        const encoded = encodePieceBank(bank);
        const { bank: decoded, rest } = decodePieceBank(encoded);
        if (rest !== '') return false;
        const a = bankCounts(bank);
        const b = bankCounts(decoded);
        if (a.size !== b.size) return false;
        for (const [k, v] of a) {
          if (b.get(k) !== v) return false;
        }
        return true;
      }),
    );
  });
});
