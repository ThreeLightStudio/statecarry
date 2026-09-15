import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');
const turboArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
const taskArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);
const freshIndex = turboArgs.indexOf('--fresh');
const fresh = freshIndex !== -1;
if (fresh) turboArgs.splice(freshIndex, 1);

if (turboArgs.length === 0) {
  throw new Error('run-turbo requires at least one Turbo task');
}

function commandVersion(command: string, commandArgs: string[]) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to read ${command} version for the Turbo cache key`);
  }
  return `${result.stdout}${result.stderr}`.trim();
}

const runtime = JSON.stringify({
  platform: process.platform,
  osRelease: release(),
  arch: process.arch,
  node: process.version,
  pnpm: commandVersion('pnpm', ['--version']),
  rtk: commandVersion('rtk', ['--version']),
  git: commandVersion('git', ['--version']),
});

const viteEnvironmentFiles = [
  'apps/web/.env',
  'apps/web/.env.local',
  'apps/web/.env.production',
  'apps/web/.env.production.local',
];
const hasLocalViteEnvironment = viteEnvironmentFiles.some((file) => existsSync(file));

const cache = hasLocalViteEnvironment ? 'local:' : fresh ? 'local:w' : 'local:rw';
const commandArgs = ['exec', 'turbo', 'run', ...turboArgs, `--cache=${cache}`, '--env-mode=strict'];
if (taskArgs.length > 0) commandArgs.push('--', ...taskArgs);

const result = spawnSync('pnpm', commandArgs, {
  stdio: 'inherit',
  env: { ...process.env, STATECARRY_TURBO_RUNTIME: runtime },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
