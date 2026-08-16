import { describe, it, expect } from 'vitest';
import { penpaToPuzzle, penpaAnswer } from '../src/cli/penpa';
import { encodeUrl } from '@core/codec/url';
import { validate } from '@core/validator';
import { deduce } from '@solver/deduce';
import { idx } from '@core/grid';
import { NO_CLUE } from '@core/types';

/**
 * "Pentopia - One-way Crossing" by athin (logic-masters.de puzzle 0004UO),
 * exported from penpa-edit with the author's answer embedded in `a=`.
 */
const PENPA_URL =
  'https://swaroopg92.github.io/penpa-edit/#m=solve&p=7VZha+M4EP2eX6EVLNyB2tpOmqQ+jqOX3d6XvWuv7bIUE4piK4mILPkkudm4dH/7juQ0jpukhYOF+3A4HkZPk5knWfNs809JNSPhqft1hyQgIVz9YOjvcAhjuJ+vW24Fi9EVk1YVnKIjdCnZ0ZKu0EgrY7ickfPSzpWOEbVzLsnc2sLEJydCzXh6lFNjmTbHGTu5pswaJgqlLRXPo5OK8RmTx8W8+I1nvwZB0Pt8Sa5LwQxS003Z+H304UrQlCGjcoYKB+dcKoji4CI7Z2imeYZ+ksoiyVJmDNVcrBAVwiWCgPxn+DM41LrRCmUKuWCrynSOGAWjANfvo5HH2QOTKON0piTkWB0DA0diq3JKpQvUrGCQk8sNi1+QVpZarqRBVGYQMRUsrcfAhTb8ETwJlALOM6ZZ5jMYCis0c1qwdc1bAKnWaokyBgWhcrMo1AOO+jn5EvgzD0sGmY1t7ZSrJVRKLRSCSAkDtYAHiKZa5fXG1Gdjp+56pRPH9cETncDOylWT/phcXlyQKRWGdZL12Rl3EhxigiO4Qzz+Vt18SzAm4bjzWF3Hj9V9nIyfSPW5cYeNexM/gv3L29Dbu/gR9wIcJ5v8BHt696k7iS4xwb1+E+DGOwGD8I2AMNjUCPfXCKOui3BdA9feiIGPeC3HcE0U5g9EnPmIV6pENdPXIsI3c5y+taPR6WbHDqwl6kdv7GnUP6t5HK4yGLzKFJ7/hT8Fkbe3cEhI1fX2g7eBt6fefvIxH7394u3I2563fR8zcMes00l6tfwdukAk/5/9b8+CzICiYKPEvSn1FF4SOLa6ZMRDsswnTOPYS1MNgewVgksI2wL5TCrN9k45kGWzffETpUG4WxNLEOcWUGtqC0q5TkUbspq3xv78t5Ac3q8tYEItvJvNnBftTKDJbQKWtinSBbwb27mbNT918Ffs76QL3dp1an0WV+ek+iNu6Tmp/ga5/jOubpxa18rues8HReB+bNwvft55oxoMQQVA3Wsf3DtwX4pCdRUn1S3BrtTvPoFzcQ6vINAKT8WNU5VPYDUJ3tqPesaUmVqU61ivIeeHGXcbxs6tGTtvD2O3EMe4fo73n34A3bPxU/0kgn/9tvxBmvl13WxKN/22dZQA3tNzgO7trTW+016A7zSSK7jbS4DuaSdAX3YUQLtNBeBOXwF2oLVc1pfd5Vi9bDBXaqfHXKntNgPVGik509SWov5YfIfuVAkfqeJh/SlYlFUlWP1FukQTmi7gcxUtlV68+w4=&a=VZDLDYQwDER74cwBjxMnrgXRfxvsPE4roadgzydw30dcOs4flxmXqY8BJyyIRm0mHGznRzRzm4W3SF4Dolm4NvnNvK0Xd1DYJXqV1ii/c0Lrlehp10AzOE8Siu3CtZjQLtpFu2jXRrPRtPPz8iS5Q4bnGfZm2Jvhr8vwH8hwyzDKu/KqvNl+bee3Y1rHc95/z/MC';

// Arrow bits: UP=1, DOWN=2, LEFT=4, RIGHT=8.
const EXPECTED_CLUES: [number, number, number][] = [
  [6, 0, 2], // (col, row, mask)
  [12, 1, 2],
  [3, 3, 8],
  [7, 4, 15],
  [0, 7, 8],
  [13, 7, 1],
  [4, 8, 15],
  [8, 8, 15],
  [5, 9, 15],
  [2, 11, 8],
  [13, 11, 2],
  [1, 12, 4],
  [9, 12, 15],
];

describe('penpa-edit import', () => {
  it('reads the board size, title and arrow clues', () => {
    const { puzzle, title, arrowless } = penpaToPuzzle(PENPA_URL);
    expect(title).toBe('Pentopia - One-way Crossing');
    expect(puzzle.cols).toBe(15);
    expect(puzzle.rows).toBe(15);
    expect(puzzle.transparent).toBe(false);
    expect(puzzle.bank.pieces).toHaveLength(12);

    for (const [x, y, mask] of EXPECTED_CLUES) {
      expect(puzzle.clues[idx(x, y, 15)], `clue at (${x},${y})`).toBe(mask);
    }
    const clued = [...puzzle.clues].filter((v) => v !== NO_CLUE);
    expect(clued).toHaveLength(EXPECTED_CLUES.length);

    // penpa's arrow_cross draws nothing when all four flags are 0
    // (class_square.js draw_arrowcross: `if (num[i] === 1)`), so these two
    // leftover symbols are invisible in the source puzzle and are dropped.
    expect(arrowless.map((c) => [c % 15, Math.floor(c / 15)])).toEqual([
      [0, 0],
      [1, 11],
    ]);
  });

  it('encodes to a puzz.link string', () => {
    const { puzzle } = penpaToPuzzle(PENPA_URL);
    expect(encodeUrl(puzzle)).toBe('pentopia/15/15/l2z2z8xfzw8r1kfifqfzl8p2h4mfzu//p');
  });

  it("deduces exactly the author's embedded answer, guess-free", () => {
    const { puzzle } = penpaToPuzzle(PENPA_URL);
    const expected = new Uint8Array(puzzle.cols * puzzle.rows);
    for (const c of penpaAnswer(PENPA_URL, puzzle.cols, puzzle.rows)!) expected[c] = 1;

    const ded = deduce(puzzle);
    expect(ded.solved).toBe(true);
    expect(ded.solution!.shaded).toEqual(expected);
  });

  it("validates the author's embedded answer against the imported clues", () => {
    const { puzzle } = penpaToPuzzle(PENPA_URL);
    const cells = penpaAnswer(PENPA_URL, puzzle.cols, puzzle.rows)!;
    expect(cells).toHaveLength(60);

    const shaded = new Uint8Array(puzzle.cols * puzzle.rows);
    for (const c of cells) shaded[c] = 1;
    const res = validate(puzzle, { shaded });
    expect(res.failures).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
