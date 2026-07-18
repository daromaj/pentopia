/**
 * The "Number16" clue-grid codec (format §3.2): one signed value per cell,
 * row-major, hex-like with run-length-encoded "no clue" gaps.
 *
 * g-z run-length semantics (resolved empirically, see docs/roadmap.md
 * Phase 1b + format §3.4): a letter in `g`-`z` skips
 * `parseInt(letter, 36) - 15` cells (so `g` -> 1, `z` -> 20), NOT
 * "16-35 blanks" as a literal reading of the spec's parenthetical might
 * suggest. Decoding the format §3.4 golden sample
 * (`2s9ziar5gbi6z6hai9s4` for a 10x10 grid) character-by-character against
 * the documented clue table confirms this exactly: e.g. the leading `2`
 * lands at (0,0), the following `s` (base36 28, skip 13) lands the next
 * value `9` at cell index 14 = (4,1) as documented, and so on for all 10
 * clues with zero slack — the "16-35" in the spec is describing the base36
 * *character* range (g=16 .. z=35), not the resulting blank-run-length
 * range (which is 1-20).
 */

import { HATENA, NO_CLUE, type ClueValue } from '../types';

function encodeCell(v: ClueValue): string {
  if (v === HATENA) return '.';
  if (v >= 0 && v <= 15) return v.toString(16);
  if (v >= 16 && v <= 255) return '-' + v.toString(16).padStart(2, '0');
  if (v >= 256 && v <= 4095) return '+' + v.toString(16).padStart(3, '0');
  if (v >= 4096 && v <= 8191) return '=' + (v - 4096).toString(16).padStart(3, '0');
  if (v >= 8192 && v <= 12287) return '@' + (v - 8192).toString(16).padStart(3, '0');
  if (v >= 12288 && v <= 77823) return '*' + (v - 12240).toString(16).padStart(4, '0');
  if (v >= 77824) return '$' + (v - 77776).toString(16).padStart(5, '0');
  throw new Error(`encodeNumber16: value out of range: ${v}`);
}

/** Decode a Number16 clue body. Cells beyond what the body covers default to NO_CLUE. */
export function decodeNumber16(
  body: string,
  cellCount: number,
): { values: Int16Array; rest: string } {
  const values = new Int16Array(cellCount).fill(NO_CLUE);
  let i = 0;
  let cell = 0;
  while (cell < cellCount) {
    const c = body[i];
    if (c === undefined) break;
    if (c === '.') {
      values[cell] = HATENA;
      cell++;
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
      values[cell] = parseInt(c, 16);
      cell++;
      i++;
      continue;
    }
    if (c === '-') {
      values[cell] = parseInt(body.slice(i + 1, i + 3), 16);
      cell++;
      i += 3;
      continue;
    }
    if (c === '+') {
      values[cell] = parseInt(body.slice(i + 1, i + 4), 16);
      cell++;
      i += 4;
      continue;
    }
    if (c === '=') {
      values[cell] = parseInt(body.slice(i + 1, i + 4), 16) + 4096;
      cell++;
      i += 4;
      continue;
    }
    if (c === '@' || c === '%') {
      values[cell] = parseInt(body.slice(i + 1, i + 4), 16) + 8192;
      cell++;
      i += 4;
      continue;
    }
    if (c === '*') {
      values[cell] = parseInt(body.slice(i + 1, i + 5), 16) + 12240;
      cell++;
      i += 5;
      continue;
    }
    if (c === '$') {
      values[cell] = parseInt(body.slice(i + 1, i + 6), 16) + 77776;
      cell++;
      i += 6;
      continue;
    }
    if (c >= 'g' && c <= 'z') {
      const skip = parseInt(c, 36) - 15;
      cell += skip;
      i++;
      continue;
    }
    // Unrecognized character: stop, leave the rest as-is for the caller.
    break;
  }
  return { values, rest: body.slice(i) };
}

/**
 * Encode a full clue array.
 *
 * A grid with *no* clues at all encodes to the empty string, relying on
 * the URL envelope's documented shortcut (format §3.1: a body starting
 * with `/` skips the clue section entirely, since `/` never a valid
 * Number16 leading character) — the piece-bank section that always
 * follows starts with `/`, so an empty clue body naturally produces that
 * shape.
 *
 * Otherwise every cell 0..length-1 is encoded, *including* a trailing
 * NO_CLUE run after the last real clue: the reference encoder does not
 * elide trailing blanks mid-grid, only the "nothing at all" case above.
 * Confirmed against the real sample `pentopia/7/6/l6o3bi8q9l5g//t`, whose
 * body ends in a single trailing blank cell explicitly encoded as `g`
 * (skip 1) rather than omitted.
 */
export function encodeNumber16(values: Int16Array): string {
  let hasClue = false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== NO_CLUE) {
      hasClue = true;
      break;
    }
  }
  if (!hasClue) return '';

  let out = '';
  let i = 0;
  while (i < values.length) {
    const v = values[i]!;
    if (v === NO_CLUE) {
      let j = i;
      while (j < values.length && values[j] === NO_CLUE) j++;
      let runLen = j - i;
      while (runLen > 0) {
        const chunk = Math.min(runLen, 20);
        out += (chunk + 15).toString(36);
        runLen -= chunk;
      }
      i = j;
    } else {
      out += encodeCell(v);
      i++;
    }
  }
  return out;
}
