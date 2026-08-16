# Pentopia

A generator, solver, and player for the
[Pentopia](https://puzz.link/rules.html?pentopia) pencil puzzle, fully
compatible with the [puzz.link](https://puzz.link) puzzle format. Runs
entirely in the browser — no backend, free to host.

See [`goal.md`](goal.md) for the original idea and direction.

## Play it

**Live player:** <https://daromaj.github.io/pentopia/>

- **Generate** puzzles in the browser (6×6–10×10; easy / medium / hard /
  expert). Every generated puzzle is verified to have a **unique** solution
  reachable **without guessing**.
- **Hints** (learning mode): the deduction engine highlights the next
  logically forced cell and explains *why* — errors are pointed out first.
- **Check** validates your board with the same rules puzz.link uses and
  highlights the offending cells.
- **Favorites & resume**: star puzzles, and the app reopens your last
  puzzle exactly as you left it (stored locally). Each favorite has a PR
  button that pre-fills a GitHub commit adding it to [`puzzles/`](puzzles/).
- **Installable**: on Android, Chrome menu → *Add to Home screen* runs it
  fullscreen as an app (network still required — no offline cache yet).

Puzzles deep-link via `?p=` (or a hash) using puzz.link's own encoding, so
any Pentopia URL works in both players:

- The 10×10 sample:
  [`?p=pentopia/10/10/2s9ziar5gbi6z6hai9s4//p`](https://daromaj.github.io/pentopia/?p=pentopia/10/10/2s9ziar5gbi6z6hai9s4//p)
- The same puzzle on puzz.link:
  [`puzz.link/p?pentopia/10/10/...`](https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p)

## How it works

- **Core** (`src/core/`): the puzz.link URL codec, shape canonicalization,
  and the 7-check answer validator — tested against pzprjs's own fixtures
  (one board per failure code, vendored with MIT attribution).
- **Solver** (`src/solver/`): one shared constraint engine (arrow
  tie-distance intervals, no-touch halos, cover analysis, clue-candidate
  "reservation" reasoning, bounded what-if probing to depth 2) drives two
  consumers — a complete backtracking solver that enumerates all solutions
  to prove uniqueness, and a human-style deducer that solves by pure
  inference and logs each step with a difficulty tier (that log powers the
  Hint button). Published puzzles up to 15×11 deduce guess-free.
- **Generator** (`src/generator/`): seeded random shape layout → maximal
  arrow clues → greedy clue minimization, where every removal must keep
  the puzzle both unique (complete solver) *and* human-solvable (deducer)
  within the requested difficulty tier. Expert difficulty additionally
  demands a measured amount of what-if reasoning.
- **Player** (`src/ui/`): plain DOM + SVG, no framework, full-viewport
  layout, light/dark themes, zero runtime dependencies.

## Development

```sh
npm install
npm run dev                                    # player UI at localhost:5173
npm test                                       # full suite (~170 tests)
npm run gen -- --cols 8 --rows 8 --seed 1 --difficulty expert
npm run solve -- "https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p"
npm run penpa -- "https://swaroopg92.github.io/penpa-edit/#m=solve&p=..."
```

`npm run penpa` imports a Pentopia puzzle drawn in
[penpa-edit](https://swaroopg92.github.io/penpa-edit/) (its fragment is
base64 + raw-deflate; the arrow clues live in the `arrow_cross` symbol
layer) and prints the equivalent puzz.link string plus ready-to-open
player links. Quote the URL — it contains `&` and `#`.

CI runs tests + build on every push; pushes to `main` deploy to GitHub
Pages automatically.

## Docs

- [`docs/pentopia-puzzlink-format.md`](docs/pentopia-puzzlink-format.md) —
  Pentopia's rules, the puzz.link URL/file encoding format, and the
  reference validator logic, reverse-engineered from the
  [pzprjs](https://github.com/robx/pzprjs) reference implementation.
- [`docs/roadmap.md`](docs/roadmap.md) — the implementation roadmap:
  architecture, tech stack, phased milestones with acceptance criteria
  and per-task owner assignments, solver/generator design, testing
  strategy, and risks.
