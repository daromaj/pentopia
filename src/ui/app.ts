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
  UNTOUCHED,
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
import {
  saveProgress,
  loadProgress,
  setLastPlayed,
  getLastPlayed,
  addFavorite,
  removeFavorite,
  isFavorite,
  saveElapsed,
  loadElapsed,
  saveSolveTime,
  loadSolveTime,
  clearSolveRecord,
  getPlayerName,
  setPlayerName,
} from './persist';
import { createFavoritesPanel, defaultFavoriteName } from './favorites';
import { createTimer, startTimer, pauseTimer, isRunning, elapsedMs, formatTime } from './timer';
import type { SolveTimer } from './timer';
import { playCelebration } from './celebrate';
import { parseChallenge, verifyChallenge } from './share';
import { showSolvedDialog } from './solvedDialog';
import type { ChallengeContext } from './solvedDialog';

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

const appTitle = document.createElement('div');
appTitle.className = 'app-title';
appTitle.textContent = 'Pentopia';

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
resetBtn.title = 'Start over: clear the board and restart the solve clock (board change is undoable)';
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
for (const n of [6, 8, 10, 12, 14, 16]) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = `${n}×${n}`;
  sizeSelect.appendChild(opt);
}
sizeSelect.value = '8';

const difficultySelect = document.createElement('select');
difficultySelect.dataset.hook = 'generate-difficulty';
difficultySelect.title = 'New puzzle difficulty';
for (const d of ['easy', 'medium', 'hard', 'expert']) {
  const opt = document.createElement('option');
  opt.value = d;
  opt.textContent = d;
  difficultySelect.appendChild(opt);
}
difficultySelect.value = 'medium';

const generateBtn = document.createElement('button');
generateBtn.type = 'button';
generateBtn.textContent = 'New puzzle';
generateBtn.classList.add('btn-primary');
generateBtn.dataset.hook = 'generate-puzzle';

const editGroup = document.createElement('div');
editGroup.className = 'action-group';
editGroup.append(undoBtn, redoBtn, checkBtn, hintBtn, resetBtn, clueCount);

// Generation-progress bar: shown only while the worker is grinding. Expert
// puzzles (and bigger boards) can take up to a minute, so a visible indicator
// beats a frozen "Generating…" label. See wireGenerateProgress below.
const generateProgress = document.createElement('div');
generateProgress.className = 'generate-progress';
generateProgress.dataset.hook = 'generate-progress';
generateProgress.hidden = true;
generateProgress.setAttribute('role', 'progressbar');
generateProgress.setAttribute('aria-label', 'Generating puzzle');
const generateProgressFill = document.createElement('div');
generateProgressFill.className = 'generate-progress-fill';
generateProgress.appendChild(generateProgressFill);

const generateGroup = document.createElement('div');
generateGroup.className = 'action-group generate-group';
generateGroup.append(sizeSelect, difficultySelect, generateBtn, generateProgress);

actions.append(editGroup, generateGroup);
toolbar.append(appTitle, urlbarMount, actions);

const banner = document.createElement('div');
banner.className = 'banner';
banner.hidden = true;
banner.dataset.hook = 'banner';

const playArea = document.createElement('div');
playArea.className = 'play-area';

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
playArea.append(banner, boardArea);
root.append(toolbar, playArea);
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
/** Set once the player closes the standing challenge banner, so it stays dismissed for this puzzle instead of reappearing on every re-render. Reset when a new puzzle loads. */
let challengeDismissed = false;

// --- Solve timer + challenge context ---------------------------------------

/** Per-puzzle solve clock; recreated on every puzzle load from its saved elapsed time. */
let timer: SolveTimer = createTimer(loadElapsed(encodeUrl(state.puzzle)) ?? 0);
/** Whether the board validated on the previous render — solve detection fires on the false→true edge. */
let wasSolved = false;
/** Puzzle keys already celebrated this session, so undo/redo around the solving move can't re-trigger the show. */
const celebratedKeys = new Set<string>();
/** True while the timer is paused only because the tab is hidden (so visibility-restore knows to resume). */
let timerPausedByHide = false;
/**
 * Whether the current board state represents a live timed attempt. False
 * when a puzzle loads already-solved (there's no honest clock for it — e.g.
 * progress saved before timing existed), so toggling a cell off and back on
 * can never record a bogus seconds-long "solve". Reset starts a fresh
 * attempt and flips it back on.
 */
