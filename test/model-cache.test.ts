import { afterEach, describe, expect, it } from 'vitest';
import { buildModel, buildModelUncached, setGeometryCache, type Model } from '@solver/model';
import { PRESETS } from '@core/bank';
import { orientations, PENTOMINOES } from '@core/shape';
import { HATENA, NO_CLUE, type Bank, type Puzzle } from '@core/types';
import { createRng, randInt, shuffle } from '@generator/rng';
import { placeShapes } from '@generator/place';
import { deriveMaximalClues } from '@generator/clues';
import { generatePuzzle } from '@generator/generate';

/**
 * The geometry cache (E9 of flip/experiments/generator-search-plan.md) must
 * not move a byte: every model it builds equals the from-scratch reference,
 * placement order and indices included, and the generator deals the boards it
 * dealt before the cache existed.
 */

afterEach(() => setGeometryCache(true));

function expectSameModel(cached: Model, reference: Model): void {
  expect(cached.placements.length).toBe(reference.placements.length);
  for (let i = 0; i < reference.placements.length; i++) {
    const a = cached.placements[i]!;
    const b = reference.placements[i]!;
    if (a.index !== i || a.piece !== b.piece || !a.cells.equals(b.cells) || !a.halo.equals(b.halo) ||
      a.cellList.join() !== b.cellList.join()) {
      expect.fail(`placement ${i} differs: ${JSON.stringify([a.index, a.piece, a.cellList])} vs ${JSON.stringify([b.index, b.piece, b.cellList])}`);
    }
  }
  expect(cached.pieceTypes).toBe(reference.pieceTypes);
  expect(cached.placementsByPiece).toStrictEqual(reference.placementsByPiece);
  expect(cached.placementsCoveringCell).toStrictEqual(reference.placementsCoveringCell);
  expect(cached.clues).toStrictEqual(reference.clues);
  expect(cached.clueCellMask).toStrictEqual(reference.clueCellMask);
  expect(cached.clueRayMask).toStrictEqual(reference.clueRayMask);
  expect([cached.puzzle, cached.cols, cached.rows]).toStrictEqual([reference.puzzle, reference.cols, reference.rows]);
}

function expectCacheMatches(puzzle: Puzzle): void {
  expectSameModel(buildModel(puzzle), buildModelUncached(puzzle));
}

/** Random arrows, HATENA and blanks — not necessarily solvable, which the model doesn't care about. */
function randomCluePuzzle(rng: () => number, cols: number, rows: number, bank: Bank, transparent: boolean): Puzzle {
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  const density = rng() * 0.6;
  for (let i = 0; i < clues.length; i++) {
    if (rng() >= density) continue;
    clues[i] = rng() < 0.1 ? HATENA : randInt(rng, 0, 16);
  }
  return { cols, rows, clues, bank, transparent };
}

/** What the minimizer sees: a layout's maximal clues, then a seeded removal order. */
function minimizerTrajectory(rng: () => number, cols: number, rows: number, bank: Bank): Puzzle[] {
  let answer = placeShapes(cols, rows, bank, rng);
  while (answer === null) answer = placeShapes(cols, rows, bank, rng);
  const clues = deriveMaximalClues(cols, rows, answer.shaded);
  const present: number[] = [];
  for (let i = 0; i < clues.length; i++) if (clues[i] !== NO_CLUE) present.push(i);
  shuffle(present, rng);
  const out: Puzzle[] = [];
  while (present.length > 0) {
    out.push({ cols, rows, clues: clues.slice(), bank, transparent: false });
    for (let k = 0; k < 4 && present.length > 0; k++) clues[present.pop()!] = NO_CLUE;
  }
  return out;
}

const SIZES: readonly [number, number][] = [[6, 6], [8, 8], [10, 10], [7, 9], [5, 12]];

