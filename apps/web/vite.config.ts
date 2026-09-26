import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { APP_VERSION } from '../../app-version';
import { developmentPort, DEVELOPMENT_WEB_PORT } from '../../runtime-config';
export default defineConfig(({ command }) => ({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  define: {
    __STATECARRY_VERSION__: JSON.stringify(APP_VERSION),
    __STATECARRY_DEVELOPER_CONTROLS__: JSON.stringify(
      command === 'serve' || process.env.STATECARRY_DESKTOP_ENV === 'dev',
    ),
  },
  server:
    command === 'serve'
      ? {
          host: '127.0.0.1',
          port: DEVELOPMENT_WEB_PORT,
          strictPort: true,
          proxy: {
            '/api': { target: `http://127.0.0.1:${developmentPort()}`, changeOrigin: true },
          },
        }
      : undefined,
  build: {
    outDir: resolve(import.meta.dirname, '../../dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/')) return 'vendor';
        },
      },
      onwarn(warning, warn) {
        // zod's explanatory comments mention `@__PURE__` in their text; Rollup flags
        // their position as unreadable and strips them. Harmless until upstream fixes it.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules/zod/')) {
          return;
        }
        warn(warning);
      },
    },
  },
}));
