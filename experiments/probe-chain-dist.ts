/**
 * FAST calibration: probe forced-move chain length on `hard` puzzles (the tier
 * where depth-1 probing is common and generation is ~150ms/puzzle). Strictly
 * time-boxed so it can't hang. Expert (depth-2, ~60s/puzzle) is deliberately
 * skipped — the chain cap applies to it too, but we don't need slow expert
 * generation to pick the cap.
 */
import { generatePuzzle } from '../src/generator/generate';
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
const N = 10;
const t0 = Date.now();

for (const [cols, rows] of sizes) {
  const chains: number[] = []; // maxProbeChain per puzzle
  const allChains: number[] = []; // every probe step's chain, pooled
  let gen = 0;
  for (let s = 0; s < N; s++) {
    let res;
    try {
      res = generatePuzzle({ cols, rows, seed: 2000 + s, difficulty: 'hard', timeBudgetMs: 8_000 });
    } catch {
      continue;
    }
    gen++;
    const d = deduce(res.puzzle);
    chains.push(d.maxProbeChain);
    for (const st of d.steps) if (st.probeChain !== undefined) allChains.push(st.probeChain);
  }
  chains.sort((a, b) => a - b);
  allChains.sort((a, b) => a - b);
  const mean = chains.length ? (chains.reduce((a, b) => a + b, 0) / chains.length).toFixed(1) : 'n/a';
  console.log(
    `${cols}x${rows} hard (${gen}/${N}): PER-PUZZLE max chain  min=${chains[0] ?? '-'} median=${pct(chains, 50)} p90=${pct(chains, 90)} max=${chains[chains.length - 1] ?? '-'} mean=${mean}`,
  );
  console.log(
    `${cols}x${rows} hard          ALL ${allChains.length} probe steps  median=${pct(allChains, 50)} p90=${pct(allChains, 90)} p99=${pct(allChains, 99)} max=${allChains[allChains.length - 1] ?? '-'}`,
  );
}
console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
