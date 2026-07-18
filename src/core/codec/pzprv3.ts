/**
 * Minimal reader for the "pzprv3" save-string format used by the vendored
 * pzprjs ground-truth fixtures (test/fixtures/pentopia.ts). This is a
 * different wire format from the puzz.link URL (format §3.1/§3.2) — it's
 * the engine's internal save/board-state serialization, not the shareable
 * puzzle URL. It is read-only here: we only need it to load fixtures for
 * validator testing, not to produce it.
 *
 * Shape, established empirically against the fixtures (cross-checked
 * against the URL codec in test/pzprv3.test.ts):
 *
 *   pzprv3/pentopia/<rows>/<cols>/<bankpreset>/[t/]<rows clue lines><rows answer lines><bank-state line>
 *
 * Note this is ROWS then COLS — the *opposite* order from the puzz.link URL
 * envelope (`pid/[pflag/]cols/rows/body`, format §3.1). E.g. the fixture
 * `pzprv3/pentopia/6/7/t/...` (6 clue/answer lines of 7 space-separated
 * tokens each) is the exact same board as the URL
 * `pentopia/7/6/l6o3bi8q9l5g//t` (cols=7, rows=6) — both describe a 7-wide,
 * 6-tall grid, they just spell the two numbers in opposite order. Verified
 * cell-by-cell in test/pzprv3.test.ts.
 *
 * Segments (this whole string is one big `/`-separated list):
 *   0: "pzprv3"            — literal format tag
 *   1: "pentopia"          — puzzle type id
 *   2: rows                — decimal
 *   3: cols                — decimal
 *   4: bank preset shortkey (format §2.2: 'p','t','d','z') — looked up via PRESETS
 *   [5: "t"]                — optional transparent flag (format §2.1); present iff
 *                             this segment is the literal string "t" (grid-line
 *                             segments always contain spaces/dots/digits, never
 *                             a bare "t", so this is unambiguous)
 *   next `rows` segments   — clue grid lines, top to bottom
 *   next `rows` segments   — answer grid lines, top to bottom
 *   next segment            — per-bank-piece UI state ("0 0 ... 0") — ignored
 *   (trailing "")           — from the string's trailing '/'
 *
 * Each grid line is `cols` space-separated tokens (with a trailing space
 * before the line's closing '/').
 *   - Clue tokens: '.' = no clue (NO_CLUE); a decimal integer = arrow
 *     bitmask (format §3.2; 1..15, UP=1 DOWN=2 LEFT=4 RIGHT=8). Unlike the
 *     Number16 URL codec, '.' here means "no clue", not HATENA — the
 *     fixtures never encode a hatena cell, and this reader only needs to
 *     support what's actually in them.
 *   - Answer tokens: '#' = shaded; '.' and '+' = unshaded ('+' is a
 *     player's "marked empty" annotation, semantically identical to '.').
 */

import type { Puzzle, Solution } from '../types';
import { NO_CLUE } from '../types';
import { idx } from '../grid';
import { PRESETS } from '../bank';

function splitTokens(line: string, cols: number, kind: string): string[] {
  const tokens = line.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length !== cols) {
    throw new Error(
      `decodePzprv3: expected ${cols} tokens in ${kind} line, got ${tokens.length} ("${line}")`,
    );
  }
  return tokens;
}

export function decodePzprv3(s: string): { puzzle: Puzzle; answer: Solution } {
  const parts = s.split('/');
  let i = 0;

  const expect = (want: string): void => {
    const got = parts[i];
    if (got !== want) {
      throw new Error(`decodePzprv3: expected segment "${want}" at position ${i}, got "${got}"`);
    }
    i++;
  };
  expect('pzprv3');
  expect('pentopia');

  const rows = parseInt(parts[i] ?? '', 10);
  i++;
  const cols = parseInt(parts[i] ?? '', 10);
  i++;
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
    throw new Error(`decodePzprv3: invalid dims rows=${parts[i - 2]} cols=${parts[i - 1]}`);
  }

  const bankKey = parts[i];
  i++;
  const preset = bankKey === undefined ? undefined : PRESETS[bankKey];
  if (preset === undefined) {
    throw new Error(`decodePzprv3: unknown bank preset shortkey "${bankKey}"`);
  }

  let transparent = false;
  if (parts[i] === 't') {
    transparent = true;
    i++;
  }

  if (i + 2 * rows > parts.length) {
    throw new Error(
      `decodePzprv3: not enough grid-line segments for rows=${rows} (need ${2 * rows}, have ${parts.length - i})`,
    );
  }

  const clueLines = parts.slice(i, i + rows);
  i += rows;
  const answerLines = parts.slice(i, i + rows);
  i += rows;
  // Remaining segments: the per-bank-piece UI state line and a trailing "" — ignored.

  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  for (let y = 0; y < rows; y++) {
    const tokens = splitTokens(clueLines[y] ?? '', cols, 'clue');
    for (let x = 0; x < cols; x++) {
      const t = tokens[x]!;
      clues[idx(x, y, cols)] = t === '.' ? NO_CLUE : parseInt(t, 10);
    }
  }

  const shaded = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const tokens = splitTokens(answerLines[y] ?? '', cols, 'answer');
    for (let x = 0; x < cols; x++) {
      const t = tokens[x]!;
      shaded[idx(x, y, cols)] = t === '#' ? 1 : 0;
    }
  }

  const puzzle: Puzzle = { cols, rows, clues, bank: preset, transparent };
  const answer: Solution = { shaded };
  return { puzzle, answer };
}
