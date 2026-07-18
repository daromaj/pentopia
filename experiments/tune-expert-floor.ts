/**
 * experiments/tune-expert-floor.ts
 *
 * Empirically picks the probe-count floor for the new 'expert' difficulty
 * tier. Generates a batch of 'hard' puzzles at 8x8 and 10x10, records each
 * one's `probe-forcing` step count (tier 6 — the only probe rule 'hard' can
 * ever emit, since hard's ceiling is maxTier<=6), and reports the
 * distribution (min/median/p90/max) per size.
 *
 * 'expert' should be meaningfully harder than 'hard', so its probe-count
 * floor is set comfortably above hard's p90 for each size — see
 * generatePuzzle()'s EXPERT_PROBE_FLOOR for the resulting formula and the
 * data snapshot baked into its comment.
 *
 * Run: npx tsx experiments/tune-expert-floor.ts
 */

import { generatePuzzle } from '../src/generator/generate';

const SAMPLE = 15;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function summarize(label: string, counts: number[]): void {
  const sorted = [...counts].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  console.log(
    `${label}: n=${sorted.length} min=${sorted[0]} median=${percentile(sorted, 50)} ` +
      `p90=${percentile(sorted, 90)} max=${sorted[sorted.length - 1]} mean=${mean.toFixed(1)}`,
  );
  console.log(`  raw: [${sorted.join(', ')}]`);
}

function run(cols: number, rows: number): void {
  const counts: number[] = [];
  const t0 = performance.now();
  for (let seed = 1; seed <= SAMPLE; seed++) {
    const { stats } = generatePuzzle({ cols, rows, seed, difficulty: 'hard', maxAttempts: 150 });
    counts.push(stats.tierHistogram['probe-forcing']);
  }
  const elapsed = performance.now() - t0;
  summarize(`${cols}x${rows} hard probe-forcing counts`, counts);
  console.log(`  elapsed=${elapsed.toFixed(0)}ms for ${SAMPLE} puzzles\n`);
}

console.log(`Tuning expert probe-count floor: ${SAMPLE} hard puzzles each at 8x8 and 10x10.\n`);
run(8, 8);
run(10, 10);
