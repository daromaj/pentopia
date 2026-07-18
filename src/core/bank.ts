/**
 * Shape bank: BankPiece wire codec, built-in presets, and canonical-count
 * comparison (format §2.2, §3.3).
 */

import type { Bank, Shape } from './types';
import { canonicalKey, PENTOMINOES, TETROMINOES } from './shape';

/**
 * Serialize a single shape as a BankPiece (format §3.3):
 * `<w><h><bits...>` — w, h are single base-36 digits; the w*h bitmap is
 * chunked into 5-bit groups (last group zero-padded) written as base-32
 * digits (0-9a-v); trailing all-zero digits are stripped.
 */
export function serializeBankPiece(s: Shape): string {
  const { w, h, bits } = s;
  const n = w * h;
  let bitStr = '';
  for (let i = 0; i < n; i++) bitStr += bits[i] ? '1' : '0';
  const groups = Math.ceil(n / 5);
  bitStr = bitStr.padEnd(groups * 5, '0');
  let digits = '';
  for (let g = 0; g < groups; g++) {
    const chunk = bitStr.slice(g * 5, g * 5 + 5);
    digits += parseInt(chunk, 2).toString(32);
  }
  digits = digits.replace(/0+$/, '');
  return w.toString(36) + h.toString(36) + digits;
}

/** Inverse of {@link serializeBankPiece}. */
export function deserializeBankPiece(str: string): Shape {
  const w = parseInt(str[0]!, 36);
  const h = parseInt(str[1]!, 36);
  const n = w * h;
  const groups = Math.ceil(n / 5);
  const digitsPart = str.slice(2);
  let bitStr = '';
  for (let g = 0; g < groups; g++) {
    const ch = digitsPart[g];
    const val = ch !== undefined ? parseInt(ch, 32) : 0;
    bitStr += val.toString(2).padStart(5, '0');
  }
  bitStr = bitStr.slice(0, n);
  const bits = new Uint8Array(n);
  for (let i = 0; i < n; i++) bits[i] = bitStr[i] === '1' ? 1 : 0;
  return { w, h, bits };
}

function bankOf(shapes: readonly Shape[], repeat: number): Bank {
  const pieces: Shape[] = [];
  for (let r = 0; r < repeat; r++) pieces.push(...shapes);
  return { pieces };
}

const pentominoList = Object.values(PENTOMINOES);
const tetrominoList = Object.values(TETROMINOES);

/** Built-in bank presets (format §2.2). */
export const PRESETS: Record<string, Bank> = {
  p: bankOf(pentominoList, 1),
  t: bankOf(tetrominoList, 1),
  d: bankOf(tetrominoList, 2),
  z: { pieces: [] },
};

/** Order presets are checked in when matching (format §2.2: `p` is first/default). */
export const PRESET_ORDER: readonly string[] = ['p', 't', 'd', 'z'];

/** Map canonicalKey -> count of pieces in the bank sharing that key. */
export function bankCounts(bank: Bank): Map<string, number> {
  const counts = new Map<string, number>();
  for (const piece of bank.pieces) {
    const key = canonicalKey(piece);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/** Returns the preset shortkey iff the bank's canonical-key multiset exactly matches a preset. */
export function matchPreset(bank: Bank): string | null {
  const counts = bankCounts(bank);
  for (const key of PRESET_ORDER) {
    const presetCounts = bankCounts(PRESETS[key]!);
    if (countsEqual(counts, presetCounts)) return key;
  }
  return null;
}
