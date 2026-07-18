import './styles.css';

import { validate } from '../core/validator';
import { decodeUrl, encodeUrl } from '../core/codec/url';
import type { Failure, Puzzle } from '../core/types';
import { NO_CLUE } from '../core/types';
import type { WorkerRequest, WorkerResponse } from '../generator/worker';
import {
  createPlayState,
  loadPuzzle,
  resetBoard,
  undo,
  redo,
  FAILCODE_MESSAGES,
  SHADED,
} from './state';
import type { PlayState } from './state';
import { renderBoard, renderBank } from './render';
import { computeHint } from './hint';
import type { Hint } from './hint';
import { attachBoardInteraction, attachKeyboardShortcuts } from './interaction';
import {
  createUrlBar,
  setShareUrl,
  loadStartupPuzzle,
  hasDeepLink,
  updateHash,
} from './urlbar';
import { saveProgress, loadProgress, setLastPlayed, getLastPlayed, addFavorite, removeFavorite, isFavorite } from './persist';
import { createFavoritesPanel, defaultFavoriteName } from './favorites';

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('pentopia: #app mount point not found');
}
appRoot.replaceChildren();

// --- DOM scaffold -----------------------------------------------------

const root = document.createElement('div');
root.className = 'pentopia-app';

const toolbar = document.createElement('header');
toolbar.className = 'toolbar';

const urlbarMount = document.createElement('div');
urlbarMount.className = 'urlbar-mount';

const actions = document.createElement('div');
actions.className = 'toolbar-actions';

const undoBtn = document.createElement('button');
undoBtn.type = 'button';
undoBtn.textContent = 'Undo';
undoBtn.dataset.hook = 'undo-btn';

const redoBtn = document.createElement('button');
redoBtn.type = 'button';
redoBtn.textContent = 'Redo';
redoBtn.dataset.hook = 'redo-btn';

const checkBtn = document.createElement('button');
checkBtn.type = 'button';
checkBtn.textContent = 'Check';
checkBtn.dataset.hook = 'check-btn';

const hintBtn = document.createElement('button');
hintBtn.type = 'button';
hintBtn.textContent = 'Hint';
hintBtn.title = 'Learning mode: highlight one next step and explain it (never applies it for you)';
hintBtn.dataset.hook = 'hint-btn';

const resetBtn = document.createElement('button');
resetBtn.type = 'button';
resetBtn.textContent = 'Reset';
resetBtn.title = 'Clear the board for this puzzle (undoable)';
resetBtn.dataset.hook = 'reset-btn';

const favoriteBtn = document.createElement('button');
favoriteBtn.type = 'button';
favoriteBtn.className = 'favorite-btn';
favoriteBtn.title = 'Favorite this puzzle';
favoriteBtn.dataset.hook = 'favorite-btn';

const clueCount = document.createElement('span');
clueCount.className = 'clue-count';
clueCount.dataset.hook = 'clue-count';