let attemptLive = true;

/**
 * An incoming challenge (`?p=…&t=…&n=…&c=…` from a shared link), pinned to
 * the puzzle key it arrived with. `verified` starts false and flips via an
 * async checksum check that re-renders when it lands.
 */
interface IncomingChallenge extends ChallengeContext {
  puzzleKey: string;
}
let incomingChallenge: IncomingChallenge | null = null;
{
  const params = new URLSearchParams(window.location.search);
  const parsed = params.get('p') ? parseChallenge(window.location.search) : null;
  if (parsed) {
    const puzzleKey = encodeUrl(state.puzzle);
    incomingChallenge = { name: parsed.name, timeMs: parsed.timeMs, verified: false, puzzleKey };
    void verifyChallenge(puzzleKey, parsed).then((ok) => {
      if (incomingChallenge?.puzzleKey === puzzleKey) {
        incomingChallenge.verified = ok;
        rerender();
      }
    });
  }
}

/** The active challenge if the currently loaded puzzle is the one it was issued for. */
function challengeForCurrentPuzzle(): IncomingChallenge | null {
  return incomingChallenge && incomingChallenge.puzzleKey === encodeUrl(state.puzzle) ? incomingChallenge : null;
}

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
initAttemptState(encodeUrl(state.puzzle));

/**
 * Establish solve/attempt bookkeeping for a freshly (re)loaded board. A
 * board that arrives already solved gets no live attempt — its recorded
 * time, if any, is the only honest one it will ever have — but it does
 * replay the celebration (animation only, no dialog): refreshing a solved
 * page should still feel like a win. The key still goes into
 * `celebratedKeys` so undo/redo around the original solving move can't
 * re-trigger the full solve flow.
 */
function initAttemptState(key: string): void {
  wasSolved = isSolved();
  attemptLive = !wasSolved;
  if (wasSolved) {
    celebratedKeys.add(key);
    // The board SVG doesn't exist yet — every caller renders right after
    // this returns, so defer one frame and play over the freshly laid-out
    // board.
    requestAnimationFrame(celebrateCurrentBoard);
  }
}

/** Replay a celebration over the current board (animation only, no dialog). */
function celebrateCurrentBoard(): void {
  const svg = boardHost.querySelector<SVGSVGElement>('svg.board-svg');
  if (svg) playCelebration(boardHost, svg, state.puzzle, state.cellState);
}

// Clicking the solved banner replays the show (the share button inside it
// keeps its own job — opening the dialog — so clicks on any button are left
// alone).
banner.addEventListener('click', (e) => {
  if (!banner.classList.contains('banner-solved')) return;
  if (e.target instanceof Element && e.target.closest('button')) return;
  celebrateCurrentBoard();
});

/** Load `puzzle` through the full path — reset state, restore saved progress, clear stale Check results, re-render — shared by urlbar Load, favorites, and (new) puzzle generation. */
function loadPuzzleAndRestore(puzzle: Puzzle): void {
  loadPuzzle(state, puzzle);
  const key = encodeUrl(state.puzzle);
  restoreProgress(key);
  timer = createTimer(loadElapsed(key) ?? 0);
  timerPausedByHide = false;
  initAttemptState(key);
  lastFailures = [];
  failureCells = null;
  currentHint = null;
  challengeDismissed = false;
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

/** Dismiss whatever transient message the banner is showing (hint, Check result, or challenge) and clear the board highlights that came with it. */
function dismissBanner(): void {
  currentHint = null;
  lastFailures = [];
  failureCells = null;
  challengeDismissed = true;
  rerender();
}

/** Append a close (×) button to the banner and mark it as closeable (reserves padding for the button). */
function addBannerCloseButton(): void {
  banner.classList.add('has-close');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'banner-close';
  close.textContent = '×';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissBanner();
  });
  banner.appendChild(close);
}

