import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import type { Connection, SourceRead, WorkspaceSnapshot } from '@statecarry/contracts';
import { AT, harness, MemoryRepository, read, source } from './helpers';

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(threadIds = ['thread-a'], discover = false, inspector?: ProjectInspector) {
  let time = Date.parse(AT);
  const clock = { now: () => new Date(time).toISOString() };
  const repo = new MemoryRepository();
  const h = harness(repo, clock);
  const changed = vi.fn<(workId: string | null) => void>();
  const settled = vi.fn<(workId: string) => void>();
  const core = new StateCarry(
    h.repo,
    h.reader,
    h.summary,
    h.navigator,
    clock,
    h.core.ids,
    { changed, collectionSettled: settled },
    undefined,
    inspector,
  );
  const reads = new Map(
    ['thread-a', 'thread-b', 'thread-c'].map((id) => [
      id,
      { ...read([source(`Saved content for ${id}`, id)]), threadId: id, title: id },
    ]),
  );
  h.reader.read = vi.fn(async (id: string) => {
    const value = reads.get(id);
    if (!value) throw new Error('Source unavailable');
    return {
      ...structuredClone(value),
      observedAt: clock.now(),
      revisions: value.revisions.map((item) => ({ ...item, observedAt: clock.now() })),
    };
  });
  const discovery = {
    threads: threadIds.map((id) => ({ id, title: id, cwd: '/tmp/example' })),
    complete: true,
    limitations: [] as string[],
    manifest: {
      filter: { cwd: '/tmp/example' },
      complete: true,
      cursors: [null] as (string | null)[],
    },
  };
  h.reader.discover = vi.fn(async () => structuredClone(discovery));
  const id = core.connect({
    requestId: core.ids.next(),
    expectedRevision: 0,
    payload: { title: 'Collection fixture', cwd: '/tmp/example', threadIds, discover },
  }).workId;
  expect(changed.mock.calls).toEqual([[id]]);
  changed.mockClear();
  const connection = () => core.connection(core.work(id).projectId);
  const scope = (patch: Partial<Connection>) => {
    const current = connection();
    return core.updateConnection(current.id, {
      requestId: core.ids.next(),
      expectedRevision: core.work(id).revision,
      payload: {
        title: current.title,
        cwd: current.cwd,
        threadIds: current.threadIds,
        startTurnIds: current.startTurnIds,
        recordRanges: current.recordRanges,
        discover: current.discover,
        ...patch,
      },
    });
  };
  return {
    ...h,
    repo,
    core,
    id,
    reads,
    discovery,
    changed,
    settled,
    clock,
    connection,
    scope,
    advance: () => {
      time += 15000;
    },
    discover: () => core.discover(connection()),
  };
}

