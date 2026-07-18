/**
 * localStorage persistence: per-puzzle progress autosave + a favorites list.
 * Pure logic, no DOM — takes a Storage-like object (defaulting to
 * `globalThis.localStorage`) so it's unit-testable without a browser.
 *
 * The canonical identity of a puzzle is `encodeUrl(puzzle)` (e.g.
 * "pentopia/10/10/2s9ziar5gbi6z6hai9s4//p") — callers pass that string in as
 * `key` / `url` everywhere below.
 *
 * Every public function swallows storage errors (quota exceeded, storage
 * disabled/unavailable in a sandboxed context, etc.) and degrades silently
 * to a no-op / `null` / empty-list return — persistence is a nice-to-have,
 * never something that should break the app.
 */

/** Minimal Storage surface this module relies on (matches window.localStorage). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    // Some environments throw just reading `localStorage` (e.g. disabled in browser settings).
    return null;
  }
}

const PROGRESS_PREFIX = 'pentopia.progress.';
const PROGRESS_INDEX_KEY = 'pentopia.progress.index';
const LAST_PLAYED_KEY = 'pentopia.lastPlayed';
const FAVORITES_KEY = 'pentopia.favorites';
const ELAPSED_PREFIX = 'pentopia.elapsed.';
const SOLVE_TIME_PREFIX = 'pentopia.solveTime.';
const PLAYER_NAME_KEY = 'pentopia.playerName';

/** Cap on the number of stored progress entries; oldest (by savedAt) is evicted first. */
const MAX_PROGRESS_ENTRIES = 50;

interface ProgressIndexEntry {
  key: string;
  savedAt: number;
}

function readIndex(storage: StorageLike): ProgressIndexEntry[] {
  try {
    const raw = storage.getItem(PROGRESS_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ProgressIndexEntry =>
        typeof e === 'object' && e !== null && typeof (e as ProgressIndexEntry).key === 'string' &&
        typeof (e as ProgressIndexEntry).savedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeIndex(storage: StorageLike, index: ProgressIndexEntry[]): void {
  storage.setItem(PROGRESS_INDEX_KEY, JSON.stringify(index));
}

/** Encode a cellState (values 0|1|2 only) as a compact digit string, e.g. "010221". */
function encodeCellState(cellState: Uint8Array): string {
  let s = '';
  for (let i = 0; i < cellState.length; i++) s += cellState[i];
  return s;
}

function decodeCellState(digits: string): Uint8Array {
  const out = new Uint8Array(digits.length);
  for (let i = 0; i < digits.length; i++) {
    const v = digits.charCodeAt(i) - 48; // '0' -> 0
    out[i] = v >= 0 && v <= 2 ? v : 0;
  }
  return out;
}

/**
 * Save `cellState` as the progress for puzzle `key` (its canonical
 * `encodeUrl(puzzle)` string). Maintains an index of saved keys capped at
 * `MAX_PROGRESS_ENTRIES`, evicting the oldest entry (by savedAt) when full.
 * No-ops silently on any storage failure.
 */
export function saveProgress(key: string, cellState: Uint8Array, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const now = Date.now();
    let index = readIndex(storage);
    const existingPos = index.findIndex((e) => e.key === key);
    if (existingPos !== -1) index.splice(existingPos, 1);
    index.push({ key, savedAt: now });

    while (index.length > MAX_PROGRESS_ENTRIES) {
      // Evict the oldest by savedAt (index is not necessarily sorted, so scan).
      let oldestPos = 0;
      for (let i = 1; i < index.length; i++) {
        if (index[i]!.savedAt < index[oldestPos]!.savedAt) oldestPos = i;
      }
      const [evicted] = index.splice(oldestPos, 1);
      if (evicted) {
        storage.removeItem(PROGRESS_PREFIX + evicted.key);
        // The timer entries ride along with progress — evict them together
        // so they can't accumulate unbounded for puzzles we no longer track.
        storage.removeItem(ELAPSED_PREFIX + evicted.key);
        storage.removeItem(SOLVE_TIME_PREFIX + evicted.key);
      }
    }

    storage.setItem(PROGRESS_PREFIX + key, encodeCellState(cellState));
    writeIndex(storage, index);
  } catch {
    // Storage full/unavailable — degrade silently.
  }
}

/** Load previously saved progress for puzzle `key`, or `null` if none is stored (or storage failed). */
export function loadProgress(key: string, storage: StorageLike | null = defaultStorage()): Uint8Array | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROGRESS_PREFIX + key);
    if (raw === null) return null;
    return decodeCellState(raw);
  } catch {
    return null;
  }
}

