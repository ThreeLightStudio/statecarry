import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { StateCarry } from '@statecarry/core';
import { BackgroundLoop } from './background';
import { CodexReader } from './adapters/codex-reader';
import { CodexSummary } from './adapters/codex-summary';
import { identity } from './adapters/identity';
import { MacLocalFolderPicker, type LocalFolderPicker } from './adapters/local-folder-picker';
import type { LocalUpdater } from './adapters/local-updater';
import { CodexNavigator } from './adapters/navigator';
import { observationLog } from './adapters/observation-log';
import { GitProjectInspector } from './adapters/project-inspector';
import { UnsupportedSessionExecutor } from './adapters/session-executor';
import { settingsFromEnvironment } from './adapters/summary-settings';
import { SQLiteRepository } from './adapters/sqlite';
import { ChangeEvents, createHttpServer } from './http';

const DEFAULT_PORT = 4310;
const HOST = '127.0.0.1';

export type ServerRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dataDir?: string;
  port?: number;
  webDir?: string;
  folderPicker?: LocalFolderPicker;
  updater?: LocalUpdater;
  reportBackgroundError?: (error: unknown) => void;
  onServerError?: (error: Error) => void;
};

export type ServerRuntime = ReturnType<typeof createServerRuntime>;

function runtimePort(value: number | string | undefined): number {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid STATECARRY_PORT');
  return port;
}

export function createServerRuntime(options: ServerRuntimeOptions = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataDir = resolve(options.dataDir ?? env.STATECARRY_DATA_DIR ?? `${homedir()}/.statecarry`);
  const port = runtimePort(options.port ?? env.STATECARRY_PORT);
  const webDir = resolve(cwd, options.webDir ?? 'dist/web');
  const repo = new SQLiteRepository(dataDir);
  const events = new ChangeEvents(observationLog(dataDir));
  const core = new StateCarry(
    repo,
    new CodexReader(),
    new CodexSummary(dataDir, settingsFromEnvironment(env)),
    new CodexNavigator(dataDir),
    { now: () => new Date().toISOString() },
    identity,
    events,
    new UnsupportedSessionExecutor(),
    new GitProjectInspector(),
  );
  const server = createHttpServer(core, events, webDir, port, {
    folderPicker: options.folderPicker ?? new MacLocalFolderPicker(),
    updater: options.updater,
  });
  const background = new BackgroundLoop(
    core,
    options.reportBackgroundError ?? console.error,
    env.STATECARRY_LEGACY_ANALYSIS !== '1',
  );
  let timer: ReturnType<typeof setInterval> | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped = false;

  const closeServer = async () => {
    if (!server.listening) {
      server.closeAllConnections();
      return;
    }
    const closed = new Promise<void>((resolveClosed, rejectClosed) => {
      server.close((error) => {
        if (error) rejectClosed(error);
        else resolveClosed();
      });
    });
    server.closeAllConnections();
    await closed;
  };

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      server.off('error', handleServerError);
      let failure: unknown = null;
      try {
        await closeServer();
      } catch (error) {
        failure = error;
      }
      try {
        await core.close();
      } catch (error) {
        failure ??= error;
      }
      try {
        repo.close();
      } catch (error) {
        failure ??= error;
      }
      if (failure) throw failure;
    })();
    return stopPromise;
  };

  const handleServerError = (error: Error) => {
    options.onServerError?.(error);
    void stop().catch((stopError) => {
      options.onServerError?.(
        stopError instanceof Error ? stopError : new Error(String(stopError)),
      );
    });
  };

  const start = () => {
    if (stopped) return Promise.reject(new Error('StateCarry server runtime has already stopped'));
    if (server.listening) return Promise.resolve();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        await core.recover();
        if (stopped) return;
        await new Promise<void>((resolveListening, rejectListening) => {
          const failed = (error: Error) => {
            server.off('listening', listening);
            rejectListening(error);
          };
          const listening = () => {
            server.off('error', failed);
            resolveListening();
          };
          server.once('error', failed);
          server.once('listening', listening);
          server.listen(port, HOST);
        });
        if (stopped) return;
        server.on('error', handleServerError);
        background.tick();
        timer = setInterval(() => {
          background.tick();
        }, 1000);
      } catch (error) {
        const runtimeError = error instanceof Error ? error : new Error(String(error));
        options.onServerError?.(runtimeError);
        await stop();
        throw error;
      }
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  };

  return { dataDir, host: HOST, port, webDir, repo, events, core, server, start, stop };
}
