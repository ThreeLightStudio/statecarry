// @vitest-environment jsdom
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { SessionRun } from '@statecarry/contracts';
import { StateCarry } from '@statecarry/core';
import { BackgroundLoop } from '../apps/server/src/background';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { HttpProjectGateway } from '../apps/web/src/adapters/project-gateway';
import { HttpAnalysisGateway } from '../apps/web/src/adapters/analysis-gateway';
import { harness, source } from './helpers';
import { projectCandidate } from './project-fixtures';
import {
  act,
  button,
  installBrowser,
  mountProjectRoot,
  press,
  toggleDetails,
} from './project-ui-fixtures';

class LoopbackEventSource extends EventTarget {
  static port = 0;
  private connection: ReturnType<typeof request>;

  constructor(url: string) {
    super();
    this.connection = request(
      {
        hostname: '127.0.0.1',
        port: LoopbackEventSource.port,
        path: new URL(url, 'http://127.0.0.1').pathname,
        headers: { Host: '127.0.0.1:4310' },
      },
      (response) => {
        response.setEncoding('utf8');
        let pending = '';
        response.on('data', (chunk: string) => {
          pending += chunk;
          let boundary = pending.indexOf('\n\n');
          while (boundary >= 0) {
            const block = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const event = block
              .split('\n')
              .find((line) => line.startsWith('event:'))
              ?.slice('event:'.length)
              .trim();
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice('data:'.length).trim())
              .join('\n');
            if (event) this.dispatchEvent(new MessageEvent(event, { data }));
            boundary = pending.indexOf('\n\n');
          }
        });
      },
    );
    this.connection.on('error', () => this.dispatchEvent(new Event('error')));
    this.connection.end();
  }

  close() {
    this.connection.destroy();
  }
}

