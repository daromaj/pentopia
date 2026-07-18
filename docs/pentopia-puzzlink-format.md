# Pentopia — Rules, puzz.link Format, and Validator Reference

This document is a complete technical reference for the **Pentopia** puzzle
type as implemented by [puzz.link](https://puzz.link) / the
[pzprjs](https://github.com/robx/pzprjs) engine (the "pzprv3" family of
pencil-puzzle players). It covers the puzzle rules, the URL/file encoding
format, and the answer-validation logic, so that a solver/generator can be
built without needing to reverse-engineer the reference JS implementation
again.

Everything below was derived by reading the actual pzprjs source
(`robx/pzprjs`, MIT licensed) and the sample puzzle
`https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p`. Key files:

- `src/variety/statuepark.js` — shared implementation for Pentopia and its
  sibling puzzle types (rules/UI/validator).
- `src/variety-common/Encode.js`, `src/variety-common/Answer.js`,
  `src/puzzle/PieceList.js`, `src/puzzle/Encode.js`, `src/puzzle/Answer.js`
  — generic encode/decode and validation helpers used by many puzzle types.
- `src-ui/res/rules.en.yaml` — canonical human-readable rules text.
- `test/script/pentopia.js` — the engine's own test fixtures, including one
  failing board per validator error code (extremely useful as ground truth).
- `src/res/failcode.en.json` — human-readable text for each validator error
  code.

## 1. What Pentopia is

Pentopia belongs to a family of puzzles that puzz.link implements with one
shared engine, historically called **"Statue Park"** (`pid` list in
`statuepark.js`: `statuepark`, `statuepark-aux`, `pentopia`, `battleship`,
`pentatouch`, `kissing`, `retroships`, `regional-poly`, `distopia`). All of
them are "place shapes from a bank into a grid" puzzles; they differ in how
placement is clued and in which extra constraints apply. Pentopia's
distinguishing features are:

- You are given a **bank of shapes** (by default, the twelve free
  pentominoes), but you only need to use **some** of them (each at most
  once) — unlike Statue Park, which requires using every shape.
- Placement is clued by **arrows** on cells outside any shape, not by
  outlines, numbers, or borders.

The board itself has no fixed size in the format — width and height are
part of the puzzle string (see §3).

## 2. Rules

Canonical rules text (`src-ui/res/rules.en.yaml`, key `pentopia`):

> Place some shapes from the bank into the grid. Shapes can be rotated or
> mirrored.
> 1. A shape can be used no more than once. There cannot be shapes in the
>    grid that aren't present in the bank.
> 2. Two shapes cannot be orthogonally or diagonally adjacent.
> 3. Arrows point towards the shape closest to the clue. If a clue has
>    multiple arrows, the distance to the closest shape must be the same.
>    Directions without an arrow must have a shape further away, or not
>    have a shape in that direction.
> 4. A cell with a clue cannot overlap a shape.

In solver-friendly terms:

1. **Shading.** Some cells are shaded ("black"/filled); the rest are not.
   Every maximal 4-connected group of shaded cells must, up to rotation
   and reflection, exactly match one of the shapes currently available in
   the bank (see §3.3 for how shapes/orientations are compared). A given
   bank shape may be used 0 or 1 times; a shape count that exceeds what's
   in the bank, or a shaded shape not present in the bank at all, is
   invalid.
2. **Separation.** No two shaded regions (i.e. no two different placed
   shapes) may touch, including diagonally (king-move adjacency). A
   single shape *is* allowed to touch itself diagonally (this happens
   naturally with shapes like the W or Z pentomino) — only cross-shape
   diagonal adjacency is forbidden.
3. **Arrow clues.** A clue cell has between 1 and 4 arrows, one per
   cardinal direction (up/down/left/right). Casting a ray from the clue
   cell in each of the four directions until it hits a shaded cell (or the
   edge of the board):
   - Every direction that *has* an arrow must hit a shaded cell
     eventually (otherwise: no valid "closest shape" in that direction).
   - All arrowed directions must hit their first shaded cell at exactly
     the **same distance** (measured in cells) from the clue.
   - Every direction that does **not** have an arrow must either hit
     nothing, or hit its first shaded cell **strictly farther away** than
     the arrowed distance (an unarrowed direction may not tie or beat the
     arrowed directions).
   In short: the arrows point at *all* directions tied for the closest
   shaded cell, and only those.
4. **Clue cells are always empty.** A cell carrying an arrow clue can
   never itself be part of a shaded shape (this is true by default; see
   the "transparent" variant below where it's relaxed).

### 2.1 The "transparent" variant

The puzz.link engine supports a per-puzzle flag, `pentopia_transparent`
(URL `t` flag, see §3.1), which — when set — **removes rule 4**: clue
cells are then allowed to be covered by a shaded shape (the arrow is drawn
"through" the shape). This is an alternate presentation used by some
setters; absent the flag, rule 4 is enforced normally.

### 2.2 Bank presets

The default bank (used when the puzzle string requests preset `p`, or when
none of the `preset.*` are matched, the very first preset in the list, also `p`)
is the twelve free pentominoes, one of each: **F, I, L, N, P, T, U, V, W, X,
Y, Z**. Other built-in presets:

| shortkey | name | contents |
|---|---|---|
| `p` | pentominoes | 1× each of the 12 free pentominoes |
| `t` | tetrominoes | 1× each of the 5 free tetrominoes (I, L, O, S, T) |
| `d` | double tetrominoes | 2× each of the 5 free tetrominoes |
| `z` | zero | empty bank (no shapes at all — degenerate) |

A puzzle can also ship an arbitrary custom bank (arbitrary shapes, with
arbitrary repeat counts) instead of a preset — see §3.3.

### 2.3 Related puzzle types on the same engine

These share `statuepark.js` and the shape-bank/orientation machinery, but
are otherwise distinct puzzles (documented here only for context — they are
out of scope for the "pentopia" solver itself):

| pid | difference from Pentopia |
|---|---|
| `statuepark` | must use **every** bank shape exactly once; clued by black/white circles instead of arrows; unshaded cells must form one connected region |
| `distopia` | same shape-placement mechanic as Pentopia, but the clue is a single **number** = (closest distance) × (count of directions tied for that minimum), instead of directional arrows |
| `pentatouch` | must use every bank shape exactly once; no arrow clues; instead, dots mark every place two shapes touch diagonally (edge-adjacency between different shapes still forbidden) |
| `battleship` / `retroships` | ship-fleet variants with outside-the-grid row/column counts |
| `kissing` | must use every shape; bars mark every place two *different* shapes are orthogonally adjacent; regions can't be crossed |
| `regional-poly` | like `kissing`'s "must use every shape, no diagonal touching" but with outlined regions, each containing at most one shape |

## 3. The puzz.link URL / file format

### 3.1 General envelope

```
https://puzz.link/p?<pid>/[<pflag>/]<cols>/<rows>/<body>
```

- `pid` — puzzle type id, `pentopia` for this puzzle.
- `pflag` — an *optional* segment, present only when it is not purely
  numeric (the parser tells it apart from `cols` with `isNaN(inp[0])`). For
  Pentopia the only meaningful flag character is `t` (transparent mode,
  §2.1). When absent, there is no clue-cell-overlap relaxation.
- `cols`, `rows` — board width and height, plain decimal integers.
- `body` — everything after `rows`, still slash-separated on the wire but
  processed as one contiguous string internally (slashes inside it are
  significant delimiters for the piece-bank section, see §3.3).

Example: `https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p`
decomposes as `pid=pentopia`, no `pflag`, `cols=10`, `rows=10`,
`body="2s9ziar5gbi6z6hai9s4//p"`.

Decoding order (from `Encode@pentopia,distopia,retroships` in
`statuepark.js`):

```js
decodePzpr: function(type) {
  this.puzzle.setConfig("pentopia_transparent", this.checkpflag("t"));
  if (this.outbstr[0] !== "/") {
    this.decodeNumber16();   // clue grid, §3.2 — skipped entirely if body starts with "/"
  }
  this.decodePieceBank();     // bank section, §3.3
}
```

If the body starts with `/` there is no clue section at all (an all-blank
grid) and decoding jumps straight to the piece bank.

### 3.2 Clue grid encoding — "Number16"

The clue section stores one signed value per cell, in row-major order
(row 0 left→right, then row 1, …), using a variable-width hex-like scheme
that also run-length-encodes long stretches of "no clue" cells. This same
`Number16` codec is reused by many other puzzle types in pzprjs, not just
Pentopia.

Per-cell values, read left to right (`readNumber16` in
`src/variety-common/Encode.js`):

| leading char(s) | consumes | value |
|---|---|---|
| `0`–`9`, `a`–`f` | 1 char | the hex digit itself, `0`–`15` |
| `.` | 1 char | `-2` (a "hatena" / undecided placeholder clue) |
| `-XX` | 3 chars | `0x XX` (16–255) |
| `+XXX` | 4 chars | `0x XXX` (256–4095) |
| `=XXX` | 4 chars | `0x XXX + 4096` (4096–8191) |
| `@XXX` or `%XXX` | 4 chars | `0x XXX + 8192` (8192–12239) |
| `*XXXX` | 5 chars | `0x XXXX + 12240` |
| `$XXXXX` | 6 chars | `0x XXXXX + 77776` |
| `g`–`z` | 1 char | *not a value* — skip `(base36 value) - 15` cells (16–35 blank cells) with no clue (`-1`) |

Decoding stops once every cell has been assigned a value (cells not
otherwise mentioned default to `-1`, "no clue"). For Pentopia specifically,
the value domain that actually appears is:

- `-1` — no clue (the vast majority of cells; this is also the default).
- `1`–`15` — an **arrow bitmask** (see below). `0` is never produced by a
  real puzzle (checked by `getShadeDirs`, which skips `qnum <= 0`).
- `-2` (the `.` marker) — a "hatena" placeholder, rendered as `?`; not a
  normal solvable clue.

**Arrow bitmask.** The four cardinal directions are numbered
`UP=1, DOWN=2, LEFT=3, RIGHT=4` internally; a direction's bit is
`1 << (dir - 1)`, i.e.:

| direction | bit value |
|---|---|
| UP | 1 |
| DOWN | 2 |
| LEFT | 4 |
| RIGHT | 8 |

The clue's `qnum` is the OR (sum) of the bits for every direction that has
an arrow drawn. E.g. `9 = 1 + 8` = arrows pointing UP and RIGHT; `15` = all
four arrows.

### 3.3 Piece bank encoding

After the clue grid, the remainder of the body is the piece bank. It comes
in two forms:

**a) Preset shorthand** — `//<shortkey>`, e.g. `//p` (pentominoes), `//t`
(tetrominoes), `//d` (double tetrominoes), `//z` (empty). This is what the
generator/encoder emits whenever the current bank exactly matches one of
the built-in presets (see the preset table in §2.2).

**b) Explicit piece list** — `/<count>/<piece1>/<piece2>/…/<pieceN>`: a
literal leading `/`, then a decimal `count`, then `count` more
slash-separated fields, each one a serialized `BankPiece` (below). Used for
custom banks, or when a preset's shapes are present but its *counts*
differ (e.g., 2 F-pentominoes + 1 of everything else).

