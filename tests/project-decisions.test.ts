import { describe, expect, it, vi } from 'vitest';
import { StateCarry, type SessionExecutor } from '@statecarry/core';
import type {
  ChangeScope,
  ProjectExecutionCommand,
  ScopeObservation,
  SessionRun,
} from '@statecarry/contracts';
import { harness } from './helpers';
import { registerProject } from './project-fixtures';

function fixture(supported = true) {
  const h = harness();
  const id = registerProject(h).receipt.projectId;
  const scopes: ChangeScope[] = [
    {
      id: 'one',
      path: 'shared.ts',
      layer: 'staged',
      kind: 'hunk',
      description: '@@ -1 +1 @@',
      patch: '@@ -1 +1 @@\n-old\n+first',
    },
    {
      id: 'two',
      path: 'shared.ts',
      layer: 'unstaged',
      kind: 'hunk',
      description: '@@ -20 +20 @@',
      patch: '@@ -20 +20 @@\n-old\n+second',
    },
  ];
  let scope: ScopeObservation = {
    basis: 'basis-1',
    checkedAt: '2026-09-21T00:00:00.000Z',
    complete: true,
    scopes,
    limitations: [],
  };
  let execution: SessionRun = { status: 'running', report: '', error: null, questions: [] };
  const session: SessionExecutor = {
    capability: () => ({
      create: supported ? 'supported' : 'unsupported',
      send: supported ? 'supported' : 'unsupported',
      detail: '',
      verifiedAt: null,
    }),
    create: vi.fn(async () => ({ threadId: 'created' })),
    send: vi.fn(async () => ({ turnId: 'turn-1' })),
    read: vi.fn(async () => execution),
    answer: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
  };
  const core = new StateCarry(
    h.repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    h.core.ids,
    h.core.events,
    session,
    {
      scope: () => scope,
      inspect: () => ({
        cwd: '/tmp/example',
        root: '/tmp/example',
        branch: 'main',
        commit: 'head',
        dirty: scope.scopes.length > 0,
        status: 'checked',
        checkedAt: scope.checkedAt,
        changedPaths: ['shared.ts'],
        limitations: [],
        fileFingerprint: 'files',
      }),
    },
  );
  core.projectModel.createWork(
    id,
    {
      title: 'Review selected changes',
      completionCondition: 'The check is reported with its limits.',
    },
    'execution-work',
  );
  const workItemId = core.projectModel.view(id).workItems[0].id;
  const command = (input: ProjectExecutionCommand) =>
    core.executions.command(id, input, core.executions.view(id).record.version);
  const prepare = (
    operation: 'verify' | 'continue' | 'commit' | 'revert' | 'unstage' | 'policy' = 'verify',
    scopeIds = ['one'],
  ) =>
    command({
      action: 'prepare',
      context: {
        operation,
        basis: scope.basis,
        scopeIds,
        ...(operation === 'policy' ? {} : { workItemId }),
      },
      text: 'Check only the selected change.',
      doneWhen: 'The check is reported with its limits.',
      threadId: null,
    });
  return {
    core,
    id,
    workItemId,
    h,
    session,
    command,
    prepare,
    scopes,
    setScope: (s: ScopeObservation) => {
      scope = s;
    },
    setExecution: (e: SessionRun) => {
      execution = e;
    },
  };
}

