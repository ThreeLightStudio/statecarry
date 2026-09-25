import { once } from 'node:events';
import { request, type Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { LocalUpdateState } from '../apps/server/src/adapters/local-updater';
import { unsupportedUpdateState } from '../apps/server/src/adapters/local-updater';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

const update = (phase: LocalUpdateState['phase']): LocalUpdateState => ({
  supported: true,
  currentVersion: '0.1.0',
  latestVersion: phase === 'idle' ? '0.1.0' : '0.1.1',
  phase,
  progress: phase === 'downloading' ? 42 : null,
  error: null,
});

const callUpdaterApi =
  (server: Server, declaredPort: number) => (method: string, path: string, value?: unknown) => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/v1/local/updater${path}`,
          method,
          headers: { Host: `127.0.0.1:${declaredPort}`, 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });
  };

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
};

const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

describe('local updater HTTP bridge', () => {
  it('exposes status and explicit check, download, and restart actions only on the local API', async () => {
    const h = harness();
    const updater = {
      state: vi.fn(async () => update('available')),
      check: vi.fn(async () => update('available')),
      download: vi.fn(async () => update('ready')),
      restart: vi.fn(async () => update('restarting')),
    };
    const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310, { updater });
    await listen(server);
    const call = callUpdaterApi(server, 4310);
    try {
      expect(await call('GET', '')).toEqual({ status: 200, body: update('available') });
      expect(await call('POST', '/check', {})).toEqual({ status: 200, body: update('available') });
      expect(await call('POST', '/download', {})).toEqual({ status: 200, body: update('ready') });
      expect(await call('POST', '/restart', {})).toEqual({
        status: 202,
        body: update('restarting'),
      });
      expect(updater.state).toHaveBeenCalledTimes(1);
      expect(updater.check).toHaveBeenCalledTimes(1);
      expect(updater.download).toHaveBeenCalledTimes(1);
      expect(updater.restart).toHaveBeenCalledTimes(1);
      expect((await call('GET', '/download')).status).toBe(404);
      expect((await call('POST', '/check', { unexpected: true })).status).toBe(400);
    } finally {
      await close(server);
    }
  });

  it('answers the automatic state and check polls with a supported:false state when no updater exists', async () => {
    const h = harness();
    const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4311);
    await listen(server);
    const call = callUpdaterApi(server, 4311);
    try {
      expect(await call('GET', '')).toEqual({ status: 200, body: unsupportedUpdateState() });
      expect(await call('POST', '/check', {})).toEqual({
        status: 200,
        body: unsupportedUpdateState(),
      });
      // Explicit actions stay a loud capability error even without an updater.
      const download = await call('POST', '/download', {});
      expect(download.status).toBe(501);
      expect(download.body.error.code).toBe('CAPABILITY_UNSUPPORTED');
      expect((await call('POST', '/restart', {})).status).toBe(501);
      expect((await call('POST', '/check', { unexpected: true })).status).toBe(400);
    } finally {
      await close(server);
    }
  });
});
