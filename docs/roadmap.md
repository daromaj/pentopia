# Pentopia — Implementation Roadmap

The plan for building the generator, solver, and player described in
[`goal.md`](../goal.md), targeting the puzz.link format documented in
[`pentopia-puzzlink-format.md`](pentopia-puzzlink-format.md) (referenced
below by section, e.g. "format §3.2").

Each task carries an **owner assignment**: *Fable* (the lead agent — owns
the overall vision, designs the cross-module contracts, writes subagent
briefs, and reviews every diff before merge) or a delegated subagent tier
(*Opus* for hard reasoning, *Sonnet* for most implementation, *Haiku* for
mechanical work).

## 1. Architecture & repo layout

Strict dependency DAG, no cycles:

```
ui ──▶ generator ──▶ solver ──▶ core
cli ──▶ generator / solver / core
core depends on nothing.
```

- **core** — pure, side-effect-free domain library: data model, shape
  canonicalization, puzz.link codec, validator. Runs identically in
  browser and Node. Zero DOM, zero I/O.
- **solver** — two solvers over one shared constraint model: a *complete
  search* solver (uniqueness proof) and a *deduction engine* (guess-free
  human solvability). Depends only on core.
- **generator** — places shapes, derives clues, minimizes. Depends on
  solver + core.
- **ui** — SVG rendering + interaction + URL import/export. Depends on
  everything.
- **cli** — thin Node entry points for batch generation/solving.

Single package with TS path aliases — no monorepo overhead:

```
pentopia/
  package.json            # type: module; scripts: dev, build, test, gen, solve
  tsconfig.json           # strict: true; paths: @core/* @solver/* @generator/*
  vite.config.ts          # base: '/pentopia/' for GitHub Pages
  vitest.config.ts
  index.html
  src/
    core/
      types.ts            # Puzzle, Solution, Bank, BankPiece, Dir, ClueValue, FailCode
      grid.ts             # idx(x,y), directions, ray-walk, king/rook neighbor helpers
      shape.ts            # orientations(), canonicalKey(), pentomino catalog (format App. A)
      bank.ts             # presets p/t/d/z, BankPiece (de)serialize, canonical compare
      codec/
        number16.ts       # readNumber16 / writeNumber16 (format §3.2)
        pieceBank.ts      # decode/encode piece bank (format §3.3)
        url.ts            # decodeUrl / encodeUrl (format §3.1 envelope)
        pzprv3.ts         # minimal pzprv3 file reader (fixtures — see Risks)
      validator.ts        # 7-item checklist (format §4)
      index.ts
    solver/
      board.ts            # BitBoard (Uint32Array): shaded/excluded planes, dir-shifts
      model.ts            # cell states, precomputed placement lists
      propagate.ts        # the §5 constraint loop → fixed point (SHARED, see below)
      search.ts           # placement-branching DFS, enumerate-all, early-exit at 2
      deduce.ts           # human-style: propagate only, emits ranked step log
      index.ts
    generator/
      place.ts            # random separated shape layout → answer shading
      clues.ts            # deriveClues(shading) → maximal arrow-bitmask grid
      minimize.ts         # greedy clue reduction, gated on unique AND guess-free
      generate.ts         # orchestration, seedable RNG, difficulty knobs
      worker.ts           # Web Worker wrapper (browser)
      index.ts
    ui/
      app.ts
      render.ts           # SVG grid + arrows + bank panel
      interaction.ts      # click/drag shade, keyboard, undo stack
      urlbar.ts           # import/export, deep-link ?p=
      styles.css
    cli/
      solve.ts            # node/tsx entry
      generate.ts
  test/
    fixtures/pentopia.ts  # vendored pzprjs strings + expected failcodes (MIT attrib)
    shape.test.ts  codec.test.ts  validator.test.ts
    solver.test.ts  deduce.test.ts  generator.test.ts
    roundtrip.prop.test.ts  # fast-check property tests
  docs/                   # this file + the format reference
  .github/workflows/      # ci.yml (tests), deploy.yml (Pages)
```