function updateBanner(solved: boolean): void {
  banner.replaceChildren();
  banner.classList.remove('banner-solved', 'banner-fail', 'banner-hint', 'banner-challenge', 'has-close');
  banner.removeAttribute('title');
  if (solved) {
    banner.classList.add('banner-solved');
    banner.title = 'Replay the celebration';
    const solveMs = loadSolveTime(encodeUrl(state.puzzle));
    const text = document.createElement('span');
    text.textContent = solveMs !== null ? `Solved in ${formatTime(solveMs)}!` : 'Solved!';
    banner.appendChild(text);
    if (solveMs !== null) {
      // Re-entry point to the share dialog after the solve-moment popup is gone.
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'banner-share-btn';
      share.textContent = 'Challenge friends';
      share.addEventListener('click', () => openSolvedDialog(solveMs));
      banner.appendChild(share);
    }
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
    addBannerCloseButton();
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
    addBannerCloseButton();
    banner.hidden = false;
    return;
  }
  // Lowest priority: the standing challenge from a shared link — but only
  // while the board is still untouched and the player hasn't dismissed it.
  const challenge = challengeForCurrentPuzzle();
  const boardUntouched = !state.cellState.some((v) => v !== UNTOUCHED);
  if (challenge && boardUntouched && !challengeDismissed) {
    banner.classList.add('banner-challenge');
    banner.textContent =
      `🏁 ${challenge.name} solved this in ${formatTime(challenge.timeMs)} — can you beat it?` +
      (challenge.verified ? '' : ' (unverified time)');
    addBannerCloseButton();
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

/** Persist the current board (cellState) + solve clock + mark this puzzle as last-played. Any storage failure is silently swallowed inside persist.ts. */
function autosaveProgress(): void {
  const key = encodeUrl(state.puzzle);
  saveProgress(key, state.cellState);
  saveElapsed(key, elapsedMs(timer));
  setLastPlayed(key);
}

/** Open the solved dialog (time, name, share banner) for the current puzzle. */
function openSolvedDialog(timeMs: number): void {
  showSolvedDialog({
    puzzleKey: encodeUrl(state.puzzle),
    timeMs,
    sizeText: `${state.puzzle.cols}×${state.puzzle.rows}`,
    challenge: challengeForCurrentPuzzle(),
    getName: getPlayerName,
    setName: setPlayerName,
  });
}

function onBoardChange(): void {
  // Any edit invalidates the last "Check" result until it's run again, and
  // the last "Hint" until the player asks for a new one.
  lastFailures = [];
  failureCells = null;
  currentHint = null;

  const key = encodeUrl(state.puzzle);
  const solved = isSolved();
  const newlySolved = solved && !wasSolved;

  // The first edit that actually puts paint on the board starts the clock —
  // an empty board (fresh load, or the Reset edit itself) hasn't begun the
  // attempt yet. A puzzle whose solve time is already on record never
  // restarts its clock.
  const boardHasPaint = state.cellState.some((v) => v !== UNTOUCHED);
  if (!solved && boardHasPaint && loadSolveTime(key) === null) startTimer(timer);

  let solveMs: number | null = null;
  if (newlySolved) {
    pauseTimer(timer);
    solveMs = loadSolveTime(key);
    // Record a time only for a live attempt with real clock behind it —
    // re-solving a board that loaded solved (or was un-toggled and back)
    // must never mint a fresh seconds-long "record".
    if (solveMs === null && attemptLive && elapsedMs(timer) > 0) {
      solveMs = elapsedMs(timer);
      saveSolveTime(key, solveMs);
    }
  }
  wasSolved = solved;

  autosaveProgress();
  rerender();

  // Celebration + dialog fire once per puzzle per session, on the edit that
  // solved it — undo/redo shenanigans around that edit can't re-trigger them.
  if (newlySolved && solveMs !== null && !celebratedKeys.has(key)) {
    celebratedKeys.add(key);
    const svg = boardHost.querySelector<SVGSVGElement>('svg.board-svg');
    const delay = svg ? playCelebration(boardHost, svg, state.puzzle, state.cellState) : 0;
    const ms = solveMs;
    setTimeout(() => openSolvedDialog(ms), delay);
  }
}

// Pause the clock while the tab is hidden — thinking time counts, being at
// lunch doesn't. Resume only clocks we paused ourselves.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (isRunning(timer)) {
      pauseTimer(timer);
      saveElapsed(encodeUrl(state.puzzle), elapsedMs(timer));
      timerPausedByHide = true;
    }
  } else if (timerPausedByHide) {
    timerPausedByHide = false;
    startTimer(timer);
  }
});

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
  // Reset = fresh timed attempt: zero the clock, forget the recorded solve
  // time, and re-arm the celebration. (The board clear itself stays undoable,
  // but undoing back to the solved position won't re-record a time — the
  // clock is at zero, which the recording guard above rejects.)
  const key = encodeUrl(state.puzzle);
  clearSolveRecord(key);
  timer = createTimer(0);
  timerPausedByHide = false;
  celebratedKeys.delete(key);
  attemptLive = true;
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

