import { describe, it, expect } from 'vitest';
import { solve, solveModel } from '@solver/search';
import { buildModel } from '@solver/model';
import { initState } from '@solver/state';
import { propagateToFixpoint } from '@solver/propagate';
import { decodeUrl } from '@core/codec/url';
import { decodePzprv3 } from '@core/codec/pzprv3';
import { validate } from '@core/validator';
import { shapeFromStrings, TETROMINOES } from '@core/shape';
import { idx } from '@core/grid';
import { NO_CLUE, dirBit, Dir, type Bank, type Puzzle, type Solution } from '@core/types';
import { fixtures } from './fixtures/pentopia';

function sig(s: Solution): string {
  return Array.from(s.shaded).join('');
}

function renderGrid(cols: number, rows: number, s: Solution): string {
  let out = '';
  for (let y = 0; y < rows; y++) {
    let row = '';
    for (let x = 0; x < cols; x++) row += s.shaded[y * cols + x] ? '#' : '.';
    out += row + '\n';
  }
  return out;
}

function mkPuzzle(
  cols: number,
  rows: number,
  clues: Record<number, number>,
  bank: Bank,
  transparent = false,
): Puzzle {
  const c = new Int16Array(cols * rows).fill(NO_CLUE);
  for (const k of Object.keys(clues)) c[+k] = clues[+k]!;
  return { cols, rows, clues: c, bank, transparent };
}

// ── Vendored valid fixtures ────────────────────────────────────────────────
describe('solver: vendored valid fixtures', () => {
  it('valid_6x7 (tetromino bank, 6 clues): unique solution = the fixture answer', () => {
    const f = fixtures.find((x) => x.name === 'valid_6x7')!;
    const { puzzle, answer } = decodePzprv3(f.pzprv3);
    const res = solve(puzzle, { maxSolutions: 5 });
    // This hand-made board turns out to be a proper (uniquely solvable) puzzle.
    expect(res.solutions.length).toBe(1);
    expect(res.complete).toBe(true);
    expect(sig(res.solutions[0]!)).toBe(sig(answer));
    expect(validate(puzzle, res.solutions[0]!).ok).toBe(true);
  });

  it('valid_5x5 (transparent, pentomino bank, 1 clue): answer is among the solutions', () => {
    const f = fixtures.find((x) => x.name === 'valid_5x5')!;
    const { puzzle, answer } = decodePzprv3(f.pzprv3);
    // Enumerate fully (25 cells, cheap). This fixture is a hand-made PARTIAL
    // board with a single clue, so it is NOT a unique puzzle — many shadings
    // satisfy its lone clue. We assert only that the fixture's own answer is
    // one of the valid solutions (and report the ambiguity).
    const res = solve(puzzle, { maxSolutions: 100_000 });
    expect(res.complete).toBe(true);
    expect(res.solutions.length).toBeGreaterThan(1); // ambiguous, as expected
    const found = res.solutions.some((s) => sig(s) === sig(answer));
    expect(found).toBe(true);
    for (const s of res.solutions) expect(validate(puzzle, s).ok).toBe(true);
  });
});

// ── The §3.4 published sample ──────────────────────────────────────────────
describe('solver: §3.4 published sample', () => {
  it('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p solves uniquely and validates', () => {
    const puzzle = decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');
    const t0 = performance.now();
    const res = solve(puzzle, { maxSolutions: 2 });
    const ms = performance.now() - t0;

    expect(res.solutions.length).toBe(1); // published puzzle → unique
    expect(res.complete).toBe(true);
    expect(res.capped).toBe(false);
    const sol = res.solutions[0]!;
    expect(validate(puzzle, sol).ok).toBe(true);

    // Eyeball rendering + perf, per the brief.
    console.log(
      `\n§3.4 sample: ${res.solutions.length} solution, ${res.nodes} nodes, ${ms.toFixed(1)} ms\n` +
        renderGrid(puzzle.cols, puzzle.rows, sol),
    );
    expect(ms).toBeLessThan(5000); // loose CI-safe bound (target ~200ms)
  });
});

