import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

describe('local folder picker HTTP bridge', () => {
  it('opens the injected local picker only through POST and returns selection or cancel', async () => {
    const h = harness();
    const choose = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('/Users/example/Projects/statecarry')
      .mockResolvedValueOnce(null);
    const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310, {
      folderPicker: { choose },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const call = (method: string, value?: unknown, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/api/v1/local/folder-picker',
            method,
            headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json', ...headers },
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
      expect(await call('GET')).toMatchObject({ status: 405 });
      expect(choose).not.toHaveBeenCalled();
      expect(await call('POST', {}, { Origin: 'https://example.com' })).toMatchObject({
        status: 403,
      });
      expect(await call('POST', {}, { Host: 'example.com' })).toMatchObject({ status: 403 });
      expect(choose).not.toHaveBeenCalled();
      expect(await call('POST', {})).toEqual({
        status: 200,
        body: { path: '/Users/example/Projects/statecarry' },
      });
      expect(await call('POST', {})).toEqual({ status: 200, body: { path: null } });
      expect(choose).toHaveBeenCalledTimes(2);
      expect((await call('POST', { unexpected: true })).status).toBe(400);
      expect(choose).toHaveBeenCalledTimes(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