const sizeSelect = document.createElement('select');
sizeSelect.dataset.hook = 'generate-size';
sizeSelect.title = 'New puzzle size';
for (const n of [6, 8, 10]) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n}×${n}`;
  sizeSelect.appendChild(opt);
}
sizeSelect.value = '8';

const difficultySelect = document.createElement('select');
difficultySelect.dataset.hook = 'generate-difficulty';
difficultySelect.title = 'New puzzle difficulty';
for (const d of ['easy', 'medium', 'hard']) {
  const opt = document.createElement('option');
  opt.value = d;
  opt.textContent = d;
  difficultySelect.appendChild(opt);
}
difficultySelect.value = 'medium';

const generateBtn = document.createElement('button');
generateBtn.type = 'button';
generateBtn.textContent = 'New puzzle';
generateBtn.dataset.hook = 'generate-puzzle';

actions.append(undoBtn, redoBtn, checkBtn, hintBtn, resetBtn, clueCount, sizeSelect, difficultySelect, generateBtn);
toolbar.append(urlbarMount, actions);

const banner = document.createElement('div');
banner.className = 'banner';
banner.hidden = true;
banner.dataset.hook = 'banner';

const boardArea = document.createElement('main');
boardArea.className = 'board-area';

const boardHost = document.createElement('div');
boardHost.className = 'board-host';
boardHost.dataset.hook = 'board-host';

const bankColumn = document.createElement('div');
bankColumn.className = 'bank-column';

const bankHost = document.createElement('div');
bankHost.className = 'bank-host';
bankHost.dataset.hook = 'bank-host';

const favoritesHost = document.createElement('div');
favoritesHost.className = 'favorites-host';

bankColumn.append(bankHost, favoritesHost);
boardArea.append(boardHost, bankColumn);
root.append(toolbar, banner, boardArea);
appRoot.append(root);

// --- State --------------------------------------------------------------

/**
 * Startup puzzle: a deep link (`?p=` / hash) always wins (so a shared link
 * never gets silently swapped for whatever was last played on this
 * machine). Absent a deep link, resume `getLastPlayed()`'s puzzle; absent
 * that too, `loadStartupPuzzle()` falls through to the format §3.4 sample.
 */
function resolveStartupPuzzle(): Puzzle {
  if (hasDeepLink()) return loadStartupPuzzle();
  const lastKey = getLastPlayed();
  if (lastKey) {
    try {
      return decodeUrl(lastKey);
    } catch {
      // stale/corrupt lastPlayed entry — fall through to the default sample.
    }
  }
  return loadStartupPuzzle();
}

const state: PlayState = createPlayState(resolveStartupPuzzle());
let lastFailures: readonly Failure[] = [];
let failureCells: Set<number> | null = null;
/** Last "Hint" result — highlight + banner persist until the next board edit (same lifecycle as `failureCells`/`lastFailures`). Learning mode never applies this for the player; it's display-only. */
let currentHint: Hint | null = null;

/**
 * Overwrite `state.cellState` with any saved progress for puzzle `key`
 * (goes through the same "clean undo/redo" contract `loadPuzzle` already
 * gives us: stacks are reset to empty right before this runs). No-op if
 * nothing is saved, or the saved length doesn't match the current puzzle's
 * cell count (defends against a stale entry from an edited/differently-sized
 * puzzle sharing a key by coincidence — shouldn't happen, but cheap to check).
 */
function restoreProgress(key: string): void {
  const saved = loadProgress(key);
  if (saved && saved.length === state.cellState.length) {
    state.cellState = saved;
    state.undoStack = [];
    state.redoStack = [];
  }
}

restoreProgress(encodeUrl(state.puzzle));

/** Load `puzzle` through the full path — reset state, restore saved progress, clear stale Check results, re-render — shared by urlbar Load, favorites, and (new) puzzle generation. */
function loadPuzzleAndRestore(puzzle: Puzzle): void {
  loadPuzzle(state, puzzle);
  restoreProgress(encodeUrl(state.puzzle));
  lastFailures = [];
  failureCells = null;
  currentHint = null;
  rerender();
}

const urlbar = createUrlBar({
  onLoad: (puzzle) => loadPuzzleAndRestore(puzzle),
});
urlbarMount.append(urlbar.root, favoriteBtn);

const favoritesPanel = createFavoritesPanel({
  onSelect: (puzzle) => loadPuzzleAndRestore(puzzle),
});
favoritesHost.appendChild(favoritesPanel.root);

function updateFavoriteBtn(): void {
  const fav = isFavorite(encodeUrl(state.puzzle));
  favoriteBtn.textContent = fav ? '★' : '☆';
  favoriteBtn.classList.toggle('is-favorite', fav);
  favoriteBtn.setAttribute('aria-pressed', String(fav));
}

favoriteBtn.addEventListener('click', () => {
  const url = encodeUrl(state.puzzle);
  if (isFavorite(url)) {
    removeFavorite(url);
  } else {
    addFavorite({ url, name: defaultFavoriteName(state.puzzle) });
  }
  updateFavoriteBtn();
  favoritesPanel.refresh();
});

// --- Wiring ---------------------------------------------------------------

function currentShaded(): Uint8Array {
  const shaded = new Uint8Array(state.cellState.length);
  for (let i = 0; i < state.cellState.length; i++) {
    if (state.cellState[i] === SHADED) shaded[i] = 1;
  }
  return shaded;
}

/** Solved iff the current shading fully validates AND at least one cell is shaded (an empty board is not "solved"). */
function isSolved(): boolean {
  const shaded = currentShaded();
  if (!shaded.some((v) => v === 1)) return false;
  return validate(state.puzzle, { shaded }).ok;
}

function updateBanner(solved: boolean): void {
  banner.replaceChildren();
  banner.classList.remove('banner-solved', 'banner-fail', 'banner-hint');
  if (solved) {
    banner.classList.add('banner-solved');
    banner.textContent = 'Solved!';
    banner.hidden = false;
    return;
  }
  // A hint (when present) takes priority over a stale "Check" result — it's
  // the more recent, more specific thing to tell the player. An 'error' hint
  // reuses the fail style (it *is* a failure, just diagnosed more precisely);
  // every other kind gets the accent-colored, non-alarming hint style.
  if (currentHint) {
    banner.classList.add(currentHint.kind === 'error' ? 'banner-fail' : 'banner-hint');
    banner.textContent = currentHint.message;
    banner.hidden = false;
    return;
  }
  if (lastFailures.length > 0) {
    banner.classList.add('banner-fail');
    const heading = document.createElement('div');
    heading.textContent = 'Not solved yet:';
    const list = document.createElement('ul');
    for (const f of lastFailures) {
      const li = document.createElement('li');
      li.textContent = FAILCODE_MESSAGES[f.code];
      list.appendChild(li);
    }
    banner.append(heading, list);
    banner.hidden = false;
    return;
  }
  banner.hidden = true;
}

function updateClueCount(): void {
  let n = 0;
  for (const c of state.puzzle.clues) if (c !== NO_CLUE) n++;
  clueCount.textContent = `${n} clue${n === 1 ? '' : 's'}`;
}

function rerender(): void {
  updateHash(state.puzzle);
  setShareUrl(urlbar, state.puzzle);
  updateClueCount();
  updateFavoriteBtn();

  const solved = isSolved();
  const hintCells = currentHint && currentHint.cells.length > 0 ? new Set(currentHint.cells) : undefined;
  renderBoard(boardHost, state, { failureCells: failureCells ?? undefined, hintCells, solved });
  renderBank(bankHost, state.puzzle, state.cellState);
  updateBanner(solved);

  undoBtn.disabled = state.undoStack.length === 0;
  redoBtn.disabled = state.redoStack.length === 0;
}

/** Persist the current board (cellState) + mark this puzzle as last-played. Any storage failure is silently swallowed inside persist.ts. */
function autosaveProgress(): void {
  const key = encodeUrl(state.puzzle);
  saveProgress(key, state.cellState);
  setLastPlayed(key);
}

function onBoardChange(): void {
  // Any edit invalidates the last "Check" result until it's run again, and
  // the last "Hint" until the player asks for a new one.
  lastFailures = [];
  failureCells = null;
  currentHint = null;
  autosaveProgress();
  rerender();
}

attachBoardInteraction(boardHost, state, onBoardChange);
attachKeyboardShortcuts(state, onBoardChange);

undoBtn.addEventListener('click', () => {
  if (undo(state)) onBoardChange();
});
redoBtn.addEventListener('click', () => {
  if (redo(state)) onBoardChange();
});
resetBtn.addEventListener('click', () => {
  resetBoard(state);
  onBoardChange();
});
checkBtn.addEventListener('click', () => {
  const result = validate(state.puzzle, { shaded: currentShaded() });
  lastFailures = result.failures;
  failureCells = new Set<number>();
  for (const f of result.failures) {
    for (const c of f.cells ?? []) failureCells.add(c);
  }
  rerender();
});
hintBtn.addEventListener('click', () => {
  // Learning mode, not autoplay: this only highlights + explains a cell, it
  // never paints `state.cellState` itself — the player still has to click.
  currentHint = computeHint(state.puzzle, state.cellState);
  rerender();
});

// --- Generator wiring -----------------------------------------------------

let generatorWorker: Worker | null = null;

function showGenerateError(message: string): void {
  banner.replaceChildren();
  banner.classList.remove('banner-solved');
  banner.classList.add('banner-fail');
  banner.textContent = `Generation failed: ${message}`;
  banner.hidden = false;
}

generateBtn.addEventListener('click', () => {
  generatorWorker ??= new Worker(new URL('../generator/worker.ts', import.meta.url), {
    type: 'module',
  });
  const worker = generatorWorker;

  const size = parseInt(sizeSelect.value, 10);
  const difficulty = difficultySelect.value as 'easy' | 'medium' | 'hard';
  const seed = (Math.random() * 0xffffffff) >>> 0;

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';

  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    generateBtn.disabled = false;
    generateBtn.textContent = 'New puzzle';
    const msg = ev.data;
    if (msg.type === 'error') {
      showGenerateError(msg.message);
      return;
    }
    try {
      loadPuzzleAndRestore(decodeUrl(msg.result.puzzleUrl));
    } catch (e) {
      showGenerateError(e instanceof Error ? e.message : String(e));
    }
  };
  worker.onerror = (ev) => {
    generateBtn.disabled = false;
    generateBtn.textContent = 'New puzzle';
    showGenerateError(ev.message || 'worker error');
  };

  worker.postMessage({
    type: 'generate',
    opts: { cols: size, rows: size, seed, difficulty },
  } satisfies WorkerRequest);
});

rerender();
