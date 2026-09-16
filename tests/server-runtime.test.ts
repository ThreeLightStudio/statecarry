import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { request, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerRuntime } from '../apps/server/src/runtime';

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No probe address');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function temporaryDataDir() {
  return mkdtempSync(join(tmpdir(), 'statecarry-runtime-'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('server runtime lifecycle', () => {
  it('recovers before listening and releases the HTTP server, Core, and SQLite writer lock on stop', async () => {
    const dataDir = temporaryDataDir();
    const port = await freePort();
    const runtime = createServerRuntime({ dataDir, port });
    let finishRecovery!: () => void;
    const recover = vi.spyOn(runtime.core, 'recover').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRecovery = resolve;
        }),
    );
    const closeCore = vi.spyOn(runtime.core, 'close');
    try {
      const started = runtime.start();
      await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
      expect(runtime.server.listening).toBe(false);
      finishRecovery();
      await started;
      expect(runtime.server.listening).toBe(true);

      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = request(
          {
            hostname: runtime.host,
            port,
            path: '/api/v1/project-workspace',
            headers: { Host: `${runtime.host}:${port}` },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(response).toEqual({ status: 200, body: { projects: [] } });

      await Promise.all([runtime.stop(), runtime.stop()]);
      expect(runtime.server.listening).toBe(false);
      expect(closeCore).toHaveBeenCalledOnce();

      const reopened = createServerRuntime({ dataDir, port });
      await reopened.stop();
    } finally {
      await runtime.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('stops the background timer and closes an active SSE connection without exiting the process', async () => {
    vi.useFakeTimers();
    const dataDir = temporaryDataDir();
    const port = await freePort();
    const runtime = createServerRuntime({ dataDir, port });
    const sweep = vi.spyOn(runtime.core.questions, 'sweep');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let req: ReturnType<typeof request> | null = null;
    try {
      await runtime.start();
      expect(sweep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sweep).toHaveBeenCalledTimes(2);

      req = request({
        hostname: runtime.host,
        port,
        path: '/api/v1/events',
        headers: { Host: `${runtime.host}:${port}` },
      });
      const responsePromise = once(req, 'response');
      req.end();
      const [response] = (await responsePromise) as [IncomingMessage];
      const closed = new Promise<void>((resolve) => response.once('close', () => resolve()));

      await runtime.stop();
      await closed;
      const callsAtStop = sweep.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(sweep).toHaveBeenCalledTimes(callsAtStop);
      expect(exit).not.toHaveBeenCalled();
      expect(runtime.server.listening).toBe(false);
    } finally {
      req?.destroy();
      await runtime.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
