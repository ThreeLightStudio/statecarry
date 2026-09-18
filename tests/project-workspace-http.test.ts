import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectRegistrations, ProjectWorkspace, Receipt } from '@statecarry/contracts';
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

describe('project workspace HTTP contract', () => {
  it('supports the full lifecycle by workId with Command receipts and no implicit model call', async () => {
    const { h, call, close } = await serverFixture();
    const read = vi.spyOn(h.reader, 'read');
    const resume = vi.fn();
    h.summary.generateResume = resume;
    try {
      expect((await call<ProjectWorkspace>('/project-workspace')).body).toEqual({ projects: [] });
      const command = {
        requestId: 'create-project-http',
        expectedRevision: 0,
        payload: {
          title: 'HTTP project',
          cwd: '/tmp/example',
          purpose: 'Keep context.',
          goal: 'Manual goal.',
          threadIds: [],
          discover: false,
        },
      };
      const created = await call<Receipt>('/project-workspace', 'POST', command);
      expect(created.status).toBe(200);
      expect((await call<Receipt>('/project-workspace', 'POST', command)).body).toEqual(
        created.body,
      );
      const id = created.body.workId;
      const path = `/project-workspace/${encodeURIComponent(id)}`;
      const registrations = (await call<ProjectRegistrations>('/project-workspace/registrations'))
        .body;
      expect(registrations.projects[0]).toMatchObject({
        workId: id,
        connectionId: created.body.resultId,
        title: 'HTTP project',
        cwd: '/tmp/example',
        purpose: 'Keep context.',
      });
      expect(registrations.projects[0]).not.toHaveProperty('resume');
      expect(registrations.projects[0]).not.toHaveProperty('acceptedKeys');
      const workspace = (await call<ProjectWorkspace>('/project-workspace')).body;
      expect(workspace.projects[0]).toMatchObject({
        workId: id,
        connectionId: created.body.resultId,
        purpose: 'Keep context.',
        resume: { goalText: 'Manual goal.', sessionCount: 0, state: 'empty' },
      });
      expect(
        (
          await call(
            `${path}/settings`,
            'POST',
            h.command(id, { title: 'Renamed', purpose: 'Saved purpose.', focused: true }),
          )
        ).status,
      ).toBe(200);
      const stale = await call(`${path}/settings`, 'POST', {
        requestId: 'stale-settings',
        expectedRevision: 1,
        payload: { title: 'stale', purpose: '', focused: false },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('REVISION_CONFLICT');
      expect(
        (
          await call(
            `/project-workspace/${created.body.resultId}/settings`,
            'POST',
            h.command(id, { title: 'Wrong identity', purpose: '', focused: false }),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `${path}/sources`,
            'POST',
            h.command(id, { threadIds: [], startTurnIds: {}, discover: false }),
          )
        ).status,
      ).toBe(200);
      const disconnect = h.command(id, {});
      const removed = await call<Receipt>(`${path}/disconnect`, 'POST', disconnect);
      expect(removed.body.command).toBe('project-disconnect');
      expect((await call<Receipt>(`${path}/disconnect`, 'POST', disconnect)).body).toEqual(
        removed.body,
      );
      expect((await call<ProjectWorkspace>('/project-workspace')).body.projects[0]).toMatchObject({
        resume: null,
        focused: true,
      });
      expect((await call(`${path}/restore`, 'POST', h.command(id, {}))).status).toBe(200);
      expect((await call<ProjectWorkspace>('/project-workspace')).body.projects[0]).toMatchObject({
        focused: true,
      });
      const preview = h.core.projects.deletionPreview(id);
      expect((await call(`${path}/deletion`)).body).toEqual(preview);
      const badToken = await call(`${path}/deletion`, 'POST', h.command(id, { token: 'invalid' }));
      expect(badToken.status).toBe(409);
      expect(badToken.body.error.code).toBe('PROJECT_DELETION_CHANGED');
      const deletion = h.command(id, { token: preview.token });
      const deleted = await call<Receipt>(`${path}/deletion`, 'POST', deletion);
      expect(deleted.status).toBe(200);
      expect((await call<Receipt>(`${path}/deletion`, 'POST', deletion)).body).toEqual(
        deleted.body,
      );
      expect((await call<ProjectWorkspace>('/project-workspace')).body).toEqual({ projects: [] });
      expect((await call('/resume')).body).toEqual([]);
      expect((await call(`${path}/deletion`)).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(h.counts().generationCalls).toBe(0);
    } finally {
      await close();
    }
  });

  it('rejects unwrapped writes, unknown fields, out-of-scope ranges and unsupported routes', async () => {
    const { h, call, close } = await serverFixture();
    try {
      const payload = {
        title: 'Project',
        cwd: '/tmp/example',
        purpose: '',
        threadIds: [],
        discover: false,
      };
      expect((await call('/project-workspace', 'POST', payload)).status).toBe(400);
      expect(
        (
          await call('/project-workspace', 'POST', {
            requestId: 'bad',
            expectedRevision: 0,
            payload: { ...payload, raw: 'unwanted' },
          })
        ).status,
      ).toBe(400);
      const invalid = await call('/project-workspace', 'POST', {
        requestId: 'out-of-scope',
        expectedRevision: 0,
        payload: { ...payload, startTurnIds: { other: 'first' } },
      });
      expect(invalid.body.error.code).toBe('VALIDATION');
      expect((await call('/project-workspace', 'PUT', {})).status).toBe(404);
      const id = h.connect();
      expect(
        (await call(`/project-workspace/${id}/delete`, 'POST', h.command(id, {}))).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/project-workspace/${id}/sources`,
            'POST',
            h.command(id, { threadIds: [], discover: false }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            `/project-workspace/${id}/disconnect`,
            'POST',
            h.command(id, { deleteOriginals: true }),
          )
        ).status,
      ).toBe(400);
      expect(h.core.work(id)).toBeDefined();
    } finally {
      await close();
    }
  });
});
