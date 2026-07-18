import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.prop.test.ts'],
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@solver': resolve(__dirname, 'src/solver'),
      '@generator': resolve(__dirname, 'src/generator'),
    },
  },
});