A serialized `BankPiece` (`BankPiece.serialize` /
`BankPiece.deserialize` in `statuepark.js`) is:

```
<w><h><bits...>
```

- `w`, `h` — shape width and height, each a single base-36 digit
  (`0`–`9a`–`z`, so up to 35×35).
- The shape's cell bitmap, `w*h` bits, row-major, `1` = filled / `0` =
  empty, is chunked into groups of 5 bits (last group zero-padded), and
  each 5-bit group is written as one base-32 digit (`0`–`9a`–`v`).
  Trailing all-zero (`"0"`) digits are stripped from the output.

Example: `337k` decodes to `w=3, h=3`; digits `7`, `k` → binary
`00111`+`10100` → bit string `0011110100`, truncated to `w*h=9` bits →
`001111010`, laid out as a 3×3 grid:

```
..#
###
.#.
```

— the F-pentomino. See Appendix A for the full pentomino/tetromino
catalog with codes and shapes.

**Orientation canonicalization** (`BankPiece.canonize`): to compare a
placed shape against bank shapes "up to rotation/reflection", the engine
generates all 8 dihedral-symmetry variants of a shape (identity, the two
axis flips, the two 90° rotations, and their composition — some may
coincide for symmetric shapes), serializes each as `<dim>:<bitstring>`
(where `<dim>` is the width for the 4 "un-rotated-frame" variants and the
height for the 4 "rotated-frame" ones), sorts them lexicographically, and
takes the smallest as the shape's canonical key. Two shapes are "the same
piece, any orientation" iff their canonical keys match.

