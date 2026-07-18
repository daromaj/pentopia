/**
 * Polyomino shapes: construction, the 8 dihedral orientations, and
 * canonical-key comparison (format §3.3 "Orientation canonicalization" /
 * §4.1). This is the *one* implementation of that algorithm — bank codec,
 * validator, solver, and generator all reuse it so a placed region and a
 * bank piece are always compared by the identical code path.
 */

import type { Shape } from './types';

/** Build a Shape from an array of equal-length strings; '#' = filled, anything else = empty. */
export function shapeFromStrings(rows: readonly string[]): Shape {
  const h = rows.length;
  const w = h > 0 ? rows[0]!.length : 0;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < w; x++) {
      bits[y * w + x] = row[x] === '#' ? 1 : 0;
    }
  }
  return { w, h, bits };
}

/** Rotate a shape 90° clockwise. */
function rotate90(s: Shape): Shape {
  const { w, h, bits } = s;
  const nw = h;
  const nh = w;
  const nbits = new Uint8Array(nw * nh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits[y * w + x]) {
        const nx = h - 1 - y;
        const ny = x;
        nbits[ny * nw + nx] = 1;
      }
    }
  }
  return { w: nw, h: nh, bits: nbits };
}

/** Mirror a shape across its vertical axis (reverse x). */
function flipH(s: Shape): Shape {
  const { w, h, bits } = s;
  const nbits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits[y * w + x]) {
        nbits[y * w + (w - 1 - x)] = 1;
      }
    }
  }
  return { w, h, bits: nbits };
}

function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.bits.length; i++) {
    if (a.bits[i] !== b.bits[i]) return false;
  }
  return true;
}

/**
 * All 8 dihedral-symmetry variants of a shape (identity, the 3 further 90°
 * rotations, and the same 4 after a mirror flip), deduplicated — symmetric
 * shapes (e.g. X, O) yield fewer than 8 distinct results.
 */
export function orientations(s: Shape): Shape[] {
  const raw: Shape[] = [];
  let cur = s;
  for (let i = 0; i < 4; i++) {
    raw.push(cur);
    cur = rotate90(cur);
  }
  let curF = flipH(s);
  for (let i = 0; i < 4; i++) {
    raw.push(curF);
    curF = rotate90(curF);
  }
  const uniq: Shape[] = [];
  for (const sh of raw) {
    if (!uniq.some((u) => shapesEqual(u, sh))) uniq.push(sh);
  }
  return uniq;
}

function serializeVariant(s: Shape): string {
  let bitStr = '';
  for (let i = 0; i < s.bits.length; i++) bitStr += s.bits[i] ? '1' : '0';
  return `${s.w}:${bitStr}`;
}

/**
 * The canonical comparison key for a shape "up to rotation/reflection"
 * (format §3.3/§4.1): generate all 8 dihedral variants, serialize each as
 * `${dim}:${bitstring}` and take the lexicographically smallest.
 *
 * Interpretation of the spec's "<dim> is the width for the 4
 * un-rotated-frame variants and the height for the 4 rotated-frame ones":
 * rather than special-casing which of the 8 transforms counts as
 * "rotated", we use *each transformed shape's own actual width* after
 * performing the geometric transform. This is equivalent to the spec's
 * description automatically: for the 4 variants that don't swap the
 * bounding box (identity, 180° rotation, and their mirrors) the
 * transformed width IS the original width; for the 4 that do swap it (the
 * two 90°/270° rotations and their mirrors) the transformed width IS the
 * original height. So "width of the transform" and "width-for-unrotated /
 * height-for-rotated" describe the exact same number — see the property
 * test asserting all 8 transforms of every pentomino/tetromino share one
 * canonicalKey, and that distinct free polyominoes get distinct keys.
 */
export function canonicalKey(s: Shape): string {
  const variants = orientations(s);
  let best: string | null = null;
  for (const v of variants) {
    const key = serializeVariant(v);
    if (best === null || key < best) best = key;
  }
  return best as string;
}

/** The 12 free pentominoes, exactly as drawn in format Appendix A. */
export const PENTOMINOES: Record<string, Shape> = {
  F: shapeFromStrings(['..#', '###', '.#.']),
  I: shapeFromStrings(['#', '#', '#', '#', '#']),
  L: shapeFromStrings(['.#', '.#', '.#', '##']),
  N: shapeFromStrings(['.#', '.#', '##', '#.']),
  P: shapeFromStrings(['.#', '##', '##']),
  T: shapeFromStrings(['..#', '###', '..#']),
  U: shapeFromStrings(['##', '.#', '##']),
  V: shapeFromStrings(['..#', '..#', '###']),
  W: shapeFromStrings(['..#', '.##', '##.']),
  X: shapeFromStrings(['.#.', '###', '.#.']),
  Y: shapeFromStrings(['.#', '.#', '##', '.#']),
  Z: shapeFromStrings(['..#', '###', '#..']),
};

/** The 5 free tetrominoes, exactly as drawn in format Appendix A. */
export const TETROMINOES: Record<string, Shape> = {
  I: shapeFromStrings(['#', '#', '#', '#']),
  L: shapeFromStrings(['.#', '.#', '##']),
  O: shapeFromStrings(['##', '##']),
  S: shapeFromStrings(['.#', '##', '#.']),
  T: shapeFromStrings(['.#', '##', '.#']),
};