it('keeps another Work selected while a request completes across restart', async () => {
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
  let readExecution = async (): Promise<SessionRun> => ({
    status: 'running',
    report: '',
    error: null,
    questions: [],
  });
  const session = {
    capability: () => ({
      create: 'supported' as const,
      send: 'supported' as const,
      detail: '',
      verifiedAt: null,
    }),
    create: vi.fn(async () => ({ threadId: 'native-execution' })),
    send: vi.fn(async () => ({ turnId: 'native-turn' })),
    read: vi.fn(() => readExecution()),
    answer: async () => {},
    interrupt: async () => {},
  };
  let events = new ChangeEvents();
  const makeCore = () =>
    new StateCarry(
      repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      events,
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
  let server = createHttpServer(core, events, '/tmp/no-web', 4310);
  const listen = async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    LoopbackEventSource.port = address.port;
    vi.stubGlobal('EventSource', LoopbackEventSource);
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
  let background: BackgroundLoop | undefined;
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
    const workBData = await gateway.now(id);
    const workB = workBData.model.workItems.find((work) => work.id === selected)!;
    expect(workB).toBeDefined();
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
    window.history.replaceState(null, '', `#/project/${id}`);
    mounted = await mountProjectRoot(gateway, analysis);
    await act(async () => {
      await vi.waitFor(() => expect(mounted!.host.textContent).toContain('User written task'));
    });
    await press(mounted.host, 'Continue work');
    await act(async () => {
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('.pw-decision-confirm input')).toBeTruthy(),
      );
    });
    const confirmation = mounted.host.querySelector<HTMLInputElement>(
      '.pw-decision-confirm input',
    )!;
    await act(async () => {
      await vi.waitFor(() => expect(confirmation.disabled).toBe(false));
    });
    await act(async () => confirmation.click());
    await act(async () => {
      await vi.waitFor(() =>
        expect(button(mounted!.host, 'Prepare request for Codex').disabled).toBe(false),
      );
    });
    await press(mounted.host, 'Prepare request for Codex');
    await act(async () => {
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain('Your request is ready to review'),
      );
    });
    const requestId = repo
      .list('continuation')
      .find((request) => request.target.payload.projectContext?.workItemId === userWork.id)!.id;
    expect(session.send).not.toHaveBeenCalled();
    await press(mounted.host, 'Send to a new Codex conversation');
    await act(async () => {
      await vi.waitFor(() =>
        expect(repo.get('continuation', requestId)?.execution?.status).toBe('running'),
      );
    });
    expect(session.send).toHaveBeenCalledTimes(1);
    await press(mounted.host, 'Back to current work');
    await act(async () => {
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain('Codex is working on this request.'),
      );
    });
    expect((await gateway.now(id)).now).toMatchObject({
      currentWorkId: userWork.id,
      currentWorkSelection: 'user',
      execution: { workItemId: userWork.id, requestId, status: 'running' },
    });
    expect(repo.get('workItem', userWork.id)?.state).toBe('active');

    const otherWorkCount = (await gateway.now(id)).now.otherWorkCount;
    expect(otherWorkCount).toBeGreaterThan(0);
    await toggleDetails(mounted.host, `Other work · ${otherWorkCount}`);
    const chooseWorkB = [...mounted.host.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidateButton) => candidateButton.getAttribute('aria-label') === `Choose ${workB.title}`,
    );
    expect(chooseWorkB).toBeTruthy();
    await act(async () => {
      chooseWorkB!.click();
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
    });
    expect((await gateway.now(id)).now).toMatchObject({
      currentWorkId: selected,
      currentWorkSelection: 'user',
      execution: { workItemId: userWork.id, requestId, status: 'running' },
    });
    expect(mounted.host.textContent).toContain('Request for User written task');

    const firstBackgroundTime = Date.now();
    const executionBackground = new BackgroundLoop(core);
    background = executionBackground;
    executionBackground.deferExisting(firstBackgroundTime);
    readExecution = async () => ({
      status: 'waiting',
      report: '',
      error: null,
      questions: [
        {
          id: 'input-needed',
          kind: 'question',
          title: 'A decision is needed',
          detail: 'Choose the output format.',
        },
      ],
    });
    await act(async () => {
      executionBackground.tick(firstBackgroundTime);
      await vi.waitFor(() =>
        expect(repo.get('continuation', requestId)?.execution?.status).toBe('waiting'),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain(
          'Codex needs your input before it can continue.',
        ),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
    });
    expect(button(mounted.host, 'Respond to Codex')).toBeTruthy();
    expect((await gateway.now(id)).now.currentWorkId).toBe(selected);

    readExecution = async () => {
      throw new Error('The Codex conversation is temporarily unavailable.');
    };
    await act(async () => {
      executionBackground.tick(firstBackgroundTime + 4_000);
      await vi.waitFor(() =>
        expect(repo.get('continuation', requestId)?.execution?.status).toBe('unknown'),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain(
          'StateCarry could not confirm whether this request is still running.',
        ),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
    });
    expect(button(mounted.host, 'Check execution state')).toBeTruthy();
    expect(repo.get('workItem', userWork.id)?.state).toBe('active');
    expect((await gateway.now(id)).now).toMatchObject({
      currentWorkId: selected,
      currentWorkSelection: 'user',
      execution: { workItemId: userWork.id, requestId, status: 'unknown' },
    });

    await mounted.unmount();
    mounted = undefined;
    executionBackground.stop();
    background = undefined;
    await close();
    repo.close();
    repo = new SQLiteRepository(directory);
    events = new ChangeEvents();
    core = makeCore();
    server = createHttpServer(core, events, '/tmp/no-web', 4310);
    await listen();
    expect((await gateway.now(id)).now).toMatchObject({
      currentWorkId: selected,
      currentWorkSelection: 'user',
      execution: { requestId, status: 'unknown' },
    });
    expect(repo.list('workDiscussion')[0].workItemId).toBe(userWork.id);

    const calls = generate.mock.calls.length;
    window.history.replaceState(null, '', `#/project/${id}`);
    mounted = await mountProjectRoot(gateway, analysis);
    await act(async () => {
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain(
          'StateCarry could not confirm whether this request is still running.',
        ),
      );
    });
    expect(mounted.host.textContent).toContain('Request for User written task');
    expect(repo.get('workItem', userWork.id)?.state).toBe('active');
    expect((await gateway.execution(id)).record.accepted).toEqual([]);
    expect(session.send).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls.length).toBe(calls);

    readExecution = async () => ({
      status: 'completed',
      report: 'The requested check passed.',
      error: null,
      questions: [],
    });
    const restartTime = Date.now();
    const restartedBackground = new BackgroundLoop(core);
    background = restartedBackground;
    restartedBackground.deferExisting(restartTime);
    await act(async () => {
      restartedBackground.tick(restartTime);
      await vi.waitFor(() =>
        expect(repo.get('continuation', requestId)?.execution?.status).toBe('completed'),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain(
          'User written task has a result ready to review.',
        ),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.querySelector('#pw-now-work-title')?.textContent).toBe(workB.title),
      );
    });
    expect(mounted.host.textContent).toContain('A result is ready for your review.');
    expect(mounted.host.textContent).toContain('Request for User written task');
    expect(repo.get('workItem', userWork.id)?.state).toBe('active');
    expect((await gateway.now(id)).now).toMatchObject({
      currentWorkId: selected,
      currentWorkSelection: 'user',
      execution: { workItemId: userWork.id, requestId, status: 'completed' },
    });
    expect((await gateway.execution(id)).record.accepted).toEqual([]);
    expect(session.send).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls.length).toBe(calls);
    await press(mounted.host, 'Review result');
    await act(async () => {
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain('The requested check passed.'),
      );
      await vi.waitFor(() =>
        expect(mounted!.host.textContent).toContain('Observed after the request'),
      );
    });
    expect(mounted.host.querySelector('.pw-now-mode-context strong')?.textContent).toBe(
      workB.title,
    );
    expect((await gateway.now(id)).now.currentWorkId).toBe(selected);
    expect((await gateway.execution(id)).record.accepted).toEqual([]);
    expect(generate.mock.calls.length).toBe(calls);
    expect(repo.list('source')[0].text).toBe(source().text);
  } finally {
    await mounted?.unmount();
    background?.stop();
    await close();
    repo.close();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  }
});
