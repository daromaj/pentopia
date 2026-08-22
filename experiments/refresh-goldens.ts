/**
 * Recompute the generator characterization goldens that went stale when hard
 * acceptance changed (bounded probing). Prints the current values for the two
 * hard rows so they can be pasted back into test/characterization.test.ts.
 */
import { generatePuzzle, type Difficulty } from '../src/generator/generate';

const CASES: { cols: number; rows: number; difficulty: Difficulty; seed: number }[] = [
  { cols: 6, rows: 6, difficulty: 'hard', seed: 2 },
  { cols: 8, rows: 8, difficulty: 'hard', seed: 7 },
];

for (const c of CASES) {
  const { url, stats } = generatePuzzle(c);
  const hist = Object.fromEntries(Object.entries(stats.tierHistogram).filter(([, n]) => n > 0));
  console.log(JSON.stringify({ ...c, url, clueCount: stats.clueCount, maxTier: stats.maxTier, hist }));
}
