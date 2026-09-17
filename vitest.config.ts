import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfig from './tsconfig.json';
import { APP_VERSION } from './apps/desktop/src/app-version';

// Test the same local workspace sources that TypeScript checks.
const alias = Object.fromEntries(
  Object.entries(tsconfig.compilerOptions.paths).map(([name, [path]]) => [
    name,
    fileURLToPath(new URL(path, import.meta.url)),
  ]),
);
export default defineConfig({
  define: { __STATECARRY_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: { alias: { ...alias, '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], fileParallelism: false },
});
