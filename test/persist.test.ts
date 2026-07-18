import { describe, it, expect } from 'vitest';
import {
  saveProgress,
  loadProgress,
  setLastPlayed,
  getLastPlayed,
  listFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  getFavoritesCollapsed,
  setFavoritesCollapsed,
} from '../src/ui/persist';
import type { StorageLike } from '../src/ui/persist';
import { hashString, favoriteSlug, buildPrUrl, defaultFavoriteName } from '../src/ui/favorites';
import { NO_CLUE, type Puzzle } from '@core/types';
import { PRESETS } from '@core/bank';

/** A simple Map-backed Storage-like, mirroring window.localStorage's semantics. */
function makeFakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function makePuzzle(cols: number, rows: number, clueCells: readonly number[] = []): Puzzle {
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const c of clueCells) clues[c] = 1;
  return { cols, rows, clues, bank: PRESETS.p!, transparent: false };
}

describe('progress persistence', () => {
  it('round-trips a cellState (save -> load equals original)', () => {
    const storage = makeFakeStorage();
    const key = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
    const cellState = new Uint8Array([0, 1, 2, 1, 0, 2, 1, 1, 0, 2]);

    saveProgress(key, cellState, storage);
    const loaded = loadProgress(key, storage);

    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!)).toEqual(Array.from(cellState));
  });

  it('an unknown key returns null', () => {
    const storage = makeFakeStorage();
    expect(loadProgress('pentopia/never/saved', storage)).toBeNull();
  });

  it('caps stored progress entries at ~50, evicting the oldest by savedAt', () => {
    const storage = makeFakeStorage();
    // Save 55 distinct puzzle keys, each with a strictly increasing savedAt
    // (Date.now() may tie within the same tick, so force distinct order via
    // the module's real Date.now — separate calls each get a fresh push).
    for (let i = 0; i < 55; i++) {
      saveProgress(`pentopia/key-${i}`, new Uint8Array([1]), storage);
    }

    let present = 0;
    let evictedEarly = 0;
    for (let i = 0; i < 55; i++) {
      const loaded = loadProgress(`pentopia/key-${i}`, storage);
      if (loaded !== null) present++;
      if (i < 5 && loaded === null) evictedEarly++;
    }

    expect(present).toBeLessThanOrEqual(50);
    expect(present).toBeGreaterThan(0);
    // The earliest-saved entries should be the ones evicted (FIFO-ish by savedAt).
    expect(evictedEarly).toBeGreaterThan(0);
    // The most recently saved entry must have survived.
    expect(loadProgress('pentopia/key-54', storage)).not.toBeNull();
  });

  it('re-saving an existing key updates it without growing the index unboundedly', () => {
    const storage = makeFakeStorage();
    const key = 'pentopia/some-key';
    saveProgress(key, new Uint8Array([1]), storage);
    saveProgress(key, new Uint8Array([2]), storage);
    saveProgress(key, new Uint8Array([0]), storage);

    expect(Array.from(loadProgress(key, storage)!)).toEqual([0]);
    expect(JSON.parse(storage.getItem('pentopia.progress.index')!)).toHaveLength(1);
  });

  it('lastPlayed set/get round-trips, and defaults to null when unset', () => {
    const storage = makeFakeStorage();
    expect(getLastPlayed(storage)).toBeNull();
    setLastPlayed('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p', storage);
    expect(getLastPlayed(storage)).toBe('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');
  });
});

describe('favorites', () => {
  const urlA = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
  const urlB = 'pentopia/8/8/somethingelse//p';

  it('add/list/remove/isFavorite basic flow', () => {
    const storage = makeFakeStorage();
    expect(listFavorites(storage)).toEqual([]);
    expect(isFavorite(urlA, storage)).toBe(false);

    addFavorite({ url: urlA, name: 'A' }, storage);
    expect(isFavorite(urlA, storage)).toBe(true);
    expect(listFavorites(storage)).toHaveLength(1);
    expect(listFavorites(storage)[0]!.name).toBe('A');

    removeFavorite(urlA, storage);
    expect(isFavorite(urlA, storage)).toBe(false);
    expect(listFavorites(storage)).toEqual([]);
  });

  it('duplicate add is a no-op on count, refreshing addedAt instead of creating a second entry', () => {
    const storage = makeFakeStorage();
    addFavorite({ url: urlA, name: 'first name' }, storage);
    const firstAddedAt = listFavorites(storage)[0]!.addedAt;

    // Ensure a distinguishable later timestamp.
    const later = firstAddedAt + 1000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      addFavorite({ url: urlA, name: 'second name' }, storage);
    } finally {
      Date.now = realNow;
    }

    const favorites = listFavorites(storage);
    expect(favorites).toHaveLength(1);
    expect(favorites[0]!.name).toBe('second name');
    expect(favorites[0]!.addedAt).toBe(later);
  });

  it('lists in insertion order; caller sorts newest-first (as favorites.ts does for the panel)', () => {
    const storage = makeFakeStorage();
    addFavorite({ url: urlA }, storage);
    addFavorite({ url: urlB }, storage);
    const favorites = listFavorites(storage);
    expect(favorites.map((f) => f.url)).toEqual([urlA, urlB]);
  });

  it('removing a non-favorited url is a no-op', () => {
    const storage = makeFakeStorage();
    addFavorite({ url: urlA }, storage);
    removeFavorite('pentopia/not-there', storage);
    expect(listFavorites(storage)).toHaveLength(1);
  });

  it('favorites-panel collapsed flag persists', () => {
    const storage = makeFakeStorage();
    expect(getFavoritesCollapsed(storage)).toBe(false);
    setFavoritesCollapsed(true, storage);
    expect(getFavoritesCollapsed(storage)).toBe(true);
    setFavoritesCollapsed(false, storage);
    expect(getFavoritesCollapsed(storage)).toBe(false);
  });
});

