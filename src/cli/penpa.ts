/**
 * CLI: convert a penpa-edit URL into a puzz.link/Pentopia puzzle string.
 *
 *   npm run penpa -- "https://swaroopg92.github.io/penpa-edit/#m=solve&p=..."
 *
 * penpa-edit stores its whole puzzle in the URL fragment as
 * base64(raw-deflate(text)). The text is a `\n`-separated list of sections; we
 * only need two of them:
 *
 *  - the header (`square,<cols>,<rows>,...`), for the board size;
 *  - the symbol layer, whose `zY` (== "symbol") dict holds the arrow clues as
 *    `"<index>": [[l, u, r, d], "arrow_cross", <layer>]`.
 *
 * penpa pads the board with a 2-cell invisible margin on every side, so its
 * flat cell index maps back as `row = idx / (cols + 4) - 2`,
 * `col = idx % (cols + 4) - 2` (verified against this file's fixture: the
 * top-left cell of a 15x15 board is index 40 = 2 * 19 + 2).
 *
 * The arrow tuple order is [left, up, right, down] — resolved empirically by
 * replaying the fixture's stored answer against the Pentopia arrow rule; see
 * test/penpa.test.ts.
 */

import { inflateRawSync } from 'node:zlib';
import type { Puzzle } from '../core/types';
import { Dir, NO_CLUE, dirBit } from '../core/types';
import { PRESETS } from '../core/bank';
import { encodeUrl } from '../core/codec/url';

/** penpa's arrow_cross value order. */
const ARROW_ORDER: readonly Dir[] = [Dir.Left, Dir.Up, Dir.Right, Dir.Down];

/** Grab a named parameter out of a penpa URL fragment (or accept the raw payload). */
function extractPayload(input: string, param: string): string | undefined {
  const s = input.trim();
  const frag = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  if (!frag.includes('=')) return param === 'p' ? frag : undefined;
  // Deliberately not URLSearchParams: it decodes `+` as a space, and `+` is a
  // real base64 character in penpa's payload.
  for (const kv of frag.split('&')) {
    const eq = kv.indexOf('=');
    if (eq !== -1 && kv.slice(0, eq) === param) return kv.slice(eq + 1);
  }
  return undefined;
}

export function inflatePenpa(payload: string): string {
  // penpa uses plain base64 (with `+` and `/`) inside the fragment, so no
  // url-safe alphabet remapping here — just undo any percent-encoding.
  return inflateRawSync(Buffer.from(decodeURIComponent(payload), 'base64')).toString('utf8');
}

/** Convert a penpa flat cell index to a row-major board index, or -1 if in the margin. */
function penpaIndexToCell(idx: number, cols: number, rows: number): number {
  const nx0 = cols + 4;
  const r = Math.floor(idx / nx0) - 2;
  const c = (idx % nx0) - 2;
  if (r < 0 || r >= rows || c < 0 || c >= cols) return -1;
  return r * cols + c;
}

export function penpaToPuzzle(url: string): { puzzle: Puzzle; title: string; arrowless: number[] } {
  const payload = extractPayload(url, 'p');
  if (payload === undefined) throw new Error('penpaToPuzzle: no `p=` payload in URL');
  const text = inflatePenpa(payload);

  const header = text.split('\n', 1)[0]!.split(',');
  if (header[0] !== 'square') throw new Error(`penpaToPuzzle: unsupported grid "${header[0]}"`);
  const cols = parseInt(header[1] ?? '', 10);
  const rows = parseInt(header[2] ?? '', 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    throw new Error('penpaToPuzzle: could not read board size from header');
  }
  const title = (header.find((f) => f.startsWith('Title: ')) ?? 'Title: (untitled)').slice(7);

  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  const arrowless: number[] = [];
  const symbolRe = /"(\d+)":\[\[(\d),(\d),(\d),(\d)\],"arrow_cross",\d+\]/g;
  for (const m of text.matchAll(symbolRe)) {
    const cell = penpaIndexToCell(parseInt(m[1]!, 10), cols, rows);
    if (cell === -1) continue;
    let mask = 0;
    ARROW_ORDER.forEach((dir, i) => {
      if (m[2 + i] === '1') mask |= dirBit(dir);
    });
    if (mask === 0) arrowless.push(cell);
    clues[cell] = mask === 0 ? NO_CLUE : mask;
  }

  // Pentopia's rules text in these files always states the arrow cannot be
  // covered, which is the non-transparent (no `t` pflag) variant.
  return { puzzle: { cols, rows, clues, bank: PRESETS.p!, transparent: false }, title, arrowless };
}

/** Decode penpa's `a=` answer payload into shaded row-major cell indices, if present. */
export function penpaAnswer(url: string, cols: number, rows: number): number[] | undefined {
  const payload = extractPayload(url, 'a');
  if (payload === undefined) return undefined;
  const groups = JSON.parse(inflatePenpa(payload)) as string[][];
  return groups
    .flat()
    .map((s) => penpaIndexToCell(parseInt(s, 10), cols, rows))
    .filter((c) => c !== -1);
}

function main(): void {
  const input = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (input === undefined) {
    console.error('usage: npm run penpa -- "<penpa-edit url>"');
    process.exitCode = 1;
    return;
  }

  const { puzzle, title, arrowless } = penpaToPuzzle(input);
  const str = encodeUrl(puzzle);
  console.error(`# ${title} — ${puzzle.cols}x${puzzle.rows}`);
  if (arrowless.length > 0) {
    const at = arrowless
      .map((c) => `(r${Math.floor(c / puzzle.cols)},c${c % puzzle.cols})`)
      .join(' ');
    console.error(`# warning: ${arrowless.length} arrowless cross symbol(s) dropped: ${at}`);
  }
  console.log(str);
  console.log(`https://daromaj.github.io/pentopia/?p=${str}`);
  console.log(`https://puzz.link/p?${str}`);
}

// Guarded so the exported helpers can be imported by tests without running the CLI.
if (process.argv[1]?.endsWith('penpa.ts') === true) main();
