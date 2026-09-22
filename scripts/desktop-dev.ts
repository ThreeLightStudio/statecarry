import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { developmentPort } from '../runtime-config';

const projectRoot = realpathSync(process.cwd());
const serverPort = String(developmentPort());

type ProcessRow = { pid: number; ppid: number; command: string };

function output(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function processes(): ProcessRow[] {
  return output('ps', ['-axo', 'pid=,ppid=,command='])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return [];
      return [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }];
    });
}

function cwd(pid: number): string | null {
  const value = output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  if (!value) return null;
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

function listeningPids(port: string): number[] {
  return output('lsof', ['-n', '-P', '-tiTCP:' + port, '-sTCP:LISTEN'])
    .split('\n')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminate(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function stopStaleWatchers() {
  const rows = processes();
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const stale = rows.filter(
    (row) =>
      row.command.includes('hutch-engine') &&
      row.command.includes('electrobun dev --env=dev --watch') &&
      cwd(row.pid) === projectRoot,
  );
  if (!stale.length) return;

  const targets = new Set<number>();
  for (const watcher of stale) {
    targets.add(watcher.pid);
    const parent = byPid.get(watcher.ppid);
    if (
      parent &&
      parent.command.includes('electrobun') &&
      parent.command.includes('dev --env=dev --watch') &&
      cwd(parent.pid) === projectRoot
    )
      targets.add(parent.pid);
  }

  console.log('StateCarry: cleaning up a stale Electrobun dev watcher.');
  for (const pid of [...targets].reverse()) terminate(pid, 'SIGTERM');

  const deadline = Date.now() + 1500;
  while ([...targets].some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));

  for (const pid of targets) if (alive(pid)) terminate(pid, 'SIGKILL');
}

const listeners = listeningPids(serverPort);
if (listeners.length) {
  console.error(
    'Cannot start StateCarry Dev: port is already in use at 127.0.0.1:' +
      serverPort +
      ' (PID ' +
      listeners.join(', ') +
      ').',
  );
  process.exit(1);
}

await stopStaleWatchers();

const child = spawn('electrobun', ['dev', '--env=dev', '--watch'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    STATECARRY_DESKTOP_ENV: 'dev',
    // Electrobun forwards child output through pipes; preserve terminal color support.
    ...(process.stderr.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
      ? { FORCE_COLOR: process.env.FORCE_COLOR ?? '1' }
      : {}),
  },
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1;
    return;
  }
  process.exitCode = code ?? 1;
});
