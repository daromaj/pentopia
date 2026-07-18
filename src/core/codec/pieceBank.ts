/**
 * Piece-bank section codec (format §3.3): either `//<shortkey>` (preset
 * shorthand) or `/<count>/<piece1>/.../<pieceN>` (explicit BankPiece list).
 */

import type { Bank } from '../types';
import { PRESETS, deserializeBankPiece, matchPreset, serializeBankPiece } from '../bank';

export function decodePieceBank(rest: string): { bank: Bank; rest: string } {
  if (rest.startsWith('//')) {
    const shortkey = rest.slice(2);
    const preset = PRESETS[shortkey];
    if (preset === undefined) {
      throw new Error(`decodePieceBank: unknown preset shortkey "${shortkey}"`);
    }
    return { bank: preset, rest: '' };
  }
  if (rest.startsWith('/')) {
    const parts = rest.split('/');
    // parts[0] === '' (leading slash), parts[1] === count, parts[2..] === pieces.
    const count = parseInt(parts[1] ?? '0', 10);
    const pieceStrs = parts.slice(2, 2 + count);
    const pieces = pieceStrs.map(deserializeBankPiece);
    const leftoverParts = parts.slice(2 + count);
    const hasLeftover = leftoverParts.some((p) => p !== '');
    return { bank: { pieces }, rest: hasLeftover ? '/' + leftoverParts.join('/') : '' };
  }
  // No bank section present at all: fall back to the default preset (`p`, format §2.2).
  return { bank: PRESETS.p!, rest };
}

export function encodePieceBank(bank: Bank): string {
  const shortkey = matchPreset(bank);
  if (shortkey !== null) return `//${shortkey}`;
  return `/${bank.pieces.length}/${bank.pieces.map(serializeBankPiece).join('/')}`;
}
