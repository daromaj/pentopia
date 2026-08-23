import { describe, expect, it } from 'vitest';
import { dirBit, Dir, NO_CLUE, type Puzzle, type Solution } from '@core/types';
import { deduce } from '@solver/deduce';
import { candidateSeed, generatePuzzle, generateRatedCandidate, SEED_BUMPS, type Difficulty, type GenerateResult } from '@generator/generate';
import { distanceFlow, scoreFlow, signatureOf, type FlowSignature } from '@generator/flow';
import { prioritizeClueRemovals } from '@generator/minimize';
import type { RuleId } from '@solver/propagate';

const histogram = (): Record<RuleId, number> => ({ 'clue-cell-exclusion': 0, 'no-touch-halo': 0, 'placement-filtering': 0, 'arrow-distance-bounds': 0, 'arrow-forced-shade': 0, 'forced-placement': 0, 'cover-analysis': 0, 'clue-candidate': 0, 'probe-forcing': 0, 'probe-forcing-2': 0 });
const signature = (patch: Partial<FlowSignature> = {}): FlowSignature => ({ arrowCardinality: [1, 0, 0, 0], meanTieDistance: 0, clueDispersion: 0, earlySourceShare: 0, earlySourceDispersion: 0, cascadeLinkShare: 0, largestCascadeShare: 0, ruleHistogram: histogram(), probeChainShare: 0, ...patch });
const context = { difficulty: 'medium' as Difficulty, rung: 3 };

type Transform = (x: number, y: number, n: number) => readonly [number, number];
const TRANSFORMS: readonly Transform[] = [
  (x, y) => [x, y],
  (x, y, n) => [n - 1 - y, x],
  (x, y, n) => [n - 1 - x, n - 1 - y],
  (x, y, n) => [y, n - 1 - x],
  (x, y, n) => [n - 1 - x, y],
  (x, y, n) => [x, n - 1 - y],
  (x, y) => [y, x],
  (x, y, n) => [n - 1 - y, n - 1 - x],
];

function transformed(result: GenerateResult, transform: Transform): GenerateResult {
  const n = result.puzzle.cols;
  const clues = new Int16Array(n * n).fill(NO_CLUE);
  const shaded = new Uint8Array(n * n);
  const origin = transform(0, 0, n);
  const mapDir = (dir: Dir): Dir => {
    const [dx, dy] = dir === Dir.Up ? [0, -1] : dir === Dir.Down ? [0, 1] : dir === Dir.Left ? [-1, 0] : [1, 0];
    const point = transform(dx, dy, n);
    const vx = point[0] - origin[0], vy = point[1] - origin[1];
    return vy < 0 ? Dir.Up : vy > 0 ? Dir.Down : vx < 0 ? Dir.Left : Dir.Right;
  };
  for (let source = 0; source < n * n; source++) {
    const [x, y] = transform(source % n, Math.floor(source / n), n);
    const target = y * n + x;
    shaded[target] = result.answer.shaded[source]!;
    const clue = result.puzzle.clues[source]!;
    if (clue <= 0) clues[target] = clue;
    else {
      let mapped = 0;
      for (const dir of [Dir.Up, Dir.Down, Dir.Left, Dir.Right]) {
        if ((clue & dirBit(dir)) !== 0) mapped |= dirBit(mapDir(dir));
      }
      clues[target] = mapped;
    }
  }
  return { ...result, puzzle: { ...result.puzzle, clues } as Puzzle, answer: { shaded } as Solution };
}

describe('flow profiles', () => {
  it('scores each profile for its intended decisive metric', () => {
    expect(scoreFlow('crossfire', signature({ arrowCardinality: [0, 1, 0, 0] }), context)).toBeGreaterThan(scoreFlow('crossfire', signature(), context));
    expect(scoreFlow('long-range', signature({ meanTieDistance: 1 }), context)).toBeGreaterThan(scoreFlow('long-range', signature(), context));
    expect(scoreFlow('shape-chain', signature({ largestCascadeShare: 1 }), context)).toBeGreaterThan(scoreFlow('shape-chain', signature(), context));
    expect(scoreFlow('split-front', signature({ earlySourceDispersion: 1 }), context)).toBeGreaterThan(scoreFlow('split-front', signature(), context));
  });
  it('zeros probe distance on easy', () => {
    const a = signature(), b = signature({ probeChainShare: 1 });
    expect(distanceFlow(a, b, { ...context, difficulty: 'easy' })).toBe(0);
  });

  it('is invariant under every square-board dihedral symmetry', () => {
    const board = generatePuzzle({ cols: 6, rows: 6, seed: 17, difficulty: 'medium' });
    const want = signatureOf(board);
    for (const transform of TRANSFORMS) expect(signatureOf(transformed(board, transform))).toEqual(want);
  });

  it('tags every clue-specific deduction with its structural source', () => {
    const board = generatePuzzle({ cols: 6, rows: 6, seed: 29, difficulty: 'medium' });
    const clueSteps = deduce(board.puzzle).steps.filter((step) =>
      step.rule === 'arrow-distance-bounds' || step.rule === 'arrow-forced-shade' || step.rule === 'clue-candidate',
    );
    expect(clueSteps.length).toBeGreaterThan(0);
    expect(clueSteps.every((step) => step.sourceClue !== undefined)).toBe(true);
  });
});

describe('rated candidate generation', () => {
  it('uses opposite clue-removal priorities for crossfire and shape-chain', () => {
    const puzzle = {
      cols: 3,
      rows: 3,
      clues: Int16Array.from([1, 3, 7, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]),
      bank: { pieces: [] },
      transparent: false,
    } as Puzzle;
    const answer = { shaded: new Uint8Array(9) } as Solution;
    const crossfire = [2, 0, 1];
    const chain = [2, 0, 1];
    prioritizeClueRemovals(crossfire, puzzle, answer, 'crossfire');
    prioritizeClueRemovals(chain, puzzle, answer, 'shape-chain');
    expect(crossfire).toEqual([0, 1, 2]);
    expect(chain).toEqual([2, 1, 0]);
  });

  it('keeps candidate zero on the legacy seed path and gives candidates separate streams', () => {
    const opts = { cols: 6, rows: 6, seed: 123, difficulty: 'medium' as const };
    expect(generateRatedCandidate(opts, 0).url).toBe(generatePuzzle(opts).url);
    expect(generateRatedCandidate(opts, 1).candidateIndex).toBe(1);
  });

  it('keeps every supported candidate and retry bump on a distinct deterministic seed', () => {
    const base = 0xfedcba98;
    const seeds = new Set<number>();
    for (let candidateIndex = 0; candidateIndex < 4; candidateIndex++) {
      for (let bumpIndex = 0; bumpIndex < SEED_BUMPS; bumpIndex++) {
        const seed = candidateSeed(base, candidateIndex, bumpIndex);
        expect(seeds.has(seed)).toBe(false);
        seeds.add(seed);
      }
    }
    expect(seeds.size).toBe(32);
  });
});