/** Record `key` as the most recently played puzzle. No-op on storage failure. */
export function setLastPlayed(key: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_PLAYED_KEY, key);
  } catch {
    // ignore
  }
}

/** The most recently played puzzle's canonical key, or `null` if none / storage unavailable. */
export function getLastPlayed(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(LAST_PLAYED_KEY);
  } catch {
    return null;
  }
}

// --- Solve timer ------------------------------------------------------------

function saveMs(prefix: string, key: string, ms: number, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.setItem(prefix + key, String(Math.max(0, Math.round(ms))));
  } catch {
    // ignore
  }
}

function loadMs(prefix: string, key: string, storage: StorageLike | null): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(prefix + key);
    if (raw === null) return null;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Persist the in-progress solve clock for puzzle `key` (ms of elapsed play time). */
export function saveElapsed(key: string, ms: number, storage: StorageLike | null = defaultStorage()): void {
  saveMs(ELAPSED_PREFIX, key, ms, storage);
}

/** The saved in-progress solve clock for puzzle `key`, or `null` if none. */
export function loadElapsed(key: string, storage: StorageLike | null = defaultStorage()): number | null {
  return loadMs(ELAPSED_PREFIX, key, storage);
}

/** Persist the final solve time for puzzle `key` — set once, when the board first validates. */
export function saveSolveTime(key: string, ms: number, storage: StorageLike | null = defaultStorage()): void {
  saveMs(SOLVE_TIME_PREFIX, key, ms, storage);
}

/** The recorded final solve time for puzzle `key`, or `null` if it hasn't been solved here. */
export function loadSolveTime(key: string, storage: StorageLike | null = defaultStorage()): number | null {
  return loadMs(SOLVE_TIME_PREFIX, key, storage);
}

/** Wipe both timer entries for puzzle `key` — a Reset starting a fresh timed attempt. */
export function clearSolveRecord(key: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(ELAPSED_PREFIX + key);
    storage.removeItem(SOLVE_TIME_PREFIX + key);
  } catch {
    // ignore
  }
}

/** The player's saved display name for challenge links ('' if unset). */
export function getPlayerName(storage: StorageLike | null = defaultStorage()): string {
  if (!storage) return '';
  try {
    return storage.getItem(PLAYER_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPlayerName(name: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // ignore
  }
}

// --- Favorites --------------------------------------------------------------

export interface Favorite {
  /** Canonical `encodeUrl(puzzle)` string — the favorite's identity. */
  url: string;
  name?: string;
  /** Epoch ms. */
  addedAt: number;
}

function readFavorites(storage: StorageLike): Favorite[] {
  try {
    const raw = storage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is Favorite =>
        typeof f === 'object' && f !== null && typeof (f as Favorite).url === 'string' &&
        typeof (f as Favorite).addedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeFavorites(storage: StorageLike, favorites: Favorite[]): void {
  storage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

/** All favorites, in stored order (see `addFavorite` for ordering — newest last; callers wanting newest-first should reverse). */
export function listFavorites(storage: StorageLike | null = defaultStorage()): Favorite[] {
  if (!storage) return [];
  try {
    return readFavorites(storage);
  } catch {
    return [];
  }
}

/**
 * Add a favorite for `url`. Adding a `url` that's already favorited is a
 * no-op on its stored data except refreshing `addedAt` to now (bumps it to
 * "just added" ordering) — it does not create a duplicate entry.
 */
export function addFavorite(
  fav: { url: string; name?: string },
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const favorites = readFavorites(storage);
    const existingPos = favorites.findIndex((f) => f.url === fav.url);
    if (existingPos !== -1) favorites.splice(existingPos, 1);
    favorites.push({ url: fav.url, name: fav.name, addedAt: Date.now() });
    writeFavorites(storage, favorites);
  } catch {
    // ignore
  }
}

/** Remove the favorite for `url`, if present. No-op otherwise (or on storage failure). */
export function removeFavorite(url: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const favorites = readFavorites(storage).filter((f) => f.url !== url);
    writeFavorites(storage, favorites);
  } catch {
    // ignore
  }
}

/** Whether `url` is currently favorited. */
export function isFavorite(url: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return readFavorites(storage).some((f) => f.url === url);
  } catch {
    return false;
  }
}

// --- Favorites panel collapsed state ----------------------------------------

const FAVORITES_COLLAPSED_KEY = 'pentopia.favorites.collapsed';

export function getFavoritesCollapsed(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FAVORITES_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFavoritesCollapsed(collapsed: boolean, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(FAVORITES_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}
