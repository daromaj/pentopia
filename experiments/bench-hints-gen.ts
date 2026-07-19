/**
 * experiments/bench-hints-gen.ts
 *
 * Deterministic benchmark for the two hot paths this branch optimizes:
 *   - generatePuzzle across difficulties/sizes (generator),
 *   - computeHint on partially-solved boards (hints).
 *
 * Fixed seeds → same puzzles every run, so before/after timings are comparable.
 * Run: npx tsx experiments/bench-hints-gen.ts
 */

import { generatePuzzle } from '../src/generator/generate';
import { computeHint } from '../src/ui/hint';
import { deduce } from '../src/solver/deduce';
import { SHADED, MARKED_EMPTY } from '../src/ui/state';

function bench(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(42)} ${ms.toFixed(0).padStart(7)}ms`);
  return ms;
}

// ── Generator ────────────────────────────────────────────────────────────
console.log('=== Generator ===');
const genCfgs: { cols: number; rows: number; difficulty: 'easy' | 'medium' | 'hard' | 'expert'; seeds: number[] }[] = [
  { cols: 8, rows: 8, difficulty: 'medium', seeds: [1, 2, 3, 4, 5] },
  { cols: 8, rows: 8, difficulty: 'hard', seeds: [1, 2, 3, 4, 5] },
  { cols: 10, rows: 10, difficulty: 'hard', seeds: [1, 2, 3] },
  { cols: 8, rows: 8, difficulty: 'expert', seeds: [1, 2] },
];
let genTotal = 0;
for (const c of genCfgs) {
  genTotal += bench(`gen ${c.cols}x${c.rows} ${c.difficulty} (${c.seeds.length})`, () => {
    for (const seed of c.seeds) {
      try {
        generatePuzzle({ cols: c.cols, rows: c.rows, seed, difficulty: c.difficulty, timeBudgetMs: 30_000 });
      } catch {
        /* count failures as time spent */
      }
    }
  });
}
console.log(`generator total: ${genTotal.toFixed(0)}ms\n`);

// ── Hints ────────────────────────────────────────────────────────────────
// Build a few hard puzzles, then time computeHint at empty / half-solved / near-solved.
console.log('=== Hints ===');
const hintPuzzles = [1, 2, 3].map((seed) => {
  const { puzzle, answer } = generatePuzzle({ cols: 8, rows: 8, seed, difficulty: 'hard', timeBudgetMs: 30_000 });
  return { puzzle, answer };
});

function boardAtFraction(puzzle: { clues: Int16Array; cols: number; rows: number }, answer: { shaded: Uint8Array }, frac: number): Uint8Array {
  const n = puzzle.cols * puzzle.rows;
  const cs = new Uint8Array(n);
  // Fill the first `frac` share of non-clue cells from the answer (deterministic).
  const nonClue: number[] = [];
  for (let i = 0; i < n; i++) if (puzzle.clues[i] === -1) nonClue.push(i);
  const cut = Math.floor(nonClue.length * frac);
  for (let k = 0; k < cut; k++) {
    const i = nonClue[k]!;
    cs[i] = answer.shaded[i] === 1 ? SHADED : MARKED_EMPTY;
  }
  return cs;
}

let hintTotal = 0;
for (const frac of [0, 0.5, 0.9]) {
  hintTotal += bench(`hint @ ${Math.round(frac * 100)}% filled (${hintPuzzles.length} puzzles)`, () => {
    for (const { puzzle, answer } of hintPuzzles) {
      const cs = boardAtFraction(puzzle as never, answer, frac);
      computeHint(puzzle, cs);
    }
  });
}
console.log(`hints total: ${hintTotal.toFixed(0)}ms\n`);

// ── Raw deduce (shared engine, probe-heavy) ──────────────────────────────
console.log('=== deduce() on generated hard puzzles ===');
let dedTotal = 0;
dedTotal += bench(`deduce hard x${hintPuzzles.length}`, () => {
  for (const { puzzle } of hintPuzzles) deduce(puzzle);
});
console.log(`deduce total: ${dedTotal.toFixed(0)}ms\n`);

console.log(`GRAND TOTAL: ${(genTotal + hintTotal + dedTotal).toFixed(0)}ms`);
