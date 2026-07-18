# Pentopia

A project to build a generator, solver, and player for the
[Pentopia](https://puzz.link/rules.html?pentopia) pencil puzzle, compatible
with the [puzz.link](https://puzz.link) puzzle format.

See [`goal.md`](goal.md) for the high-level idea and current direction.

## Status

All roadmap phases implemented: core library (puzz.link codec, shape
canonicalization, validator), complete solver + human-style deduction
engine, puzzle generator with difficulty control, and the web player UI
(plain SVG, client-side only). Deployed to GitHub Pages on push to main.

Quick start:

```sh
npm install
npm run dev                                    # player UI
npm test                                       # full suite
npm run gen -- --cols 8 --rows 8 --seed 1 --difficulty medium
npm run solve -- "https://puzz.link/p?pentopia/10/10/2s9ziar5gbi6z6hai9s4//p"
```

## Docs

- [`docs/pentopia-puzzlink-format.md`](docs/pentopia-puzzlink-format.md) —
  Pentopia's rules, the puzz.link URL/file encoding format, and the
  reference validator logic, reverse-engineered from the
  [pzprjs](https://github.com/robx/pzprjs) reference implementation.
- [`docs/roadmap.md`](docs/roadmap.md) — the implementation roadmap:
  architecture, tech stack, phased milestones with acceptance criteria
  and per-task owner assignments, solver/generator design, testing
  strategy, and risks.
