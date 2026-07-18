/**
 * SVG rendering: the board grid (cells, clue arrows, shading, marked-empty
 * dots) and the bank panel (mini shapes with used/remaining counts). Plain
 * DOM + SVG, no framework — cheap enough to fully rebuild on every state
 * change given board sizes here (up to a few hundred cells).
 */

import { bankCounts } from '../core/bank';
import { canonicalKey } from '../core/shape';
import { NO_CLUE, HATENA, Dir, dirBit, DIRS } from '../core/types';
import type { Puzzle, Shape } from '../core/types';
import { computeShadedComponents, MARKED_EMPTY, SHADED } from './state';
import type { PlayState } from './state';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Board grid cell size, in SVG user units (the viewBox scales to fit any container width). */
export const CELL = 40;

function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Triangle polygon points for one arrow, pointing outward from cell-center
 * (cx,cy) toward `dir`. Each arrow lives in the *outer ring* of the cell —
 * tip near the cell edge, base well clear of the center — so a multi-arrow
 * clue keeps visible whitespace between the arrows instead of them all
 * crowding the middle.
 */
function arrowPoints(cx: number, cy: number, dir: Dir, cell: number): string {
  const tip = cell * 0.4; // distance center -> arrow tip (near the cell edge)
  const base = cell * 0.14; // distance center -> arrow base (clear gap in the middle)
  const halfW = cell * 0.13;
  switch (dir) {
    case Dir.Up:
      return `${cx},${cy - tip} ${cx - halfW},${cy - base} ${cx + halfW},${cy - base}`;
    case Dir.Down:
      return `${cx},${cy + tip} ${cx - halfW},${cy + base} ${cx + halfW},${cy + base}`;
    case Dir.Left:
      return `${cx - tip},${cy} ${cx - base},${cy - halfW} ${cx - base},${cy + halfW}`;
    case Dir.Right:
      return `${cx + tip},${cy} ${cx + base},${cy - halfW} ${cx + base},${cy + halfW}`;
  }
}

export interface RenderOptions {
  /** Cell indices implicated in the last "Check" run — highlighted until the next edit. */
  failureCells?: ReadonlySet<number>;
  /** Whether the current shading is a full valid solution — highlights the board outline. */
  solved?: boolean;
}

/** Build (or rebuild) the board SVG inside `host` and return it. */
export function renderBoard(host: HTMLElement, state: PlayState, opts: RenderOptions = {}): SVGSVGElement {
  const { puzzle, cellState } = state;
  const { cols, rows } = puzzle;
  const w = cols * CELL;
  const h = rows * CELL;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    class: 'board-svg' + (opts.solved ? ' solved' : ''),
    role: 'img',
    'aria-label': 'Pentopia board',
  }) as SVGSVGElement;

  const bg = svgEl('rect', { x: 0, y: 0, width: w, height: h, class: 'board-bg' });
  svg.appendChild(bg);

  const failureCells = opts.failureCells;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const clue = puzzle.clues[i]!;
      const cx = x * CELL;
      const cy = y * CELL;

      if (failureCells?.has(i)) {
        svg.appendChild(svgEl('rect', { x: cx, y: cy, width: CELL, height: CELL, class: 'cell-failure' }));
      }

      if (clue !== NO_CLUE) {
        svg.appendChild(svgEl('rect', { x: cx, y: cy, width: CELL, height: CELL, class: 'cell-clue' }));
        const ccx = cx + CELL / 2;
        const ccy = cy + CELL / 2;
        if (clue === HATENA) {
          const text = svgEl('text', {
            x: ccx,
            y: ccy,
            class: 'clue-hatena',
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          });
          text.textContent = '?';
          svg.appendChild(text);
        } else {
          for (const dir of DIRS) {
            if ((clue & dirBit(dir)) === 0) continue;
            svg.appendChild(
              svgEl('polygon', { points: arrowPoints(ccx, ccy, dir, CELL), class: 'clue-arrow' }),
            );
          }
        }
      } else if (cellState[i] === SHADED) {
        svg.appendChild(svgEl('rect', { x: cx, y: cy, width: CELL, height: CELL, class: 'cell-shaded' }));
      } else if (cellState[i] === MARKED_EMPTY) {
        svg.appendChild(
          svgEl('circle', { cx: cx + CELL / 2, cy: cy + CELL / 2, r: CELL * 0.08, class: 'cell-marked' }),
        );
      }
    }
  }

  // Grid lines, drawn last so they sit crisply above cell fills.
  const grid = svgEl('g', { class: 'grid-lines' });
  for (let x = 0; x <= cols; x++) {
    grid.appendChild(svgEl('line', { x1: x * CELL, y1: 0, x2: x * CELL, y2: h }));
  }
  for (let y = 0; y <= rows; y++) {
    grid.appendChild(svgEl('line', { x1: 0, y1: y * CELL, x2: w, y2: y * CELL }));
  }
  svg.appendChild(grid);

  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: h, class: 'board-outline' }));

  host.replaceChildren(svg);
  return svg;
}