describe('settled collection change notifications', () => {
  it('emits once for a multi-thread result and no events for timestamp-only repeated reads', async () => {
    const h = fixture(['thread-a', 'thread-b', 'thread-c']);
    const statuses: string[][] = [];
    h.changed.mockImplementation(() => {
      expect(h.core.isCollecting(h.id)).toBe(false);
      statuses.push(h.repo.list('checkpoint').map((item) => item.status));
    });
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(statuses).toEqual([['checked', 'checked', 'checked']]);
    const work = h.core.work(h.id);
    const before = h.repo.list('checkpoint')[0].lastSuccessfulAt;
    h.changed.mockClear();
    h.advance();
    await h.core.collect(h.id);
    h.advance();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.core.work(h.id)).toEqual(work);
    expect(h.repo.list('checkpoint')[0].lastSuccessfulAt).not.toBe(before);
    expect(h.repo.list('checkpoint').every((item) => item.lastAttemptAt === h.clock.now())).toBe(
      true,
    );
    expect(h.core.sources(h.id).every((item) => item.observedAt === h.clock.now())).toBe(true);
    expect(h.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });
  });

  it('signals settled after collection has ended for changed, unchanged and failed results', async () => {
    const h = fixture();
    const terminal: { id: string; collecting: boolean; status: string }[] = [];
    h.settled.mockImplementation((id) => {
      terminal.push({
        id,
        collecting: h.core.isCollecting(id),
        status: h.repo.list('checkpoint')[0].status,
      });
    });
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    h.advance();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
    vi.mocked(h.reader.read).mockRejectedValueOnce(new Error('Source unavailable'));
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(terminal).toEqual([
      { id: h.id, collecting: false, status: 'checked' },
      { id: h.id, collecting: false, status: 'checked' },
      { id: h.id, collecting: false, status: 'failed' },
    ]);
  });

  it('preserves durable reading state and coalesces concurrent collects without notification churn', async () => {
    const h = fixture();
    await h.core.collect(h.id);
    h.changed.mockClear();
    h.settled.mockClear();
    const pendingRead = deferred<SourceRead>();
    vi.mocked(h.reader.read).mockImplementationOnce(() => pendingRead.promise);
    const first = h.core.collect(h.id);
    const second = h.core.collect(h.id);
    expect(second).toBe(first);
    expect(h.core.hasProjectActivity(h.id)).toBe(true);
    expect(h.core.isCollecting(h.id)).toBe(true);
    expect(h.repo.list('checkpoint')[0].status).toBe('reading');
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.settled).not.toHaveBeenCalled();
    pendingRead.resolve(h.reads.get('thread-a')!);
    await first;
    expect(h.core.hasProjectActivity(h.id)).toBe(false);
    expect(h.core.isCollecting(h.id)).toBe(false);
    expect(h.repo.list('checkpoint')[0].status).toBe('checked');
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.settled.mock.calls).toEqual([[h.id]]);
    expect(h.reader.read).toHaveBeenCalledTimes(2);
  });

  it('notifies once when multiple sources change and preserves immutable earlier records', async () => {
    const h = fixture(['thread-a', 'thread-b']);
    await h.core.collect(h.id);
    const oldSources = h.core.sources(h.id);
    h.changed.mockClear();
    for (const id of ['thread-a', 'thread-b'])
      h.reads.set(id, { ...read([source(`Corrected content for ${id}`, id)]), title: id });
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.core.sources(h.id).every((item) => item.text.startsWith('Corrected'))).toBe(true);
    for (const record of oldSources) expect(h.repo.get('source', record.id)).toEqual(record);
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('notifies on collection failure and recovery but not the same repeated failure', async () => {
    const h = fixture();
    await h.core.collect(h.id);
    const priorSources = h.core.sources(h.id);
    const originalRead = h.reader.read;
    h.reader.read = vi.fn(async () => {
      throw new Error('Connection unavailable');
    });
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.repo.list('checkpoint')[0].status).toBe('failed');
    expect(h.core.sources(h.id)).toEqual(priorSources);
    h.changed.mockClear();
    h.advance();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
    h.reader.read = originalRead;
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.repo.list('checkpoint')[0].status).toBe('checked');
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('distinguishes a changed coverage limit and its recovery from a clock update', async () => {
    const h = fixture();
    await h.core.collect(h.id);
    h.changed.mockClear();
    const saved = h.reads.get('thread-a')!;
    saved.status = 'partial';
    saved.limitations = ['Only part of the conversation was readable'];
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    h.advance();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
    saved.limitations = ['A required record boundary could not be checked'];
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    saved.status = 'checked';
    saved.limitations = [];
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
  });

  it('notifies on source replacement, missing records and changed link metadata', async () => {
    const h = fixture();
    const extra = source('Extra saved record', 'thread-a', 'extra');
    h.reads.get('thread-a')!.revisions.push(extra);
    await h.core.collect(h.id);
    h.changed.mockClear();
    h.reads.get('thread-a')!.revisions.pop();
    h.reads.get('thread-a')!.generation = 'replacement';
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.repo.list('checkpoint')[0].limitations.join(' ')).toContain('absent');
    expect(h.repo.get('source', extra.id)).not.toBeNull();
    // The first successful repeat clears the recorded replacement limitation.
    await h.core.collect(h.id);
    h.changed.mockClear();
    h.reads.get('thread-a')!.title = 'Recognizable conversation name';
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.core.links(h.id)[0].title).toBe('Recognizable conversation name');
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'rejected'] as const)(
    'keeps scope mutation events but rejects a late %s collection result',
    async (outcome) => {
      const h = fixture();
      await h.core.collect(h.id);
      const gate = deferred<SourceRead>();
      vi.mocked(h.reader.read).mockImplementationOnce(() => gate.promise);
      h.changed.mockClear();
      h.settled.mockClear();
      const pending = h.core.collect(h.id);
      h.scope({ startTurnIds: { 'thread-a': 'later-turn' } });
      expect(h.changed.mock.calls).toEqual([[h.id]]);
      const afterScope = structuredClone(h.repo.list('checkpoint'));
      h.changed.mockClear();
      if (outcome === 'resolved') gate.resolve(read([source('Obsolete result')]));
      else gate.reject(new Error('Obsolete read failed'));
      await pending;
      expect(h.changed).not.toHaveBeenCalled();
      expect(h.settled.mock.calls).toEqual([[h.id]]);
      expect(h.core.isCollecting(h.id)).toBe(false);
      expect(h.repo.list('checkpoint')).toEqual(afterScope);
      expect(h.core.sources(h.id)).toEqual([]);
      expect(h.repo.get('source', source('Obsolete result').id)).toBeNull();
    },
  );

  it('keeps the range mutation notification and emits one settled recollection result', async () => {
    const h = fixture();
    await h.core.collect(h.id);
    h.changed.mockClear();
    h.scope({ startTurnIds: { 'thread-a': 'turn-a' } });
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    await h.core.collect(h.id);
    expect(h.changed).not.toHaveBeenCalled();
  });
});

