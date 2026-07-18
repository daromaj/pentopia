/**
 * puzz.link URL envelope codec (format §3.1):
 * `https://puzz.link/p?<pid>/[<pflag>/]<cols>/<rows>/<body>`
 *
 * Also accepts a bare `pentopia/...` string, and a `?p=...` query-parameter
 * embedding (for hosts that pass the puzzle string as a named query param
 * rather than the whole query string).
 */

import type { Puzzle } from '../types';
import { decodeNumber16, encodeNumber16 } from './number16';
import { decodePieceBank, encodePieceBank } from './pieceBank';

const PID = 'pentopia';

/** Pull the `<pid>/[<pflag>/]<cols>/<rows>/<body>` string out of any accepted input form. */
function extractPidBody(input: string): string {
  const s = input.trim();
  const qIndex = s.indexOf('?');
  if (qIndex === -1) return s;
  const query = s.slice(qIndex + 1);
  if (query.includes('=')) {
    const params = new URLSearchParams(query);
    const p = params.get('p');
    return p ?? query;
  }
  return query;
}

export function decodeUrl(input: string): Puzzle {
  const pidBody = extractPidBody(input);
  const parts = pidBody.split('/');
  if (parts[0] !== PID) {
    throw new Error(`decodeUrl: expected pid "${PID}", got "${parts[0]}"`);
  }

  let idx = 1;
  let pflag = '';
  const next = parts[idx];
  if (next !== undefined && next !== '' && isNaN(Number(next[0]))) {
    pflag = next;
    idx++;
  }
  const cols = parseInt(parts[idx] ?? '', 10);
  idx++;
  const rows = parseInt(parts[idx] ?? '', 10);
  idx++;
  const body = parts.slice(idx).join('/');

  const transparent = pflag.includes('t');

  let clues: Int16Array;
  let rest: string;
  if (body.startsWith('/')) {
    clues = new Int16Array(cols * rows).fill(-1);
    rest = body;
  } else {
    const decoded = decodeNumber16(body, cols * rows);
    clues = decoded.values;
    rest = decoded.rest;
  }

  const { bank } = decodePieceBank(rest);

  return { cols, rows, clues, bank, transparent };
}

export function encodeUrl(p: Puzzle): string {
  const pflagPart = p.transparent ? 't/' : '';
  const cluebody = encodeNumber16(p.clues);
  const bankpart = encodePieceBank(p.bank);
  return `${PID}/${pflagPart}${p.cols}/${p.rows}/${cluebody}${bankpart}`;
}