### 3.4 Worked example

Decoding `pentopia/10/10/2s9ziar5gbi6z6hai9s4//p`:

- `cols=10, rows=10`, no `pflag` → `pentopia_transparent = false`.
- Clue body `2s9ziar5gbi6z6hai9s4` decodes (row-major, 0-indexed
  `(col,row)`) to these non-empty clues:

  | cell (col,row) | value | arrows |
  |---|---|---|
  | (0,0) | 2 | DOWN |
  | (4,1) | 9 | UP + RIGHT |
  | (8,3) | 10 | DOWN + RIGHT |
  | (1,5) | 5 | UP + LEFT |
  | (3,5) | 11 | UP + DOWN + RIGHT |
  | (7,5) | 6 | DOWN + LEFT |
  | (8,7) | 6 | DOWN + LEFT |
  | (1,8) | 10 | DOWN + RIGHT |
  | (5,8) | 9 | UP + RIGHT |
  | (9,9) | 4 | LEFT |

  All other 90 cells have no clue.
- Remaining body after the clue grid is `//p` → preset shorthand → the
  bank is the full 12-piece pentomino set, one of each (§2.2/Appendix A).

## 4. Validator (`AnsCheck`) logic

Answer checking runs a fixed **checklist** of functions in order; the first
one that reports a failure (in "stop at first error" mode) determines the
error shown to the user, but a full check (`checkOnly=false`, used for a
final "is this solved?" pass) runs every item and can report several
failures at once. For Pentopia (and shared with `distopia`), the checklist
is (`AnsCheck@pentopia,distopia#1.checklist` combined with the specific
`checkShadeDirExist/Closer/Unequal` overrides that live directly under
`AnsCheck@pentopia`):

