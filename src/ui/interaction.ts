/**
 * Pointer + keyboard interaction on the board SVG. Listeners are attached
 * once to the (persistent) host container rather than per-cell, since
 * render.ts fully rebuilds the <svg> on every redraw — event delegation
 * plus geometry math (viewBox vs. bounding-rect) locates the cell under the
 * pointer without caring whether the SVG element itself was just replaced.
 */

import {
  continueStroke,
  endStroke,
  moveCursor,
  redo,
  setCursor,
  startStroke,
  toggleCellValue,
  undo,
  MARKED_EMPTY,
  SHADED,
} from './state';
import type { PlayState } from './state';
import { CELL } from './render';

function cellFromPoint(host: HTMLElement, puzzle: PlayState['puzzle'], clientX: number, clientY: number): number | null {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const viewBox = (svg as SVGSVGElement).viewBox.baseVal;
  const px = ((clientX - rect.left) / rect.width) * viewBox.width;
  const py = ((clientY - rect.top) / rect.height) * viewBox.height;
  const x = Math.floor(px / CELL);
  const y = Math.floor(py / CELL);
  if (x < 0 || x >= puzzle.cols || y < 0 || y >= puzzle.rows) return null;
  return y * puzzle.cols + x;
}

/**
 * Wire click/tap-to-cycle and drag-to-paint on the board. A tap is a stroke
 * of one cell (cycles untouched -> shaded -> marked-empty -> untouched); a
 * drag paints every cell it crosses with the value chosen at stroke start
 * (pzprjs-style). Right-click or a second simultaneous touch point paints
 * marked-empty directly instead of cycling. `onChange` is called after every
 * mutation so the caller can re-render.
 */
export function attachBoardInteraction(host: HTMLElement, state: PlayState, onChange: () => void): void {
  const activePointers = new Set<number>();
  let painting = false;

  host.addEventListener('contextmenu', (e) => e.preventDefault());

  host.addEventListener('pointerdown', (e) => {
    const i = cellFromPoint(host, state.puzzle, e.clientX, e.clientY);
    activePointers.add(e.pointerId);
    if (i === null) return;
    const forced = e.button === 2 || activePointers.size >= 2 ? MARKED_EMPTY : undefined;
    painting = true;
    // Keep the keyboard cursor where the player last touched, so switching
    // from mouse to keys continues from the same cell instead of jumping.
    setCursor(state, i);
    startStroke(state, i, forced);
    host.setPointerCapture(e.pointerId);
    onChange();
  });

  host.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const i = cellFromPoint(host, state.puzzle, e.clientX, e.clientY);
    if (i === null) return;
    if (continueStroke(state, i)) onChange();
  });

  function finishPointer(e: PointerEvent): void {
    activePointers.delete(e.pointerId);
    if (!painting) return;
    painting = false;
    endStroke(state);
  }
  host.addEventListener('pointerup', finishPointer);
  host.addEventListener('pointercancel', finishPointer);
}

const ARROW_DELTAS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Whether the key event came from somewhere the player is typing (the URL bar,
 * the size/difficulty selects, a dialog field) — bare letter and arrow keys
 * belong to that control, not the board.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Board keyboard control, attached once to the window:
 *
 * - Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo.
 * - Arrows move the cursor (clamped at the edges; first press places it).
 * - `x` shades the cursor cell, `z` marks it empty — each toggles back to
 *   untouched when the cell already holds that value.
 *
 * `onEdit` runs after a board mutation; `onCursorMove` (defaults to `onEdit`)
 * after a cursor-only move, so the caller can do the cheap thing — a plain
 * re-render — without the full post-edit pipeline clearing the hint banner
 * just because the player looked at another cell.
 */
export function attachKeyboardShortcuts(
  state: PlayState,
  onEdit: () => void,
  onCursorMove: () => void = onEdit,
): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (redo(state)) onEdit();
        } else if (undo(state)) {
          onEdit();
        }
      } else if (key === 'y') {
        e.preventDefault();
        if (redo(state)) onEdit();
      }
      return;
    }
    if (e.altKey || isTypingTarget(e.target)) return;

    const delta = ARROW_DELTAS[e.key];
    if (delta) {
      e.preventDefault(); // arrows would otherwise scroll the page
      if (moveCursor(state, delta[0], delta[1])) onCursorMove();
      return;
    }

    const key = e.key.toLowerCase();
    if (key !== 'x' && key !== 'z') return;
    e.preventDefault();
    // No cursor yet: the first keypress only places it, so a stray `x` can't
    // paint a cell the player never aimed at.
    if (state.cursor === null) {
      if (setCursor(state, 0)) onCursorMove();
      return;
    }
    if (toggleCellValue(state, state.cursor, key === 'x' ? SHADED : MARKED_EMPTY)) onEdit();
  });
}
