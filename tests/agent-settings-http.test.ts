import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

async function serverFixture() {
  const h = harness();
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const call = <T = { error: { code: string; message: string } }>(
    path: string,
    method = 'GET',
    value?: unknown,
  ): Promise<{ status: number; body: T }> =>
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
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) as T }));
        },
      );
      req.on('error', reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { h, call, close };
}

describe('agent settings HTTP contract', () => {
  it('returns the Codex default before any save', async () => {
    const { call, close } = await serverFixture();
    try {
      const response = await call('/agent-settings');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        provider: 'codex',
        openrouterModel: 'openrouter/free',
        hasApiKey: false,
        apiKeyHint: null,
      });
    } finally {
      await close();
    }
  });

  it('saves OpenRouter settings and returns only a masked key', async () => {
    const { call, close } = await serverFixture();
    try {
      const saved = await call('/agent-settings', 'POST', {
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        openrouterApiKey: 'sk-or-v1-9998887777ffff',
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        hasApiKey: true,
        apiKeyHint: '…ffff',
      });
      const reread = await call<{ hasApiKey: boolean }>('/agent-settings');
      expect(JSON.stringify(reread.body)).not.toContain('sk-or-v1-9998887777ffff');
      expect(reread.body.hasApiKey).toBe(true);
    } finally {
      await close();
    }
  });

  it('rejects invalid agent settings with a validation error', async () => {
    const { call, close } = await serverFixture();
    try {
      const saved = await call('/agent-settings', 'POST', { provider: 'chatgpt' });
      expect(saved.status).toBe(400);
      expect((saved.body as { error: { code: string } }).error.code).toBe('VALIDATION');
    } finally {
      await close();
    }
  });
});
