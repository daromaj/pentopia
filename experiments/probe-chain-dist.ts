/**
 * Measure the forced-move chain length of probes required by generated puzzles,
 * per difficulty and size. Grounds the generation-time cap on look-ahead depth.
 */
import { generatePuzzle, type Difficulty } from '../src/generator/generate';
import { deduce } from '../src/solver/deduce';

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

const sizes: [number, number][] = [
  [8, 8],
  [10, 10],
];
const diffs: Difficulty[] = ['hard', 'expert'];
const N = 12;

for (const [cols, rows] of sizes) {
  for (const diff of diffs) {
    const chains: number[] = []; // maxProbeChain per generated puzzle
    let generated = 0;
    for (let s = 0; s < N; s++) {
      let res;
      try {
        res = generatePuzzle({ cols, rows, seed: 1000 + s, difficulty: diff, timeBudgetMs: 45_000 });
      } catch {
        continue;
      }
      generated++;
      const d = deduce(res.puzzle);
      chains.push(d.maxProbeChain);
    }
    chains.sort((a, b) => a - b);
    const mean = chains.length ? (chains.reduce((a, b) => a + b, 0) / chains.length).toFixed(1) : 'n/a';
    console.log(
      `${cols}x${rows} ${diff.padEnd(6)} (${generated}/${N} gen): ` +
        `min=${chains[0] ?? '-'} median=${pct(chains, 50)} p90=${pct(chains, 90)} max=${chains[chains.length - 1] ?? '-'} mean=${mean}`,
    );
  }
}
