/**
 * Answer validator (`AnsCheck`, format §4). Runs the full Pentopia checklist
 * (format §4, items 1-7) against a complete candidate solution and reports
 * every failing check, in checklist order — this is the "full check"
 * (`checkOnly=false`) mode described in the doc, used for a final
 * is-this-solved verdict rather than live per-move feedback.
 *
 * Each checklist item yields at most one {@link Failure} in the result,
 * aggregating every cell implicated by that kind of violation (a board can
 * have multiple instances of the same mistake, e.g. two separate diagonal
 * touches — both get folded into one `shDiag` failure with all the cells
 * involved).
 */

import type { Bank, Failure, Puzzle, Shape, Solution, ValidationResult } from './types';
import { DIRS, Dir, dirBit } from './types';
import { idx, rayDistance, ORTH4 } from './grid';
import { canonicalKey } from './shape';
import { bankCounts } from './bank';

interface Component {
  readonly cells: readonly number[];
  readonly key: string;
}

/** 4-connected flood fill of shaded cells into components, each reduced to a canonical shape key (format §4.1). */
function findComponents(puzzle: Puzzle, answer: Solution): { components: Component[]; componentOf: Int32Array } {
  const { cols, rows } = puzzle;
  const { shaded } = answer;
  const componentOf = new Int32Array(cols * rows).fill(-1);
  const components: Component[] = [];

  for (let start = 0; start < cols * rows; start++) {
    if (!shaded[start] || componentOf[start] !== -1) continue;
    const cells: number[] = [];
    const stack = [start];
    componentOf[start] = components.length;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      cells.push(cur);
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      for (const [dx, dy] of ORTH4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = idx(nx, ny, cols);
        if (!shaded[ni] || componentOf[ni] !== -1) continue;
        componentOf[ni] = components.length;
        stack.push(ni);
      }
    }

    let minX = cols;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    for (const c of cells) {
      const x = c % cols;
      const y = Math.floor(c / cols);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const bits = new Uint8Array(w * h);
    for (const c of cells) {
      const x = (c % cols) - minX;
      const y = Math.floor(c / cols) - minY;
      bits[y * w + x] = 1;
    }
    const shape: Shape = { w, h, bits };
    components.push({ cells, key: canonicalKey(shape) });
  }

  return { components, componentOf };
}

function checkCsOnArrow(puzzle: Puzzle, answer: Solution): Failure | null {
  if (puzzle.transparent) return null;
  const cells: number[] = [];
  for (let i = 0; i < puzzle.clues.length; i++) {
    if (puzzle.clues[i] !== -1 && answer.shaded[i]) cells.push(i);
  }
  return cells.length > 0 ? { code: 'csOnArrow', cells } : null;
}

function checkBankGt(bank: Bank, components: readonly Component[]): Failure | null {
  const allowed = bankCounts(bank);
  const cells: number[] = [];
  for (const comp of components) {
    if (!allowed.has(comp.key)) continue;
    const count = components.filter((c) => c.key === comp.key).length;
    if (count > (allowed.get(comp.key) ?? 0)) {
      cells.push(...comp.cells);
    }
  }
  const uniqCells = [...new Set(cells)].sort((a, b) => a - b);
  return uniqCells.length > 0 ? { code: 'bankGt', cells: uniqCells } : null;
}

function checkBankInvalid(components: readonly Component[], bank: Bank): Failure | null {
  const allowed = bankCounts(bank);
  const cells: number[] = [];
  for (const comp of components) {
    if (!allowed.has(comp.key)) cells.push(...comp.cells);
  }
  return cells.length > 0 ? { code: 'bankInvalid', cells } : null;
}

/** format §4.2: 2x2 window, exactly 2 shaded cells, diagonal to each other, different components. */
function checkShDiag(puzzle: Puzzle, answer: Solution, componentOf: Int32Array): Failure | null {
  const { cols, rows } = puzzle;
  const { shaded } = answer;
  const cells = new Set<number>();
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const tl = idx(x, y, cols);
      const tr = idx(x + 1, y, cols);
      const bl = idx(x, y + 1, cols);
      const br = idx(x + 1, y + 1, cols);
      const shadedSet = [tl, tr, bl, br].filter((i) => shaded[i]);
      if (shadedSet.length !== 2) continue;
      const [a, b] = shadedSet as [number, number];
      const isDiagPair = (a === tl && b === br) || (a === tr && b === bl);
      if (!isDiagPair) continue;
      if (componentOf[a] !== componentOf[b]) {
        cells.add(a);
        cells.add(b);
      }
    }
  }
  return cells.size > 0 ? { code: 'shDiag', cells: [...cells].sort((x, y) => x - y) } : null;
}

