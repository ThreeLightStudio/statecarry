import { describe, expect, it } from 'vitest';
import type { Entities } from '@statecarry/core';
import type { ExplanationInput, SourceRead } from '@statecarry/contracts';
import { harness, MemoryRepository, read, source, AT } from './helpers';
import { deferred, deletionCommand, projectCandidate, registerProject } from './project-fixtures';
import { fixtureAnswer, questionHarness } from './question-fixtures';
import { explanationHarness, fixtureExplanation } from './explanation-fixtures';

function executionRows(h: ReturnType<typeof harness>, workId: string) {
  const input: ExplanationInput = {
    workId,
    summaryId: 'summary-fixture',
    sourceRevisionIds: [],
    connectionRevision: 1,
    linkVersion: 1,
    policyVersion: 'fixture',
    analysis: h.summary.configuration(),
    capturedAt: AT,
    ranges: [],
    selectionComplete: true,
    limitations: [],
  };
  return {
    job: {
      id: 'summary-job',
      workId,
      inputVersion: '',
      extractorVersion: 'fixture',
      status: 'applied',
      attempts: 1,
      attemptToken: 'attempt',
      remote: null,
      candidate: null,
      model: 'fake',
      error: null,
      retryable: false,
      updatedAt: AT,
      resultId: null,
    },
    explanationJob: {
      id: 'explanation-job',
      workId,
      summaryId: input.summaryId,
      input,
      status: 'ready',
      calls: 2,
      repairs: 0,
      retries: 0,
      attemptToken: 'attempt',
      remote: null,
      candidate: null,
      resultId: null,
      error: null,
      queuedAt: AT,
      updatedAt: AT,
      phases: [],
    },
    questionExecution: {
      id: 'question-execution',
      workId,
      sessionId: 'session',
      turnId: 'turn',
      bodyHash: 'body',
      attempt: 1,
      status: 'completed',
      remote: null,
      analysis: h.summary.configuration(),
      updatedAt: AT,
    },
    continuation: {
      id: 'continuation',
      workId,
      requestId: 'continuation-request',
      target: {
        mode: 'new-session',
        threadId: null,
        title: 'Next session',
        workId,
        payload: {
          goal: null,
          currentState: 'Ready.',
          nextAction: 'Check the export.',
          constraints: [],
          doneWhen: 'The check passes.',
        },
        expectedRevision: h.core.work(workId).revision,
      },
      state: 'sent',
      threadId: 'created-thread',
      turnId: 'created-turn',
      error: null,
      createdAt: AT,
      updatedAt: AT,
    },
    handoff: {
      id: 'handoff',
      target: {
        title: 'Recorded session',
        role: 'work',
        workId,
        expectedRevision: h.core.work(workId).revision,
        summaryId: input.summaryId,
        threadId: 'thread-a',
        evidenceIds: [],
        draft: 'Saved app draft',
        precision: 'thread',
        url: null,
      },
      state: 'dispatched',
      error: null,
      createdAt: AT,
    },
  } satisfies Pick<
    Entities,
    'job' | 'explanationJob' | 'questionExecution' | 'continuation' | 'handoff'
  >;
}

