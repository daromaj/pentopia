/**
 * CLI: solve a Pentopia puzzle from a URL or bare puzzle string.
 *
 *   npm run solve -- "https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p"
 *   npm run solve -- "pentopia/6/6/....//p"
 *
 * Prints each solution grid, the uniqueness verdict, the search node count, and
 * the deduce() tier summary (how a human would solve it, and how hard).
 */

import type { Solution } from '../core/types';
import { decodeUrl } from '../core/codec/url';
import { solve } from '../solver/search';
import { deduce } from '../solver/deduce';
import { renderShaded } from './ascii';

function main(): void {
  const input = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (input === undefined) {
    console.error('usage: npm run solve -- "<puzz.link url or pentopia/... string>"');
    process.exitCode = 1;
    return;
  }

  const puzzle = decodeUrl(input);
  console.log(`board ${puzzle.cols}x${puzzle.rows}  transparent=${puzzle.transparent}  bankPieces=${puzzle.bank.pieces.length}`);

  const res = solve(puzzle, { maxSolutions: 2 });
  const verdict =
    res.solutions.length === 0
      ? 'NO SOLUTION'
      : res.solutions.length === 1 && res.complete
        ? 'UNIQUE'
        : `AMBIGUOUS (>=${res.solutions.length})`;
  console.log(`solutions found: ${res.solutions.length}  |  verdict: ${verdict}  |  nodes: ${res.nodes}${res.capped ? ' (node cap hit!)' : ''}`);

  res.solutions.forEach((sol: Solution, i: number) => {
    console.log(`\nsolution ${i + 1}:`);
    console.log(renderShaded(puzzle.cols, puzzle.rows, sol));
  });

  const ded = deduce(puzzle);
  console.log('\ndeduce():');
  console.log(`  solved=${ded.solved}  maxTier=${ded.maxTier}  unresolved=${ded.unresolved}  steps=${ded.steps.length}`);
  console.log(`  tiers: ${JSON.stringify(ded.tierHistogram)}`);
  if (ded.contradiction) console.log(`  contradiction: ${ded.contradiction}`);
}

main();
