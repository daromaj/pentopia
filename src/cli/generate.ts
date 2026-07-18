/**
 * CLI: generate one or more Pentopia puzzles.
 *
 *   npm run gen -- --cols 6 --rows 6 --seed 42 --difficulty medium --count 1
 *
 * Prints, per puzzle: the puzz.link URL, clue count, maxTier, elapsed ms, and an
 * ASCII rendering of the clue grid and the answer (with clues overlaid).
 */

import { generatePuzzle, type Difficulty } from '../generator/generate';
import { renderClues, renderCombined, GLYPH_LEGEND } from './ascii';

interface Args {
  cols: number;
  rows: number;
  seed: number;
  difficulty: Difficulty;
  count: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cols: 6, rows: 6, seed: 1, difficulty: 'medium', count: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = argv[i + 1];
    switch (a) {
      case '--cols':
        args.cols = parseInt(val!, 10);
        i++;
        break;
      case '--rows':
        args.rows = parseInt(val!, 10);
        i++;
        break;
      case '--seed':
        args.seed = parseInt(val!, 10);
        i++;
        break;
      case '--difficulty':
        if (val !== 'easy' && val !== 'medium' && val !== 'hard' && val !== 'expert') {
          throw new Error(`--difficulty must be easy|medium|hard|expert, got "${val}"`);
        }
        args.difficulty = val;
        i++;
        break;
      case '--count':
        args.count = parseInt(val!, 10);
        i++;
        break;
      default:
        throw new Error(`unknown argument "${a}" (accepted: --cols --rows --seed --difficulty --count)`);
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Generating ${args.count} puzzle(s): ${args.cols}x${args.rows}, ${args.difficulty}, seed ${args.seed}+`,
  );
  console.log(GLYPH_LEGEND);

  for (let k = 0; k < args.count; k++) {
    const seed = args.seed + k;
    try {
      const { puzzle, answer, url, stats } = generatePuzzle({
        cols: args.cols,
        rows: args.rows,
        seed,
        difficulty: args.difficulty,
      });
      console.log('\n' + '='.repeat(56));
      console.log(`seed ${seed}  |  https://puzz.link/p?${url}`);
      console.log(
        `clues=${stats.clueCount}  maxTier=${stats.maxTier}  attempts=${stats.attempts}  ` +
          `elapsed=${stats.elapsedMs.toFixed(1)}ms`,
      );
      console.log(`tiers: ${JSON.stringify(stats.tierHistogram)}`);
      console.log('\nclues:');
      console.log(renderClues(puzzle));
      console.log('\nanswer (# shaded, glyphs = clues):');
      console.log(renderCombined(puzzle, answer));
    } catch (e) {
      console.error(`seed ${seed}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();
