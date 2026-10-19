/**
 * The `sensor-wrap` rule (propagate.ts, `ruleSensorWrap`): at tie distance 1 a
 * clue's arrowed neighbours are shaded; neighbours touching diagonally must be
 * one piece, so if no alive placement holds a whole such group, distance 1 is
 * impossible and every arrowed neighbour is excluded.
 */

import { describe, it, expect } from 'vitest';
import { buildModel, type Model } from '@solver/model';
import { commitPlacement, initState, type SolveState } from '@solver/state';
import { propagateToFixpoint, type Step } from '@solver/propagate';
import { deduce } from '@solver/deduce';
import { solve } from '@solver/search';
import { generatePuzzle, type Difficulty } from '@generator/generate';
import { decodeUrl } from '@core/codec/url';
import { PRESETS } from '@core/bank';
import { canonicalKey, shapeFromStrings } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, dirBit, Dir, type Bank, type Puzzle } from '@core/types';

const N = 8;
const at = (x: number, y: number): number => idx(x, y, N);
const SENSOR = at(3, 3);
const UP = at(3, 2);
const DOWN = at(3, 4);
const LEFT = at(2, 3);
const RIGHT = at(4, 3);

function mkPuzzle(arrows: number, bank: Bank, transparent = false, cols = N, rows = N, sensor = SENSOR): Puzzle {
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  clues[sensor] = arrows;
  return { cols, rows, clues, bank, transparent };
}

const U_KEY = canonicalKey(shapeFromStrings(['#.#', '###']));
const bankWithoutU: Bank = { pieces: PRESETS.p!.pieces.filter((s) => canonicalKey(s) !== U_KEY) };
const iOnly: Bank = { pieces: [shapeFromStrings(['#####'])] };

const wrapSteps = (steps: readonly Step[]): Step[] => steps.filter((s) => s.rule === 'sensor-wrap');

function run(puzzle: Puzzle, seed?: (model: Model, st: SolveState) => void, ignoreBank = false) {
  const model = buildModel(puzzle);
  const st = initState(model);
  seed?.(model, st);
  const r = propagateToFixpoint(model, st, { probeDepth: 0, ignoreBank });
  return { model, st, r, wrap: wrapSteps(r.steps) };
}

