import { build as bundle } from 'esbuild';
import { build as web } from 'vite';
import { createRequire } from 'node:module';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Build only current entry points; old diagnostic bundles must not enter a release.
await rm('dist', { recursive: true, force: true });
await bundle({
  entryPoints: ['apps/server/src/index.ts', 'scripts/verify-connection.ts'],
  entryNames: '[name]',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
// Keep the single documented production entry point independent of source paths.
await rename('dist/index.mjs', 'dist/server.mjs');
await web({ configFile: 'apps/web/vite.config.ts' });
const require = createRequire(import.meta.url);
const versions = Object.fromEntries(
  ['typescript', 'tsx', 'esbuild', 'vite', 'vitest', 'react', 'react-dom', 'zod'].map((name) => {
    const resolver =
      name === 'zod'
        ? createRequire(new URL('../packages/contracts/package.json', import.meta.url))
        : name === 'react' || name === 'react-dom'
          ? createRequire(new URL('../apps/web/package.json', import.meta.url))
          : require;
    return [name, resolver(`${name}/package.json`).version];
  }),
);
const lockfileHash = createHash('sha256')
  .update(await readFile('pnpm-lock.yaml'))
  .digest('hex');
await writeFile(
  'dist/build-info.json',
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      node: process.version,
      method: 'pnpm build: esbuild server + Vite web',
      versions,
      lockfileHash,
    },
    null,
    2,
  ) + '\n',
);