describe('storage failure handling', () => {
  function makeThrowingStorage(): StorageLike {
    return {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {
        throw new Error('boom');
      },
      removeItem: () => {
        throw new Error('boom');
      },
      key: () => {
        throw new Error('boom');
      },
      length: 0,
    };
  }

  it('saveProgress/loadProgress never throw outward when storage.setItem/getItem throw', () => {
    const storage = makeThrowingStorage();
    expect(() => saveProgress('pentopia/x', new Uint8Array([1]), storage)).not.toThrow();
    expect(() => loadProgress('pentopia/x', storage)).not.toThrow();
    expect(loadProgress('pentopia/x', storage)).toBeNull();
  });

  it('setLastPlayed/getLastPlayed never throw outward', () => {
    const storage = makeThrowingStorage();
    expect(() => setLastPlayed('pentopia/x', storage)).not.toThrow();
    expect(() => getLastPlayed(storage)).not.toThrow();
    expect(getLastPlayed(storage)).toBeNull();
  });

  it('favorites functions never throw outward', () => {
    const storage = makeThrowingStorage();
    expect(() => addFavorite({ url: 'pentopia/x' }, storage)).not.toThrow();
    expect(() => removeFavorite('pentopia/x', storage)).not.toThrow();
    expect(() => isFavorite('pentopia/x', storage)).not.toThrow();
    expect(() => listFavorites(storage)).not.toThrow();
    expect(listFavorites(storage)).toEqual([]);
  });

  it('a null/unavailable storage (no injected Storage, e.g. sandboxed) degrades to no-ops without throwing', () => {
    expect(() => saveProgress('pentopia/x', new Uint8Array([1]), null)).not.toThrow();
    expect(loadProgress('pentopia/x', null)).toBeNull();
    expect(getLastPlayed(null)).toBeNull();
    expect(listFavorites(null)).toEqual([]);
  });
});

describe('PR-URL builder', () => {
  it('produces a stable 8-hex-char hash for a given string', () => {
    const h = hashString('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashString('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p')).toBe(h);
    expect(hashString('something-else')).not.toBe(h);
  });

  it('favoriteSlug is "<cols>x<rows>-<8 hex chars>"', () => {
    const url = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
    const slug = favoriteSlug(url, 10, 10);
    expect(slug).toMatch(/^10x10-[0-9a-f]{8}$/);
  });

  it('buildPrUrl targets the puzzles/<slug>.json filename on daromaj/pentopia main, and its value decodes back to the favorite', () => {
    const url = 'pentopia/10/10/2s9ziar5gbi6z6hai9s4//p';
    const puzzle = makePuzzle(10, 10);
    const fav = { url, name: 'My favorite', addedAt: Date.parse('2026-07-18T00:00:00.000Z') };

    const prUrl = buildPrUrl(fav, puzzle);
    expect(prUrl).toMatch(
      /^https:\/\/github\.com\/daromaj\/pentopia\/new\/main\?filename=puzzles%2F10x10-[0-9a-f]{8}\.json&value=/,
    );

    const valueParam = prUrl.split('&value=')[1]!;
    const decoded = JSON.parse(decodeURIComponent(valueParam));
    expect(decoded).toEqual({
      url,
      name: 'My favorite',
      addedAt: '2026-07-18T00:00:00.000Z',
    });
  });

  it('defaultFavoriteName is "<cols>x<rows>, <n> clues, <date>"', () => {
    const puzzle = makePuzzle(10, 10, [0, 1, 2]);
    const when = new Date('2026-07-18T12:00:00.000Z');
    expect(defaultFavoriteName(puzzle, when)).toBe('10x10, 3 clues, 2026-07-18');
  });
});
