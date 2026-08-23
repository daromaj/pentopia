/**
 * BitBoard — a bit-packed set of grid cells over a `Uint32Array` of
 * `ceil(cols*rows/32)` words (roadmap §4 "Board representation").
 *
 * Cell `i = y*cols + x` occupies bit `i` (word `i >>> 5`, bit `i & 31`).
 * The board's geometry (cols/rows and the derived edge masks) is shared,
 * cached per `cols×rows` so many boards over one puzzle don't recompute it.
 *
 * The load-bearing operation is {@link BitBoard.kingHalo}: the set of all
 * king-move (orthogonal + diagonal) neighbours of the set cells, minus the
 * set cells themselves — computed with word-level directional shifts and
 * per-direction edge masks (roadmap: `halo = shift8(shaded) & ~shaded`).
 * Row-major packing means a naive whole-array shift wraps cells across row
 * boundaries; the edge masks below strip the source column that would wrap
 * before each shift, and a final board-mask AND clears any padding bits.
 */

import { KING8 } from '../core/grid';

interface Geom {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  readonly words: number;
  /** Bits 0..n-1 set; everything else (padding in the last word) clear. */
  readonly boardMask: Uint32Array;
  /** Bits of column 0. */
  readonly leftColMask: Uint32Array;
  /** Bits of column cols-1. */
  readonly rightColMask: Uint32Array;
}

const geomCache = new Map<string, Geom>();

function buildGeom(cols: number, rows: number): Geom {
  const n = cols * rows;
  const words = Math.ceil(n / 32) || 1;
  const boardMask = new Uint32Array(words);
  for (let i = 0; i < n; i++) boardMask[i >>> 5]! |= 1 << (i & 31);
  const leftColMask = new Uint32Array(words);
  const rightColMask = new Uint32Array(words);
  for (let y = 0; y < rows; y++) {
    const l = y * cols; // (0, y)
    const r = y * cols + (cols - 1); // (cols-1, y)
    leftColMask[l >>> 5]! |= 1 << (l & 31);
    rightColMask[r >>> 5]! |= 1 << (r & 31);
  }
  return { cols, rows, n, words, boardMask, leftColMask, rightColMask };
}

function getGeom(cols: number, rows: number): Geom {
  const key = `${cols}x${rows}`;
  let g = geomCache.get(key);
  if (g === undefined) {
    g = buildGeom(cols, rows);
    geomCache.set(key, g);
  }
  return g;
}

/** Population count of a single 32-bit word (Hamming weight). */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/**
 * Shift the bitset `src` (word array) by `delta` bit positions into `out`
 * (which is fully overwritten). `delta > 0` moves bit `i` to `i+delta`
 * (toward higher indices); `delta < 0` moves it toward lower indices. Bits
 * shifted off either end are dropped. No edge/row masking here — callers do
 * that around this primitive.
 */
function shiftInto(src: Uint32Array, out: Uint32Array, delta: number, words: number): void {
  if (delta === 0) {
    out.set(src);
    return;
  }
  out.fill(0);
  if (delta > 0) {
    const wordShift = delta >>> 5;
    const bitShift = delta & 31;
    for (let k = words - 1; k >= 0; k--) {
      const s = k - wordShift;
      if (s < 0) continue;
      let v = src[s]! << bitShift;
      if (bitShift > 0 && s - 1 >= 0) v |= src[s - 1]! >>> (32 - bitShift);
      out[k] = v >>> 0;
    }
  } else {
    const d = -delta;
    const wordShift = d >>> 5;
    const bitShift = d & 31;
    for (let k = 0; k < words; k++) {
      const s = k + wordShift;
      if (s >= words) continue;
      let v = src[s]! >>> bitShift;
      if (bitShift > 0 && s + 1 < words) v |= src[s + 1]! << (32 - bitShift);
      out[k] = v >>> 0;
    }
  }
}

export class BitBoard {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  readonly words: number;
  readonly w: Uint32Array;
  private readonly geom: Geom;

  /**
   * `new BitBoard(cols, rows)` → empty board. `new BitBoard(cols, rows,
   * words)` adopts `words` as the backing store (no copy) — used internally.
   */
  constructor(cols: number, rows: number, words?: Uint32Array) {
    const g = getGeom(cols, rows);
    this.geom = g;
    this.cols = cols;
    this.rows = rows;
    this.n = g.n;
    this.words = g.words;
    this.w = words ?? new Uint32Array(g.words);
  }

  clone(): BitBoard {
    return new BitBoard(this.cols, this.rows, this.w.slice());
  }

  /** A board with every real cell set (padding bits clear). */
  static full(cols: number, rows: number): BitBoard {
    return new BitBoard(cols, rows, getGeom(cols, rows).boardMask.slice());
  }

