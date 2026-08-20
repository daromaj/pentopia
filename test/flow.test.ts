import { describe, expect, it } from 'vitest';
import { candidateSeed, generatePuzzle, generateRatedCandidate, SEED_BUMPS, type Difficulty } from '@generator/generate';
import { distanceFlow, scoreFlow, selectCandidate, type FlowSignature, type RatedCandidate } from '@generator/flow';
import type { RuleId } from '@solver/propagate';

const histogram = (): Record<RuleId, number> => ({ 'clue-cell-exclusion': 0, 'no-touch-halo': 0, 'placement-filtering': 0, 'arrow-distance-bounds': 0, 'arrow-forced-shade': 0, 'forced-placement': 0, 'cover-analysis': 0, 'clue-candidate': 0, 'probe-forcing': 0, 'probe-forcing-2': 0 });
const signature = (patch: Partial<FlowSignature> = {}): FlowSignature => ({ arrowCardinality: [1, 0, 0, 0], meanTieDistance: 0, clueDispersion: 0, earlySourceShare: 0, earlySourceDispersion: 0, cascadeLinkShare: 0, largestCascadeShare: 0, ruleHistogram: histogram(), probeChainShare: 0, ...patch });
const context = { difficulty: 'medium' as Difficulty, rung: 3 };

describe('flow profiles', () => {
  it('scores each profile for its intended decisive metric', () => {
    expect(scoreFlow('crossfire', signature({ arrowCardinality: [0, 1, 0, 0] }), context)).toBeGreaterThan(scoreFlow('crossfire', signature(), context));
    expect(scoreFlow('long-range', signature({ meanTieDistance: 1 }), context)).toBeGreaterThan(scoreFlow('long-range', signature(), context));
    expect(scoreFlow('shape-chain', signature({ largestCascadeShare: 1 }), context)).toBeGreaterThan(scoreFlow('shape-chain', signature(), context));
    expect(scoreFlow('split-front', signature({ earlySourceDispersion: 1 }), context)).toBeGreaterThan(scoreFlow('split-front', signature(), context));
  });
  it('zeros probe distance on easy and picks lower candidate index on ties', () => {
    const a = signature(), b = signature({ probeChainShare: 1 });
    expect(distanceFlow(a, b, { ...context, difficulty: 'easy' })).toBe(0);
    const board = generatePuzzle({ cols: 6, rows: 6, seed: 1, difficulty: 'easy' });
    const candidates = [1, 0].map((candidateIndex) => ({ ...board, candidateIndex, signature: a })) as RatedCandidate[];
    expect(selectCandidate('crossfire', candidates, context).candidateIndex).toBe(0);
    expect(() => selectCandidate('crossfire', [], context)).toThrow(/must not be empty/);
  });
});

describe('rated candidate generation', () => {
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