describe('sensor-wrap', () => {
  it('four arrows on an empty board exclude all four neighbours', () => {
    const { st, r, wrap } = run(mkPuzzle(15, PRESETS.p!));
    expect(r.status).toBe('ok');
    expect(wrap).toHaveLength(1);
    expect(wrap[0]).toMatchObject({
      kind: 'exclude',
      sourceClue: SENSOR,
      detail: `clue ${SENSOR}: distance 1 impossible — four arrows`,
    });
    expect([...wrap[0]!.cells].sort((a, b) => a - b)).toEqual([UP, LEFT, RIGHT, DOWN].sort((a, b) => a - b));
    for (const c of [UP, DOWN, LEFT, RIGHT]) expect(st.excluded.test(c)).toBe(true);
  });

  it('three arrows stay silent on an empty board while the U can wrap the sensor', () => {
    const { r, wrap, st } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Left) | dirBit(Dir.Right), PRESETS.p!));
    expect(r.status).toBe('ok');
    expect(wrap).toHaveLength(0);
    for (const c of [UP, LEFT, RIGHT]) expect(st.excluded.test(c)).toBe(false);
  });

  it('three arrows fire when the bank holds no U', () => {
    const { r, wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Left) | dirBit(Dir.Right), bankWithoutU));
    expect(r.status).toBe('ok');
    expect(wrap).toHaveLength(1);
    expect(wrap[0]!.detail).toBe(`clue ${SENSOR}: distance 1 impossible — no piece holds cells ${UP},${LEFT},${RIGHT}`);
    expect([...wrap[0]!.cells].sort((a, b) => a - b)).toEqual([UP, LEFT, RIGHT]);
  });

  describe('three arrows with the U already committed elsewhere', () => {
    // 12x12 board, sensor at (3,3); the U is committed in the far corner.
    const cols = 12;
    const sensor = idx(3, 3, cols);
    const puzzle = mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Left) | dirBit(Dir.Right), PRESETS.p!, false, cols, cols, sensor);
    const commitU = (model: Model, st: SolveState) => {
      const u = model.pieceTypes.findIndex((t) => t.key === U_KEY);
      const corner = idx(11, 11, cols);
      const p = model.placementsByPiece[u]!.find((q) => model.placements[q]!.cells.test(corner))!;
      commitPlacement(model, st, p);
    };

    it('fires under the real bank (the U is used up)', () => {
      const { wrap } = run(puzzle, commitU);
      expect(wrap).toHaveLength(1);
      expect(wrap[0]!.sourceClue).toBe(sensor);
    });

    it('stays silent under ignoreBank (a second U is allowed)', () => {
      const { wrap } = run(puzzle, commitU, true);
      expect(wrap).toHaveLength(0);
    });
  });

  it('two perpendicular arrows fire with the corner reason when the corner is excluded', () => {
    const corner = at(4, 2);
    const { r, wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Right), PRESETS.p!), (_m, st) => st.excluded.set(corner));
    expect(r.status).toBe('ok');
    expect(wrap).toHaveLength(1);
    expect(wrap[0]!.detail).toBe(`clue ${SENSOR}: distance 1 impossible — corner ${corner} blocked`);
    expect([...wrap[0]!.cells].sort((a, b) => a - b)).toEqual([UP, RIGHT]);
  });

  it('two perpendicular arrows stay silent while the corner is open', () => {
    const { wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Right), PRESETS.p!));
    expect(wrap).toHaveLength(0);
  });

  it('two perpendicular arrows name the cells when no piece shape can hold both', () => {
    const { wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Right), iOnly));
    expect(wrap).toHaveLength(1);
    expect(wrap[0]!.detail).toBe(`clue ${SENSOR}: distance 1 impossible — no piece holds cells ${UP},${RIGHT}`);
  });

  it('two opposite arrows never fire', () => {
    for (const bank of [PRESETS.p!, iOnly]) {
      const { wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Down), bank));
      expect(wrap).toHaveLength(0);
    }
  });

  it('in transparent mode a piece through the sensor counts, so the corner reason is not used', () => {
    // Corner excluded, but the sensor itself is coverable: an L/V-like piece can
    // join UP and RIGHT through the sensor cell, so nothing fires.
    const corner = at(4, 2);
    const { wrap } = run(mkPuzzle(dirBit(Dir.Up) | dirBit(Dir.Right), PRESETS.p!, true), (_m, st) => st.excluded.set(corner));
    expect(wrap).toHaveLength(0);
  });

  it('four arrows stay silent in transparent mode while the X can cover the sensor', () => {
    const { wrap } = run(mkPuzzle(15, PRESETS.p!, true));
    expect(wrap).toHaveLength(0);
  });

  it('four arrows in transparent mode without the X fire with the cell-list reason', () => {
    const X_KEY = canonicalKey(shapeFromStrings(['.#.', '###', '.#.']));
    const bankWithoutX: Bank = { pieces: PRESETS.p!.pieces.filter((s) => canonicalKey(s) !== X_KEY) };
    const { wrap } = run(mkPuzzle(15, bankWithoutX, true));
    expect(wrap).toHaveLength(1);
    const cells = [UP, LEFT, RIGHT, DOWN].sort((a, b) => a - b).join(',');
    expect(wrap[0]!.detail).toBe(`clue ${SENSOR}: distance 1 impossible — no piece holds cells ${cells}`);
  });
});

describe('sensor-wrap on real boards', () => {
  it('closes the constructor board pentopia/10/10/jczv7kdxdk1zm without a what-if', () => {
    const puzzle = decodeUrl('https://puzz.link/p?pentopia/10/10/jczv7kdxdk1zm//p');
    const d = deduce(puzzle);
    expect(d.solved).toBe(true);
    expect(d.maxTier).toBeLessThanOrEqual(5);
    expect(d.tierHistogram['sensor-wrap']).toBeGreaterThanOrEqual(1);
    const s = solve(puzzle, { maxSolutions: 2 });
    expect(s.complete).toBe(true);
    expect(s.solutions).toHaveLength(1);
    expect(Array.from(d.solution!.shaded)).toEqual(Array.from(s.solutions[0]!.shaded));
  }, 30_000);

  const cases: [number, number, Difficulty, number][] = [
    [6, 6, 'medium', 3],
    [6, 6, 'hard', 4],
    [8, 8, 'medium', 7],
    [8, 8, 'hard', 2],
    [8, 8, 'expert', 1],
  ];
  it.each(cases)('soundness: %ix%i %s seed %i — deduce agrees with search, every wrap exclusion is unshaded', (cols, rows, difficulty, seed) => {
    const { puzzle, answer } = generatePuzzle({ cols, rows, seed, difficulty });
    const d = deduce(puzzle);
    expect(d.contradiction).toBeUndefined();
    const s = solve(puzzle, { maxSolutions: 2 });
    expect(s.solutions).toHaveLength(1);
    expect(Array.from(s.solutions[0]!.shaded)).toEqual(Array.from(answer.shaded));
    if (d.solved) expect(Array.from(d.solution!.shaded)).toEqual(Array.from(answer.shaded));
    for (const step of wrapSteps(d.steps)) for (const c of step.cells) expect(answer.shaded[c]).toBe(0);
  }, 120_000);
});
