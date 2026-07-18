/**
 * URL toolbar: a share-URL input (always the puzzle, never the player's
 * progress — clue changes never alter it), Load (paste-and-import any
 * accepted decodeUrl form) and Copy-link buttons, plus startup parsing of
 * `?p=` / `location.hash` and keeping the hash in sync with the puzzle.
 */

import { decodeUrl, encodeUrl } from '../core/codec/url';
import type { Puzzle } from '../core/types';

/** The format §3.4 sample puzzle, used when no puzzle is given on startup. */
const DEFAULT_PUZZLE_STRING = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';

export interface UrlBar {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
}

export interface UrlBarOptions {
  /** Called with the freshly decoded puzzle when the user loads a valid URL/string. */
  onLoad: (puzzle: Puzzle) => void;
}

/** Build the URL bar sub-component (input + Load + Copy link + inline error). Caller mounts `root`. */
export function createUrlBar(opts: UrlBarOptions): UrlBar {
  const root = document.createElement('div');
  root.className = 'urlbar';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'urlbar-input';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Puzzle share URL');

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.textContent = 'Load';
  loadBtn.dataset.hook = 'load-btn';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy link';
  copyBtn.dataset.hook = 'copy-btn';

  const error = document.createElement('div');
  error.className = 'urlbar-error';
  error.hidden = true;

  function showError(msg: string): void {
    error.textContent = msg;
    error.hidden = false;
  }
  function clearError(): void {
    error.hidden = true;
    error.textContent = '';
  }

  loadBtn.addEventListener('click', () => {
    clearError();
    try {
      const puzzle = decodeUrl(input.value);
      opts.onLoad(puzzle);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not parse that puzzle URL.');
    }
  });

  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(input.value).catch(() => {
      input.select();
    });
  });

  root.append(input, loadBtn, copyBtn, error);
  return { root, input };
}

/** Set the input to the canonical share URL for `puzzle` (the puzzle itself, not progress). */
export function setShareUrl(bar: UrlBar, puzzle: Puzzle): void {
  bar.input.value = `https://puzz.link/p?${encodeUrl(puzzle)}`;
}

/** Resolve the startup puzzle from `?p=`, then `location.hash`, falling back to the format §3.4 sample. */
export function loadStartupPuzzle(): Puzzle {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('p');
  if (fromQuery) {
    try {
      return decodeUrl(fromQuery);
    } catch {
      // fall through to hash / default
    }
  }
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    try {
      return decodeUrl(hash);
    } catch {
      // fall through to default
    }
  }
  return decodeUrl(DEFAULT_PUZZLE_STRING);
}

/** Mirror the current puzzle into `location.hash` as `#pentopia/...` (bare encoded string, no history entry). */
export function updateHash(puzzle: Puzzle): void {
  const encoded = encodeUrl(puzzle);
  history.replaceState(null, '', `#${encoded}`);
}
