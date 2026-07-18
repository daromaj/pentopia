import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/pentopia/',
  build: {
    rollupOptions: {
      // Two pages: the player, and the static OG-tag landing page that
      // challenge share links point at (see challenge.html).
      input: {
        main: resolve(__dirname, 'index.html'),
        challenge: resolve(__dirname, 'challenge.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@solver': resolve(__dirname, 'src/solver'),
      '@generator': resolve(__dirname, 'src/generator'),
    },
  },
});
