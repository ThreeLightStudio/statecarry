import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', 'apps/web/vite.config.ts'], {
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`StateCarry web build failed with exit code ${result.status}`);
