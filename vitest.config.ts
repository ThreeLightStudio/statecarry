import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import tsconfig from './tsconfig.json';

// Test the same local workspace sources that TypeScript checks.
const alias = Object.fromEntries(
  Object.entries(tsconfig.compilerOptions.paths).map(([name, [path]]) => [
    name,
    fileURLToPath(new URL(path, import.meta.url)),
  ]),
);
export default defineConfig({
  resolve: { alias: { ...alias, '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], fileParallelism: false },
});