describe('project decision loop', () => {
  it('prepares verification without loading unrelated file details and allows its normal artifacts', async () => {
    const f = fixture();
    f.setScope({
      basis: 'basis-1',
      checkedAt: '2026-09-21T00:00:00.000Z',
      complete: false,
      inventoryComplete: true,
      scopes: [],
      files: [
        {
          id: 'large',
          path: 'large.ts',
          layer: 'unstaged',
          detail: 'unread',
          limitation: 'Read separately.',
        },
      ],
      limitations: ['Details not read.'],
    });
    await f.command({ action: 'observe', outputLanguage: 'en' });
    const prepared = await f.prepare('verify', []);
    expect(prepared.requests[0].target.payload.projectContext).toMatchObject({
      operation: 'verify',
      scopeIds: [],
      workItemId: f.workItemId,
    });
    expect(prepared.requests[0].preparedText).toContain('normal generated build or test artifacts');
    expect(prepared.requests[0].preparedText).toContain('Do not implement fixes');
    expect(prepared.requests[0].preparedText).toContain('Excluded unstaged · large.ts');
    expect(f.session.send).not.toHaveBeenCalled();
    f.setScope({ ...prepared.record.observation!, checkedAt: '2026-09-21T00:01:00.000Z' });
    await f.command({ action: 'send', requestId: prepared.requests[0].id });
    expect(f.session.send).toHaveBeenCalledTimes(1);
  });

  it('requires a complete inventory and exact selected scopes, but not unrelated file details', async () => {
    const f = fixture();
    const partial: ScopeObservation = {
      basis: 'basis-1',
      checkedAt: '2026-09-21T00:00:00.000Z',
      complete: false,
      inventoryComplete: true,
      scopes: f.scopes,
      files: [
        {
          id: 'large',
          path: 'large.ts',
          layer: 'unstaged',
          detail: 'unread',
          limitation: 'Read separately.',
        },
      ],
      limitations: [],
    };
    f.setScope(partial);
    await f.command({ action: 'observe', outputLanguage: 'en' });
    await expect(f.prepare('commit', ['unread-file-scope'])).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const prepared = await f.prepare('commit', ['one']);
    expect(prepared.requests[0].preparedText).toContain('Excluded unstaged · large.ts');
    f.setScope({ ...partial, basis: 'changed-unread-file' });
    await expect(
      f.command({ action: 'send', requestId: prepared.requests[0].id }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.session.create).not.toHaveBeenCalled();
    f.setScope({ ...partial, inventoryComplete: false, scopes: [] });
    await expect(f.prepare('verify', [])).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('requires a real task for task execution and never invents one for policy work', async () => {
    const f = fixture();
    await f.command({ action: 'observe', outputLanguage: 'en' });
    const before = f.h.repo.list('workItem');
    await expect(
      f.command({
        action: 'prepare',
        context: { operation: 'verify', basis: 'basis-1', scopeIds: ['one'] },
        text: 'Check changes.',
        doneWhen: 'Checks pass.',
        threadId: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const policy = await f.prepare('policy');
    expect(policy.requests[0].target.payload.projectContext?.workItemId).toBeUndefined();
    expect(f.h.repo.list('workItem')).toEqual(before);
  });

  it('prepares exact scope, preserves excluded changes in the same file, and only sends explicitly', async () => {
    const f = fixture();
    const prepared = await f.prepare('commit');
    const request = prepared.requests[0];
    expect(request.preparedText).toContain('Included staged · shared.ts · one');
    expect(request.preparedText).toContain('Excluded changes:\n\nunstaged · shared.ts · two');
    expect(f.session.send).not.toHaveBeenCalled();
    await f.command({ action: 'send', requestId: request.id });
    await f.command({ action: 'send', requestId: request.id });
    expect(f.session.create).toHaveBeenCalledTimes(1);
    expect(f.session.send).toHaveBeenCalledTimes(1);
    expect(f.session.send).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'commit', text: request.preparedText }),
    );
  });
  it('links a prepared execution to the durable WorkItem that launched it', async () => {
    const f = fixture();
    f.h.repo.put('workItem', {
      id: 'durable-work',
      projectId: f.id,
      title: 'Validate the return flow',
      state: 'active',
      origin: 'user',
      completionCondition: 'The return flow is checked.',
      completionConditionOrigin: 'user',
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    });
    const prepared = await f.command({
      action: 'prepare',
      context: {
        operation: 'verify',
        basis: 'basis-1',
        scopeIds: ['one'],
        workItemId: 'durable-work',
      },
      text: 'Check the return flow.',
      doneWhen: 'The return flow is checked.',
      threadId: null,
    });
    const request = prepared.requests[0];
    expect(request.target.payload.projectContext?.workItemId).toBe('durable-work');
    expect(
      f.h.repo.list('workDecision').filter((decision) => decision.kind === 'execution-for-work'),
    ).toEqual([
      expect.objectContaining({
        projectId: f.id,
        workItemId: 'durable-work',
        value: { requestId: request.id },
        state: 'valid',
      }),
    ]);
  });
  it('rejects sending and copying against a changed basis', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    f.setScope({
      basis: 'new',
      scopes: f.scopes,
      complete: true,
      checkedAt: '2026-09-21T01:00:00.000Z',
      limitations: [],
    });
    await expect(f.command({ action: 'send', requestId: request.id })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(f.command({ action: 'review', requestId: request.id })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(f.session.send).not.toHaveBeenCalled();
  });
  it('keeps only selected scope and preserves the decision after unrelated changes', async () => {
    const f = fixture();
    await f.command({ action: 'keep', basis: 'basis-1', scopeIds: ['one'] });
    f.setScope({
      basis: 'unrelated',
      scopes: [...f.scopes, { ...f.scopes[1], id: 'other', path: 'other.ts' }],
      complete: true,
      checkedAt: '2026-09-21T01:00:00.000Z',
      limitations: [],
    });
    const view = await f.command({ action: 'observe', outputLanguage: 'en' });
    expect(view.record.kept[0].scopeIds).toEqual(['one']);
    expect(view.record.observation?.scopes).toHaveLength(3);
  });
  it('does not turn a successful report or clean Git into acceptance', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    f.setExecution({ status: 'completed', report: 'Done', error: null, questions: [] });
    await f.command({ action: 'sync', requestId: request.id });
    await expect(f.command({ action: 'accept', requestId: request.id })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    f.setScope({
      basis: 'clean',
      scopes: [],
      complete: true,
      checkedAt: '2026-09-21T01:00:00.000Z',
      limitations: [],
    });
    const compared = await f.command({
      action: 'compare',
      requestId: request.id,
      outputLanguage: 'en',
    });
    expect(compared.record.accepted).toEqual([]);
    expect(compared.record.comparisons[request.id].changed).toEqual(['one']);
    expect((await f.command({ action: 'accept', requestId: request.id })).record.accepted).toEqual([
      request.id,
    ]);
  });
  it('blocks invalid scope and distinguishes unstaging from discarding', async () => {
    const f = fixture();
    await expect(f.prepare('commit', [])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.prepare('revert', ['absent'])).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.prepare('unstage', ['two'])).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await f.prepare('unstage')).requests[0].preparedText).toContain(
      'Preserve the working files',
    );
  });
  it('allows copy preparation without a supported executor but never sends', async () => {
    const f = fixture(false);
    const request = (await f.prepare()).requests[0];
    expect(request.preparedText).toContain('Check only the selected change');
    await expect(f.command({ action: 'send', requestId: request.id })).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED',
    });
  });
  it('records conflict and requires an explicit direction or checked policy resolution', async () => {
    const f = fixture();
    await f.command({
      action: 'conflict',
      description: 'The new storage conflicts with local-only policy.',
      source: 'docs/policy.md',
    });
    await expect(f.prepare('continue')).rejects.toMatchObject({ code: 'VALIDATION' });
    await f.prepare('policy');
    const view = await f.command({ action: 'resolve-direction', text: 'Keep all storage local.' });
    expect(view.record.policyConflict?.status).toBe('resolved');
    expect(
      f.core.projectModel
        .directions(f.id)
        .find((direction) => direction.state === 'active' && direction.primary)?.text,
    ).toBe('Keep all storage local.');
  });
  it('records an explicit no-direction choice and clears it when a direction is later saved', async () => {
    const f = fixture();

    await f.command({ action: 'defer-direction' });
    expect(f.core.projectModel.directionDeferred(f.id)).toBe(true);
    expect(
      f.core.projectModel
        .directions(f.id)
        .filter((direction) => direction.state === 'active' && direction.primary),
    ).toEqual([]);

    await f.command({
      action: 'direction',
      text: 'Improve project return decisions.',
      finish: false,
    });

    expect(f.core.projectModel.directionDeferred(f.id)).toBe(false);
    expect(
      f.core.projectModel
        .directions(f.id)
        .find((direction) => direction.state === 'active' && direction.primary)?.text,
    ).toBe('Improve project return decisions.');
  });
  it('preserves the created conversation when the send outcome is unknown', async () => {
    const f = fixture();
    vi.mocked(f.session.send).mockRejectedValueOnce(new Error('Disconnected'));
    const request = (await f.prepare()).requests[0];
    const view = await f.command({ action: 'send', requestId: request.id });
    expect(view.requests[0]).toMatchObject({ threadId: 'created', state: 'result-unknown' });
    await f.command({ action: 'send', requestId: request.id });
    expect(f.session.send).toHaveBeenCalledTimes(1);
    await expect(f.prepare('continue')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('stores execution status changes and notifies the project-scoped update stream', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    f.setExecution({
      status: 'completed',
      report: 'The focused check passed.',
      error: null,
      questions: [],
    });
    const changed = vi.spyOn(f.core.events, 'changed');

    await f.core.executions.sync(f.id, request.id);

    expect(f.core.executions.view(f.id).requests[0].execution).toMatchObject({
      status: 'completed',
      report: 'The focused check passed.',
    });
    expect(changed).toHaveBeenCalledWith(f.id, 'execution');
  });
  it('records an honest unknown state after a failed check without sending again', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    vi.mocked(f.session.read!).mockRejectedValueOnce(new Error('transport detail'));

    await expect(f.core.executions.sync(f.id, request.id)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });

    expect(f.core.executions.view(f.id).requests[0].execution).toMatchObject({
      status: 'unknown',
      error:
        'StateCarry could not check this Codex request. Check the conversation before sending it again.',
    });
    await f.command({ action: 'send', requestId: request.id });
    expect(f.session.send).toHaveBeenCalledOnce();
  });
  it('derives execution state in Project Now without changing the user-selected Work lifecycle', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    await f.command({ action: 'sync', requestId: request.id });

    const selected = f.core.now.resolve(f.id);
    expect(selected).toMatchObject({
      currentWorkId: f.workItemId,
      currentWorkSelection: 'user',
      state: 'waiting',
      execution: { requestId: request.id, status: 'running' },
    });
    expect(f.core.repo.get('workItem', f.workItemId)?.state).toBe('active');

    f.core.projectModel.pauseWork(f.id, f.workItemId);
    const paused = f.core.now.resolve(f.id);
    expect(paused).toMatchObject({
      currentWorkId: f.workItemId,
      currentWorkSelection: 'user',
      state: 'paused',
      currentState: 'This work is paused.',
      execution: { requestId: request.id, status: 'running' },
    });
    f.core.projectModel.completeWork(f.id, f.workItemId);
    expect(f.core.now.resolve(f.id)).toMatchObject({
      currentWorkId: f.workItemId,
      currentWorkSelection: 'user',
      state: 'complete',
      currentState: 'This work is complete.',
      execution: { requestId: request.id, status: 'running' },
    });

    const stopped = fixture();
    const stoppedRequest = (await stopped.prepare()).requests[0];
    await stopped.command({ action: 'send', requestId: stoppedRequest.id });
    await stopped.command({ action: 'sync', requestId: stoppedRequest.id });
    stopped.core.projectModel.stopWork(stopped.id, stopped.workItemId);
    expect(stopped.core.now.resolve(stopped.id)).toMatchObject({
      currentWorkId: stopped.workItemId,
      currentWorkSelection: 'user',
      state: 'stopped',
      currentState: 'This work was stopped.',
      execution: { requestId: stoppedRequest.id, status: 'running' },
    });
  });
  it('keeps stopped Work stopped while matching kept changes by scope fingerprint', async () => {
    const f = fixture();
    f.core.projectModel.setDirection(f.id, 'Improve the project return experience.');
    f.core.projectModel.stopWork(f.id, f.workItemId);

    const beforeKeep = f.core.now.resolve(f.id);
    expect(beforeKeep.next?.kind).toBe('review-remaining-changes');
    expect(beforeKeep.secondaryActions.map((action) => action.kind)).toContain('discuss-work');

    await f.command({ action: 'observe', outputLanguage: 'en' });
    await f.command({ action: 'keep', basis: 'basis-1', scopeIds: ['one'] });
    const kept = f.core.repo.get('projectScope', f.id)!;
    expect(kept.kept[0]?.scopeIds).toEqual(['one']);
    expect(f.core.repo.get('workItem', f.workItemId)?.state).toBe('stopped');

    f.setScope({
      basis: 'basis-2',
      checkedAt: '2026-09-21T01:00:00.000Z',
      complete: true,
      scopes: [
        { ...f.scopes[0]!, id: 'one' },
        { ...f.scopes[1]!, id: 'two' },
      ],
      limitations: [],
    });
    await f.command({ action: 'observe', outputLanguage: 'en' });
    const unchangedKeptAndUnrelated = f.core.now.resolve(f.id);
    expect(unchangedKeptAndUnrelated.next?.kind).toBe('review-remaining-changes');
    expect(unchangedKeptAndUnrelated.currentWorkId).toBe(f.workItemId);
    expect(unchangedKeptAndUnrelated.state).toBe('stopped');

    await f.command({ action: 'keep', basis: 'basis-2', scopeIds: ['two'] });
    const allKept = f.core.now.resolve(f.id);
    expect(allKept.next?.kind).toBe('choose-next-work');
    expect(allKept.secondaryActions.map((action) => action.kind)).toContain('discuss-work');
    expect(allKept.currentWorkId).toBe(f.workItemId);
    expect(allKept.state).toBe('stopped');

    f.setScope({
      basis: 'basis-3',
      checkedAt: '2026-09-21T02:00:00.000Z',
      complete: true,
      scopes: [
        { ...f.scopes[0]!, id: 'one-changed', patch: `${f.scopes[0]!.patch}\n+changed` },
        { ...f.scopes[1]!, id: 'two' },
      ],
      limitations: [],
    });
    await f.command({ action: 'observe', outputLanguage: 'en' });
    expect(f.core.now.resolve(f.id)).toMatchObject({
      currentWorkId: f.workItemId,
      state: 'stopped',
      next: { kind: 'review-remaining-changes' },
    });
    expect(f.core.repo.get('workItem', f.workItemId)?.state).toBe('stopped');
  });
  it('does not open an empty remaining-changes decision for a checked clean project', async () => {
    const f = fixture();
    f.core.projectModel.setDirection(f.id, 'Improve the project return experience.');
    f.setScope({
      basis: 'clean-scope',
      checkedAt: '2026-09-21T00:00:00.000Z',
      complete: true,
      scopes: [],
      limitations: [],
    });
    await f.core.projects.observe(f.id, 'en', undefined, false);
    await f.command({ action: 'observe', outputLanguage: 'en' });
    f.core.projectModel.stopWork(f.id, f.workItemId);

    expect(f.core.now.resolve(f.id)).toMatchObject({
      currentWorkId: f.workItemId,
      state: 'stopped',
      next: { kind: 'choose-next-work' },
    });
  });
  it('does not let external reports, comparisons, closing, or acceptance hide an in-flight request', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    await f.command({ action: 'sync', requestId: request.id });
    const current = f.core.repo.get('projectExecution', f.id)!;
    f.core.repo.put('projectExecution', {
      ...current,
      accepted: [request.id],
      closed: [request.id],
    });

    expect(f.core.now.resolve(f.id)).toMatchObject({
      currentWorkId: f.workItemId,
      execution: { requestId: request.id, status: 'running' },
    });
    await expect(
      f.command({ action: 'record-result', requestId: request.id, report: 'It passed.' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      f.command({ action: 'close-request', requestId: request.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      f.command({ action: 'compare', requestId: request.id, outputLanguage: 'en' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.command({ action: 'accept', requestId: request.id })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(f.prepare('continue')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(f.session.send).toHaveBeenCalledOnce();
  });
  it('ignores a late execution read after service shutdown invalidates pending syncs', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    await f.command({ action: 'sync', requestId: request.id });
    let resolveLate!: (value: SessionRun) => void;
    vi.mocked(f.session.read!).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLate = resolve)),
    );
    const late = f.core.executions.sync(f.id, request.id);
    f.core.executions.cancelPendingExecutionSyncs();
    resolveLate({ status: 'completed', report: 'late result', error: null, questions: [] });
    await late;

    expect(f.core.executions.view(f.id).requests[0].execution).toMatchObject({
      status: 'running',
      report: '',
    });
  });
  it('coalesces status reads and ignores a late response after an interrupt', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    f.setExecution({ status: 'running', report: '', error: null, questions: [] });
    await f.command({ action: 'sync', requestId: request.id });

    let resolveLate!: (value: SessionRun) => void;
    vi.mocked(f.session.read!).mockImplementationOnce(
      () => new Promise((resolve) => (resolveLate = resolve)),
    );
    const late = f.core.executions.sync(f.id, request.id);
    void f.core.executions.sync(f.id, request.id);
    expect(f.session.read).toHaveBeenCalledTimes(2);

    await f.command({ action: 'interrupt', requestId: request.id });
    f.setExecution({ status: 'interrupted', report: '', error: null, questions: [] });
    await f.core.executions.sync(f.id, request.id, true);
    resolveLate({ status: 'running', report: 'late', error: null, questions: [] });
    await late;

    expect(f.core.executions.view(f.id).requests[0].execution).toMatchObject({
      status: 'interrupted',
      report: '',
    });
  });
  it('rejects another project request and concurrent decision overwrite', async () => {
    const f = fixture();
    await expect(f.command({ action: 'sync', requestId: 'foreign' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await f.command({ action: 'correct', key: 'work', text: 'My description' });
    await expect(
      f.core.executions.command(f.id, { action: 'correct', key: 'work', text: 'Old tab' }, 0),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.core.executions.view(f.id).record.corrections.work).toBe('My description');
  });
  it('does not regenerate analysis just to observe the project', async () => {
    const f = fixture();
    f.h.summary.analyzeWorkingTree = vi.fn();
    await f.command({ action: 'observe', outputLanguage: 'en' });
    expect(f.h.summary.analyzeWorkingTree).not.toHaveBeenCalled();
  });

  it('feeds compared execution evidence into a fresh explanation with explicit attribution', async () => {
    const f = fixture();
    f.h.summary.analyzeWorkingTree = vi.fn(async () => ({
      summary: 'The check returned.',
      groups: [
        {
          title: 'Review checked work',
          summary: 'A result is ready for review.',
          currentState: 'The agent reported the check result.',
          openItems: ['User review remains.'],
          suggestedNextStep: 'Review the result.',
          reason: 'A report is not acceptance.',
          doneWhen: 'The user reviews the result.',
          files: ['shared.ts'],
        },
      ],
    }));
    await f.command({ action: 'observe', outputLanguage: 'en' });
    await f.command({ action: 'analyze', outputLanguage: 'en' });
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    f.setExecution({
      status: 'completed',
      report: 'The focused test passed.',
      error: null,
      questions: [],
      checks: [{ command: 'pnpm test', exitCode: 0, output: 'Passed' }],
    });
    await f.command({ action: 'sync', requestId: request.id });
    await f.command({ action: 'compare', requestId: request.id, outputLanguage: 'en' });
    expect(f.h.summary.analyzeWorkingTree).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionResults: [
          expect.objectContaining({
            source: 'agent-report',
            current: true,
            accepted: false,
            checks: [expect.objectContaining({ exitCode: 0 })],
          }),
        ],
      }),
    );
    expect(f.h.summary.analyzeWorkingTree).toHaveBeenCalledTimes(2);
  });
  it('supports external execution reports without labelling them as Codex verification', async () => {
    const f = fixture(false);
    const request = (await f.prepare()).requests[0];
    await f.command({
      action: 'record-result',
      requestId: request.id,
      report: 'I ran the request externally; one check passed.',
    });
    const view = await f.command({
      action: 'compare',
      requestId: request.id,
      outputLanguage: 'en',
    });
    expect(view.requests[0].externalReport).toContain('externally');
    expect(view.requests[0].execution).toBeUndefined();
    expect(
      (await f.command({ action: 'accept', requestId: request.id })).record.accepted,
    ).toContain(request.id);
    expect(f.session.send).not.toHaveBeenCalled();
  });
  it('rechecks scope after creating a session and before submitting the message', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    vi.mocked(f.session.create).mockImplementation(async () => {
      f.setScope({
        basis: 'changed-during-create',
        scopes: f.scopes,
        complete: true,
        checkedAt: '2026-09-21T01:00:00.000Z',
        limitations: [],
      });
      return { threadId: 'created' };
    });
    const view = await f.command({ action: 'send', requestId: request.id });
    expect(view.requests[0]).toMatchObject({ state: 'failed', threadId: 'created' });
    expect(f.session.send).not.toHaveBeenCalled();
  });
  it('allows a new explicit request after reviewing a failed execution', async () => {
    const f = fixture();
    const request = (await f.prepare()).requests[0];
    await f.command({ action: 'send', requestId: request.id });
    f.setExecution({ status: 'failed', report: '', error: 'The check failed.', questions: [] });
    await f.command({ action: 'sync', requestId: request.id });
    await f.command({ action: 'close-request', requestId: request.id });
    const next = await f.prepare();
    expect(next.requests).toHaveLength(2);
    expect(next.requests[1].id).not.toBe(request.id);
    expect(next.record.accepted).toEqual([]);
  });
});
