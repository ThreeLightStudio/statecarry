import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { LocalUpdateState } from '../apps/server/src/adapters/local-updater';
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
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const call = (method: string, path: string, value?: unknown) =>
      new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/api/v1/local/updater${path}`,
            method,
            headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json' },
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
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
