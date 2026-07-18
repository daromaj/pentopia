import { describe, it, expect } from 'vitest';
import { decodeUrl, encodeUrl } from '@core/codec/url';
import { decodeNumber16, encodeNumber16 } from '@core/codec/number16';
import { decodePieceBank, encodePieceBank } from '@core/codec/pieceBank';
import { PRESETS, matchPreset } from '@core/bank';
import { PENTOMINOES } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE } from '@core/types';

const GOLDEN_URL = 'https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
const GOLDEN_CANONICAL = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';

const GOLDEN_CLUES: [number, number, number][] = [
  [0, 0, 2],
  [4, 1, 9],
  [8, 3, 10],
  [1, 5, 5],
  [3, 5, 11],
  [7, 5, 6],
  [8, 7, 6],
  [1, 8, 10],
  [5, 8, 9],
  [9, 9, 4],
];

describe('golden sample (format §3.4)', () => {
  it('decodes cols/rows/transparent/clues/bank exactly', () => {
    const p = decodeUrl(GOLDEN_URL);
    expect(p.cols).toBe(10);
    expect(p.rows).toBe(10);
    expect(p.transparent).toBe(false);
    expect(p.clues.length).toBe(100);

    const expectedByCell = new Map<number, number>();
    for (const [x, y, v] of GOLDEN_CLUES) {
      expectedByCell.set(idx(x, y, 10), v);
    }
    for (let i = 0; i < 100; i++) {
      expect(p.clues[i], `cell ${i}`).toBe(expectedByCell.get(i) ?? NO_CLUE);
    }

    expect(matchPreset(p.bank)).toBe('p');
  });

  it('re-encodes to the canonical bare form', () => {
    const p = decodeUrl(GOLDEN_URL);
    expect(encodeUrl(p)).toBe(GOLDEN_CANONICAL);
  });

  it('decodes the bare pentopia/... form and the ?p= form identically', () => {
    const bare = decodeUrl(GOLDEN_CANONICAL);
    const withParam = decodeUrl(`https://example.com/app?p=${GOLDEN_CANONICAL}`);
    expect(encodeUrl(bare)).toBe(GOLDEN_CANONICAL);
    expect(encodeUrl(withParam)).toBe(GOLDEN_CANONICAL);
  });
});

describe('encodeNumber16 / decodeNumber16 round-trip on the golden clue body', () => {
  it('decode(golden body) then re-encode reproduces the identical string', () => {
    const body = '2s9ziar5gbi6z6hai9s4';
    const { values, rest } = decodeNumber16(body, 100);
    expect(rest).toBe('');
    expect(encodeNumber16(values)).toBe(body);
  });
});

describe('second real sample: pentopia/7/6/l6o3bi8q9l5g//t', () => {
  const URL = 'pentopia/7/6/l6o3bi8q9l5g//t';

  const EXPECTED: [number, number, number][] = [
    [6, 0, 6],
    [2, 2, 3],
    [3, 2, 11],
    [0, 3, 8],
    [5, 4, 9],
    [5, 5, 5],
  ];

  it('decodes to 7 cols x 6 rows with the tetromino bank and the documented clues', () => {
    const p = decodeUrl(URL);
    expect(p.cols).toBe(7);
    expect(p.rows).toBe(6);
    expect(p.clues.length).toBe(42);
    expect(matchPreset(p.bank)).toBe('t');

    const expectedByCell = new Map<number, number>();
    for (const [x, y, v] of EXPECTED) {
      expectedByCell.set(idx(x, y, 7), v);
    }
    for (let i = 0; i < 42; i++) {
      expect(p.clues[i], `cell ${i}`).toBe(expectedByCell.get(i) ?? NO_CLUE);
    }
  });

  it('re-encodes to the identical string', () => {
    const p = decodeUrl(URL);
    expect(encodeUrl(p)).toBe(URL);
  });
});

describe('bank presets', () => {
  for (const key of ['p', 't', 'd', 'z']) {
    it(`//${key} decodes and re-encodes identically`, () => {
      const encoded = `//${key}`;
      const { bank, rest } = decodePieceBank(encoded);
      expect(rest).toBe('');
      expect(matchPreset(bank)).toBe(key);
      expect(encodePieceBank(bank)).toBe(encoded);
    });
  }

  it('a 13-piece custom bank (all 12 pentominoes + an extra F) emits explicit form and round-trips', () => {
    const pieces = [...PRESETS.p!.pieces, PENTOMINOES.F!];
    const bank = { pieces };
    expect(matchPreset(bank)).toBeNull();
    const encoded = encodePieceBank(bank);
    expect(encoded.startsWith('/13/')).toBe(true);
    const { bank: decoded, rest } = decodePieceBank(encoded);
    expect(rest).toBe('');
    expect(decoded.pieces.length).toBe(13);
    expect(encodePieceBank(decoded)).toBe(encoded);
  });
});
