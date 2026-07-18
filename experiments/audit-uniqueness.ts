/**
 * experiments/audit-uniqueness.ts
 *
 * Empirical audit of Pentopia's uniqueness guarantee, independent of the
 * generator's own gates. Two lines of attack:
 *
 *  PART 1 — Re-verify generated puzzles with generous solve() limits
 *    (maxSolutions: 8, nodeCap: 5_000_000, well above what the generator uses
 *    internally). Any puzzle that comes back with solutions.length !== 1 or
 *    capped=true is a red flag: either the complete solver under-searches
 *    (unsound pruning) or a gate in src/generator/ let something through.
 *
 *  PART 2 — Independent ground-truth enumeration on 6x6 boards. This does
 *    NOT reuse solver/model.ts, solver/board.ts, solver/propagate.ts, or
 *    solver/search.ts. It only reuses:
 *      - core/shape.ts orientations()/canonicalKey() — fixture-tested shape
 *        geometry, the one legitimate shared dependency both the solver and
 *        this script must agree on for "what is an F-pentomino orientation".
 *      - core/bank.ts bankCounts() — trivial canonical-key tally.
 *      - core/validator.ts validate() — the ground-truth arbiter of "is this
 *        shading a legal answer", used by pzprjs-compatible checklist logic
 *        that has nothing to do with the solver's constraint propagation.
 *    Everything else (placement enumeration, overlap/adjacency/subset logic)
 *    is written fresh here, dumbly, for cross-checking.
 *
 * PART 3 — for any PART 1 multi-solution flag, run deduce() and report
 *   whether it (wrongly) claims solved=true.
 *
 * PART 4 — best-effort minimization of any real counterexample.
 *
 * Run: npx tsx experiments/audit-uniqueness.ts
 */

import { generatePuzzle, type Difficulty } from '../src/generator/generate';
import { solve, type SolveResult } from '../src/solver/search';
import { deduce } from '../src/solver/deduce';
import { validate } from '../src/core/validator';
import { encodeUrl } from '../src/core/codec/url';
import { orientations, canonicalKey } from '../src/core/shape';
import { bankCounts } from '../src/core/bank';
import { NO_CLUE } from '../src/core/types';
import type { Puzzle, Solution, Shape } from '../src/core/types';
import { renderClues, renderShaded } from '../src/cli/ascii';

const T_START = performance.now();
const BUDGET_MS = 9 * 60 * 1000; // leave headroom under the 10-minute cap
function overBudget(): boolean {
  return performance.now() - T_START > BUDGET_MS;
}
function elapsed(): string {
  return ((performance.now() - T_START) / 1000).toFixed(1) + 's';
}

// ─────────────────────────────────────────────────────────────────────────
// Shared small helpers
// ─────────────────────────────────────────────────────────────────────────

function sameSolution(a: Solution, b: Solution): boolean {
  if (a.shaded.length !== b.shaded.length) return false;
  for (let i = 0; i < a.shaded.length; i++) if (a.shaded[i] !== b.shaded[i]) return false;
  return true;
}

function puzzleUrl(puzzle: Puzzle): string {
  return `https://puzz.link/p?${encodeUrl(puzzle)}`;
}

