/**
 * Favorites panel: rendered below the bank panel, lists starred puzzles
 * (newest first), lets the player jump back into one, remove it, or open a
 * prefilled GitHub "new file" page to contribute it to the puzzles/
 * directory.
 *
 * Repo-integration mechanism (deliberately minimal, no tokens in the app):
 * the "PR" button just opens GitHub's own "create new file" UI
 * (`/new/<branch>?filename=...&value=...`) with the favorite's JSON
 * pre-filled in the editor. The user reviews it and commits directly (or
 * via a PR, GitHub's UI offers both) — this app never talks to the GitHub
 * API and never holds credentials.
 */

import { decodeUrl } from '../core/codec/url';
import { NO_CLUE } from '../core/types';
import type { Puzzle } from '../core/types';
import {
  listFavorites,
  removeFavorite,
  getFavoritesCollapsed,
  setFavoritesCollapsed,
} from './persist';
import type { Favorite, StorageLike } from './persist';

const REPO_OWNER = 'daromaj';
const REPO_NAME = 'pentopia';
const REPO_BRANCH = 'main';

/** Deterministic 32-bit FNV-1a hash of `s`, rendered as 8 lowercase hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Filesystem-safe slug for a favorite's puzzle file, e.g. "10x10-3f2a19bc". */
export function favoriteSlug(url: string, cols: number, rows: number): string {
  return `${cols}x${rows}-${hashString(url)}`;
}

/**
 * Build the GitHub "new file" prefill URL for a favorite. `puzzle` supplies
 * the board dimensions used in the slug (decode it from `fav.url` if not
 * already at hand).
 */
export function buildPrUrl(fav: Favorite, puzzle: Puzzle): string {
  const slug = favoriteSlug(fav.url, puzzle.cols, puzzle.rows);
  const body = {
    url: fav.url,
    name: fav.name ?? '',
    addedAt: new Date(fav.addedAt).toISOString(),
  };
  const value = JSON.stringify(body, null, 2) + '\n';
  const filename = `puzzles/${slug}.json`;
  return (
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/new/${REPO_BRANCH}` +
    `?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(value)}`
  );
}

/** Default favorite name: "<cols>x<rows>, <n> clues, <date>". */
export function defaultFavoriteName(puzzle: Puzzle, when: Date = new Date()): string {
  let clues = 0;
  for (const c of puzzle.clues) if (c !== NO_CLUE) clues++;
  const date = when.toISOString().slice(0, 10);
  return `${puzzle.cols}x${puzzle.rows}, ${clues} clue${clues === 1 ? '' : 's'}, ${date}`;
}

export interface FavoritesPanelOptions {
  /** Called when a favorite is clicked, with its decoded puzzle — caller loads it (and restores progress) same as urlbar Load. */
  onSelect: (puzzle: Puzzle, url: string) => void;
  storage?: StorageLike;
}

export interface FavoritesPanel {
  readonly root: HTMLElement;
  /** Re-read favorites from storage and rebuild the DOM. Hides the panel entirely when the list is empty. */
  refresh(): void;
}

export function createFavoritesPanel(opts: FavoritesPanelOptions): FavoritesPanel {
  const root = document.createElement('div');
  root.className = 'favorites-panel';
  root.dataset.hook = 'favorites-panel';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'favorites-header';
  header.dataset.hook = 'favorites-toggle';

  const caret = document.createElement('span');
  caret.className = 'favorites-caret';

  const title = document.createElement('span');
  title.className = 'favorites-title';

  header.append(caret, title);

  const list = document.createElement('ul');
  list.className = 'favorites-list';
  list.dataset.hook = 'favorites-list';

  root.append(header, list);

  let collapsed = getFavoritesCollapsed(opts.storage);

  function applyCollapsed(): void {
    caret.textContent = collapsed ? '▸' : '▾'; // ▸ / ▾
    list.hidden = collapsed;
  }

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    setFavoritesCollapsed(collapsed, opts.storage);
    applyCollapsed();
  });

  function refresh(): void {
    const favorites = listFavorites(opts.storage).slice().sort((a, b) => b.addedAt - a.addedAt);

    if (favorites.length === 0) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    title.textContent = `Favorites (${favorites.length})`;
    applyCollapsed();

    list.replaceChildren();
    for (const fav of favorites) {
      let puzzle: Puzzle;
      try {
        puzzle = decodeUrl(fav.url);
      } catch {
        continue; // corrupted/stale entry — skip rather than crash the panel
      }

      const item = document.createElement('li');
      item.className = 'favorites-item';

      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'favorites-item-link';
      link.dataset.hook = 'favorite-load';

      const name = document.createElement('span');
      name.className = 'favorites-item-name';
      name.textContent = fav.name || fav.url;

      let clues = 0;
      for (const c of puzzle.clues) if (c !== NO_CLUE) clues++;
      const info = document.createElement('span');
      info.className = 'favorites-item-info';
      info.textContent = `${puzzle.cols}×${puzzle.rows}, ${clues} clue${clues === 1 ? '' : 's'}`;

      link.append(name, info);
      link.addEventListener('click', () => opts.onSelect(puzzle, fav.url));

      const prLink = document.createElement('a');
      prLink.className = 'favorites-item-pr';
      prLink.textContent = 'PR';
      prLink.title = 'Open a prefilled GitHub "new file" page to contribute this puzzle';
      prLink.target = '_blank';
      prLink.rel = 'noopener';
      prLink.href = buildPrUrl(fav, puzzle);
      prLink.dataset.hook = 'favorite-pr';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'favorites-item-remove';
      removeBtn.textContent = '✕'; // ✕
      removeBtn.title = 'Remove favorite';
      removeBtn.dataset.hook = 'favorite-remove';
      removeBtn.addEventListener('click', () => {
        removeFavorite(fav.url, opts.storage);
        refresh();
      });

      item.append(link, prLink, removeBtn);
      list.appendChild(item);
    }
  }

  applyCollapsed();
  refresh();

  return { root, refresh };
}
