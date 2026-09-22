import { once } from 'node:events';
import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProjectModelView,
  ProjectNow,
  ProjectRegistrations,
  ProjectWorkspace,
  ReleaseProjectView,
  Receipt,
  WorkspaceSnapshot,
} from '@statecarry/contracts';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';
import { projectCandidate } from './project-fixtures';

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
  it('does not expose retired routes or execution preparation aliases', async () => {
    const { h, call, close } = await serverFixture();
    const id = h.connect();
    try {
      for (const path of [
        '/resume',
        '/work-contexts',
        '/project-workspace',
        '/connections',
        `/projects/${id}/decision`,
        `/projects/${id}/continuations/old`,
      ])
        expect((await call(path)).status).toBe(404);
      expect((await call(`/projects/${id}/continuations`, 'POST', h.command(id, {}))).status).toBe(
        404,
      );
    } finally {
      await close();
    }
  });

  it('keeps the observe endpoint free of semantic analysis', async () => {
    const { h, call, close } = await serverFixture();
    const id = h.connect();
    const snapshot = h.core.projects.latestSnapshot(id, 'en');
    const observe = vi
      .spyOn(h.core.projects, 'observe')
      .mockResolvedValue(structuredClone(snapshot) as WorkspaceSnapshot);
    try {
      const response = await call<WorkspaceSnapshot>(
        `/projects/${encodeURIComponent(id)}/observe`,
        'POST',
        { outputLanguage: 'ko' },
      );

      expect(response.status).toBe(200);
      expect(observe).toHaveBeenCalledWith(id, 'ko', undefined, false);
    } finally {
      await close();
    }
  });

  it('supports the full lifecycle by projectId with Command receipts and no implicit model call', async () => {
    const { h, call, close } = await serverFixture();
    const read = vi.spyOn(h.reader, 'read');
    const analysis = vi.fn();
    h.summary.generateAnalysis = analysis;
    try {
      expect((await call<ProjectWorkspace>('/projects')).body).toEqual({ projects: [] });
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
      const created = await call<Receipt>('/projects', 'POST', command);
      expect(created.status).toBe(200);
      expect((await call<Receipt>('/projects', 'POST', command)).body).toEqual(created.body);
      const id = created.body.projectId;
      const path = `/projects/${encodeURIComponent(id)}`;
      const registrations = (await call<ProjectRegistrations>('/projects/registrations')).body;
      expect(registrations.projects[0]).toMatchObject({
        projectId: id,
        connectionId: created.body.resultId,
        title: 'HTTP project',
        cwd: '/tmp/example',
        purpose: 'Keep context.',
      });
      expect(registrations.projects[0]).not.toHaveProperty('resume');
      expect(registrations.projects[0]).not.toHaveProperty('acceptedKeys');
      const workspace = (await call<ProjectWorkspace>('/projects')).body;
      expect(workspace.projects[0]).toMatchObject({
        projectId: id,
        connectionId: created.body.resultId,
        purpose: 'Keep context.',
        analysis: { goalText: 'Manual goal.', sessionCount: 0, state: 'empty' },
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
            `/projects/${created.body.resultId}/settings`,
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
      expect((await call<ProjectWorkspace>('/projects')).body.projects[0]).toMatchObject({
        analysis: null,
        focused: true,
      });
      expect((await call(`${path}/restore`, 'POST', h.command(id, {}))).status).toBe(200);
      expect((await call<ProjectWorkspace>('/projects')).body.projects[0]).toMatchObject({
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
      expect((await call<ProjectWorkspace>('/projects')).body).toEqual({ projects: [] });
      expect((await call('/projects/analysis')).body).toEqual([]);
      expect((await call(`${path}/deletion`)).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
      expect(analysis).not.toHaveBeenCalled();
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
      expect((await call('/projects', 'POST', payload)).status).toBe(400);
      expect(
        (
          await call('/projects', 'POST', {
            requestId: 'bad',
            expectedRevision: 0,
            payload: { ...payload, raw: 'unwanted' },
          })
        ).status,
      ).toBe(400);
      const invalid = await call('/projects', 'POST', {
        requestId: 'out-of-scope',
        expectedRevision: 0,
        payload: { ...payload, startTurnIds: { other: 'first' } },
      });
      expect(invalid.body.error.code).toBe('VALIDATION');
      expect((await call('/projects', 'PUT', {})).status).toBe(404);
      const id = h.connect();
      expect((await call(`/projects/${id}/delete`, 'POST', h.command(id, {}))).status).toBe(404);
      expect(
        (
          await call(
            `/projects/${id}/sources`,
            'POST',
            h.command(id, { threadIds: [], discover: false }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await call(`/projects/${id}/disconnect`, 'POST', h.command(id, { deleteOriginals: true })))
          .status,
      ).toBe(400);
      expect(h.core.project(id)).toBeDefined();
    } finally {
      await close();
    }
  });

  it('exposes ProjectNow and migrates only an explicitly selected legacy proposal', async () => {
    const { h, call, close } = await serverFixture();
    try {
      const created = h.core.projects.create({
        requestId: 'create-now-http',
        expectedRevision: 0,
        payload: {
          title: 'Now project',
          cwd: '/tmp/now-project',
          purpose: 'Resume work cheaply.',
          goal: 'Show one next action.',
          threadIds: [],
          discover: false,
        },
      });
      const id = created.projectId;
      h.repo.put('project', { ...h.core.project(id) });
      h.core.storeAnalysis({
        id: h.core.project(id).id,
        projectId: h.core.project(id).id,
        result: {
          scope: 'legacy-scope',
          version: 'legacy-version',
          generatedAt: '2026-09-21T00:00:00Z',
          candidates: [projectCandidate()],
        },
      });
      const path = `/projects/${encodeURIComponent(id)}`;
      const before = await call<{ model: ProjectModelView; now: ProjectNow }>(`${path}/now`);
      expect(before.status).toBe(200);
      expect(before.body.model.workItems).toEqual([]);

      const migrated = await call<ProjectModelView>(
        `${path}/select-proposal`,
        'POST',
        h.command(id, { proposalKey: 'analysis:export-check' }),
      );
      expect(migrated.status).toBe(200);
      expect(migrated.body.workItems).toEqual([
        expect.objectContaining({ title: 'Finish export validation', origin: 'reconstructed' }),
      ]);
      const after = await call<{ model: ProjectModelView; now: ProjectNow }>(`${path}/now`);
      expect(after.body.now.currentWorkId).toBe(migrated.body.workItems[0].id);

      h.repo.put('project', { ...h.core.project(id) });
      h.repo.put('projectScope', {
        id: h.core.project(id).id,
        projectId: h.core.project(id).id,
        ...{
          version: 1,
          kept: [],
          corrections: {},
          direction: null,
          policyConflict: {
            description: 'Showing more state by default increases return-time reading cost.',
            source: 'project-purpose',
            status: 'open',
          },
          requests: [],
          accepted: [],
          comparisons: {},
        },
      });
      const conflicted = await call<{ model: ProjectModelView; now: ProjectNow }>(`${path}/now`);
      expect(conflicted.body.now).toMatchObject({
        currentWorkId: migrated.body.workItems[0].id,
        notice: { kind: 'direction-conflict', level: 'immediate' },
        next: { kind: 'review-direction' },
        secondaryActions: [{ kind: 'continue-despite-direction-conflict' }],
      });

      const continued = await call<ProjectModelView>(
        `${path}/continue-direction-conflict`,
        'POST',
        h.command(id, {}),
      );
      expect(continued.status).toBe(200);
      const continuedAgain = await call<ProjectModelView>(
        `${path}/continue-direction-conflict`,
        'POST',
        h.command(id, {}),
      );
      expect(continuedAgain.status).toBe(200);
      expect(
        h.repo
          .list('workDecision')
          .filter(
            (decision) =>
              decision.projectId === id && decision.kind === 'continue-direction-conflict',
          ),
      ).toHaveLength(1);
      const afterContinue = await call<{ model: ProjectModelView; now: ProjectNow }>(`${path}/now`);
      expect(afterContinue.body.now).toMatchObject({
        currentWorkId: migrated.body.workItems[0].id,
        notice: null,
        next: { kind: 'continue-work' },
      });

      const createWork = h.command(id, {
        title: 'Define the next return experiment',
        completionCondition: 'One bounded experiment has a recorded result.',
      });
      const createdWork = await call<ProjectModelView>(`${path}/create-work`, 'POST', createWork);
      const repeatedWork = await call<ProjectModelView>(`${path}/create-work`, 'POST', createWork);
      expect(createdWork.status).toBe(200);
      expect(repeatedWork.body.workItems).toHaveLength(2);
      const userWork = createdWork.body.workItems.find((item) => item.origin === 'user');
      expect(userWork).toMatchObject({
        title: 'Define the next return experiment',
        completionCondition: 'One bounded experiment has a recorded result.',
      });
      expect(
        (await call<{ model: ProjectModelView; now: ProjectNow }>(`${path}/now`)).body.now,
      ).toMatchObject({ currentWorkId: userWork!.id, currentWorkSelection: 'user' });

      const paused = await call<ProjectModelView>(
        `${path}/pause-work`,
        'POST',
        h.command(id, { workItemId: userWork!.id }),
      );
      expect(paused.status).toBe(200);
      expect(paused.body.workItems.find((item) => item.id === userWork!.id)?.state).toBe('paused');
      expect(
        paused.body.decisions.filter(
          (decision) =>
            decision.workItemId === userWork!.id &&
            decision.kind === 'pause-work' &&
            decision.state === 'valid',
        ),
      ).toHaveLength(1);

      const resumed = await call<ProjectModelView>(
        `${path}/resume-work`,
        'POST',
        h.command(id, { workItemId: userWork!.id }),
      );
      expect(resumed.body.workItems.find((item) => item.id === userWork!.id)?.state).toBe('active');
      expect(
        resumed.body.decisions.filter(
          (decision) =>
            decision.workItemId === userWork!.id &&
            decision.kind === 'resume-work' &&
            decision.state === 'valid',
        ),
      ).toHaveLength(1);
      expect(
        resumed.body.decisions.filter(
          (decision) =>
            decision.workItemId === userWork!.id &&
            decision.kind === 'pause-work' &&
            decision.state === 'superseded',
        ),
      ).toHaveLength(1);

      const completed = await call<ProjectModelView>(
        `${path}/complete-work`,
        'POST',
        h.command(id, { workItemId: userWork!.id }),
      );
      expect(completed.body.workItems.find((item) => item.id === userWork!.id)?.state).toBe(
        'completed',
      );
      expect(
        completed.body.decisions.filter(
          (decision) =>
            decision.workItemId === userWork!.id &&
            decision.kind === 'complete-work' &&
            decision.state === 'valid',
        ),
      ).toHaveLength(1);

      const stopped = await call<ProjectModelView>(
        `${path}/stop-work`,
        'POST',
        h.command(id, { workItemId: migrated.body.workItems[0].id }),
      );
      expect(
        stopped.body.workItems.find((item) => item.id === migrated.body.workItems[0].id)?.state,
      ).toBe('stopped');
      expect(
        stopped.body.decisions.filter(
          (decision) =>
            decision.workItemId === migrated.body.workItems[0].id &&
            decision.kind === 'stop-work' &&
            decision.state === 'valid',
        ),
      ).toHaveLength(1);

      const discussionPayload = {
        workItemId: migrated.body.workItems[0].id,
        basis: 'legacy-version',
        turns: [
          {
            question: 'What remains?',
            answer: {
              items: [
                {
                  id: 'discussion-item',
                  kind: 'record',
                  nature: 'agent-report',
                  text: 'One behavior check remains.',
                  uncertainty: '',
                  evidence: [],
                },
              ],
              unknowns: [],
              limitations: [],
            },
            basis: 'legacy-version',
          },
        ],
      };
      const discussion = await call<ProjectModelView>(
        `${path}/sync-discussion`,
        'POST',
        h.command(id, discussionPayload),
      );
      expect(discussion.status).toBe(200);
      expect(discussion.body.discussions).toEqual([
        expect.objectContaining({
          workItemId: migrated.body.workItems[0].id,
          turns: [expect.objectContaining({ question: 'What remains?' })],
        }),
      ]);
      const repeatedDiscussion = await call<ProjectModelView>(
        `${path}/sync-discussion`,
        'POST',
        h.command(id, discussionPayload),
      );
      expect(repeatedDiscussion.body.discussions[0].turns).toHaveLength(1);

      const stale = await call(`${path}/select-work`, 'POST', {
        requestId: 'stale-now-selection',
        expectedRevision: 0,
        payload: { workItemId: migrated.body.workItems[0].id },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    } finally {
      await close();
    }
  });

  it('persists release policy, checks and independent delivery state through the HTTP contract', async () => {
    const { h, call, close } = await serverFixture();
    try {
      const created = await call<Receipt>('/projects', 'POST', {
        requestId: 'create-release-http-project',
        expectedRevision: 0,
        payload: {
          title: 'Release HTTP project',
          cwd: '/tmp/example',
          purpose: 'Ship completed work safely.',
          goal: 'Deliver a stable release.',
          threadIds: [],
          discover: false,
        },
      });
      const id = created.body.projectId;
      const path = `/projects/${encodeURIComponent(id)}`;
      h.core.projectModel.view(id);
      h.repo.put('workItem', {
        id: 'release-work',
        projectId: id,
        title: 'Completed release work',
        state: 'completed',
        origin: 'user',
        completionCondition: 'Implementation is complete.',
        completionConditionOrigin: 'user',
        createdAt: '2026-09-08T13:35:01.780Z',
        updatedAt: '2026-09-08T13:35:01.780Z',
      });

      const policy = await call<ReleaseProjectView>(
        `${path}/release-policy`,
        'POST',
        h.command(id, {
          name: 'Stable policy',
          timing: null,
          channel: 'stable',
          requiredChecks: ['Build passes'],
          inclusionRule: 'ready-only',
          targets: [
            { key: 'desktop', label: 'Desktop app', required: true },
            { key: 'docs', label: 'Docs site', required: false },
          ],
          completionMode: 'user-confirmation',
          postReleaseVerification: 'risk-based',
        }),
      );
      expect(policy.status).toBe(200);
      expect(policy.body.pendingWork).toEqual([expect.objectContaining({ id: 'release-work' })]);

      let release = await call<ReleaseProjectView>(
        `${path}/create-release`,
        'POST',
        h.command(id, { title: 'Stable release', workItemIds: ['release-work'] }),
      );
      const batch = release.body.batches[0];
      expect(batch).toMatchObject({
        state: 'planned',
        checks: [expect.objectContaining({ label: 'Build passes', state: 'pending' })],
      });
      const desktop = release.body.targets.find((target) => target.key === 'desktop')!;
      const docs = release.body.targets.find((target) => target.key === 'docs')!;

      release = await call<ReleaseProjectView>(
        `${path}/update-delivery`,
        'POST',
        h.command(id, {
          releaseId: batch.id,
          targetId: docs.id,
          state: 'failed',
          detail: 'Docs delivery failed.',
        }),
      );
      expect(release.body.targets.find((target) => target.id === docs.id)?.state).toBe('failed');

      release = await call<ReleaseProjectView>(
        `${path}/update-delivery`,
        'POST',
        h.command(id, { releaseId: batch.id, targetId: desktop.id, state: 'succeeded' }),
      );
      expect(release.body.batches[0].state).toBe('delivering');

      release = await call<ReleaseProjectView>(
        `${path}/update-release-check`,
        'POST',
        h.command(id, {
          releaseId: batch.id,
          checkId: release.body.batches[0].checks[0].id,
          state: 'passed',
        }),
      );
      expect(release.body.batches[0].state).toBe('awaiting-confirmation');

      release = await call<ReleaseProjectView>(
        `${path}/confirm-release`,
        'POST',
        h.command(id, { releaseId: batch.id }),
      );
      expect(release.body.batches[0].state).toBe('completed');
      expect(h.repo.get('workItem', 'release-work')?.state).toBe('completed');

      const stale = await call(`${path}/create-release`, 'POST', {
        requestId: 'stale-release-command',
        expectedRevision: 0,
        payload: { title: 'Stale', workItemIds: ['release-work'] },
      });
      expect(stale.status).toBe(409);
    } finally {
      await close();
    }
  });
});
