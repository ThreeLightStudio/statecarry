import { spawn } from 'node:child_process';
const grouped = process.platform !== 'win32';
const children = [
  spawn('rtk', ['pnpm', 'exec', 'tsx', 'apps/server/src/index.ts'], { stdio: 'inherit', detached: grouped }),
  spawn('rtk', ['pnpm', 'exec', 'vite', '--config', 'apps/web/vite.config.ts'], { stdio: 'inherit', detached: grouped }),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  for (const child of children) {
    if (!child.pid) continue;
    try { if (grouped) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error); }
  }
};
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
