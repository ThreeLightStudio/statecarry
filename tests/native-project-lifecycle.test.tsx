// @vitest-environment jsdom
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { StateCarry } from '@statecarry/core';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { HttpProjectGateway } from '../apps/web/src/adapters/project-gateway';
import { HttpAnalysisGateway } from '../apps/web/src/adapters/analysis-gateway';
import { harness, source } from './helpers';
import { projectCandidate } from './project-fixtures';
import { act, installBrowser, mountProjectRoot, toggleDetails } from './project-ui-fixtures';

it('uses the real client, HTTP and SQLite through analysis, selection, execution and restart', async () => {
  installBrowser();
  const directory = mkdtempSync(join(tmpdir(), 'statecarry-native-'));
  let repo = new SQLiteRepository(directory);
  const h = harness(repo);
  const candidate = projectCandidate();
  const generate = vi.fn(async () => ({ candidates: [candidate] }));
  h.summary.generateAnalysis = generate;
  h.summary.answerQuestion = async () => ({
    items: [],
    unknowns: ['This user-created task has no verified result yet.'],
  });
  h.summary.checkQuestion = async () => ({ checks: [], unknownsSafe: true });
  const session = {
    capability: () => ({
      create: 'supported' as const,
      send: 'supported' as const,
      detail: '',
      verifiedAt: null,
    }),
    create: vi.fn(async () => ({ threadId: 'native-execution' })),
    send: vi.fn(async () => ({ turnId: 'native-turn' })),
    read: async () => ({
      status: 'completed' as const,
      report: 'The requested check passed.',
      error: null,
      questions: [],
    }),
    answer: async () => {},
    interrupt: async () => {},
  };
  const makeCore = () =>
    new StateCarry(
      repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      session,
      {
        inspect: () => ({
          cwd: '/tmp/example',
          root: '/tmp/example',
          branch: 'main',
          commit: 'head',
          dirty: false,
          status: 'checked',
          checkedAt: h.core.clock.now(),
          changedPaths: [],
          limitations: [],
          files: [],
          fileFingerprint: 'native-files',
        }),
        scope: () => ({
          basis: 'native-basis',
          checkedAt: h.core.clock.now(),
          complete: true,
          scopes: [],
          limitations: [],
        }),
      },
    );
  let core = makeCore();
  let server = createHttpServer(core, new ChangeEvents(), '/tmp/no-web', 4310);
  const listen = async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    vi.stubGlobal(
      'fetch',
      (path: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          const req = request(
            {
              hostname: '127.0.0.1',
              port: address.port,
              path,
              method: init?.method ?? 'GET',
              headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () =>
                resolve({ ok: res.statusCode! < 400, json: async () => JSON.parse(body) }),
              );
            },
          );
          req.on('error', reject);
          req.end(init?.body);
        }),
    );
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  const gateway = new HttpProjectGateway();
  const analysis = new HttpAnalysisGateway();
  let mounted: Awaited<ReturnType<typeof mountProjectRoot>> | undefined;
  try {
    await listen();
    const created = await gateway.create({
      title: 'Native lifecycle',
      cwd: '/tmp/example',
      purpose: 'Keep a durable project.',
      goal: 'Finish validation.',
      threadIds: ['thread-a'],
      discover: false,
    });
    const id = created.projectId;
    expect((await gateway.now(id)).initialized).toBe(false);
    expect(repo.list('projectAnalysis')).toEqual([]);
    window.history.replaceState(null, '', `#/project/${id}`);
    mounted = await mountProjectRoot(gateway, analysis);
    await act(async () => {
      await vi.waitFor(() => expect(mounted!.host.textContent).toContain(candidate.goal));
    });
    expect((await gateway.now(id)).now.currentWorkId).toBeNull();
    await toggleDetails(mounted.host, 'Other work · 1');
    expect(mounted.host.textContent).toContain(candidate.currentState);
    await mounted.unmount();
    mounted = undefined;
    await gateway.settings(id, core.project(id).revision, {
      title: 'Native lifecycle',
      purpose: 'Keep a durable project.',
      focused: false,
      responseLanguage: 'ko',
    });
    expect(repo.list('projectAnalysis')[0].result.candidates[0].goal).toBe(candidate.goal);
    generate.mockResolvedValue({
      candidates: [
        {
          ...candidate,
          goal: '내보내기 검증 마무리',
          currentState: '내보내기 구현을 마쳤으며 최종 확인이 남아 있습니다.',
        },
      ],
    });
    await core.analyses.refresh(id);
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ outputLanguage: 'ko' }));
    expect((await gateway.now(id)).now.proposalMatches[0].proposal.title).toBe(
      '내보내기 검증 마무리',
    );
    mounted = await mountProjectRoot(gateway, analysis);
    await act(async () => {
      await vi.waitFor(() => expect(mounted!.host.textContent).toContain('내보내기 검증 마무리'));
    });
    await toggleDetails(mounted.host, 'Other work · 1');
    expect(mounted.host.textContent).toContain(
      '내보내기 구현을 마쳤으며 최종 확인이 남아 있습니다.',
    );
    await act(async () => {
      mounted!.host
        .querySelector<HTMLButtonElement>('[aria-label="Choose 내보내기 검증 마무리"]')!
        .click();
    });
    await act(async () => {
      await vi.waitFor(() => expect(repo.list('workItem')).toHaveLength(1));
    });
    const selected = (await gateway.now(id)).now.currentWorkId!;
    await mounted.unmount();
    mounted = undefined;
    await core.analyses.refresh(id, 'en');
    expect((await gateway.now(id)).now.currentWorkId).toBe(selected);
    const userModel = await gateway.createWork(id, core.project(id).revision, {
      title: 'User written task',
      completionCondition: 'The result is reviewed.',
    });
    const userWork = userModel.workItems.find((work) => work.origin === 'user')!;
    await gateway.selectWork(id, core.project(id).revision, userWork.id);
    await analysis.discussTask(id, {
      workItemId: userWork.id,
      version: core.analyses.view(id).version,
      question: 'What remains unverified?',
      history: [],
    });
    expect(repo.list('workDiscussion')[0]).toMatchObject({
      workItemId: userWork.id,
      turns: [{ question: 'What remains unverified?' }],
    });
    let execution = await gateway.execution(id, { action: 'observe', outputLanguage: 'en' });
    execution = await gateway.execution(
      id,
      {
        action: 'prepare',
        context: {
          operation: 'verify',
          workItemId: userWork.id,
          basis: execution.record.observation!.basis,
          scopeIds: [],
        },
        text: 'Check the user task.',
        doneWhen: 'The result is reviewed.',
        threadId: null,
      },
      execution.record.version,
    );
    const requestId = execution.requests[0].id;
    expect(session.send).not.toHaveBeenCalled();
    execution = await gateway.execution(
      id,
      { action: 'send', requestId },
      execution.record.version,
    );
    execution = await gateway.execution(
      id,
      { action: 'sync', requestId },
      execution.record.version,
    );
    expect(execution.record.accepted).toEqual([]);
    execution = await gateway.execution(
      id,
      { action: 'compare', requestId, outputLanguage: 'en' },
      execution.record.version,
    );
    execution = await gateway.execution(
      id,
      { action: 'accept', requestId },
      execution.record.version,
    );
    expect(execution.record.accepted).toEqual([requestId]);
    const saved = await gateway.now(id);
    const calls = generate.mock.calls.length;
    await close();
    repo.close();
    repo = new SQLiteRepository(directory);
    core = makeCore();
    server = createHttpServer(core, new ChangeEvents(), '/tmp/no-web', 4310);
    await listen();
    expect(await gateway.now(id)).toEqual(saved);
    expect((await gateway.execution(id)).record.accepted).toEqual([requestId]);
    expect(repo.list('workDiscussion')[0].workItemId).toBe(userWork.id);
    mounted = await mountProjectRoot(gateway, analysis);
    await act(async () => {
      await vi.waitFor(() => expect(mounted!.host.textContent).toContain('Native lifecycle'));
    });
    expect(generate.mock.calls.length).toBe(calls);
    expect(repo.list('source')[0].text).toBe(source().text);
  } finally {
    await mounted?.unmount();
    await close();
    repo.close();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  }
});
