import { describe, expect, it, vi } from 'vitest';
import { harness, MemoryRepository } from './helpers';
import { deletionCommand, registerProject } from './project-fixtures';

describe('project registration by normalized folder', () => {
  it('stores the normalized folder and returns one registration for equivalent new requests', () => {
    const h = harness();
    const changed = vi.spyOn(h.core.events, 'changed');
    const first = registerProject(h, { cwd: '//tmp///draft/../example/./' });
    expect(h.core.connection(first.receipt.resultId).cwd).toBe('/tmp/example');
    expect(first.receipt.command).toBe('project-create');
    expect(changed).toHaveBeenCalledTimes(1);
    changed.mockClear();

    for (const cwd of ['/tmp/example', '/tmp//example/', '/tmp/./example', '/tmp/a/../example']) {
      const { command, receipt } = registerProject(h, { cwd });
      expect(receipt).toMatchObject({
        id: command.requestId,
        command: 'project-reuse',
        workId: first.receipt.workId,
        resultId: first.receipt.resultId,
        committedRevision: first.receipt.committedRevision,
      });
      expect(h.core.projects.create(command)).toEqual(receipt);
    }
    expect(h.core.projects.create(first.command)).toEqual(first.receipt);
    expect(h.repo.list('work')).toHaveLength(1);
    expect(h.repo.list('connection')).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it('preserves existing context and scope until new conversations are explicitly connected', () => {
    const h = harness();
    const read = vi.spyOn(h.reader, 'read');
    const discover = vi.spyOn(h.reader, 'discover');
    const generate = vi.fn();
    h.summary.generateResume = generate;
    const range = {
      start: { turnId: 'chosen-turn', itemId: 'first-item' },
      end: { turnId: 'chosen-turn', itemId: 'last-item' },
    };
    const first = registerProject(h, {
      title: 'Saved project',
      goal: 'Keep the current goal.',
      threadIds: ['thread-a'],
      startTurnIds: { 'thread-a': 'chosen-turn' },
      recordRanges: { 'thread-a': range },
    });
    const id = first.receipt.workId;
    h.core.projects.settings(
      id,
      h.command(id, {
        title: 'Saved project',
        purpose: 'Keep the existing purpose.',
        focused: true,
      }),
    );
    const beforeWork = h.core.work(id);
    const beforeConnection = h.core.connection(first.receipt.resultId);
    const beforeLinks = h.core.links(id);
    const version = h.core.resumes.view(id).version;
    const duplicate = registerProject(h, {
      cwd: '/tmp/./example/',
      title: 'Do not replace the saved title',
      purpose: 'Do not replace the saved purpose',
      goal: 'Do not replace the saved goal.',
      threadIds: ['new-thread'],
      startTurnIds: {},
      recordRanges: {},
      discover: true,
    });
    expect(duplicate.receipt).toMatchObject({
      command: 'project-reuse',
      workId: id,
      resultId: first.receipt.resultId,
      committedRevision: beforeWork.revision,
    });
    expect(h.core.work(id)).toEqual(beforeWork);
    expect(h.core.connection(first.receipt.resultId)).toEqual(beforeConnection);
    expect(h.core.links(id)).toEqual(beforeLinks);
    expect(h.core.resumes.view(id).version).toBe(version);
    expect(h.repo.list('source')).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(h.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });

    h.core.projects.sources(
      id,
      h.command(id, {
        threadIds: ['thread-a', 'new-thread'],
        startTurnIds: beforeConnection.startTurnIds,
        discover: false,
      }),
    );
    expect(h.core.connection(first.receipt.resultId)).toMatchObject({
      threadIds: ['thread-a', 'new-thread'],
      startTurnIds: beforeConnection.startTurnIds,
      recordRanges: { 'thread-a': range },
    });
    expect(h.repo.list('work')).toHaveLength(1);
    expect(h.core.work(id).goal).toEqual(beforeWork.goal);
  });

  it('returns a disconnected registration without restoring it or replacing its saved goal', () => {
    const h = harness();
    const first = registerProject(h, { goal: 'Keep the disconnected goal.' });
    const id = first.receipt.workId;
    h.core.projects.disconnect(id, h.command(id, {}));
    const before = h.core.projects.list();
    const beforeWork = h.core.work(id);
    const beforeConnection = h.repo.get('connection', first.receipt.resultId);
    const duplicate = registerProject(h, {
      cwd: '/tmp/./example/',
      title: 'Another title',
      goal: 'A replacement goal.',
      threadIds: ['new-thread'],
      discover: true,
    });
    expect(duplicate.receipt).toMatchObject({
      command: 'project-reuse',
      workId: id,
      resultId: first.receipt.resultId,
      committedRevision: beforeWork.revision,
    });
    expect(h.core.projects.list()).toEqual(before);
    expect(h.core.work(id)).toEqual(beforeWork);
    expect(h.repo.get('connection', first.receipt.resultId)).toEqual(beforeConnection);
    expect(h.core.listConnections()).toEqual([]);
  });

  it('matches a legacy folder spelling without rewriting its identity, profile or access scope', () => {
    const h = harness();
    const receipt = h.core.connect({
      requestId: 'legacy-registration',
      expectedRevision: 0,
      payload: {
        title: 'Legacy project title',
        cwd: '/tmp/./old/../example//',
        threadIds: ['thread-a'],
        startTurnIds: { 'thread-a': 'chosen-turn' },
        discover: false,
      },
    });
    const work = h.core.work(receipt.workId);
    const connection = h.core.connection(receipt.resultId);
    expect(work.projectProfile).toBeUndefined();
    const reused = registerProject(h, { title: 'New title', purpose: 'New purpose.' }).receipt;
    expect(reused).toMatchObject({
      command: 'project-reuse',
      workId: receipt.workId,
      resultId: receipt.resultId,
    });
    expect(h.core.work(receipt.workId)).toEqual(work);
    expect(h.core.connection(receipt.resultId)).toEqual(connection);
  });

  it('does not merge equal basenames in different absolute folders', () => {
    const h = harness();
    const a = registerProject(h, { cwd: '/one/export', title: 'Export' });
    const b = registerProject(h, { cwd: '/two/export/', title: 'Export' });
    expect(a.receipt.command).toBe('project-create');
    expect(b.receipt.command).toBe('project-create');
    expect(a.receipt.workId).not.toBe(b.receipt.workId);
    expect(a.receipt.resultId).not.toBe(b.receipt.resultId);
    expect(h.repo.list('connection').map((connection) => connection.cwd)).toEqual([
      '/one/export',
      '/two/export',
    ]);
  });

  it('treats all lexical root spellings as one folder', () => {
    const h = harness();
    const first = registerProject(h, { cwd: '/tmp/../..' });
    const reused = registerProject(h, { cwd: '///./../' });
    expect(h.core.connection(first.receipt.resultId).cwd).toBe('/');
    expect(reused.receipt).toMatchObject({
      command: 'project-reuse',
      workId: first.receipt.workId,
    });
    expect(h.repo.list('connection')).toHaveLength(1);
  });

  it('keeps exact request idempotency and revision-zero validation when a folder already exists', () => {
    const h = harness();
    const first = registerProject(h);
    const reused = registerProject(h, { cwd: '/tmp/./example' });
    const id = first.receipt.workId;
    h.core.projects.settings(id, h.command(id, { title: 'Changed', purpose: '', focused: false }));
    const before = structuredClone((h.repo as MemoryRepository).data);
    expect(h.core.projects.create(reused.command)).toEqual(reused.receipt);
    expect(h.core.projects.create(first.command)).toEqual(first.receipt);
    expect(() =>
      h.core.projects.create({
        ...reused.command,
        payload: { ...reused.command.payload, cwd: '/tmp//example' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(() =>
      h.core.projects.create({
        ...reused.command,
        requestId: 'wrong-revision',
        expectedRevision: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect((h.repo as MemoryRepository).data).toEqual(before);
    const latest = registerProject(h).receipt;
    expect(latest.committedRevision).toBe(h.core.work(id).revision);
  });

  it.each([false, true])(
    'requires cleanup when legacy registrations share a folder (one disconnected: %s)',
    (disconnected) => {
      const h = harness();
      h.connect();
      const second = h.connect();
      const connection = h.core.connection(h.core.work(second).projectId);
      h.repo.put('connection', {
        ...connection,
        cwd: '/tmp/./example/',
        removedAt: disconnected ? h.core.clock.now() : null,
      });
      const before = structuredClone((h.repo as MemoryRepository).data);
      expect(() => registerProject(h)).toThrowError(
        expect.objectContaining({
          code: 'VALIDATION',
          status: 409,
          message: expect.stringContaining('Clean up the existing registrations'),
        }),
      );
      expect((h.repo as MemoryRepository).data).toEqual(before);
    },
  );

  it('keeps request replays after deletion from recreating the removed project', () => {
    const h = harness();
    const first = registerProject(h);
    const reused = registerProject(h, { cwd: '/tmp/./example' });
    h.core.projects.delete(first.receipt.workId, deletionCommand(h, first.receipt.workId));
    const replacement = registerProject(h);
    expect(replacement.receipt.command).toBe('project-create');
    expect(replacement.receipt.workId).not.toBe(first.receipt.workId);
    expect(h.core.projects.create(first.command)).toEqual(first.receipt);
    expect(h.core.projects.create(reused.command)).toEqual(reused.receipt);
    expect(h.repo.list('work').map((work) => work.id)).toEqual([replacement.receipt.workId]);
  });

  it('leaves existing content and receipts intact when saving the reuse receipt fails', () => {
    const repo = new MemoryRepository();
    const h = harness(repo);
    registerProject(h);
    const before = structuredClone(repo.data);
    repo.fail = true;
    expect(() => registerProject(h, { cwd: '/tmp/./example' })).toThrow('injected commit failure');
    expect(repo.data).toEqual(before);
  });
});