1. `checkShadeOnArrow` → `csOnArrow` — a clue cell is shaded (rule 4). Not
   run at all if `pentopia_transparent` is set.
2. `checkBankPiecesAvailable` → `bankGt` — a shaded shape's canonical form
   isn't in the bank in sufficient quantity (i.e. that shape has already
   been "used up").
3. `checkShadeDiagonal` → `shDiag` — two *different* shapes touch
   diagonally (rule 2).
4. `checkShadeDirCloser` → `arDistanceGt` — an un-arrowed direction from a
   clue has a shaded cell at or closer than the arrowed distance.
5. `checkShadeDirUnequal` → `arDistanceNe` — the arrowed directions from a
   clue don't all hit their nearest shaded cell at the same distance.
6. `checkShadeDirExist` → `arNoShade` — an arrowed direction from a clue
   never hits a shaded cell at all.
7. `checkBankPiecesInvalid` → `bankInvalid` — a shaded region's canonical
   shape doesn't match *any* bank piece (regardless of count).

Note what's conspicuously **absent**: unlike `statuepark`/`kissing`/
`pentatouch`, Pentopia's checklist has **no `checkBankPiecesUsed`** — the
puzzle never requires that every bank piece actually appear on the board
(consistent with rule 1, "a shape can be used no more than once", not
"exactly once").

### 4.1 Connected-component / shape detection

Shaded cells are grouped into maximal 4-connected ("rook adjacency")
components by the engine's `AreaShadeGraph`/block-manager machinery
(`board.sblkmgr`). Each component's shape is computed by
`CellList.getBlockShapes()` (`src/puzzle/PieceList.js`): take the
component's bounding box, render it as a 0/1 grid (bounding-box cells not
in the component are `0`), generate the same 8 orientations used for bank
pieces, and keep the lexicographically smallest `<dim>:<bitstring>` as the
canonical key — the exact same algorithm as `BankPiece.canonize`, so shaded
regions and bank pieces are directly comparable by canonical key.

### 4.2 `checkShadeDiagonal` in detail

