import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

describe('removed connection HTTP lifecycle', () => {
  it('lists restore revision and restores the original work without analysis', async () => {
    const h = harness(),
      projectId = h.connect(),
      connection = h.core.connection(h.core.project(projectId).connectionId);
    h.core.removeConnection(connection.id, {
      requestId: 'remove-http-lifecycle',
      expectedRevision: h.core.project(projectId).revision,
      payload: {},
    });
    const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const call = (
      path: string,
      method = 'GET',
      value?: unknown,
    ): Promise<{ status: number; body: any }> =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/api/v1${path}`,
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
      expect((await call('/projects/connections')).body).toEqual([]);
      const removed = await call('/projects/connections/removed');
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual([
        expect.objectContaining({
          connection: expect.objectContaining({ id: connection.id, projectId }),
          workRevision: h.core.project(projectId).revision,
        }),
      ]);
      const restored = await call(`/projects/${projectId}/restore`, 'POST', {
        requestId: 'restore-http-lifecycle',
        expectedRevision: removed.body[0].workRevision,
        payload: {},
      });
      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({ command: 'project-restore', projectId });
      expect((await call('/projects/connections')).body).toEqual([
        expect.objectContaining({ id: connection.id, projectId, removedAt: null }),
      ]);
      expect(h.counts().generationCalls).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