  set(i: number): void {
    this.w[i >>> 5]! |= 1 << (i & 31);
  }

  clear(i: number): void {
    this.w[i >>> 5]! &= ~(1 << (i & 31));
  }

  test(i: number): boolean {
    return (this.w[i >>> 5]! & (1 << (i & 31))) !== 0;
  }

  isEmpty(): boolean {
    for (let k = 0; k < this.words; k++) if (this.w[k] !== 0) return false;
    return true;
  }

  popcount(): number {
    let c = 0;
    for (let k = 0; k < this.words; k++) c += popcount32(this.w[k]!);
    return c;
  }

  /** In-place `this |= other`. */
  orAssign(other: BitBoard): this {
    const a = this.w;
    const b = other.w;
    for (let k = 0; k < this.words; k++) a[k]! |= b[k]!;
    return this;
  }

  /** In-place `this &= other`. */
  andAssign(other: BitBoard): this {
    const a = this.w;
    const b = other.w;
    for (let k = 0; k < this.words; k++) a[k]! &= b[k]!;
    return this;
  }

  /** In-place `this &= ~other`. */
  andNotAssign(other: BitBoard): this {
    const a = this.w;
    const b = other.w;
    for (let k = 0; k < this.words; k++) a[k]! &= ~b[k]!;
    return this;
  }

  intersects(other: BitBoard): boolean {
    const a = this.w;
    const b = other.w;
    for (let k = 0; k < this.words; k++) if ((a[k]! & b[k]!) !== 0) return true;
    return false;
  }

  equals(other: BitBoard): boolean {
    if (other.n !== this.n) return false;
    const a = this.w;
    const b = other.w;
    for (let k = 0; k < this.words; k++) if (a[k] !== b[k]) return false;
    return true;
  }

  /** Call `cb(i)` for every set cell index, ascending. */
  forEach(cb: (i: number) => void): void {
    const w = this.w;
    for (let k = 0; k < this.words; k++) {
      let word = w[k]!;
      while (word !== 0) {
        const bit = word & -word; // lowest set bit
        const i = (k << 5) + popcount32(bit - 1);
        cb(i);
        word ^= bit;
      }
    }
  }

  toArray(): number[] {
    const out: number[] = [];
    this.forEach((i) => out.push(i));
    return out;
  }

  /** Lowest set cell index, or -1 when empty. */
  firstSet(): number {
    const w = this.w;
    for (let k = 0; k < this.words; k++) {
      const word = w[k]!;
      if (word !== 0) return (k << 5) + popcount32((word & -word) - 1);
    }
    return -1;
  }

  /** The set as a dense 0/1 array over all `n` cells. */
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.n);
    this.forEach((i) => {
      out[i] = 1;
    });
    return out;
  }

  /**
   * Whole-board directional shift by `(dx, dy)` with edge masking, returning
   * a new board. A source cell `(x, y)` lands at `(x+dx, y+dy)`; cells that
   * would fall off the board (row-wrap in x, or off the top/bottom in y) are
   * dropped. Exposed primarily so the edge-mask logic is directly testable.
   */
  shift(dx: number, dy: number): BitBoard {
    const g = this.geom;
    // Strip the source column that a horizontal step would wrap across a row.
    // A purely vertical shift wraps nothing, so it reads `this.w` directly
    // (shiftInto never mutates its source).
    let src = this.w;
    if (dx > 0) {
      src = this.w.slice();
      for (let k = 0; k < g.words; k++) src[k]! &= ~g.rightColMask[k]!;
    } else if (dx < 0) {
      src = this.w.slice();
      for (let k = 0; k < g.words; k++) src[k]! &= ~g.leftColMask[k]!;
    }
    const out = new Uint32Array(g.words);
    shiftInto(src, out, dy * g.cols + dx, g.words);
    // Clear padding bits and any out-of-range landings.
    for (let k = 0; k < g.words; k++) out[k]! &= g.boardMask[k]!;
    return new BitBoard(this.cols, this.rows, out);
  }

  /**
   * The king-move halo of the set cells: every cell orthogonally or
   * diagonally adjacent to a set cell, excluding the set cells themselves.
   * `halo = (⋃ shift(dir)) & ~this` (roadmap §4). This is the no-touch
   * exclusion zone around a placed shape (format §5 constraint 1).
   */
  kingHalo(): BitBoard {
    const g = this.geom;
    const acc = new Uint32Array(g.words);
    for (const [dx, dy] of KING8) {
      const s = this.shift(dx, dy).w;
      for (let k = 0; k < g.words; k++) acc[k]! |= s[k]!;
    }
    // Remove the set cells themselves.
    for (let k = 0; k < g.words; k++) acc[k]! &= ~this.w[k]!;
    return new BitBoard(this.cols, this.rows, acc);
  }
}
