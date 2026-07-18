/**
 * Pointer + keyboard interaction on the board SVG. Listeners are attached
 * once to the (persistent) host container rather than per-cell, since
 * render.ts fully rebuilds the <svg> on every redraw — event delegation
 * plus geometry math (viewBox vs. bounding-rect) locates the cell under the
 * pointer without caring whether the SVG element itself was just replaced.
 */

import { continueStroke, endStroke, redo, startStroke, undo, MARKED_EMPTY } from './state';
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

/** Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y to redo. */
export function attachKeyboardShortcuts(state: PlayState, onChange: () => void): void {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        if (redo(state)) onChange();
      } else if (undo(state)) {
        onChange();
      }
    } else if (key === 'y') {
      e.preventDefault();
      if (redo(state)) onChange();
    }
  });
}