// ── Brute-force agreement (tiny boards) ────────────────────────────────────
describe('solver: brute-force agreement on tiny boards', () => {
  const bank: Bank = { pieces: [TETROMINOES.I!, TETROMINOES.O!] };

  function bruteSolutions(p: Puzzle): Set<string> {
    const n = p.cols * p.rows;
    expect(n).toBeLessThanOrEqual(16); // keep the 2^n enumeration cheap
    const out = new Set<string>();
    for (let m = 0; m < 1 << n; m++) {
      const shaded = new Uint8Array(n);
      for (let i = 0; i < n; i++) shaded[i] = (m >> i) & 1;
      if (validate(p, { shaded }).ok) out.add(shaded.join(''));
    }
    return out;
  }

  function solveSolutions(p: Puzzle): Set<string> {
    const res = solve(p, { maxSolutions: 1_000_000 });
    expect(res.complete).toBe(true);
    return new Set(res.solutions.map((s) => Array.from(s.shaded).join('')));
  }

  const cases: [string, Puzzle][] = [
    ['3x4, DOWN@(0,0)', mkPuzzle(3, 4, { [idx(0, 0, 3)]: dirBit(Dir.Down) }, bank)],
    ['4x4, no clue', mkPuzzle(4, 4, {}, bank)],
    ['4x4, DOWN@(0,0)', mkPuzzle(4, 4, { [idx(0, 0, 4)]: dirBit(Dir.Down) }, bank)],
    [
      '4x4, DOWN+RIGHT@(0,0) (no solution)',
      mkPuzzle(4, 4, { [idx(0, 0, 4)]: dirBit(Dir.Down) | dirBit(Dir.Right) }, bank),
    ],
    ['4x4, UP@(1,3)', mkPuzzle(4, 4, { [idx(1, 3, 4)]: dirBit(Dir.Up) }, bank)],
  ];

  for (const [name, puzzle] of cases) {
    it(`matches brute force: ${name}`, () => {
      const brute = bruteSolutions(puzzle);
      const solved = solveSolutions(puzzle);
      expect(solved.size).toBe(brute.size);
      for (const s of brute) expect(solved.has(s)).toBe(true);
    });
  }
});

// ── Ambiguity ──────────────────────────────────────────────────────────────
describe('solver: ambiguous puzzles', () => {
  it('a sparse single-clue board reports ≥2 solutions and stops at the cap', () => {
    // The hand-made valid_5x5 fixture is a single-clue, transparent, full-
    // pentomino board — wildly under-constrained (302 valid shadings). The
    // uniqueness gate must see a second solution and stop early.
    const f = fixtures.find((x) => x.name === 'valid_5x5')!;
    const { puzzle } = decodePzprv3(f.pzprv3);
    const res = solve(puzzle, { maxSolutions: 2 });
    expect(res.solutions.length).toBe(2);
    expect(res.complete).toBe(false); // stopped early at the 2-solution cap
  });
});

describe('solver: compiled model wrapper', () => {
  it('returns the same complete-search result as the puzzle wrapper', () => {
    const puzzle = decodeUrl('pentopia/10/10/2s9ziar5gbi6z6hai9s4//p');
    expect(solveModel(buildModel(puzzle), { maxSolutions: 2, nodeCap: 200_000 })).toEqual(
      solve(puzzle, { maxSolutions: 2, nodeCap: 200_000 }),
    );
  });
});

