import { dirBit, Dir, NO_CLUE, type Puzzle, type Solution } from '../core/types';
import { deduce, type DeduceResult } from '../solver/deduce';
import type { RuleId, Step } from '../solver/propagate';
import type { Difficulty, GenerateResult } from './generate';

export type FlowProfile = 'crossfire' | 'long-range' | 'shape-chain' | 'split-front';
export interface FlowSignature {
  readonly arrowCardinality: readonly [number, number, number, number];
  readonly meanTieDistance: number;
  readonly clueDispersion: number;
  readonly earlySourceShare: number;
  readonly earlySourceDispersion: number;
  readonly cascadeLinkShare: number;
  readonly largestCascadeShare: number;
  readonly ruleHistogram: Record<RuleId, number>;
  readonly probeChainShare: number;
}
export interface FlowContext { readonly difficulty: Difficulty; readonly rung: number; }
export interface RatedCandidate extends GenerateResult { readonly candidateIndex: number; readonly signature: FlowSignature; }

const RULES: readonly RuleId[] = ['clue-cell-exclusion', 'no-touch-halo', 'placement-filtering', 'arrow-distance-bounds', 'arrow-forced-shade', 'forced-placement', 'cover-analysis', 'clue-candidate', 'probe-forcing', 'probe-forcing-2'];
const diagonal = (p: Puzzle) => Math.hypot(p.cols - 1, p.rows - 1) || 1;
const dispersion = (cells: readonly number[], cols: number, rows: number) => {
  if (cells.length < 2) return 0;
  let total = 0, pairs = 0;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    total += Math.abs(cells[i]! % cols - cells[j]! % cols) + Math.abs(Math.floor(cells[i]! / cols) - Math.floor(cells[j]! / cols)); pairs++;
  }
  return Math.min(1, total / pairs / diagonal({ cols, rows } as Puzzle));
};
function canonical(puzzle: Puzzle, answer: Solution): { puzzle: Puzzle; answer: Solution } {
  if (puzzle.cols !== puzzle.rows) return { puzzle, answer };
  const n = puzzle.cols;
  const transforms = [
    (x: number, y: number) => [x, y], (x: number, y: number) => [n - 1 - y, x],
    (x: number, y: number) => [n - 1 - x, n - 1 - y], (x: number, y: number) => [y, n - 1 - x],
    (x: number, y: number) => [n - 1 - x, y], (x: number, y: number) => [x, n - 1 - y],
    (x: number, y: number) => [y, x], (x: number, y: number) => [n - 1 - y, n - 1 - x],
  ] as const;
  let best: { puzzle: Puzzle; answer: Solution; key: string } | undefined;
  for (const transform of transforms) {
    const clues = new Int16Array(n * n).fill(NO_CLUE); const shaded = new Uint8Array(n * n);
    const mapDir = (dir: Dir): Dir => { const [x0, y0] = transform(0, 0); const [dx, dy] = dir === Dir.Up ? [0, -1] : dir === Dir.Down ? [0, 1] : dir === Dir.Left ? [-1, 0] : [1, 0]; const [tx, ty] = transform(dx, dy); const vx = tx! - x0!, vy = ty! - y0!; return vy < 0 ? Dir.Up : vy > 0 ? Dir.Down : vx < 0 ? Dir.Left : Dir.Right; };
    for (let i = 0; i < n * n; i++) { const [x, y] = transform(i % n, Math.floor(i / n)); const target = y! * n + x!; shaded[target] = answer.shaded[i]!; const clue = puzzle.clues[i]!; if (clue > 0) { let mapped = 0; for (const dir of [Dir.Up, Dir.Down, Dir.Left, Dir.Right]) if ((clue & dirBit(dir)) !== 0) mapped |= dirBit(mapDir(dir)); clues[target] = mapped; } else clues[target] = clue; }
    const candidate = { puzzle: { ...puzzle, clues }, answer: { shaded }, key: `${Array.from(clues).join(',')}|${Array.from(shaded).join('')}` };
    if (best === undefined || candidate.key < best.key) best = candidate;
  }
  return { puzzle: best!.puzzle, answer: best!.answer };
}
function tieDistance(puzzle: Puzzle, answer: Solution, clue: number): number {
  const x = clue % puzzle.cols, y = Math.floor(clue / puzzle.cols), mask = puzzle.clues[clue]!;
  const directions: readonly [number, number, Dir][] = [[0, -1, Dir.Up], [0, 1, Dir.Down], [-1, 0, Dir.Left], [1, 0, Dir.Right]];
  for (const [dx, dy, dir] of directions) if ((mask & dirBit(dir)) !== 0) for (let d = 1;; d++) { const xx = x + dx * d, yy = y + dy * d; if (xx < 0 || yy < 0 || xx >= puzzle.cols || yy >= puzzle.rows) break; if (answer.shaded[yy * puzzle.cols + xx]) return d; }
  return 0;
}
export function signatureOf(result: GenerateResult): FlowSignature {
  const { puzzle, answer } = canonical(result.puzzle, result.answer); const deduction = deduce(puzzle);
  const clues: number[] = []; const counts = [0, 0, 0, 0]; let ties = 0;
  for (let i = 0; i < puzzle.clues.length; i++) if (puzzle.clues[i]! > 0) { clues.push(i); const c = Math.min(4, Math.max(1, puzzle.clues[i]!.toString(2).split('1').length - 1)); counts[c - 1] = counts[c - 1]! + 1; ties += tieDistance(puzzle, answer, i); }
  const forcedAt = deduction.steps.findIndex((step) => step.rule === 'forced-placement');
  const prefix = deduction.steps.slice(0, forcedAt < 0 ? deduction.steps.length : forcedAt).filter((step) => step.sourceClue !== undefined);
  const sources = [...new Set(prefix.map((step) => step.sourceClue!))];
  let chain = 0, largest = 0, links = 0, placements = 0, reset = true;
  for (const step of deduction.steps) { if (step.sourceClue !== undefined || step.rule === 'cover-analysis' || step.rule.startsWith('probe-')) reset = true; if (step.rule === 'forced-placement') { placements++; if (reset) chain = 1; else { chain++; links++; } largest = Math.max(largest, chain); reset = false; } }
  const technical = deduction.steps.filter((step) => step.rule !== 'clue-cell-exclusion'); const total = technical.length || 1;
  const histogram = Object.fromEntries(RULES.map((rule) => [rule, technical.filter((step) => step.rule === rule).length / total])) as Record<RuleId, number>;
  return { arrowCardinality: counts.map((count) => count / (clues.length || 1)) as unknown as readonly [number, number, number, number], meanTieDistance: ties / (clues.length || 1) / Math.max(puzzle.cols, puzzle.rows), clueDispersion: dispersion(clues, puzzle.cols, puzzle.rows), earlySourceShare: sources.length / (clues.length || 1), earlySourceDispersion: dispersion(sources, puzzle.cols, puzzle.rows), cascadeLinkShare: placements < 2 ? 0 : links / (placements - 1), largestCascadeShare: placements ? largest / placements : 0, ruleHistogram: histogram, probeChainShare: deduction.maxProbeChain / (puzzle.cols * puzzle.rows) };
}
export function scoreFlow(profile: FlowProfile, s: FlowSignature, context: FlowContext): number {
  const multi = s.arrowCardinality[1] + s.arrowCardinality[2] + s.arrowCardinality[3]; const h = s.ruleHistogram;
  if (profile === 'crossfire') return .5 * multi + .25 * s.earlySourceShare + .25 * s.earlySourceDispersion;
  if (profile === 'long-range') return .45 * s.meanTieDistance + .35 * h['arrow-distance-bounds'] + .2 * s.clueDispersion;
  if (profile === 'shape-chain') return (context.rung <= 2 ? .65 : .5) * s.largestCascadeShare + (context.rung <= 2 ? .15 : .3) * s.cascadeLinkShare + .2 * h['no-touch-halo'];
  return .55 * s.earlySourceDispersion + .3 * s.earlySourceShare + .15 * s.clueDispersion;
}
export function distanceFlow(a: FlowSignature, b: FlowSignature, context: FlowContext): number {
  const weights = [.15, .15, .1, .15, .15, .1, .1, .08, context.difficulty === 'easy' ? 0 : .02]; const sum = weights.reduce((x, y) => x + y, 0); const hist = RULES.reduce((n, rule) => n + Math.abs(a.ruleHistogram[rule] - b.ruleHistogram[rule]), 0); const values = [a.arrowCardinality.reduce((n, value, i) => n + Math.abs(value - b.arrowCardinality[i]!), 0), Math.abs(a.meanTieDistance - b.meanTieDistance), Math.abs(a.clueDispersion - b.clueDispersion), Math.abs(a.earlySourceShare - b.earlySourceShare), Math.abs(a.earlySourceDispersion - b.earlySourceDispersion), Math.abs(a.cascadeLinkShare - b.cascadeLinkShare), Math.abs(a.largestCascadeShare - b.largestCascadeShare), hist, Math.abs(a.probeChainShare - b.probeChainShare)]; return values.reduce((n, value, i) => n + value * weights[i]!, 0) / sum;
}
export function selectCandidate(profile: FlowProfile, candidates: readonly RatedCandidate[], context: FlowContext): RatedCandidate { if (!candidates.length) throw new Error('selectCandidate: candidates must not be empty'); return candidates.reduce((best, candidate) => scoreFlow(profile, candidate.signature, context) > scoreFlow(profile, best.signature, context) || (scoreFlow(profile, candidate.signature, context) === scoreFlow(profile, best.signature, context) && candidate.candidateIndex < best.candidateIndex) ? candidate : best); }
