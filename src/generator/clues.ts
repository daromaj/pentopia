/**
 * Derive the maximal legal arrow-clue set against a known answer (roadmap §5.2
 * / format §2 rule 3).
 *
 * For every UNSHADED cell, cast a ray in each of the 4 cardinal directions to
 * the nearest shaded cell. The clue's arrow bitmask is the OR of `dirBit(dir)`
 * for every direction TIED for the minimum hit distance; directions with no
 * shaded cell (or a strictly farther one) contribute no arrow. A cell that
 * sees no shaded cell in any direction gets NO_CLUE.
 *
 * This is the fullest clue set that is legal by construction against the
 * answer: arrows point at exactly the directions tied for nearest, and unarrowed
 * directions are strictly farther or empty — precisely rule 3. It is the
 * starting point the minimizer whittles down.
 */

import type { ClueValue } from '../core/types';
import { DIRS, dirBit, NO_CLUE } from '../core/types';
import { idx, rayDistance } from '../core/grid';

export function deriveMaximalClues(cols: number, rows: number, shaded: Uint8Array): Int16Array {
  const clues = new Int16Array(cols * rows).fill(NO_CLUE);
  const isShaded = (i: number): boolean => shaded[i] === 1;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y, cols);
      if (shaded[i] === 1) continue; // shaded cells never carry a clue (rule 4)

      const dists: (number | null)[] = [];
      let min = Infinity;
      for (const dir of DIRS) {
        const d = rayDistance(x, y, dir, cols, rows, isShaded);
        dists.push(d);
        if (d !== null && d < min) min = d;
      }
      if (min === Infinity) continue; // no shaded cell in any direction → NO_CLUE

      let mask = 0;
      for (let k = 0; k < DIRS.length; k++) {
        if (dists[k] === min) mask |= dirBit(DIRS[k]!);
      }
      clues[i] = mask as ClueValue;
    }
  }
  return clues;
}