For every 2×2 window of cells on the board: if exactly two of the four
cells are shaded, and those two are diagonal to each other (not sharing a
row or column), and they belong to **different** shaded components
(`cell.sblk`), it's an error (`shDiag`). Two shaded cells from the *same*
component being diagonal is fine — this is what allows shapes like the
W-pentomino (a staircase) to exist at all.

### 4.3 `getShadeDirs` (arrow-distance measurement) in detail

For every clue cell with `qnum > 0`, and for each of the 4 directions,
walk outward one grid-cell at a time until either the edge of the board is
reached or a shaded cell is found; if found, record the distance in cells.
`checkShadeDirExist` then requires that every *arrowed* direction found a
shaded cell; `checkShadeDirUnequal` requires all arrowed directions found
one at the *same* distance; `checkShadeDirCloser` requires every
*un-arrowed* direction (found or not) to be no closer than that shared
arrowed distance.

> **Note on partial boards.** The three functions above contain extra
> "unknown distance" branches (e.g. `checkShadeDirCloser` skips an
> un-arrowed direction with `dist > 1` when no arrowed direction has found
> a shaded cell yet) that only matter while the player is *mid-solve*, to
> give live feedback without over-flagging an incomplete board. For a
> **complete** candidate solution (every clue's rays have either hit a
> shaded cell or the board edge), the plain rule-3 reading above — arrowed
> directions all tied for nearest, unarrowed directions all strictly
> farther — is exactly equivalent to the reference implementation's
> verdict, and is what a solver's final validity check should implement.

### 4.4 Failcode reference (Pentopia-relevant)

Human-readable text from `src/res/failcode.en.json`:

