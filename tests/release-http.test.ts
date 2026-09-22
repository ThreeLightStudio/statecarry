import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReleaseProjectView } from '@statecarry/contracts';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

async function fixture() {
  const h = harness();
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const call = <T>(
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
  return {
    h,
    call,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('release HTTP contract', () => {
  it('persists policy, delivery targets, required checks and explicit completion through the project API', async () => {
    const { h, call, close } = await fixture();
    try {
      const created = h.core.projects.create({
        requestId: 'release-http-project',
        expectedRevision: 0,
        payload: {
          title: 'Release project',
          cwd: '/tmp/release-http',
          purpose: 'Ship completed work safely.',
          goal: 'Deliver a stable build.',
          threadIds: [],
          discover: false,
        },
      });
      const id = created.projectId;
      h.core.projectModel.view(id);
      const createdWork = h.core.projectModel.createWork(
        id,
        { title: 'Ready feature', completionCondition: 'Implementation is complete.' },
        'release-http-work',
      );
      const projectId = createdWork.workItems.find((item) => item.origin === 'user')!.id;
      h.core.projectModel.completeWork(id, projectId);
      const path = `/projects/${encodeURIComponent(id)}`;

      const empty = await call<ReleaseProjectView>(`${path}/release`);
      expect(empty.body).toMatchObject({ policy: null, pendingWork: [{ id: projectId }] });

      const policy = await call<ReleaseProjectView>(
        `${path}/release-policy`,
        'POST',
        h.command(id, {
          name: 'Stable release',
          timing: 'When completed work is ready.',
          channel: 'stable',
          requiredChecks: ['Build passes'],
          inclusionRule: 'ready-only',
          targets: [
            { key: 'desktop', label: 'Desktop app', required: true },
            { key: 'docs', label: 'Docs site', required: false },
          ],
          completionMode: 'user-confirmation',
          postReleaseVerification: 'none',
        }),
      );
      expect(policy.status).toBe(200);
      expect(policy.body.policy?.name).toBe('Stable release');

      let release = await call<ReleaseProjectView>(
        `${path}/create-release`,
        'POST',
        h.command(id, { title: '1.0.0', workItemIds: [projectId] }),
      );
      expect(release.body.batches[0]).toMatchObject({
        state: 'planned',
        completionMode: 'user-confirmation',
      });
      expect(release.body.batches[0].checks).toEqual([
        expect.objectContaining({ label: 'Build passes', state: 'pending' }),
      ]);
      const releaseId = release.body.batches[0].id;
      const desktop = release.body.targets.find((target) => target.key === 'desktop')!;
      const check = release.body.batches[0].checks[0];

      release = await call<ReleaseProjectView>(
        `${path}/update-delivery`,
        'POST',
        h.command(id, { releaseId, targetId: desktop.id, state: 'succeeded' }),
      );
      expect(release.body.batches[0].state).toBe('delivering');

      release = await call<ReleaseProjectView>(
        `${path}/update-release-check`,
        'POST',
        h.command(id, { releaseId, checkId: check.id, state: 'passed' }),
      );
      expect(release.body.batches[0].state).toBe('awaiting-confirmation');

      release = await call<ReleaseProjectView>(
        `${path}/confirm-release`,
        'POST',
        h.command(id, { releaseId }),
      );
      expect(release.body.batches[0].state).toBe('completed');
      expect(release.body.pendingWork).toEqual([]);
      expect(
        h.core.projectModel.view(id).workItems.find((item) => item.id === projectId)?.state,
      ).toBe('completed');

      const stale = await call<{ error: { code: string } }>(`${path}/release-policy`, 'POST', {
        requestId: 'stale-release-policy',
        expectedRevision: h.core.project(id).revision + 1,
        payload: {
          name: 'Stale policy',
          timing: null,
          channel: null,
          requiredChecks: [],
          inclusionRule: 'ready-only',
          targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
          completionMode: 'automatic',
          postReleaseVerification: 'none',
        },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    } finally {
      await close();
    }
  });
});
