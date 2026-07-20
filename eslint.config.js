import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // node_modules/dist/.vite: build output and deps, never linted.
    // test/fixtures/pentopia.pzprjs.js: a verbatim vendor copy of pzprjs
    // test data (references pzprjs's own `ui` global) — not our source.
    // public/sw.js: hand-written service worker, plain JS running in the
    // service worker global scope (self/caches/clients), not our TS graph.
    ignores: ['node_modules', 'dist', '.vite', 'test/fixtures/pentopia.pzprjs.js', 'public/sw.js'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      // Core/solver/generator run in both Node (tests, CLI) and the
      // browser (UI); rather than partition globals per subtree, allow
      // both everywhere the project's own tsconfig `lib` already spans
      // ("ES2022", "DOM") plus Node's __dirname/process for config files.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
];