describe('buildModel geometry cache', () => {
  it('matches the reference on random clue grids, transparent and not', () => {
    const rng = createRng(9001);
    for (const [cols, rows] of SIZES) {
      for (let n = 0; n < 12; n++) {
        expectCacheMatches(randomCluePuzzle(rng, cols, rows, PRESETS.p!, n % 2 === 1));
      }
    }
  });

  it('matches the reference along minimizer-like clue trajectories', () => {
    const rng = createRng(4242);
    for (const [cols, rows] of [[6, 6], [8, 8], [10, 10]] as const) {
      for (const puzzle of minimizerTrajectory(rng, cols, rows, PRESETS.p!)) expectCacheMatches(puzzle);
    }
  });

  it('matches the reference for other banks, duplicates and an empty grid', () => {
    const rng = createRng(77);
    for (const bank of [PRESETS.t!, PRESETS.d!, PRESETS.z!]) {
      for (const [cols, rows] of [[6, 6], [8, 8]] as const) {
        expectCacheMatches(randomCluePuzzle(rng, cols, rows, bank, false));
        expectCacheMatches({ cols, rows, clues: new Int16Array(cols * rows).fill(NO_CLUE), bank, transparent: false });
      }
    }
  });

  it('keeps banks with the same pieces in different orientations apart', () => {
    // Same canonical keys, different stored shapes: the orientation order —
    // and so the placement order — differs, so the geometry must not be shared.
    const turned: Bank = { pieces: Object.values(PENTOMINOES).map((s) => orientations(s).at(-1)!) };
    const rng = createRng(5);
    for (let n = 0; n < 6; n++) {
      expectCacheMatches(randomCluePuzzle(rng, 8, 8, PRESETS.p!, false));
      expectCacheMatches(randomCluePuzzle(rng, 8, 8, turned, false));
    }
  });

  it('serves a fresh bank object with the same pieces like the original', () => {
    const rng = createRng(31);
    const puzzle = minimizerTrajectory(rng, 8, 8, PRESETS.p!)[2]!;
    const copy: Bank = { pieces: puzzle.bank.pieces.map((s) => ({ w: s.w, h: s.h, bits: s.bits.slice() })) };
    const twin = buildModel({ ...puzzle, bank: copy });
    expectCacheMatches(puzzle);
    expectSameModel(twin, buildModelUncached({ ...puzzle, bank: copy }));
    expect(twin.placements[0]!.cells).toBe(buildModel(puzzle).placements[0]!.cells);
  });

  it('stays correct across evictions when many sizes alternate', () => {
    const rng = createRng(12);
    for (let round = 0; round < 3; round++) {
      for (let cols = 5; cols <= 15; cols++) expectCacheMatches(randomCluePuzzle(rng, cols, 6, PRESETS.p!, round === 1));
    }
  });

  it('shares geometry between models without letting a model write to it', () => {
    const rng = createRng(3);
    const a = buildModel(randomCluePuzzle(rng, 6, 6, PRESETS.p!, true));
    const b = buildModel(randomCluePuzzle(rng, 6, 6, PRESETS.p!, true));
    expect(a.placements[0]!.cells).toBe(b.placements[0]!.cells);
    expect(Object.isFrozen(a.placements[0]!.cellList)).toBe(true);
  });

  it('builds fresh geometry when switched off', () => {
    setGeometryCache(false);
    const rng = createRng(3);
    const a = buildModel(randomCluePuzzle(rng, 6, 6, PRESETS.p!, true));
    const b = buildModel(randomCluePuzzle(rng, 6, 6, PRESETS.p!, true));
    expect(a.placements[0]!.cells).not.toBe(b.placements[0]!.cells);
    expect(a.placements[0]!.cells.equals(b.placements[0]!.cells)).toBe(true);
  });
});

describe('generatePuzzle with the geometry cache', () => {
  // Recorded on 2026-10-12 before the cache existed (same options, same engine);
  // the two boards the `sensor-wrap` rule changed were re-recorded on 2026-10-19.
  const golden = [
    { opts: { cols: 6, rows: 6, seed: 1, difficulty: 'medium' }, url: 'pentopia/6/6/j6m8g4g2j8m4l//p' },
    { opts: { cols: 6, rows: 6, seed: 2, difficulty: 'medium' }, url: 'pentopia/6/6/8has5i61h9k1j//p' },
    { opts: { cols: 8, rows: 8, seed: 3, difficulty: 'medium' }, url: 'pentopia/8/8/haaocr1s9hcp3i9k//p' },
    { opts: { cols: 6, rows: 6, seed: 4, difficulty: 'hard', opening: 'narrow' }, url: 'pentopia/6/6/iag6nav8h54//p' },
    { opts: { cols: 8, rows: 8, seed: 5, difficulty: 'hard', opening: 'narrow' }, url: 'pentopia/8/8/j6h2o3l2j6pah9r1j8h//p' },
  ] as const;

  for (const { opts, url } of golden) {
    it(`deals the pre-cache board for ${opts.cols}x${opts.rows} ${opts.difficulty} seed ${opts.seed}`, () => {
      expect(generatePuzzle(opts).url).toBe(url);
      setGeometryCache(false);
      expect(generatePuzzle(opts).url).toBe(url);
    });
  }
});