**Load-bearing rule:** `shape.ts` holds the *one* implementation of the
8-orientation canonicalization (format §3.3/§4.1), reused by the bank
codec, validator, solver, and generator — so a placed region and a bank
piece are always compared by the identical code path.

## 2. Tech stack

| Choice | Justification |
|---|---|
| **TypeScript (strict)** | Same typed core runs in browser and Node — solver/validator/codec need zero duplication for CLI + tests. |
| **Vite** | Zero-config static build → drops straight onto GitHub Pages; dev server for the UI. |
| **Vitest** | Shares Vite's config; runs the pure core in Node; fast watch mode. |
| **Plain DOM + SVG** | The board is ~100 cells + arrows + a 12-tile bank; state is a single shading array. A framework adds bundle weight for nothing. Reconsider only if the UI grows multiple linked panels. |
| **fast-check** (dev) | Property testing: codec round-trips, canonicalization invariance, solver/validator agreement. |
| **Web Worker** | The generator's minimize loop is CPU-bound; keep it off the main thread. |
| **tsx** (dev) | Run `cli/*.ts` in Node without a separate build. |

Target: **zero runtime dependencies** in the shipped bundle.

## 3. Phased milestones

Ordering is deliberate: each phase is validated against ground truth
before the next depends on it. One structural rule up front: **the §5
constraint propagators are built first (Phase 3) and shared** — the
complete solver consumes them as CP propagation, the human deducer runs
them without search. One constraint implementation, two search policies;
otherwise the "unique?" and "human-solvable?" gates can silently disagree.

### Phase 0 — Scaffold — *Haiku, Fable reviews*
Vite + TS strict + Vitest + ESLint/Prettier, empty app shell, CI test
workflow.
**AC:** `npm run dev`, `npm test`, `npm run build` all green; CI runs
tests on push.