describe('settled discovery change notifications', () => {
  it('ignores identical discovery, recency order, pagination cursors and observation times', async () => {
    const h = fixture(['thread-a'], true);
    h.discovery.threads.push({ id: 'thread-b', title: 'thread-b', cwd: '/tmp/example' });
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    const before = h.connection().discovery!.successfulAt;
    h.changed.mockClear();
    h.advance();
    h.discovery.threads.reverse();
    h.discovery.manifest.cursors = [null, 'a-new-pagination-cursor'];
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.connection().discovery!.successfulAt).not.toBe(before);
    expect(h.connection().discovery!.attemptedAt).toBe(h.clock.now());
    expect(h.core.links(h.id).find((item) => item.threadId === 'thread-b')?.status).toBe(
      'proposed',
    );
    expect(h.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });
  });

  it('notifies on discovered membership, renamed proposals and changed proposal evidence', async () => {
    const h = fixture(['thread-a'], true);
    await h.discover();
    h.changed.mockClear();
    h.discovery.threads.push({ id: 'thread-b', title: 'Proposal B', cwd: '/tmp/example' });
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    h.discovery.threads[1].title = 'Renamed proposal';
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.core.links(h.id).find((item) => item.threadId === 'thread-b')?.title).toBe(
      'Renamed proposal',
    );
    h.changed.mockClear();
    h.reads.set('thread-b', read([source('New proposal context', 'thread-b')]));
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    h.discovery.threads.pop();
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('notifies on discovery failure and recovery without repeated failure events', async () => {
    const h = fixture(['thread-a'], true);
    await h.discover();
    const prior = h.connection().discovery!;
    const originalDiscover = h.reader.discover;
    h.reader.discover = vi.fn(async () => {
      throw new Error('Discovery unavailable');
    });
    h.changed.mockClear();
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.connection().discovery).toMatchObject({
      status: 'failed',
      successfulAt: prior.successfulAt,
      threadIds: prior.threadIds,
    });
    h.changed.mockClear();
    h.advance();
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
    h.reader.discover = originalDiscover;
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    h.changed.mockClear();
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('compares final partial discovery states rather than the temporary successful list read', async () => {
    const h = fixture(['thread-a'], true);
    h.discovery.threads.push({ id: 'thread-b', title: 'thread-b', cwd: '/tmp/example' });
    await h.discover();
    const originalRead = h.reader.read;
    h.reader.read = vi.fn(async () => {
      throw new Error('Proposed source unavailable');
    });
    h.changed.mockClear();
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.connection().discovery?.status).toBe('partial');
    h.changed.mockClear();
    h.advance();
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
    h.reader.read = originalRead;
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.connection().discovery?.status).toBe('checked');
  });

  it('publishes a proven followup and another source failure together without losing the failure to its own scope revision', async () => {
    const h = fixture(['thread-a'], true);
    h.discovery.threads.push(
      ...['thread-b', 'thread-c'].map((id) => ({ id, title: id, cwd: '/tmp/example' })),
    );
    h.reads.set('thread-b', read([source('Continue from thread-a.', 'thread-b')]));
    const originalRead = h.reader.read;
    h.reader.read = vi.fn(async (id, start) => {
      if (id === 'thread-c') throw new Error('Proposed source unavailable');
      return originalRead(id, start);
    });
    await h.discover();
    expect(h.changed.mock.calls).toEqual([[h.id]]);
    expect(h.core.links(h.id).find((item) => item.threadId === 'thread-b')?.status).toBe('linked');
    expect(h.connection().discovery).toMatchObject({
      status: 'partial',
      limitations: ['thread-c: Proposed source unavailable'],
    });
    h.changed.mockClear();
    h.advance();
    await h.discover();
    expect(h.changed).not.toHaveBeenCalled();
  });

  it.each(['list', 'source'] as const)(
    'rejects a late discovery %s after a scope edit without an extra notification',
    async (stage) => {
      const h = fixture(['thread-a'], true);
      h.discovery.threads.push({ id: 'thread-b', title: 'thread-b', cwd: '/tmp/example' });
      const listGate = deferred<Awaited<ReturnType<typeof h.reader.discover>>>();
      const sourceGate = deferred<SourceRead>();
      const reading = deferred<void>();
      if (stage === 'list') h.reader.discover = vi.fn(() => listGate.promise);
      else
        h.reader.read = vi.fn(() => {
          reading.resolve();
          return sourceGate.promise;
        });
      const pending = h.discover();
      if (stage === 'source') await reading.promise;
      h.scope({ startTurnIds: { 'thread-a': 'later-turn' } });
      expect(h.changed.mock.calls).toEqual([[h.id]]);
      const before = structuredClone(h.repo.data);
      h.changed.mockClear();
      listGate.resolve(h.discovery);
      sourceGate.resolve(read([source('Continue from thread-a.', 'thread-b')]));
      await pending;
      expect(h.changed).not.toHaveBeenCalled();
      expect(h.repo.data).toEqual(before);
      expect(h.core.links(h.id).find((item) => item.threadId === 'thread-b')?.status).not.toBe(
        'linked',
      );
    },
  );

  it('does not overwrite a proposal explicitly set aside while its discovery read is pending', async () => {
    const h = fixture(['thread-a'], true);
    h.discovery.threads.push({ id: 'thread-b', title: 'thread-b', cwd: '/tmp/example' });
    const gate = deferred<SourceRead>();
    const reading = deferred<void>();
    h.reader.read = vi.fn(() => {
      reading.resolve();
      return gate.promise;
    });
    const pending = h.discover();
    await reading.promise;
    const link = h.core.links(h.id).find((item) => item.threadId === 'thread-b')!;
    h.core.mutate(
      h.id,
      'link',
      h.command(h.id, { status: 'separate', linkRevision: link.revision }),
      link.id,
    );
    h.changed.mockClear();
    const before = structuredClone(h.repo.data);
    gate.resolve(read([source('Continue from thread-a.', 'thread-b')]));
    await pending;
    expect(h.repo.data).toEqual(before);
    expect(h.core.links(h.id).find((item) => item.threadId === 'thread-b')?.status).toBe(
      'separate',
    );
    expect(h.repo.list('source')).toEqual([]);
    expect(h.changed).not.toHaveBeenCalled();
  });
});

it('keeps workspace inspection on the live view read: quiet collection is not a file watcher or a workspace cache', async () => {
  let workspace: WorkspaceSnapshot = {
    cwd: '/tmp/example',
    branch: 'main',
    commit: 'same-commit',
    dirty: true,
    status: 'checked',
    checkedAt: AT,
    limitations: [],
    fileFingerprint: 'before-file-edit',
  };
  const inspect = vi.fn(() => structuredClone(workspace));
  const h = fixture(['thread-a'], true, { inspect });
  await h.core.collect(h.id);
  await h.discover();
  const before = h.core.resumes.view(h.id);
  expect(before.workspace?.fileFingerprint).toBe('before-file-edit');
  inspect.mockClear();
  h.changed.mockClear();
  workspace = { ...workspace, fileFingerprint: 'after-file-edit' };
  await h.core.collect(h.id);
  await h.discover();
  expect(inspect).not.toHaveBeenCalled();
  expect(h.changed).not.toHaveBeenCalled();
  const after = h.core.resumes.view(h.id);
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(after.workspace?.fileFingerprint).toBe('after-file-edit');
  expect(after.version).not.toBe(before.version);
  expect(h.changed).not.toHaveBeenCalled();
  expect(h.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });
});
