/**
 * ASCII rendering helpers shared by the CLI entry points. Not part of the
 * shipped library — just enough to eyeball a puzzle in a terminal.
 */

import type { Puzzle, Solution } from '../core/types';
import { NO_CLUE, HATENA } from '../core/types';

/**
 * A single glyph per arrow bitmask (UP=1, DOWN=2, LEFT=4, RIGHT=8). Combos with
 * a clean single-arrow glyph use it; messier 3-/4-arrow combos fall back to a
 * hex digit (see the legend printed alongside).
 */
const GLYPH: Record<number, string> = {
  1: '↑', // ↑ up
  2: '↓', // ↓ down
  4: '←', // ← left
  8: '→', // → right
  3: '↕', // ↕ up+down
  12: '↔', // ↔ left+right
  5: '↖', // ↖ up+left
  9: '↗', // ↗ up+right
  6: '↙', // ↙ down+left
  10: '↘', // ↘ down+right
};

function clueGlyph(v: number): string {
  if (v === NO_CLUE) return '.';
  if (v === HATENA) return '?';
  const g = GLYPH[v];
  if (g !== undefined) return g;
  return v.toString(16); // 7,11,13,14,15 → hex digit; see legend
}

/** The clue grid alone: glyph per clue cell, '.' elsewhere. */
export function renderClues(puzzle: Puzzle): string {
  const { cols, rows, clues } = puzzle;
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) line += clueGlyph(clues[y * cols + x]!) + ' ';
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/**
 * The answer with clues overlaid: '#' = shaded, a clue glyph on an unshaded clue
 * cell, '.' = unshaded no-clue. Since clues only sit on unshaded cells, this is
 * a lossless combined view.
 */
export function renderCombined(puzzle: Puzzle, answer: Solution): string {
  const { cols, rows, clues } = puzzle;
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (answer.shaded[i] === 1) line += '# ';
      else if (clues[i] !== NO_CLUE) line += clueGlyph(clues[i]!) + ' ';
      else line += '. ';
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

/** A bare shaded grid: '#' shaded, '.' unshaded. */
export function renderShaded(cols: number, rows: number, answer: Solution): string {
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) line += (answer.shaded[y * cols + x] === 1 ? '#' : '.') + ' ';
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

export const GLYPH_LEGEND =
  'arrows: ' +
  '↑up ↓down ←left →right ' +
  '↕u+d ↔l+r ↖u+l ↗u+r ↙d+l ↘d+r; ' +
  '3+-arrow combos shown as hex of the bitmask (up=1 down=2 left=4 right=8)';