describe('project deletion ownership and transaction', () => {
  it('removes only owned content and exclusive source copies, including historical revisions', async () => {
    const h = harness();
    const a = registerProject(h, { threadIds: ['thread-a', 'exclusive-thread'] });
    const b = registerProject(h, {
      title: 'Other project',
      cwd: '/tmp/other-project',
      threadIds: ['thread-a'],
    });
    const shared = source('Shared text.');
    const historical = source('Historical shared text.');
    const exclusive = source('Only the deleted registration uses this.', 'exclusive-thread');
    const oldExclusive = source('Old exclusive revision.', 'exclusive-thread');
    const unrelated = source('Not owned by either registration.', 'unrelated');
    h.reader.read = async (threadId) => read([threadId === 'thread-a' ? shared : exclusive]);
    await h.core.collect(a.receipt.workId);
    await h.core.collect(b.receipt.workId);
    h.repo.put('source', historical);
    h.repo.put('source', oldExclusive);
    h.repo.put('source', unrelated);
    h.core.projects.disconnect(b.receipt.workId, h.command(b.receipt.workId, {}));
    const otherBefore = h.core.work(b.receipt.workId);
    const otherConnection = h.repo.get('connection', b.receipt.resultId);
    const rows = executionRows(h, a.receipt.workId);
    for (const kind of Object.keys(rows) as (keyof typeof rows)[]) h.repo.put(kind, rows[kind]);
    const workId = a.receipt.workId;
    h.repo.put('draft', {
      id: 'draft',
      workId,
      threadId: 'thread-a',
      evidenceIds: [shared.id],
      summaryId: 'summary-fixture',
      text: 'Private draft.',
      revision: 1,
      updatedAt: AT,
    });
    h.repo.put('overlay', {
      id: 'overlay',
      workId,
      slot: 'next',
      text: 'Private correction.',
      baseSummaryId: 'summary-fixture',
      revision: 1,
      active: true,
      updatedAt: AT,
      history: [],
    });
    h.repo.put('visit', {
      id: 'visit',
      workId,
      summaryId: 'summary-fixture',
      evidenceIds: [shared.id],
      at: AT,
    });
    const before = structuredClone((h.repo as MemoryRepository).data);
    const preview = h.core.projects.deletionPreview(workId);
    expect(preview).toMatchObject({ blocked: false, exclusiveSources: 2, sharedSources: 2 });
    expect(preview.explanation).toContain('cannot be restored');
    expect(preview.explanation).toContain('request receipts');
    expect(preview.explanation).toContain('database records');
    expect(preview.explanation).toContain('observations.jsonl');
    expect(preview.explanation).toContain('backups are not removed');
    expect((h.repo as MemoryRepository).data).toEqual(before);
    const command = deletionCommand(h, workId);
    const result = h.core.projects.delete(workId, command);
    expect(h.core.projects.delete(workId, command)).toEqual(result);
    expect(h.core.projects.create(a.command)).toEqual(a.receipt);
    expect(h.repo.get('work', workId)).toBeNull();
    expect(h.repo.get('connection', a.receipt.resultId)).toBeNull();
    for (const kind of Object.keys(rows) as (keyof typeof rows)[])
      expect(h.repo.list(kind)).toEqual([]);
    expect(h.repo.list('draft')).toEqual([]);
    expect(h.repo.list('overlay')).toEqual([]);
    expect(h.repo.list('visit')).toEqual([]);
    expect(
      h.repo
        .list('source')
        .map((item) => item.id)
        .sort(),
    ).toEqual([shared.id, historical.id, unrelated.id].sort());
    expect(h.core.work(b.receipt.workId)).toEqual(otherBefore);
    expect(h.repo.get('connection', b.receipt.resultId)).toEqual(otherConnection);
    expect(h.core.projects.list().projects.map((project) => project.workId)).toEqual([
      b.receipt.workId,
    ]);
    expect(() =>
      h.core.projects.restore(workId, {
        requestId: 'cannot-restore',
        expectedRevision: result.committedRevision,
        payload: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() =>
      h.core.projects.delete(workId, { ...command, payload: { token: 'different' } }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('revalidates content changes without a revision bump and new sharing after preview', async () => {
    const h = harness();
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.workId;
    await h.core.collect(id);
    const command = deletionCommand(h, id);
    expect(() =>
      h.core.projects.delete(id, { ...command, payload: { token: 'tampered' } }),
    ).toThrowError(expect.objectContaining({ code: 'PROJECT_DELETION_CHANGED' }));
    h.repo.put('visit', {
      id: 'new-visit',
      workId: id,
      summaryId: 'summary',
      evidenceIds: [],
      at: AT,
    });
    expect(h.core.work(id).revision).toBe(command.expectedRevision);
    expect(() => h.core.projects.delete(id, command)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_DELETION_CHANGED' }),
    );
    const beforeSharing = deletionCommand(h, id);
    registerProject(h, { cwd: '/tmp/other-project', threadIds: ['thread-a'] });
    expect(() => h.core.projects.delete(id, beforeSharing)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_DELETION_CHANGED' }),
    );
    const stale = deletionCommand(h, id);
    h.core.projects.settings(id, h.command(id, { title: 'Changed', purpose: '', focused: false }));
    expect(() => h.core.projects.delete(id, stale)).toThrowError(
      expect.objectContaining({ code: 'REVISION_CONFLICT' }),
    );
    expect(h.repo.get('work', id)).not.toBeNull();
    expect(h.repo.list('source')).toHaveLength(1);
  });

  it('rolls the entire deletion back if removal fails after some rows were removed', async () => {
    class FailingRemoval extends MemoryRepository {
      override remove<K extends keyof Entities>(kind: K, id: string) {
        if (kind === 'source') throw new Error('injected source removal failure');
        super.remove(kind, id);
      }
    }
    const repo = new FailingRemoval();
    const h = harness(repo);
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.workId;
    await h.core.collect(id);
    const command = deletionCommand(h, id);
    const before = structuredClone(repo.data);
    expect(() => h.core.projects.delete(id, command)).toThrow('injected source removal failure');
    expect(repo.data).toEqual(before);
    expect(h.repo.get('receipt', command.requestId)).toBeNull();
  });

  it.each(['job', 'explanationJob', 'questionExecution', 'handoff', 'continuation'] as const)(
    'blocks an unresolved %s even with no recorded remote process',
    (kind) => {
      const h = harness();
      const id = registerProject(h).receipt.workId;
      const rows = executionRows(h, id);
      const row = rows[kind];
      h.repo.put(kind, {
        ...row,
        ...('status' in row
          ? { status: 'result-unknown' as const }
          : { state: 'result-unknown' as const }),
      });
      const preview = h.core.projects.deletionPreview(id);
      expect(preview.blocked).toBe(true);
      expect(preview.explanation).toContain('not been confirmed');
      expect(() => h.core.projects.delete(id, deletionCommand(h, id))).toThrowError(
        expect.objectContaining({ code: 'PROJECT_BUSY', status: 409 }),
      );
      expect(h.repo.get(kind, row.id)).not.toBeNull();
      expect(h.repo.get('work', id)).not.toBeNull();
    },
  );

  it('blocks queued jobs but does not block another project’s unrelated work', () => {
    const h = harness();
    const a = registerProject(h).receipt.workId;
    const b = registerProject(h, { cwd: '/tmp/other-project' }).receipt.workId;
    h.repo.put('job', { ...executionRows(h, a).job, status: 'queued' });
    expect(h.core.projects.deletionPreview(a).blocked).toBe(true);
    expect(h.core.projects.deletionPreview(b).blocked).toBe(false);
    h.core.projects.delete(b, deletionCommand(h, b));
    expect(h.repo.get('work', a)).not.toBeNull();
  });
});

describe('project deletion while work is awaiting a response', () => {
  it('blocks an in-flight collection and allows deletion only after it settles', async () => {
    const h = harness();
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.workId;
    const gate = deferred<SourceRead>();
    h.reader.read = () => gate.promise;
    const command = deletionCommand(h, id);
    const collecting = h.core.collect(id);
    expect(h.core.projects.deletionPreview(id).blocked).toBe(true);
    expect(() => h.core.projects.delete(id, command)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_BUSY' }),
    );
    gate.resolve(read([source()]));
    await collecting;
    h.core.projects.delete(id, deletionCommand(h, id));
    expect(h.repo.get('work', id)).toBeNull();
    expect(h.repo.list('source')).toEqual([]);
  });

  it('blocks live Resume analysis independently of durable summary jobs', async () => {
    const h = harness();
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.workId;
    const entered = deferred<void>();
    const gate = deferred<void>();
    h.summary.generateResume = async () => {
      entered.resolve();
      await gate.promise;
      return { candidates: [projectCandidate()] };
    };
    const pending = h.core.resumes.refresh(id);
    await entered.promise;
    expect(h.repo.list('job')).toEqual([]);
    expect(h.core.projects.deletionPreview(id).blocked).toBe(true);
    expect(() => h.core.projects.delete(id, deletionCommand(h, id))).toThrowError(
      expect.objectContaining({ code: 'PROJECT_BUSY' }),
    );
    h.core.projects.disconnect(id, h.command(id, {}));
    expect(h.core.projects.deletionPreview(id).blocked).toBe(true);
    gate.resolve();
    await pending;
    h.core.projects.delete(id, deletionCommand(h, id));
    expect(h.repo.get('work', id)).toBeNull();
    expect(h.core.resumes.list()).toEqual([]);
  });

  it('blocks discovery until its pending source result is settled', async () => {
    const h = harness();
    const { receipt } = registerProject(h, { threadIds: ['thread-a'], discover: true });
    const gate = deferred<Awaited<ReturnType<typeof h.reader.discover>>>();
    h.reader.discover = () => gate.promise;
    const pending = h.core.discover(h.core.connection(receipt.resultId));
    expect(() =>
      h.core.projects.delete(receipt.workId, deletionCommand(h, receipt.workId)),
    ).toThrowError(expect.objectContaining({ code: 'PROJECT_BUSY' }));
    gate.resolve({ threads: [], complete: true, limitations: [] });
    await pending;
    h.core.projects.delete(receipt.workId, deletionCommand(h, receipt.workId));
    expect(h.repo.get('connection', receipt.resultId)).toBeNull();
  });

  it('keeps a question blocked after scope invalidation until its real task settles, then forgets its session', async () => {
    const { h, id, create } = await questionHarness();
    const session = create();
    const entered = deferred<void>();
    const gate = deferred<void>();
    h.summary.answerQuestion = async (context) => {
      entered.resolve();
      await gate.promise;
      return fixtureAnswer(context);
    };
    h.core.questions.submit(id, session.id, {
      requestId: h.core.ids.next(),
      text: 'Why is this action needed?',
    });
    await entered.promise;
    h.core.questions.invalidateGoal(id);
    expect(() => h.core.projects.delete(id, deletionCommand(h, id))).toThrowError(
      expect.objectContaining({ code: 'PROJECT_BUSY' }),
    );
    gate.resolve();
    await h.core.questions.settled();
    h.core.projects.delete(id, deletionCommand(h, id));
    expect(h.repo.list('questionExecution')).toEqual([]);
    expect(() => h.core.questions.get(id, session.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('keeps a running explanation blocked and removes its ready content after completion', async () => {
    const { h, id, prepare, settled } = await explanationHarness();
    const entered = deferred<void>();
    const gate = deferred<void>();
    h.summary.generateExplanation = async (context) => {
      entered.resolve();
      await gate.promise;
      return fixtureExplanation(context);
    };
    prepare();
    await entered.promise;
    expect(() => h.core.projects.delete(id, deletionCommand(h, id))).toThrowError(
      expect.objectContaining({ code: 'PROJECT_BUSY' }),
    );
    gate.resolve();
    const result = await settled();
    expect(result.revision).not.toBeNull();
    h.core.projects.delete(id, deletionCommand(h, id));
    expect(h.repo.list('explanation')).toEqual([]);
    expect(h.repo.list('explanationJob')).toEqual([]);
    expect(h.repo.list('summary')).toEqual([]);
    expect(h.repo.list('source')).toEqual([]);
  });
});