function sideBySide(cols: number, rows: number, sols: Solution[]): string {
  const grids = sols.map((s) => renderShaded(cols, rows, s).split('\n'));
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    lines.push(grids.map((g) => g[y]).join('   |   '));
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// PART 1 — re-verify generated puzzles with generous limits
// ─────────────────────────────────────────────────────────────────────────

const SIZES = [6, 8, 10];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const SEEDS_PER_COMBO = 15;
const RESOLVE_OPTS = { maxSolutions: 8, nodeCap: 5_000_000 };

interface Part1Case {
  readonly size: number;
  readonly difficulty: Difficulty;
  readonly seed: number;
  readonly thrown: boolean;
  readonly errorMsg?: string;
  readonly puzzle?: Puzzle;
  readonly answer?: Solution;
  readonly url?: string;
  readonly reSolve?: SolveResult;
  readonly flagged: boolean;
}

const part1Cases: Part1Case[] = [];

console.log('='.repeat(70));
console.log('PART 1: re-verifying generated puzzles with maxSolutions=8, nodeCap=5,000,000');
console.log('='.repeat(70));

outer1: for (const size of SIZES) {
  for (const difficulty of DIFFICULTIES) {
    let comboChecked = 0;
    let comboThrown = 0;
    let comboFlagged = 0;
    for (let s = 1; s <= SEEDS_PER_COMBO; s++) {
      if (overBudget()) {
        console.log(`[${elapsed()}] BUDGET EXCEEDED — stopping Part 1 early at ${size}x${size} ${difficulty} seed ${s}`);
        break outer1;
      }
      try {
        const { puzzle, answer, url } = generatePuzzle({ cols: size, rows: size, seed: s, difficulty });
        const reSolve = solve(puzzle, RESOLVE_OPTS);
        const flagged = reSolve.solutions.length !== 1 || reSolve.capped || !sameSolution(reSolve.solutions[0]!, answer);
        part1Cases.push({ size, difficulty, seed: s, thrown: false, puzzle, answer, url, reSolve, flagged });
        comboChecked++;
        if (flagged) {
          comboFlagged++;
          console.log(
            `[${elapsed()}] FLAG ${size}x${size} ${difficulty} seed=${s}: solutions=${reSolve.solutions.length} capped=${reSolve.capped} matchesAnswer=${reSolve.solutions.length > 0 ? sameSolution(reSolve.solutions[0]!, answer) : 'n/a'}`,
          );
        }
      } catch (e) {
        comboThrown++;
        part1Cases.push({
          size,
          difficulty,
          seed: s,
          thrown: true,
          errorMsg: e instanceof Error ? e.message : String(e),
          flagged: false,
        });
      }
    }
    console.log(
      `[${elapsed()}] ${size}x${size} ${difficulty}: checked=${comboChecked} thrown(maxAttempts)=${comboThrown} flagged=${comboFlagged}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PART 2 — independent ground-truth enumeration on 6x6
// ─────────────────────────────────────────────────────────────────────────

interface RawPlacement {
  readonly pieceKey: string;
  readonly cells: readonly number[]; // ascending cell indices
}

/** Every legal placement of every canonical piece type, on THIS puzzle's board and clue mask. */
function enumeratePlacements(puzzle: Puzzle): RawPlacement[] {
  const { cols, rows, bank, clues, transparent } = puzzle;
  const groups = new Map<string, Shape>();
  for (const piece of bank.pieces) {
    const key = canonicalKey(piece);
    if (!groups.has(key)) groups.set(key, piece);
  }
  const placements: RawPlacement[] = [];
  for (const [key, shape] of groups) {
    // Reuse ONLY core/shape.ts orientation geometry (fixture-tested), not
    // anything from solver/*.
    const orients = orientations(shape);
    const seen = new Set<string>();
    for (const orient of orients) {
      const { w, h, bits } = orient;
      for (let oy = 0; oy + h <= rows; oy++) {
        for (let ox = 0; ox + w <= cols; ox++) {
          const cells: number[] = [];
          for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
              if (bits[sy * w + sx]) cells.push((oy + sy) * cols + (ox + sx));
            }
          }
          cells.sort((a, b) => a - b);
          // Rule 4 (format §5.4): a placement may not cover a clue cell unless transparent.
          if (!transparent) {
            let bad = false;
            for (const c of cells) {
              if (clues[c] !== NO_CLUE) {
                bad = true;
                break;
              }
            }
            if (bad) continue;
          }
          const sig = cells.join(',');
          if (seen.has(sig)) continue;
          seen.add(sig);
          placements.push({ pieceKey: key, cells });
        }
      }
    }
  }
  return placements;
}

function chebyshev(cols: number, a: number, b: number): number {
  const ax = a % cols;
  const ay = Math.floor(a / cols);
  const bx = b % cols;
  const by = Math.floor(b / cols);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function overlaps(a: readonly number[], b: readonly number[]): boolean {
  const s = new Set(b);
  for (const c of a) if (s.has(c)) return true;
  return false;
}

/** Dumb O(|a|*|b|) king-adjacency test: any cell of a within Chebyshev distance 1 of any cell of b. */
function kingAdjacent(cols: number, a: readonly number[], b: readonly number[]): boolean {
  for (const x of a) for (const y of b) if (chebyshev(cols, x, y) === 1) return true;
  return false;
}

function countsOk(subset: readonly RawPlacement[], allowed: ReadonlyMap<string, number>): boolean {
  const counts = new Map<string, number>();
  for (const p of subset) counts.set(p.pieceKey, (counts.get(p.pieceKey) ?? 0) + 1);
  for (const [k, v] of counts) if (v > (allowed.get(k) ?? 0)) return false;
  return true;
}

function shadingOf(cols: number, rows: number, subset: readonly RawPlacement[]): Uint8Array {
  const sh = new Uint8Array(cols * rows);
  for (const p of subset) for (const c of p.cells) sh[c] = 1;
  return sh;
}

interface GroundTruthResult {
  readonly count: number;
  readonly shadings: Uint8Array[];
  readonly placementCount: number;
  readonly cappedToPairs: boolean;
}

/**
 * Dumb, obviously-correct enumeration of every legal shading with 0..3
 * pieces: all subsets of placements that (a) respect bank piece-type
 * counts, (b) don't overlap, (c) aren't king-adjacent across DIFFERENT
 * placements, kept iff validate() agrees the resulting shading is a legal
 * answer. validate() is the sole arbiter — this function's only job is to
 * generate honest candidates for it to judge.
 *
 * Subsets are built in strictly increasing placement-index order (no
 * duplicate enumeration) and pruned via a pairwise compatibility graph
 * before the (potentially large) triple stage — see the module doc comment.
 */
function enumerateGroundTruth(puzzle: Puzzle): GroundTruthResult {
  const { cols, rows } = puzzle;
  const placements = enumeratePlacements(puzzle);
  const allowed = bankCounts(puzzle.bank);
  const n = placements.length;
  const shadings: Uint8Array[] = [];

  // size 0: the empty board.
  {
    const sh = new Uint8Array(cols * rows);
    if (validate(puzzle, { shaded: sh }).ok) shadings.push(sh);
  }

  // size 1.
  for (let i = 0; i < n; i++) {
    const sh = shadingOf(cols, rows, [placements[i]!]);
    if (validate(puzzle, { shaded: sh }).ok) shadings.push(sh);
  }

  // Pairwise compatibility graph (also the basis for the size-3 stage).
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!countsOk([placements[i]!, placements[j]!], allowed)) continue;
      if (overlaps(placements[i]!.cells, placements[j]!.cells)) continue;
      if (kingAdjacent(cols, placements[i]!.cells, placements[j]!.cells)) continue;
      adj[i]!.push(j);
    }
  }

  // size 2.
  for (let i = 0; i < n; i++) {
    for (const j of adj[i]!) {
      const sh = shadingOf(cols, rows, [placements[i]!, placements[j]!]);
      if (validate(puzzle, { shaded: sh }).ok) shadings.push(sh);
    }
  }

  // size 3: triangles in the compatibility graph. Budget guard — if the
  // graph is pathologically dense this degrades gracefully to pairs-only.
  let triangleWork = 0;
  for (let i = 0; i < n; i++) for (const j of adj[i]!) triangleWork += adj[j]!.length;
  const cappedToPairs = triangleWork > 20_000_000;
  if (!cappedToPairs) {
    for (let i = 0; i < n; i++) {
      const setAdjI = new Set(adj[i]!);
      for (const j of adj[i]!) {
        for (const k of adj[j]!) {
          if (k <= j) continue;
          if (!setAdjI.has(k)) continue;
          if (!countsOk([placements[i]!, placements[j]!, placements[k]!], allowed)) continue;
          const sh = shadingOf(cols, rows, [placements[i]!, placements[j]!, placements[k]!]);
          if (validate(puzzle, { shaded: sh }).ok) shadings.push(sh);
        }
      }
    }
  }

  return { count: shadings.length, shadings, placementCount: n, cappedToPairs };
}

interface Part2Case {
  readonly source: 'part1' | 'extra';
  readonly difficulty: Difficulty;
  readonly seed: number;
  readonly puzzle: Puzzle;
  readonly url: string;
  readonly groundTruth: GroundTruthResult;
  readonly solveResult: SolveResult;
  readonly agree: boolean;
}

console.log('\n' + '='.repeat(70));
console.log('PART 2: independent ground-truth enumeration on 6x6 boards');
console.log('='.repeat(70));

const part2Cases: Part2Case[] = [];
let anyPairsOnly = false;

function auditGroundTruth(puzzle: Puzzle, source: 'part1' | 'extra', difficulty: Difficulty, seed: number): void {
  const url = puzzleUrl(puzzle);
  const gt = enumerateGroundTruth(puzzle);
  if (gt.cappedToPairs) anyPairsOnly = true;
  const sv = solve(puzzle, RESOLVE_OPTS);
  const agree = gt.count === sv.solutions.length && !sv.capped;
  part2Cases.push({ source, difficulty, seed, puzzle, url, groundTruth: gt, solveResult: sv, agree });
  const tag = agree ? 'ok' : 'DISAGREE';
  console.log(
    `[${elapsed()}] [${tag}] 6x6 ${difficulty} seed=${seed} (${source}): groundTruth=${gt.count} (placements=${gt.placementCount}${gt.cappedToPairs ? ', PAIRS-ONLY' : ''}) solve()=${sv.solutions.length}${sv.capped ? ' CAPPED' : ''}`,
  );
}

for (const c of part1Cases) {
  if (c.size !== 6 || c.thrown || !c.puzzle) continue;
  if (overBudget()) {
    console.log(`[${elapsed()}] BUDGET EXCEEDED — stopping Part 2 (from Part 1) early`);
    break;
  }
  auditGroundTruth(c.puzzle, 'part1', c.difficulty, c.seed);
}

const EXTRA_6X6_SEEDS = 20;
const extraDifficulties: Difficulty[] = ['easy', 'medium', 'hard'];
for (let k = 0; k < EXTRA_6X6_SEEDS; k++) {
  if (overBudget()) {
    console.log(`[${elapsed()}] BUDGET EXCEEDED — stopping Part 2 (extra seeds) early`);
    break;
  }
  const seed = 1000 + k;
  const difficulty = extraDifficulties[k % extraDifficulties.length]!;
  try {
    const { puzzle } = generatePuzzle({ cols: 6, rows: 6, seed, difficulty });
    auditGroundTruth(puzzle, 'extra', difficulty, seed);
  } catch (e) {
    console.log(`[${elapsed()}] extra 6x6 ${difficulty} seed=${seed}: THREW (maxAttempts): ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (anyPairsOnly) {
  console.log('\nNOTE: at least one 6x6 puzzle had a triangle-enumeration graph large enough to trip the');
  console.log('20M-triangle-work budget guard; that case fell back to pairs-only (size <=2) ground truth.');
}

// ─────────────────────────────────────────────────────────────────────────
// PART 3 — deduce() cross-check for any Part 1 multi-solution flags
// ─────────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('PART 3: deduce() cross-check for flagged Part 1 cases');
console.log('='.repeat(70));

const flaggedPart1 = part1Cases.filter((c) => c.flagged);
if (flaggedPart1.length === 0) {
  console.log('No Part 1 cases were flagged — nothing to cross-check.');
} else {
  for (const c of flaggedPart1) {
    const ded = deduce(c.puzzle!);
    console.log(`\n${c.size}x${c.size} ${c.difficulty} seed=${c.seed}: deduce().solved = ${ded.solved}`);
    if (ded.solved) {
      console.log('  *** deduce() claims solved=true on a puzzle solve() found NOT unique — propagation unsoundness. ***');
    }
    console.log('  last 15 steps:');
    for (const step of ded.steps.slice(-15)) {
      console.log(`    [${step.rule}] ${step.detail ?? ''} (${step.kind ?? '?'}: ${step.cells.length} cells)`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PART 4 — best-effort minimization of any real counterexample
// ─────────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('PART 4: minimizing any counterexamples (best effort, time-boxed)');
console.log('='.repeat(70));

interface Counterexample {
  readonly kind: 'part1-multi-solution' | 'part2-disagreement';
  readonly size: number;
  readonly difficulty: Difficulty;
  readonly seed: number;
  readonly puzzle: Puzzle;
  readonly url: string;
  readonly detail: string;
}

const counterexamples: Counterexample[] = [];
for (const c of flaggedPart1) {
  counterexamples.push({
    kind: 'part1-multi-solution',
    size: c.size,
    difficulty: c.difficulty,
    seed: c.seed,
    puzzle: c.puzzle!,
    url: c.url!,
    detail: `re-solve found ${c.reSolve!.solutions.length} solutions (capped=${c.reSolve!.capped})`,
  });
}
for (const c of part2Cases) {
  if (c.agree) continue;
  counterexamples.push({
    kind: 'part2-disagreement',
    size: 6,
    difficulty: c.difficulty,
    seed: c.seed,
    puzzle: c.puzzle,
    url: c.url,
    detail: `groundTruth=${c.groundTruth.count} vs solve()=${c.solveResult.solutions.length}${c.solveResult.capped ? ' (capped)' : ''}`,
  });
}

/** Try dropping each clue (best effort); keep the drop iff the disagreement/multi-solution symptom persists. */
function minimizeClueSet(puzzle: Puzzle, stillBroken: (p: Puzzle) => boolean, deadlineMs: number): Puzzle {
  const clues = puzzle.clues.slice();
  const positions: number[] = [];
  for (let i = 0; i < clues.length; i++) if (clues[i] !== NO_CLUE) positions.push(i);
  for (const pos of positions) {
    if (performance.now() > deadlineMs) break;
    const saved = clues[pos]!;
    clues[pos] = NO_CLUE;
    const candidate: Puzzle = { ...puzzle, clues: clues.slice() };
    if (!stillBroken(candidate)) {
      clues[pos] = saved; // restore — dropping this clue killed the repro
    }
  }
  return { ...puzzle, clues };
}

if (counterexamples.length === 0) {
  console.log('No counterexamples found — nothing to minimize.');
} else {
  const deadline = performance.now() + 90_000; // 90s time-box for minimization
  for (const ce of counterexamples) {
    console.log(`\nMinimizing ${ce.kind} @ ${ce.size}x${ce.size} ${ce.difficulty} seed=${ce.seed}`);
    const stillBroken = (p: Puzzle): boolean => {
      const r = solve(p, RESOLVE_OPTS);
      return r.solutions.length !== 1 || r.capped;
    };
    if (!stillBroken(ce.puzzle)) {
      console.log('  (symptom is solve()-vs-groundTruth only, not solve()-vs-itself; skipping clue minimization for this case — see full detail below)');
      continue;
    }
    const minimized = minimizeClueSet(ce.puzzle, stillBroken, deadline);
    console.log(`  minimized URL: ${puzzleUrl(minimized)}`);
    console.log(renderClues(minimized));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FINAL REPORT
// ─────────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));

console.log('\nPart 1 table (size x difficulty):');
console.log('size  difficulty  checked  thrown  flagged  all-unique?');
for (const size of SIZES) {
  for (const difficulty of DIFFICULTIES) {
    const rows = part1Cases.filter((c) => c.size === size && c.difficulty === difficulty);
    const checked = rows.filter((c) => !c.thrown).length;
    const thrown = rows.filter((c) => c.thrown).length;
    const flagged = rows.filter((c) => c.flagged).length;
    console.log(
      `${String(size).padEnd(6)}${difficulty.padEnd(12)}${String(checked).padEnd(9)}${String(thrown).padEnd(8)}${String(flagged).padEnd(9)}${flagged === 0 ? 'YES' : 'NO'}`,
    );
  }
}

console.log('\nPart 2 table (6x6 ground truth vs solve()):');
console.log('source  difficulty  seed  placements  groundTruth  solve()  agree?');
for (const c of part2Cases) {
  console.log(
    `${c.source.padEnd(8)}${c.difficulty.padEnd(12)}${String(c.seed).padEnd(6)}${String(c.groundTruth.placementCount).padEnd(12)}${String(c.groundTruth.count).padEnd(13)}${String(c.solveResult.solutions.length).padEnd(9)}${c.agree ? 'YES' : 'NO ***'}`,
  );
}

console.log(`\nTotal counterexamples found: ${counterexamples.length}`);
for (const ce of counterexamples) {
  console.log(`\n--- COUNTEREXAMPLE (${ce.kind}) ---`);
  console.log(`size=${ce.size} difficulty=${ce.difficulty} seed=${ce.seed}`);
  console.log(`url: ${ce.url}`);
  console.log(`detail: ${ce.detail}`);
  console.log('clues:');
  console.log(renderClues(ce.puzzle));
  const part1Match = flaggedPart1.find((c) => c.size === ce.size && c.difficulty === ce.difficulty && c.seed === ce.seed);
  if (part1Match?.reSolve) {
    console.log('solve() solutions side by side:');
    console.log(sideBySide(ce.puzzle.cols, ce.puzzle.rows, part1Match.reSolve.solutions));
  }
  const part2Match = part2Cases.find((c) => c.difficulty === ce.difficulty && c.seed === ce.seed && c.url === ce.url);
  if (part2Match) {
    console.log(`ground-truth shading count: ${part2Match.groundTruth.count}, solve() count: ${part2Match.solveResult.solutions.length}`);
    if (part2Match.groundTruth.shadings.length > 0) {
      console.log('first ground-truth shading:');
      console.log(renderShaded(ce.puzzle.cols, ce.puzzle.rows, { shaded: part2Match.groundTruth.shadings[0]! }));
    }
  }
}

console.log('\n' + '='.repeat(70));
if (counterexamples.length === 0) {
  console.log('VERDICT: no disagreement found in this run. Evidence supports the solver being sound');
  console.log('(within the tested sizes/seeds/subset-size bound); no counterexample to report.');
} else {
  console.log(`VERDICT: ${counterexamples.length} counterexample(s) found — see detail above. Investigate before trusting the uniqueness gate.`);
}
console.log(`Total wall time: ${elapsed()}`);