/**
 * Time-based generation progress. We can't get true progress out of the
 * worker (generatePuzzle is one blocking call), so we animate an asymptotic
 * bar — `1 - exp(-t/tau)` — that races toward, but never reaches, 100% until
 * the worker actually returns. `tau` scales with board area and jumps for
 * expert (whose budget is a full minute), so the pace roughly tracks how long
 * a run of that shape really takes without ever lying about being "done".
 */
let progressRaf: number | null = null;

function stopProgress(): void {
  if (progressRaf !== null) {
    cancelAnimationFrame(progressRaf);
    progressRaf = null;
  }
}

function startProgress(size: number, difficulty: 'easy' | 'medium' | 'hard' | 'expert'): void {
  stopProgress();
  const cells = size * size;
  const tauMs = (difficulty === 'expert' ? 18_000 : 1_200) * (cells / 64);
  const t0 = performance.now();
  generateProgress.hidden = false;
  generateProgressFill.style.width = '0%';
  const tick = (): void => {
    const t = performance.now() - t0;
    // Cap the animation at 95% — the snap to 100% happens only on real completion.
    const pct = Math.min(95, (1 - Math.exp(-t / tauMs)) * 100);
    generateProgressFill.style.width = `${pct.toFixed(1)}%`;
    generateProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
    progressRaf = requestAnimationFrame(tick);
  };
  progressRaf = requestAnimationFrame(tick);
}

function finishProgress(): void {
  stopProgress();
  generateProgressFill.style.width = '100%';
  // Let the fill visibly complete before hiding.
  setTimeout(() => {
    generateProgress.hidden = true;
    generateProgressFill.style.width = '0%';
  }, 250);
}

function showGenerateError(message: string): void {
  banner.replaceChildren();
  banner.classList.remove('banner-solved', 'banner-hint', 'banner-challenge', 'has-close');
  banner.classList.add('banner-fail');
  banner.textContent = `Generation failed: ${message}`;
  addBannerCloseButton();
  banner.hidden = false;
}

generateBtn.addEventListener('click', () => {
  generatorWorker ??= new Worker(new URL('../generator/worker.ts', import.meta.url), {
    type: 'module',
  });
  const worker = generatorWorker;

  const size = parseInt(sizeSelect.value, 10);
  const difficulty = difficultySelect.value as 'easy' | 'medium' | 'hard' | 'expert';
  const seed = (Math.random() * 0xffffffff) >>> 0;

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  startProgress(size, difficulty);

  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    generateBtn.disabled = false;
    generateBtn.textContent = 'New puzzle';
    finishProgress();
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
    finishProgress();
    showGenerateError(ev.message || 'worker error');
  };

  worker.postMessage({
    type: 'generate',
    opts: { cols: size, rows: size, seed, difficulty },
  } satisfies WorkerRequest);
});

rerender();

// --- Offline support --------------------------------------------------
// Registered only in the built app (not the dev server, where it would
// fight Vite's own module reloading). Registration failing (unsupported
// browser, blocked by an extension, etc.) is never fatal — the game plays
// fine online either way.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
