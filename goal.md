# Goal

Build a small, free-to-run web project around the **Pentopia** puzzle:

- **Generator** — creates new Pentopia puzzles (grid + arrow clues + shape
  bank) with a unique solution.
- **Solver** — takes a Pentopia puzzle and finds its solution(s), and can be
  used to verify a generated puzzle is valid/unique or to help/check a
  human player.
- **Player** — a web UI to view and interactively solve a Pentopia puzzle
  (shade cells, place shapes, get validated against the rules).

All three should speak the same puzzle representation, based on the
puz­z.link/pzprjs encoding, so puzzles can be freely exchanged between them,
shared as puz­z.link-style URLs, and opened in the actual puzz.link player.

## Reference material already captured

Before any implementation, the puzzle format itself was researched and
written up in
[`docs/pentopia-puzzlink-format.md`](docs/pentopia-puzzlink-format.md):

- The Pentopia rules, in both the canonical puzz.link wording and a
  solver-friendly restatement.
- The puz­z.link URL/file encoding (board size, arrow-clue grid, shape
  bank, orientation matching), derived from the pzprjs reference
  implementation.
- The reference validator's logic and failure conditions, cross-checked
  against pzprjs's own test fixtures.

This exists so the generator/solver/player can target the real format
directly, and so generated puzzles can be validated against the same rules
puz­z.link itself uses.

## Hosting idea

Since a Pentopia solve/generate search is small (typical grids are around
10x10), the plan is to keep everything client-side — no backend required —
so the whole thing can be hosted as a static site (e.g. GitHub Pages).
Running in the browser means it costs nothing to host, scales to any number
of visitors, and avoids the cold-start/time-limit constraints of a free
serverless backend. This is a direction, not a locked-in decision.