/** Convert a Shape into a small standalone SVG mini-shape, scaled to fit a `box`x`box` square. */
function shapeSvg(shape: Shape, box: number, exhausted: boolean): SVGSVGElement {
  const pad = box * 0.1;
  const inner = box - pad * 2;
  const scale = inner / Math.max(shape.w, shape.h, 1);
  const offX = pad + (inner - shape.w * scale) / 2;
  const offY = pad + (inner - shape.h * scale) / 2;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${box} ${box}`,
    width: box,
    height: box,
    class: 'bank-shape' + (exhausted ? ' exhausted' : ''),
  }) as SVGSVGElement;
  for (let y = 0; y < shape.h; y++) {
    for (let x = 0; x < shape.w; x++) {
      if (!shape.bits[y * shape.w + x]) continue;
      svg.appendChild(
        svgEl('rect', {
          x: offX + x * scale,
          y: offY + y * scale,
          width: scale,
          height: scale,
          class: 'bank-cell',
        }),
      );
    }
  }
  return svg;
}

/** Rebuild the bank panel inside `host`: one tile per distinct bank piece, with a remaining/total badge. */
export function renderBank(host: HTMLElement, puzzle: Puzzle, cellState: Uint8Array): void {
  const total = bankCounts(puzzle.bank);
  const used = new Map<string, number>();
  for (const comp of computeShadedComponents(puzzle, cellState)) {
    used.set(comp.key, (used.get(comp.key) ?? 0) + 1);
  }

  // One representative Shape per canonical key, in first-seen (bank list) order.
  const seen = new Set<string>();
  const reps: { key: string; shape: Shape }[] = [];
  for (const piece of puzzle.bank.pieces) {
    const key = canonicalKey(piece);
    if (seen.has(key)) continue;
    seen.add(key);
    reps.push({ key, shape: piece });
  }

  const panel = document.createElement('div');
  panel.className = 'bank-panel';

  if (reps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bank-empty';
    empty.textContent = 'Empty bank';
    panel.appendChild(empty);
  }

  for (const { key, shape } of reps) {
    const count = total.get(key) ?? 0;
    const usedCount = used.get(key) ?? 0;
    const remaining = Math.max(0, count - usedCount);
    const exhausted = remaining <= 0;

    const tile = document.createElement('div');
    tile.className = 'bank-tile' + (exhausted ? ' exhausted' : '');
    tile.appendChild(shapeSvg(shape, 64, exhausted));

    const badge = document.createElement('div');
    badge.className = 'bank-count';
    badge.textContent = count > 1 ? `${remaining}/${count}` : exhausted ? 'used' : '';
    tile.appendChild(badge);

    panel.appendChild(tile);
  }

  host.replaceChildren(panel);
}