// ── Propagator unit tests (roadmap risk #5) ────────────────────────────────
describe('propagators: arrow-distance inference in isolation', () => {
  const empty: Bank = { pieces: [] };
  const mono: Bank = { pieces: [shapeFromStrings(['#'])] };

  it('contradiction: an arrowed ray fully excluded to the edge', () => {
    // 1x5, clue at (0,0) pointing RIGHT; whole ray excluded.
    const puzzle = mkPuzzle(5, 1, { [0]: dirBit(Dir.Right) }, empty);
    const model = buildModel(puzzle);
    const st = initState(model);
    for (const c of [1, 2, 3, 4]) st.excluded.set(c);
    expect(propagateToFixpoint(model, st).status).toBe('contradiction');
  });

  it('contradiction: lo > hi (arrowed shaded near, other arrowed excluded far)', () => {
    // 1x5, clue at cell 2 with LEFT+RIGHT. RIGHT d1 (cell 3) shaded → hi=1;
    // LEFT d1 (cell 1) excluded → lo=2. lo>hi.
    const puzzle = mkPuzzle(5, 1, { [2]: dirBit(Dir.Left) | dirBit(Dir.Right) }, empty);
    const model = buildModel(puzzle);
    const st = initState(model);
    st.shaded.set(3);
    st.excluded.set(1);
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('contradiction');
  });

  it('contradiction: an unarrowed ray shaded at d ≤ lo forces the tie too near', () => {
    // 5x5, clue (2,2) UP only; shade DOWN d1 (2,3): unarrowed hit at d=1 forces
    // hi ≤ 0 while lo=1.
    const puzzle = mkPuzzle(5, 5, { [idx(2, 2, 5)]: dirBit(Dir.Up) }, empty);
    const model = buildModel(puzzle);
    const st = initState(model);
    st.shaded.set(idx(2, 3, 5));
    expect(propagateToFixpoint(model, st).status).toBe('contradiction');
  });

  it('exclusions: arrowed cells < lo and unarrowed cells ≤ lo are excluded', () => {
    // 5x9, clue (2,4) UP+DOWN. Pre-exclude UP d1 (2,3) → lo=2. The tall board
    // keeps hi=4 (ray-length cap) so the tie ISN'T pinned — this isolates the
    // exclusion behaviour. `coverAnalysis:false` isolates the arrow rule (an
    // empty bank would otherwise, soundly, make the whole board a contradiction).
    const puzzle = mkPuzzle(5, 9, { [idx(2, 4, 5)]: dirBit(Dir.Up) | dirBit(Dir.Down) }, empty);
    const model = buildModel(puzzle);
    const st = initState(model);
    st.excluded.set(idx(2, 3, 5));
    // Disable BOTH cross-placement rules: with an empty bank, cover-analysis AND
    // clue-candidate would each (soundly) collapse the unsatisfiable board to a
    // contradiction. Disabling them isolates the pure arrow-distance behaviour.
    const r = propagateToFixpoint(model, st, { coverAnalysis: false, clueCandidate: false });
    expect(r.status).toBe('ok');
    // Arrowed DOWN cell at d=1 (2,5) is < lo → excluded.
    expect(st.excluded.test(idx(2, 5, 5))).toBe(true);
    // Unarrowed LEFT/RIGHT cells at d ≤ 2 → excluded.
    for (const c of [idx(1, 4, 5), idx(0, 4, 5), idx(3, 4, 5), idx(4, 4, 5)]) {
      expect(st.excluded.test(c)).toBe(true);
    }
    // But the arrowed UP cell at d=2 (2,2) — a still-feasible tie — is NOT excluded.
    expect(st.excluded.test(idx(2, 2, 5))).toBe(false);
  });

  it('arrow-forced-shade: when lo === hi, each arrowed ray cell at the tie is shaded', () => {
    // 5x5, clue (2,2) UP+DOWN, with a monomino bank so forced shades are
    // coverable. An unarrowed LEFT shaded cell at d=2 caps hi=1; lo=1 →
    // tie pinned at 1 → UP d1 (2,1) and DOWN d1 (2,3) forced shaded.
    const puzzle = mkPuzzle(5, 5, { [idx(2, 2, 5)]: dirBit(Dir.Up) | dirBit(Dir.Down) }, mono);
    const model = buildModel(puzzle);
    const st = initState(model);
    st.shaded.set(idx(0, 2, 5)); // unarrowed LEFT, distance 2
    const r = propagateToFixpoint(model, st);
    expect(r.status).toBe('ok');
    expect(st.shaded.test(idx(2, 1, 5))).toBe(true);
    expect(st.shaded.test(idx(2, 3, 5))).toBe(true);
  });

  it('clue-cell exclusion runs at init (non-transparent)', () => {
    const puzzle = mkPuzzle(5, 5, { [idx(2, 2, 5)]: dirBit(Dir.Up) }, empty);
    const model = buildModel(puzzle);
    const st = initState(model);
    // Isolate the clue-cell rule: an empty bank would otherwise let cover-analysis
    // OR clue-candidate (soundly) turn this unsatisfiable board into a contradiction.
    const r = propagateToFixpoint(model, st, { coverAnalysis: false, clueCandidate: false });
    expect(r.status).toBe('ok');
    expect(st.excluded.test(idx(2, 2, 5))).toBe(true);
  });
});
