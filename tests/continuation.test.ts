import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@statecarry/contracts';
import { harness } from './helpers';
import { StateCarry, type SessionExecutor } from '@statecarry/core';
import type { WorkspaceSnapshot } from '@statecarry/contracts';

function executor(overrides: Partial<SessionExecutor> = {}): SessionExecutor {
  return {
    capability: () => ({
      create: 'supported',
      send: 'supported',
      verifiedAt: null,
      detail: 'test executor',
    }),
    create: vi.fn(async () => ({ threadId: 'new-thread' })),
    send: vi.fn(async () => ({ turnId: 'new-turn' })),
    ...overrides,
  };
}

async function prepared(session: SessionExecutor = executor()) {
  const h = harness(undefined, undefined, session),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const command = h.command(id, {
    targetMode: 'new-session',
    payload: {
      goal: 'Ship the return flow',
      currentState: 'The implementation is checked.',
      nextAction: 'Run the focused verification',
      constraints: ['Do not use records from another folder'],
      doneWhen: 'The focused verification passes.',
    },
  });
  return { h, id, session, command };
}

describe('continuation execution boundary', () => {
  it('reports unsupported without persisting or dispatching', () => {
    const h = harness(),
      id = h.connect();
    expect(() =>
      h.core.continuations.prepare(
        id,
        h.command(id, {
          targetMode: 'new-session',
          payload: {
            goal: null,
            currentState: 'Unknown.',
            nextAction: 'Review the records',
            constraints: [],
            doneWhen: 'The review is complete.',
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' }));
    expect(h.repo.list('continuation')).toHaveLength(0);
  });

  it('persists prepare, sends the full context, then opens separately', async () => {
    const { h, id, session, command } = await prepared();
    const continuation = h.core.continuations.prepare(id, command);
    expect(continuation.state).toBe('prepared');
    const receipt = await h.core.continuations.send(
      id,
      h.command(id, { continuationId: continuation.id }),
    );
    expect(receipt.command).toBe('continuation-send');
    expect(h.repo.get('continuation', continuation.id)).toMatchObject({
      state: 'sent',
      threadId: 'new-thread',
      turnId: 'new-turn',
    });
    const send = session.send as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        workId: id,
        threadId: 'new-thread',
        text: expect.stringContaining('Run the focused verification'),
      }),
    );
    const openReceipt = await h.core.continuations.open(
      id,
      h.command(id, { continuationId: continuation.id }),
    );
    expect(openReceipt.command).toBe('continuation-open');
    expect(h.repo.get('continuation', continuation.id)?.state).toBe('opened');
    expect(h.counts().openCalls).toBe(1);
  });

  it('can send to a linked existing conversation without creating a session', async () => {
    const session = executor(),
      { h, id } = await prepared(session);
    const command = h.command(id, {
      targetMode: 'existing-session',
      threadId: 'thread-a',
      payload: {
        goal: 'Continue the checked work',
        currentState: 'The linked conversation is ready.',
        nextAction: 'Inspect the next result',
        constraints: [],
        doneWhen: 'The result is recorded.',
      },
    });
    const continuation = h.core.continuations.prepare(id, command);
    await h.core.continuations.send(id, h.command(id, { continuationId: continuation.id }));
    expect(session.create).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread-a' }));
  });

  it('coalesces an exact send retry and keeps an unknown result from repeating', async () => {
    let resolveCreate!: (value: { threadId: string }) => void;
    const session = executor({
      create: vi.fn(
        () =>
          new Promise<{ threadId: string }>((resolve) => {
            resolveCreate = resolve;
          }),
      ),
    });
    const { h, id, command } = await prepared(session);
    const continuation = h.core.continuations.prepare(id, command),
      sendCommand = h.command(id, { continuationId: continuation.id });
    const first = h.core.continuations.send(id, sendCommand);
    const second = h.core.continuations.send(id, sendCommand);
    resolveCreate({ threadId: 'new-thread' });
    expect(await first).toEqual(await second);
    expect(session.create).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledTimes(1);

    const unknown = executor({
      send: vi.fn(async () => {
        throw new Error('response lost');
      }),
    });
    const x = await prepared(unknown),
      c = x.h.core.continuations.prepare(x.id, x.command),
      command2 = x.h.command(x.id, { continuationId: c.id });
    await x.h.core.continuations.send(x.id, command2);
    expect(x.h.repo.get('continuation', c.id)?.state).toBe('result-unknown');
    await x.h.core.continuations.send(x.id, command2);
    expect(unknown.send).toHaveBeenCalledTimes(1);
  });

  it('coalesces duplicate browser requests that use fresh request IDs', async () => {
    const session = executor(),
      { h, id, command } = await prepared(session);
    const first = h.core.continuations.prepare(id, command);
    const duplicate = h.core.continuations.prepare(id, {
      ...command,
      requestId: `${command.requestId}-retry`,
    });
    expect(duplicate.id).toBe(first.id);
    expect(h.repo.list('continuation')).toHaveLength(1);

    const sent = await h.core.continuations.send(id, h.command(id, { continuationId: first.id }));
    const retry = await h.core.continuations.send(id, {
      ...h.command(id, { continuationId: first.id }),
      requestId: 'send-retry-with-new-id',
    });
    expect(retry).toEqual(sent);
    expect(session.create).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh explicit prepare before retrying a confirmed failure', async () => {
    const session = executor({
      send: vi.fn(async () => {
        throw new DomainError('CAPABILITY_UNSUPPORTED', 'provider rejected the request');
      }),
    });
    const { h, id, command } = await prepared(session);
    const first = h.core.continuations.prepare(id, command);
    await h.core.continuations.send(id, h.command(id, { continuationId: first.id }));
    expect(h.repo.get('continuation', first.id)?.state).toBe('failed');

    const retry = h.core.continuations.prepare(id, { ...command, requestId: 'explicit-retry' });
    expect(retry.id).not.toBe(first.id);
    expect(retry.state).toBe('prepared');
  });

  it('rejects changed request bodies under the same request ID', async () => {
    const { h, id, command } = await prepared();
    const continuation = h.core.continuations.prepare(id, command),
      sendCommand = h.command(id, { continuationId: continuation.id });
    await h.core.continuations.send(id, sendCommand);
    await expect(
      h.core.continuations.send(id, { ...sendCommand, payload: { continuationId: 'different' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('accepts only supporting quotes still accessible in the work', async () => {
    const session = executor();
    const h = harness(undefined, undefined, session),
      id = h.connect();
    await h.core.collect(id);
    const record = h.core.sources(id)[0];
    const base = {
      targetMode: 'new-session' as const,
      threadId: null,
      payload: {
        goal: null,
        currentState: 'The current status is recorded.',
        nextAction: 'Review the result',
        constraints: [],
        doneWhen: 'The result is recorded.',
      },
    };
    const valid = h.core.continuations.prepare(
      id,
      h.command(id, {
        ...base,
        payload: { ...base.payload, evidence: [{ revisionId: record.id, quote: record.text }] },
      }),
    );
    expect(valid.target.payload.evidence).toHaveLength(1);
    await expect(() =>
      h.core.continuations.prepare(
        id,
        h.command(id, {
          ...base,
          payload: {
            ...base.payload,
            evidence: [{ revisionId: record.id, quote: 'quote not in source' }],
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'HANDOFF_EVIDENCE_INACCESSIBLE' }));
  });

  it('does not send a continuation prepared against an older work revision', async () => {
    const { h, id, command, session } = await prepared();
    const continuation = h.core.continuations.prepare(id, command);
    h.repo.put('work', { ...h.core.work(id), revision: h.core.work(id).revision + 1 });
    await expect(
      h.core.continuations.send(id, h.command(id, { continuationId: continuation.id })),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(session.send).not.toHaveBeenCalled();
  });

  it('does not dispatch a cached brief after the project workspace changes', async () => {
    const session = executor();
    const h = harness(undefined, undefined, session);
    let current: WorkspaceSnapshot = {
      cwd: '/tmp/example',
      root: '/tmp/example',
      branch: 'main',
      commit: 'old-commit',
      dirty: false,
      status: 'checked',
      checkedAt: '2026-09-15T00:00:00.000Z',
      limitations: [],
    };
    const inspector = { inspect: () => ({ ...current, limitations: [...current.limitations] }) };
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      session,
      inspector,
    );
    const id = core.connect({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: { title: 'Project', cwd: current.cwd, threadIds: ['thread-a'], discover: false },
    }).workId;
    const work = core.work(id);
    core.repo.put('work', {
      ...work,
      resume: {
        scope: 'scope',
        version: 'version',
        generatedAt: current.checkedAt,
        workspaceBefore: current,
        workspaceAfter: current,
        candidates: [],
      },
    });
    const command = {
      requestId: h.core.ids.next(),
      expectedRevision: work.revision,
      payload: {
        targetMode: 'new-session' as const,
        threadId: null,
        payload: {
          goal: null,
          currentState: 'The current state is recorded.',
          nextAction: 'Review the result',
          constraints: [],
          doneWhen: 'The result is recorded.',
        },
      },
    };
    const continuation = core.continuations.prepare(id, command);
    current = { ...current, commit: 'new-commit', checkedAt: '2026-09-15T00:01:00.000Z' };
    await expect(
      core.continuations.send(id, {
        requestId: h.core.ids.next(),
        expectedRevision: work.revision,
        payload: { continuationId: continuation.id },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(session.create).not.toHaveBeenCalled();
  });

  it('does not dispatch a continuation when connected records changed after its brief', async () => {
    const session = executor();
    const { h, id } = await prepared(session);
    const record = h.core.sources(id)[0];
    h.summary.generateResume = async () => ({
      candidates: [
        {
          key: 'resume',
          goal: 'Continue the checked work',
          currentState: 'The next check remains open.',
          status: 'active',
          reason: 'The check is still open.',
          nextAction: 'Run the focused check',
          doneWhen: 'The check result is recorded.',
          actionSource: 'recorded',
          threadId: record.threadId,
          prerequisites: [],
          evidence: [{ revisionId: record.id, quote: record.text }],
          progress: { reported: [], implemented: [], verified: [] },
          completion: { reported: [], verified: [] },
        },
      ],
    });
    await h.core.resumes.refresh(id);
    const view = h.core.resumes.view(id),
      candidate = view.candidates[0];
    const continuation = h.core.continuations.prepare(
      id,
      h.command(id, {
        targetMode: 'new-session',
        threadId: null,
        payload: {
          goal: candidate.goal,
          currentState: candidate.currentState,
          nextAction: candidate.nextAction!,
          constraints: [],
          doneWhen: candidate.doneWhen!,
          previousThreadId: candidate.threadId,
        },
      }),
    );
    h.records([
      {
        ...record,
        id: `${record.id}-new`,
        key: `${record.key}-new`,
        text: 'A later record changed the connected work.',
      },
    ]);
    await h.core.collect(id);
    await expect(
      h.core.continuations.send(id, h.command(id, { continuationId: continuation.id })),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(session.create).not.toHaveBeenCalled();
  });
});