interface ClueRayInfo {
  readonly clueIndex: number;
  readonly dist: ReadonlyMap<Dir, number | null>;
  readonly arrowedDirs: readonly Dir[];
  readonly unarrowedDirs: readonly Dir[];
}

function measureClueRays(puzzle: Puzzle, answer: Solution): ClueRayInfo[] {
  const { cols, rows, clues } = puzzle;
  const { shaded } = answer;
  const infos: ClueRayInfo[] = [];
  for (let i = 0; i < clues.length; i++) {
    const v = clues[i]!;
    if (v <= 0) continue; // NO_CLUE (-1) and HATENA (-2) both skipped, matching getShadeDirs (qnum <= 0).
    const x = i % cols;
    const y = Math.floor(i / cols);
    const dist = new Map<Dir, number | null>();
    const arrowedDirs: Dir[] = [];
    const unarrowedDirs: Dir[] = [];
    for (const dir of DIRS) {
      const d = rayDistance(x, y, dir, cols, rows, (ci) => shaded[ci] === 1);
      dist.set(dir, d);
      if ((v & dirBit(dir)) !== 0) arrowedDirs.push(dir);
      else unarrowedDirs.push(dir);
    }
    infos.push({ clueIndex: i, dist, arrowedDirs, unarrowedDirs });
  }
  return infos;
}

/**
 * format §4.3: for a *complete* board, checkShadeDirCloser/Unequal/Exist
 * reduce to a plain "arrowed directions all tied for nearest, unarrowed
 * directions all strictly farther" reading (see the doc's "Note on partial
 * boards"). When arrowed directions disagree on distance (the arDistanceNe
 * case), there's no single well-defined "the arrowed distance" to compare
 * unarrowed directions against for arDistanceGt; we use the *minimum*
 * distance among arrowed directions that did hit a shaded cell as the
 * reference — an unarrowed direction tying or beating that minimum is
 * unambiguously "closer than (at least one of) the arrows", which is what
 * rule 3 forbids regardless of whether the arrows also disagree among
 * themselves.
 */
function checkArDistanceGt(infos: readonly ClueRayInfo[]): Failure | null {
  const cells = new Set<number>();
  for (const info of infos) {
    const arrowedHits = info.arrowedDirs
      .map((d) => info.dist.get(d)!)
      .filter((d): d is number => d !== null);
    if (arrowedHits.length === 0) continue;
    const minArrowed = Math.min(...arrowedHits);
    for (const dir of info.unarrowedDirs) {
      const d = info.dist.get(dir)!;
      if (d !== null && d <= minArrowed) {
        cells.add(info.clueIndex);
      }
    }
  }
  return cells.size > 0 ? { code: 'arDistanceGt', cells: [...cells].sort((a, b) => a - b) } : null;
}

function checkArDistanceNe(infos: readonly ClueRayInfo[]): Failure | null {
  const cells = new Set<number>();
  for (const info of infos) {
    const arrowedHits = info.arrowedDirs
      .map((d) => info.dist.get(d)!)
      .filter((d): d is number => d !== null);
    if (arrowedHits.length < 2) continue;
    const first = arrowedHits[0]!;
    if (arrowedHits.some((d) => d !== first)) {
      cells.add(info.clueIndex);
    }
  }
  return cells.size > 0 ? { code: 'arDistanceNe', cells: [...cells].sort((a, b) => a - b) } : null;
}

function checkArNoShade(infos: readonly ClueRayInfo[]): Failure | null {
  const cells = new Set<number>();
  for (const info of infos) {
    for (const dir of info.arrowedDirs) {
      if (info.dist.get(dir) === null) {
        cells.add(info.clueIndex);
      }
    }
  }
  return cells.size > 0 ? { code: 'arNoShade', cells: [...cells].sort((a, b) => a - b) } : null;
}

/** Run the full Pentopia validator checklist (format §4) and report every failure, in checklist order. */
export function validate(puzzle: Puzzle, answer: Solution): ValidationResult {
  const { components, componentOf } = findComponents(puzzle, answer);
  const infos = measureClueRays(puzzle, answer);

  const checks: (Failure | null)[] = [
    checkCsOnArrow(puzzle, answer),
    checkBankGt(puzzle.bank, components),
    checkShDiag(puzzle, answer, componentOf),
    checkArDistanceGt(infos),
    checkArDistanceNe(infos),
    checkArNoShade(infos),
    checkBankInvalid(components, puzzle.bank),
  ];

  const failures = checks.filter((f): f is Failure => f !== null);
  return { ok: failures.length === 0, failures };
}
