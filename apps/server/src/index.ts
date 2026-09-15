import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { StateCarry } from '@statecarry/core';
import { SQLiteRepository } from './adapters/sqlite';
import { CodexReader } from './adapters/codex-reader';
import { CodexSummary } from './adapters/codex-summary';
import { CodexNavigator } from './adapters/navigator';
import { identity } from './adapters/identity';
import { ChangeEvents, createHttpServer } from './http';
import { BackgroundLoop } from './background';
import { settingsFromEnvironment } from './adapters/summary-settings';
import { observationLog } from './adapters/observation-log';
import { GitProjectInspector } from './adapters/project-inspector';
import { UnsupportedSessionExecutor } from './adapters/session-executor';

const dataDir = resolve(process.env.STATECARRY_DATA_DIR ?? `${homedir()}/.statecarry`);
const port = Number(process.env.STATECARRY_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid STATECARRY_PORT');
const repo = new SQLiteRepository(dataDir),
  events = new ChangeEvents(observationLog(dataDir));
const core = new StateCarry(
  repo,
  new CodexReader(),
  new CodexSummary(dataDir, settingsFromEnvironment(process.env)),
  new CodexNavigator(dataDir),
  { now: () => new Date().toISOString() },
  identity,
  events,
  new UnsupportedSessionExecutor(),
  new GitProjectInspector(),
);
const server = createHttpServer(core, events, resolve(process.cwd(), 'dist/web'), port);
await core.recover();
const background = new BackgroundLoop(
  core,
  console.error,
  process.env.STATECARRY_LEGACY_ANALYSIS !== '1',
);
server.on('error', async (e) => {
  clearInterval(timer);
  console.error(e);
  await core.close();
  repo.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`StateCarry http://127.0.0.1:${port} | Node ${process.version} | ${dataDir}`);
  background.tick();
});
const timer = setInterval(() => {
  background.tick();
}, 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
  server.closeAllConnections();
  await core.close();
  repo.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