| code | message |
|---|---|
| `csOnArrow` | A cell with a clue is shaded. |
| `bankGt` | A piece appears too many times on the board. |
| `bankInvalid` | The board contains an invalid piece. |
| `bankLt` | Some pieces are not used on the board. *(defined generically, but never triggered for `pentopia` since `checkBankPiecesUsed` isn't in its checklist)* |
| `shDiag` | Two pieces are diagonally adjacent. |
| `arDistanceGt.pentopia` | There is a shaded cell closer to a clue in an unmarked direction. |
| `arDistanceNe.pentopia` | The shaded cells pointed to by a clue are at different distances. |
| `arNoShade.pentopia` | There is no shaded cell in the direction of an arrow. |

### 4.5 Ground-truth test fixtures

`test/script/pentopia.js` in pzprjs ships one full example board per
failure code above (each as a pzprv3 file string, decodable with the exact
same rules as the URL body — see §3), plus a final example board that is
fully valid (`failcode: null`). These are an excellent source of unit-test
vectors: each failing string differs from a valid partial solve by exactly
the mistake needed to trigger one specific check, so they can be used
directly to validate a from-scratch solver/validator implementation
against the reference engine's behavior.

## 5. Solvability: negative constraints matter as much as the rules themselves

A well-formed Pentopia puzzle should never require the solver to guess and
backtrack — every cell's shaded/unshaded status should be forced by a
chain of rule applications. That forcing comes from two equally important
sources: positive deductions (placing/completing a shape) and **negative
constraints** (ruling cells out). Neither is secondary to the other — a
generator that only reasons about what *must* be shaded, without also
tracking what's thereby *forbidden* from being shaded, will miss most of
the deduction chain and can't guarantee a guess-free solve. These
exclusions are part of the rule set, not an optional add-on layered on
top of it, and should be checked with the same rigor as the rules in §2.

The negative constraints available, all directly from the rules in §2:

1. **No-touch exclusion zone.** Once a shape is (even partially) known or
   deduced, every cell orthogonally *or* diagonally adjacent to it that
   isn't part of that same shape must be unshaded (rule 2). This is the
   single strongest deduction tool — it typically rules out far more
   cells around a shape than the shape itself occupies.
2. **Arrowed-distance exclusion.** For a clue with an arrow in some
   direction, every cell strictly between the clue and the (eventual)
   tied distance must be unshaded — if any of them were shaded, the ray
   would stop short and the arrow would be pointing at the wrong
   distance. This clears a whole line segment at once, not just one cell.
3. **Unarrowed-direction exclusion.** For a clue's *unarrowed* directions,
   no cell may be shaded at or before the arrowed tie distance (rule 3:
   "directions without an arrow must have a shape further away, or not
   have one at all") — another line-segment-wide exclusion.
4. **Clue-cell exclusion.** A clue cell itself can never be shaded (rule
   4, unless the transparent variant is in play) — trivial, but still a
   hard exclusion a solver can rely on immediately.
5. **Bank-exhaustion exclusion.** Once a shape from the bank has been
   placed as many times as it's available (usually once), no *other*
   region on the board may end up matching that same canonical shape —
   ruling out an otherwise-plausible completion of a partially shaded
   region.

A cell gets shaded because it's forced to complete an already partly-known
shape, or because it's the unique remaining candidate for an arrow's
required hit at its tied distance — but reaching either of those points
usually depends on cells having *already* been excluded by constraints
1–5. The two kinds of deduction feed each other in a loop: exclusions
narrow down where a shape can go, which completes shapes, which triggers
more exclusions around them, and so on. A generator that only checks
"does this puzzle have a unique solution" (e.g. via brute-force/
backtracking search) is not sufficient on its own — that guarantees a
unique *answer* but not a guess-free *solve path*. To guarantee the
latter, the generator (or a companion "human-solvability" checker) should
confirm the puzzle can be fully solved by iterating both the positive
shape-completion logic and constraints 1–5 above, together, to a fixed
point, with no branching or backtracking ever required.

## Appendix A: Pentomino / tetromino catalog

Decoded from the default bank presets in `statuepark.js` (`Bank.presets`),
using the `BankPiece` codec from §3.3.

### Pentominoes (preset `p`)

| letter | code | shape |
|---|---|---|
| F | `337k` | `..#`<br>`###`<br>`.#.` |
| I | `15v` | `#`<br>`#`<br>`#`<br>`#`<br>`#` |
| L | `24as` | `.#`<br>`.#`<br>`.#`<br>`##` |
| N | `24bo` | `.#`<br>`.#`<br>`##`<br>`#.` |
| P | `23fg` | `.#`<br>`##`<br>`##` |
| T | `337i` | `..#`<br>`###`<br>`..#` |
| U | `23rg` | `##`<br>`.#`<br>`##` |
| V | `334u` | `..#`<br>`..#`<br>`###` |
| W | `335s` | `..#`<br>`.##`<br>`##.` |
| X | `33bk` | `.#.`<br>`###`<br>`.#.` |
| Y | `24bk` | `.#`<br>`.#`<br>`##`<br>`.#` |
| Z | `337o` | `..#`<br>`###`<br>`#..` |

### Tetrominoes (preset `t`; preset `d` is these ×2)

| letter | code | shape |
|---|---|---|
| I | `14u` | `#`<br>`#`<br>`#`<br>`#` |
| J/L | `23bg` | `.#`<br>`.#`<br>`##` |
| O | `22u` | `##`<br>`##` |
| S/Z | `23f` | `.#`<br>`##`<br>`#.` |
| T | `23eg` | `.#`<br>`##`<br>`.#` |

## Appendix B: Source references

All findings above come from `robx/pzprjs` (MIT license), specifically:

- `src/variety/statuepark.js` — Pentopia rules engine, encode/decode,
  validator (`Cell@pentopia`, `Encode@pentopia,distopia,retroships`,
  `AnsCheck@pentopia,distopia#1`, `AnsCheck@pentopia`,
  `BoardExec@pentopia`, `Bank`/`BankPiece`).
- `src/variety-common/Encode.js` — generic `Number16`, piece-bank, and
  other cell/border codecs shared across puzzle types.
- `src/variety-common/Answer.js` — generic `checkBankPiecesAvailable`/
  `Invalid`/`Used`, connectivity checks.
- `src/puzzle/PieceList.js` — `CellList.getBlockShapes()` (shape
  canonicalization for placed regions).
- `src/puzzle/Encode.js`, `src/puzzle/Answer.js`, `src/pzpr/parser.js` —
  generic URL parsing (`pid/[pflag/]cols/rows/body`) and checklist-runner
  plumbing.
- `src-ui/res/rules.en.yaml` — canonical rules text (quoted in §2).
- `src/res/failcode.en.json` — failure-code message text (quoted in §4.4).
- `test/script/pentopia.js` — validator test fixtures (§4.5).