### Phase 1a — Vendor fixtures — *Haiku*
Fetch `test/script/pentopia.js` from `robx/pzprjs` (MIT), vendor the
boards (one per failcode + one valid) into `test/fixtures/pentopia.ts`
with attribution. Confirm the exact string shape (pzprv3 file vs URL
body) — this de-risks Phase 2 (see Risks #1).
**AC:** fixtures committed with license note; string format documented.

### Phase 1b — Core model + codec + canonicalization — *Sonnet implements; Fable designs `types.ts` contracts first*
`types.ts`, `grid.ts`, `shape.ts`, `bank.ts`, `codec/*`.
- `orientations(cells)` → up to 8 dihedral variants (deduped for
  symmetric shapes); `canonicalKey(cells)` → lexicographically smallest
  `<dim>:<bitstring>` (format §3.3/§4.1).
- `decodeUrl`/`encodeUrl` over `number16` + `pieceBank`.

**AC:**
- Decoding `pentopia/10/10/2s9ziar5gbi6z6hai9s4//p` reproduces the exact
  10-clue table in format §3.4 (golden test).
- Every Appendix-A catalog code decodes to its listed grid; every
  letter's `canonicalKey` is invariant under all 8 transforms.
- `encode(decode(body)) === body` on canonical fixtures; property test
  `decode(encode(p)) ≈ p` on random puzzles.
- Presets `//p` `//t` `//d` `//z` round-trip; a custom bank with
  off-preset counts emits the explicit `/count/...` form.

### Phase 2 — Validator — *Sonnet*
`validator.ts`: the 7-item checklist (format §4) in order, returning
`{ok, failures: [{code, cell}]}`. 4-connected flood fill →
`canonicalKey`; `checkShadeDiagonal` via the 2×2-window test (§4.2);
`getShadeDirs` ray walk (§4.3). Implement the **complete-board** reading
(§4.3 note), not the mid-solve UI branches.

**AC:**
- Each vendored fixture returns exactly its documented failcode; the
  valid board returns none.
- Per-check unit tests: a W-pentomino's internal diagonal is *not*
  flagged (`shDiag` only fires cross-component); `bankGt` vs
  `bankInvalid` distinguished; arrow tie/closer/no-shade each isolated.

### Phase 3 — Propagators + complete solver — *Opus; Fable reviews closely*
`board.ts`, `model.ts`, `propagate.ts`, `search.ts`. Design details in
§4 below. Enumerates **all** solutions with early-exit once a second is
found.

**AC:**
- The §3.4 sample solves to a single solution that `validate()` accepts.
- A hand-built ambiguous puzzle reports ≥2 solutions.
- Property test: every enumerated solution passes the validator; a
  brute-force cell-enumeration reference (tiny grids) finds the
  identical solution set.
- 10×10 / 12-pentomino solve < ~200 ms typical.

### Phase 4 — Deduction engine — *Opus*
`deduce.ts`: runs the shared propagators to a fixed point with zero
branching; emits a step log with each deduction's rule + difficulty rank.

**AC:**
- Soundness property: forced cells are always a subset of the unique
  solution (never contradicts the complete solver).
- One targeted micro-puzzle test per §5 exclusion (no-touch halo,
  arrowed-distance, unarrowed-direction, clue-cell, bank-exhaustion),
  each solvable only via that constraint.
- On Phase-5 generator output, `deduce()` resolves every cell.

### Phase 5 — Generator — *Opus (minimize/difficulty/orchestration) + Sonnet (place.ts, clues.ts)*
Design details in §5 below.

**AC:**
- Every output: validates, is uniquely solvable (complete solver), is
  human-solvable (`deduce()` completes), round-trips through the URL
  codec, and re-decoding→solving returns the generator's own answer.
- Seedable/reproducible; 6×6 near-instant, 10×10 within the §5 envelope.
- Difficulty knob measurably shifts clue count / deduction-tier
  distribution.
- 500-seed batch check on small boards in CI.

### Phase 6 — Player UI — *Sonnet; screenshot verification fanned out to subagents, Fable reviews*
`render.ts`, `interaction.ts`, `urlbar.ts`: SVG grid, arrow glyphs, bank
panel with used/remaining counts, drag-to-shade, undo, live validation
surfacing failcodes, URL import/export.

**AC:**
- Loads the sample from a `?p=` deep link; renders clues + bank
  correctly.
- Shading updates live validation; completing the answer shows "solved".
- Exported URL reopens identically **and** opens in the real puzz.link
  player (manual cross-check).

### Phase 7 — GitHub Pages deploy — *Haiku*
`.github/workflows/deploy.yml`: build → upload artifact →
`actions/deploy-pages`.
**AC:** push to `main` publishes; live URL loads; a deep-linked puzzle
opens.

## 4. Solver design

**Board representation — `BitBoard`.** Grids up to ~12×12 (144 cells) →
`Uint32Array` of `ceil(w*h/32)` words. Three planes: `shaded`,
`excluded` (proven-unshaded), derived `unknown`. Helpers: set/clear/test,
popcount, `orAssign`, `andNot`, and directional whole-board shifts with
edge masks — the king-move halo becomes one expression:
`halo = shift8(shaded) & ~shaded`.

**Precomputed placements (once per puzzle).** For each bank piece, each
orientation (from `shape.ts` — the same canonicalization path as the
validator), each position: a `cells` bitmask + `halo` bitmask. Discard
any placement covering a clue cell (rule 4). For 10×10 the 12 free
pentominoes have 63 distinct orientations → on the order of
**~1,500–2,000 candidate placements**. Cheap to store.

**Search.** Branch over *placements*, not cells — each branch commits 5
cells plus its exclusion halo, far more information per node than
shading one cell (2^100 unpruned).

- At each node, run the propagators to a fixed point first; branch only
  if unknowns remain.
- **Anchor selection (MRV):** branch on the arrow clue whose required
  nearest-hit has the fewest surviving candidate placements.
- On placing: `shaded |= cells`, `excluded |= halo`, decrement the
  canonical key's bank count; at 0, activate the bank-exhaustion
  propagator (§5 exclusion 5).
- **Prune** on any propagator contradiction: an arrowed direction that
  can no longer reach a shaded cell at the tie distance; an unarrowed
  direction forced closer-or-equal; a component that can't canonicalize
  to any remaining bank piece.
- Collect solutions; early-exit at 2 (uniqueness is a yes/no).

**Why not SAT or exact-cover:** DLX assumes every element is covered,
but Pentopia uses *some* pieces and leaves most cells blank. SAT needs
awkward auxiliary distance/ordering encodings for "arrowed directions
tied for nearest, unarrowed strictly farther" and makes all-solutions
enumeration clumsy. Placement-branching + the §5 propagators as CP
propagation is complete, dependency-free, and shares its constraint code
with the human deducer.

## 5. Generator design

Uniqueness and guess-free solvability are enforced **separately** — the
format doc's §5 is emphatic that uniqueness alone is insufficient.

1. **Random separated layout → answer.** Seedable RNG. Repeatedly pick
   an unused pentomino, random orientation + position; accept iff no
   overlap or king-touch with placed shapes (reuse halo masks). Target a
   density band (~20–35% of cells; piece count scales with board size);
   bounded retries if wedged.
2. **Derive maximal clues.** For every empty cell, compute the arrow
   bitmask it would legitimately carry against the answer: the set of
   directions tied for nearest shaded cell (rule 3). The fullest legal
   clue set — trivially valid.
3. **Minimize (greedy, both gates).** Shuffle clue cells; for each,
   tentatively remove its clue and keep the removal only if the puzzle
   remains (a) uniquely solvable (complete solver, early-exit 2) **and**
   (b) human-solvable (`deduce()` resolves all cells). Because
   `deduce()` is sound, completing implies reaching the unique answer.
4. **Difficulty levers:** stop minimizing early (easier) vs push to
   locally minimal (harder); cap/floor the deduction tiers appearing in
   the step log; density and awkward-piece mix (F, W, Z, X).
5. **Performance envelope.** Minimize calls solver + deducer ~O(#clue
   cells) times, each a few ms → 6×6 effectively instant, **10×10
   sub-second to a few seconds** in-browser. Run in a Web Worker with a
   time budget; CLI batch generation in Node has no time pressure
   (pre-bake a puzzle library if desired).

## 6. Testing strategy

- **pzprjs fixtures = ground truth.** One board per failcode + one valid
  board; the validator must reproduce each exactly.
- **Property tests (fast-check):** codec round-trips both directions;
  `canonicalKey` invariant under all 8 dihedral transforms of random
  polyominoes; every solver solution passes `validate()`; `deduce()`
  forced cells ⊆ the unique solution; tiny-grid brute force vs solver
  identical solution sets.
- **Generated-puzzle cross-check:** every output validates, is unique,
  is human-solvable, survives a URL round-trip; 500-seed CI batch.
- **Golden:** the sample URL → the format §3.4 clue table.

## 7. Risks / open questions

1. **Fixtures are pzprv3 file format, not `p?` URLs** (format §4.5).
   Either a minimal `codec/pzprv3.ts` reader or a one-time hand
   conversion of the ~8 fixtures. Resolve in Phase 1a before committing
   to an approach.
2. **Vendoring legality.** pzprjs is MIT — fixture strings are fine with
   attribution; no larger source copy needed.
3. **Generator perf in browser.** Worker + time budget + seeds; worst
   case degrade to smaller boards or a pre-baked library. Validate the
   10×10 envelope empirically in Phase 5.
4. **BitBoard: `Uint32Array` vs `BigInt`.** Start with `Uint32Array`
   (faster, GC-friendly); switch only if the shift/mask code proves
   error-prone.
5. **Unknown tie-distance mid-solve.** Propagators must treat each
   clue's tie distance as a bounded variable while solving, but the
   final check uses the clean complete-board rule (format §4.3 note).
   Getting this wrong makes the deducer over- or under-constrain.
6. **Hatena clues (`-2`).** Never emitted by the generator;
   validator/solver reject them explicitly rather than crash.
7. **Scope creep guard.** Keep codec/orientation/bank machinery general
   (arbitrary banks, transparent flag, other presets) since the format
   demands it — but build **no** solver/generator support for variants
   in v1.
