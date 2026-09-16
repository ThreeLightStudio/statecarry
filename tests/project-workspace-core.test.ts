import { describe, expect, it, vi } from 'vitest';
import { StateCarry } from '@statecarry/core';
import { harness, MemoryRepository, source } from './helpers';
import { projectCandidate, registerProject } from './project-fixtures';

describe('project workspace registration and decisions', () => {
  it('preserves independent folders and manual context without sessions, reads or model calls', async () => {
    const h = harness();
    const read = vi.spyOn(h.reader, 'read');
    const discover = vi.spyOn(h.reader, 'discover');
    const generate = vi.fn();
    h.summary.generateResume = generate;
    const first = registerProject(h, { goal: 'Check a small export.', discover: true });
    const second = registerProject(h, { title: 'Another project', cwd: '/tmp/other-project' });
    expect(first.receipt.workId).not.toBe(second.receipt.workId);
    expect(first.receipt.resultId).not.toBe(second.receipt.resultId);
    expect(h.core.projects.create(first.command)).toEqual(first.receipt);
    expect(() =>
      h.core.projects.create({
        ...first.command,
        payload: { ...first.command.payload, title: 'Changed request' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    const connection = h.core.connection(first.receipt.resultId);
    await h.core.discover(connection);
    await h.core.collect(first.receipt.workId);
    await h.core.process(first.receipt.workId);
    const before = structuredClone((h.repo as MemoryRepository).data);
    const workspace = h.core.projects.list();
    h.core.projects.list();
    expect(workspace.projects).toHaveLength(2);
    expect(workspace.projects[0]).toMatchObject({
      workId: first.receipt.workId,
      connectionId: first.receipt.resultId,
      purpose: 'Make exports easy to resume.',
      title: 'Export project',
      focused: false,
      acceptedKeys: [],
      resume: { state: 'empty', sessionCount: 0, goalText: 'Check a small export.' },
    });
    expect((h.repo as MemoryRepository).data).toEqual(before);
    expect(read).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(h.counts().generationCalls).toBe(0);
    expect(h.repo.list('job')).toEqual([]);
    const restarted = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
    );
    expect(restarted.projects.list()).toEqual(workspace);
  });

  it('saves one explicit focus with revisions and keeps project purpose and title independent of goal', () => {
    const h = harness();
    const a = registerProject(h, { goal: 'First goal.' }).receipt.workId;
    const b = registerProject(h, { title: 'Second project', cwd: '/tmp/second-project' }).receipt
      .workId;
    const profileA = { title: 'Export tool', purpose: 'Reusable exports.', focused: true };
    const focusA = h.command(a, profileA);
    h.core.projects.settings(a, focusA);
    const formerRevision = h.core.work(a).revision;
    h.core.projects.settings(
      b,
      h.command(b, { title: 'Second project', purpose: '', focused: true }),
    );
    expect(h.core.work(a).revision).toBe(formerRevision + 1);
    expect(
      h.core.projects.list().projects.map((project) => [project.workId, project.focused]),
    ).toEqual([
      [a, false],
      [b, true],
    ]);
    expect(() => h.core.projects.settings(a, { ...focusA, requestId: 'stale-focus' })).toThrowError(
      expect.objectContaining({ code: 'REVISION_CONFLICT' }),
    );
    h.core.describeGoal(a, h.command(a, { text: 'A different current goal.' }));
    expect(h.core.projects.list().projects[0]).toMatchObject({
      title: 'Export tool',
      purpose: 'Reusable exports.',
      focused: false,
      resume: { goalText: 'A different current goal.' },
    });
    expect(h.core.connection(h.core.work(a).projectId).title).toBe('Export tool');
    expect(h.core.projects.settings(a, focusA).command).toBe('project-settings');
    expect(h.core.work(a).projectProfile?.focused).toBe(false);
  });

  it('preserves unspecified record ranges and supports explicitly removing every source', async () => {
    const h = harness();
    const record = source();
    const range = { start: { turnId: record.turnId, itemId: record.itemId } };
    const { receipt } = registerProject(h, {
      threadIds: ['thread-a'],
      goal: 'Keep the selected context.',
      recordRanges: { 'thread-a': range },
    });
    h.summary.generateResume = async () => ({ candidates: [projectCandidate()] });
    await h.core.resumes.refresh(receipt.workId);
    const sources = h.command(receipt.workId, {
      threadIds: ['thread-a'],
      startTurnIds: {},
      discover: false,
    });
    const result = h.core.projects.sources(receipt.workId, sources);
    expect(h.core.projects.sources(receipt.workId, sources)).toEqual(result);
    expect(h.core.connection(receipt.resultId).recordRanges).toEqual({ 'thread-a': range });
    expect(() =>
      h.core.projects.sources(
        receipt.workId,
        h.command(receipt.workId, {
          threadIds: ['thread-a'],
          startTurnIds: { unselected: 'turn-a' },
          discover: false,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    h.core.projects.sources(
      receipt.workId,
      h.command(receipt.workId, { threadIds: [], startTurnIds: {}, discover: true }),
    );
    expect(h.core.projects.list().projects[0]).toMatchObject({
      purpose: 'Make exports easy to resume.',
      resume: {
        goalText: 'Keep the selected context.',
        sessionCount: 0,
        candidates: [],
        state: 'unavailable',
      },
    });
    expect(h.core.connection(receipt.resultId)).toMatchObject({ threadIds: [], discover: false });
    expect(h.repo.get('source', record.id)).toEqual(record);
  });

  it('keeps an older registration’s name when its goal is edited through Resume', () => {
    const h = harness();
    const id = h.connect();
    const before = h.core.projects.list().projects[0];
    expect(h.core.work(id).projectProfile).toBeUndefined();
    const version = h.core.resumes.view(id).version;
    h.core.resumes.setGoal(id, { version, text: 'A new current goal for the old registration.' });
    expect(h.core.projects.list().projects[0]).toMatchObject({
      title: before.title,
      purpose: before.purpose,
      focused: false,
      resume: { goalText: 'A new current goal for the old registration.' },
    });
    expect(h.core.work(id).projectProfile?.title).toBe(before.title);
  });

  it('preserves a discovered conversation range when making it an explicit source', () => {
    const h = harness();
    const { receipt } = registerProject(h, { threadIds: ['thread-a'] });
    const range = { start: { turnId: 'first-chosen-turn', itemId: 'first-chosen-item' } };
    const connection = h.core.connection(receipt.resultId);
    h.repo.put('connection', {
      ...connection,
      discoveryScope: { startTurnIds: {}, recordRanges: { 'thread-b': range } },
    });
    h.core.projects.sources(
      receipt.workId,
      h.command(receipt.workId, {
        threadIds: ['thread-a', 'thread-b'],
        startTurnIds: {},
        discover: false,
      }),
    );
    expect(h.core.connection(receipt.resultId).recordRanges?.['thread-b']).toEqual(range);
    h.core.projects.sources(
      receipt.workId,
      h.command(receipt.workId, {
        threadIds: ['thread-a', 'thread-b'],
        startTurnIds: {},
        recordRanges: {},
        discover: false,
      }),
    );
    expect(h.core.connection(receipt.resultId).recordRanges).toEqual({});
  });

  it('never restores focus implicitly through the retained legacy connection endpoints', () => {
    const h = harness();
    const { receipt } = registerProject(h);
    const id = receipt.workId;
    h.core.projects.settings(id, h.command(id, { title: 'Export', purpose: '', focused: true }));
    h.core.removeConnection(receipt.resultId, h.command(id, {}));
    expect(h.core.work(id).projectProfile?.focused).toBe(false);
    h.core.restoreConnection(receipt.resultId, h.command(id, {}));
    expect(h.core.projects.list().projects[0].focused).toBe(false);
  });

  it('counts only user decisions on current visible candidates, never an agent completion', async () => {
    const h = harness();
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.workId;
    const report = {
      ...source('The agent reported the export complete.'),
      actor: 'agent' as const,
      kind: 'agentMessage',
    };
    const verified = {
      ...source('All export checks passed.', 'thread-a', 'tool-result'),
      actor: 'tool' as const,
      kind: 'commandExecution',
    };
    h.records([report, verified]);
    const task = {
      ...projectCandidate(report),
      status: 'done' as const,
      completion: { verified: [{ revisionId: verified.id, quote: verified.text }] },
    };
    h.summary.generateResume = async () => ({ candidates: [task] });
    await h.core.resumes.refresh(id);
    expect(h.core.projects.list().projects[0]).toMatchObject({
      acceptedKeys: [],
      resume: { candidates: [expect.objectContaining({ status: 'done' })] },
    });
    const correct = (kind: 'done' | 'paused' | 'restore') =>
      h.core.resumes.correct(id, {
        candidateKey: task.key,
        version: h.core.resumes.view(id).version,
        kind,
      });
    correct('done');
    expect(h.core.projects.list().projects[0].acceptedKeys).toEqual([task.key]);
    correct('paused');
    expect(h.core.projects.list().projects[0]).toMatchObject({
      acceptedKeys: [],
      pausedKeys: [task.key],
    });
    correct('restore');
    expect(h.core.projects.list().projects[0]).toMatchObject({ acceptedKeys: [], pausedKeys: [] });
    correct('done');
    const view = h.core.resumes.view(id);
    h.core.projects.settings(
      id,
      h.command(id, {
        title: 'Renamed project',
        purpose: 'Make exports easy to resume.',
        focused: true,
      }),
    );
    expect(h.core.resumes.view(id).version).toBe(view.version);
    expect(h.core.projects.list().projects[0].acceptedKeys).toEqual([task.key]);
    h.core.projects.settings(
      id,
      h.command(id, {
        title: 'Renamed project',
        purpose: 'A different reason for this project.',
        focused: true,
      }),
    );
    expect(h.core.projects.list().projects[0]).toMatchObject({
      acceptedKeys: [],
      pausedKeys: [],
      resume: { candidates: [] },
    });
  });

  it('disconnects and restores the same registration without collection or analysis', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Preserve this manual goal.' });
    const id = receipt.workId;
    h.core.projects.settings(
      id,
      h.command(id, { title: 'Export', purpose: 'Portable exports.', focused: true }),
    );
    const before = h.core.work(id);
    const remove = h.command(id, {});
    const removed = h.core.projects.disconnect(id, remove);
    expect(h.core.projects.disconnect(id, remove)).toEqual(removed);
    expect(h.core.projects.list().projects[0]).toMatchObject({
      workId: id,
      connectionId: receipt.resultId,
      focused: false,
      resume: null,
      disconnectedAt: h.core.clock.now(),
    });
    expect(() =>
      h.core.projects.settings(id, h.command(id, { title: 'Export', purpose: '', focused: true })),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    const restore = h.command(id, {});
    h.core.projects.restore(id, restore);
    expect(h.core.projects.restore(id, restore).command).toBe('project-restore');
    expect(h.core.projects.list().projects[0]).toMatchObject({
      workId: id,
      connectionId: receipt.resultId,
      title: 'Export',
      purpose: 'Portable exports.',
      focused: false,
      disconnectedAt: null,
      resume: { goalText: before.goal?.text },
    });
    expect(h.counts().generationCalls).toBe(0);
    expect(h.repo.list('source')).toEqual([]);
  });

  it('uses a curated unavailable result while keeping manual context when a saved read fails', () => {
    const h = harness();
    registerProject(h, { goal: 'Keep my goal.' });
    vi.spyOn(h.core.resumes, 'view').mockImplementation(() => {
      throw new Error('RAW_PROVIDER_PAYLOAD');
    });
    const result = h.core.projects.list();
    expect(result.projects[0]).toMatchObject({
      purpose: 'Make exports easy to resume.',
      resume: { goalText: 'Keep my goal.', state: 'unavailable', candidates: [] },
    });
    expect(JSON.stringify(result)).not.toContain('RAW_PROVIDER_PAYLOAD');
  });
});
