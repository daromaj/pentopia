import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/pentopia/',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@solver': resolve(__dirname, 'src/solver'),
      '@generator': resolve(__dirname, 'src/generator'),
    },
  },
});
