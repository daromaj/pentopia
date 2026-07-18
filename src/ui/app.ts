import './styles.css';

import { validate } from '../core/validator';
import type { Failure } from '../core/types';
import { NO_CLUE } from '../core/types';
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

// Mount point for the generator's "New puzzle" button. Deliberately
// disabled and unwired — the lead wires this up to src/generator later.
// TODO(lead): replace `disabled` with a click handler that calls the
// generator and feeds the result through `loadPuzzle`/`onLoad`, once
// src/generator/** lands.
const generateBtn = document.createElement('button');
generateBtn.type = 'button';
generateBtn.textContent = 'Generate new puzzle';
generateBtn.disabled = true;
generateBtn.dataset.hook = 'generate-puzzle';
generateBtn.title = 'Coming soon';

actions.append(undoBtn, redoBtn, checkBtn, hintCount, generateBtn);
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

rerender();
