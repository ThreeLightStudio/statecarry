import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const output = resolve(process.cwd(), '.cache/electrobun/web');
const result = spawnSync(
  'pnpm',
  ['exec', 'vite', 'build', '--config', 'apps/web/vite.config.ts', '--outDir', output],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`StateCarry web build failed with exit code ${result.status}`);
