import { generateRatedCandidate, type GenerationObserver } from '../src/generator/generate';

const seeds = Number(process.argv[2] ?? 30);
if (!Number.isInteger(seeds) || seeds < 1) throw new Error('usage: tsx experiments/generator-phases.ts [positive seed count]');

type Sample = { total: number; solve: number; solveCalls: number; deduce: number; removalTrials: number; removals: number; attempts: number; builds: number; buildMs: number; scoring: number; scoringBuilds: number };
const percentile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))]!;

for (const [rung, cols, rows, difficulty] of [
  [1, 6, 6, 'easy'], [2, 6, 6, 'medium'], [3, 8, 8, 'easy'],
  [4, 8, 8, 'medium'], [5, 8, 8, 'hard'], [6, 10, 10, 'medium'],
  [7, 10, 10, 'hard'],
] as const) {
  const samples: Sample[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    let solve = 0, solveCalls = 0, deduce = 0, removalTrials = 0, removals = 0, builds = 0, buildMs = 0, scoring = 0, scoringBuilds = 0;
    const observer: GenerationObserver = {
      onSolve: (ms) => { solve += ms; solveCalls++; },
      onDeduce: (ms) => { deduce += ms; },
      onRemoval: (accepted) => { removalTrials++; if (accepted) removals++; },
      onModelBuilt: (ms, purpose) => { builds++; buildMs += ms; if (purpose === 'scoring') scoringBuilds++; },
      onScoring: (ms) => { scoring += ms; },
    };
    const result = generateRatedCandidate({ cols, rows, seed, difficulty, observer }, 0);
    if (builds !== solveCalls + scoringBuilds) throw new Error(`rung ${rung}, seed ${seed}: ${builds} models for ${solveCalls} solve gates plus ${scoringBuilds} scoring passes`);
    samples.push({ total: result.stats.elapsedMs + scoring, solve, solveCalls, deduce, removalTrials, removals, attempts: result.stats.attempts, builds, buildMs, scoring, scoringBuilds });
  }
  const field = (key: keyof Sample) => samples.map((sample) => sample[key] as number);
  const keys = ['total', 'solve', 'solveCalls', 'deduce', 'removalTrials', 'removals', 'attempts', 'builds', 'buildMs', 'scoring', 'scoringBuilds'] as const;
  console.log(JSON.stringify({ rung, board: `${cols}x${rows}`, difficulty, seeds, p50: Object.fromEntries(keys.map((key) => [key, percentile(field(key), .5)])), p95: Object.fromEntries(keys.map((key) => [key, percentile(field(key), .95)])) }));
}
