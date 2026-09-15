import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
  build: { outDir: resolve(import.meta.dirname, '../../dist/web'), emptyOutDir: true },
});
