import './styles.css';

import { validate } from '../core/validator';
import { decodeUrl } from '../core/codec/url';
import type { Failure } from '../core/types';
import { NO_CLUE } from '../core/types';
import type { WorkerRequest, WorkerResponse } from '../generator/worker';
import {
  createPlayState,
  loadPuzzle,
  undo,
  redo,
  FAILCODE_MESSAGES,
  SHADED,
} from './state';
import type { PlayState } from './state';
import { renderBoard, renderBank } from './render';
import { attachBoardInteraction, attachKeyboardShortcuts } from './interaction';
import { createUrlBar, setShareUrl, loadStartupPuzzle, updateHash } from './urlbar';

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

const hintCount = document.createElement('span');
hintCount.className = 'hint-count';
hintCount.dataset.hook = 'hint-count';

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

actions.append(undoBtn, redoBtn, checkBtn, hintCount, sizeSelect, difficultySelect, generateBtn);
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

const bankHost = document.createElement('div');
bankHost.className = 'bank-host';
bankHost.dataset.hook = 'bank-host';

boardArea.append(boardHost, bankHost);
root.append(toolbar, banner, boardArea);
appRoot.append(root);

// --- State --------------------------------------------------------------

const state: PlayState = createPlayState(loadStartupPuzzle());
let lastFailures: readonly Failure[] = [];
let failureCells: Set<number> | null = null;

const urlbar = createUrlBar({
  onLoad: (puzzle) => {
    loadPuzzle(state, puzzle);
    lastFailures = [];
    failureCells = null;
    rerender();
  },
});
urlbarMount.appendChild(urlbar.root);

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
  banner.classList.remove('banner-solved', 'banner-fail');
  if (solved) {
    banner.classList.add('banner-solved');
    banner.textContent = 'Solved!';
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

function updateHintCount(): void {
  let n = 0;
  for (const c of state.puzzle.clues) if (c !== NO_CLUE) n++;
  hintCount.textContent = `${n} clue${n === 1 ? '' : 's'}`;
}

function rerender(): void {
  updateHash(state.puzzle);
  setShareUrl(urlbar, state.puzzle);
  updateHintCount();

  const solved = isSolved();
  renderBoard(boardHost, state, { failureCells: failureCells ?? undefined, solved });
  renderBank(bankHost, state.puzzle, state.cellState);
  updateBanner(solved);

  undoBtn.disabled = state.undoStack.length === 0;
  redoBtn.disabled = state.redoStack.length === 0;
}

function onBoardChange(): void {
  // Any edit invalidates the last "Check" result until it's run again.
  lastFailures = [];
  failureCells = null;
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
checkBtn.addEventListener('click', () => {
  const result = validate(state.puzzle, { shaded: currentShaded() });
  lastFailures = result.failures;
  failureCells = new Set<number>();
  for (const f of result.failures) {
    for (const c of f.cells ?? []) failureCells.add(c);
  }
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
      loadPuzzle(state, decodeUrl(msg.result.puzzleUrl));
      lastFailures = [];
      failureCells = null;
      rerender();
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
