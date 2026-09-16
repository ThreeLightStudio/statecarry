import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  build: { outDir: resolve(import.meta.dirname, '../../dist/landing'), emptyOutDir: true },
});
