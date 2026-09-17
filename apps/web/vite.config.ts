import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { APP_VERSION } from '../desktop/src/app-version';
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  define: { __STATECARRY_VERSION__: JSON.stringify(APP_VERSION) },
  server: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4310' },
  },
  build: { outDir: resolve(import.meta.dirname, '../../dist/web'), emptyOutDir: true },
});
