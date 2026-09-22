import { workingTreeGroupKey } from '@statecarry/contracts';
import { describe, expect, it, vi } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import { harness, MemoryRepository, source } from './helpers';
import { projectCandidate, registerProject } from './project-fixtures';

describe('project workspace registration and decisions', () => {
  it('adds semantic working-tree reconstruction from current repository evidence only', async () => {
    const h = harness();
    const { receipt } = registerProject(h);
    const inspector: ProjectInspector = {
      inspect: () => ({
        cwd: '/tmp/export-project',
        root: '/tmp/export-project',
        branch: 'main',
        commit: 'abcdef',
        dirty: true,
        changedPaths: ['src/recovery.ts', 'tests/recovery.test.ts'],
        changedFiles: [
          { path: 'src/recovery.ts', status: 'modified' },
          { path: 'tests/recovery.test.ts', status: 'modified' },
        ],
        changedFileCount: 2,
        additions: 24,
        deletions: 3,
        untrackedCount: 0,
        diffPreview: 'diff --git a/src/recovery.ts b/src/recovery.ts',
        recentCommits: [],
        status: 'checked',
        checkedAt: '2026-09-18T00:00:00.000Z',
        limitations: [],
        files: [],
      }),
    };
    h.summary.analyzeWorkingTree = vi.fn(async () => ({
      summary: 'Working-tree recovery is being implemented and covered by tests.',
      groups: [
        {
          title: 'Working-tree recovery',
          summary: 'Add repository-state recovery and its test coverage.',
          currentState: 'The implementation and related test both have uncommitted changes.',
          openItems: ['Review the continuation handoff.'],
          suggestedNextStep: 'Review the working-tree handoff in the running app.',
          reason:
            'The current diff contains the implementation and test changes but not live UI evidence.',
          doneWhen: 'The handoff is understandable in a real dirty project.',
          files: ['src/recovery.ts', 'tests/recovery.test.ts'],
        },
      ],
    }));
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      inspector,
    );

    const snapshot = await core.projects.observe(receipt.projectId, 'ko');

    expect(h.summary.analyzeWorkingTree).toHaveBeenCalledWith(
      expect.objectContaining({ projectTitle: 'Export project', outputLanguage: 'ko' }),
    );
    expect(snapshot.workingTreeAnalysis?.groups[0]).toMatchObject({
      title: 'Working-tree recovery',
      files: ['src/recovery.ts', 'tests/recovery.test.ts'],
    });

    await core.projects.observe(receipt.projectId, 'ko');
    expect(h.summary.analyzeWorkingTree).toHaveBeenCalledTimes(1);

    await core.projects.observe(receipt.projectId, 'en');
    expect(h.summary.analyzeWorkingTree).toHaveBeenCalledTimes(2);
    h.summary.answerQuestion = async (context) => {
      const excerpt = context.excerpts[0];
      return {
        items: [
          {
            id: 'changes',
            kind: 'record',
            nature: 'tool-result',
            text: 'The current project has uncommitted changes.',
            uncertainty: '',
            evidence: [
              { revisionId: excerpt.revisionId, start: excerpt.start, quote: excerpt.text },
            ],
          },
        ],
        unknowns: ['Whether these changes are worth continuing is your decision.'],
      };
    };
    h.summary.checkQuestion = async (_, answer) => ({
      checks: answer.items.map((item) => ({
        itemId: item.id,
        verdict: 'supported',
        reason: 'The tool record establishes dirty state.',
      })),
      unknownsSafe: true,
    });
    const before = core.analyses.view(receipt.projectId);
    const latest = before.workspace!;
    core.projectModel.selectProposal(
      receipt.projectId,
      workingTreeGroupKey(latest.workingTreeAnalysis!.groups[0]),
    );
    const workItem = core.projectModel.view(receipt.projectId).workItems[0];
    const request = {
      workItemId: workItem.id,
      version: before.version,
      question: 'Is this work worth continuing?',
      history: [],
    };
    const answer = await core.analyses.discuss(receipt.projectId, request);
    expect(answer.answer.items[0].text).toContain('uncommitted changes');
    expect(core.projectModel.view(receipt.projectId).workItems[0]).toEqual(workItem);
    expect(before.sessionCount).toBe(0);
    await expect(
      core.analyses.discuss(receipt.projectId, { ...request, version: 'old-basis' }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(
      core.analyses.discuss(receipt.projectId, { ...request, workItemId: 'missing-work' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('preserves independent folders and manual context without sessions, reads or model calls', async () => {
    const h = harness();
    const read = vi.spyOn(h.reader, 'read');
    const discover = vi.spyOn(h.reader, 'discover');
    const generate = vi.fn();
    h.summary.generateAnalysis = generate;
    const first = registerProject(h, { goal: 'Check a small export.', discover: true });
    const second = registerProject(h, { title: 'Another project', cwd: '/tmp/other-project' });
    expect(first.receipt.projectId).not.toBe(second.receipt.projectId);
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
    await h.core.collect(first.receipt.projectId);
    await h.core.process(first.receipt.projectId);
    const before = structuredClone((h.repo as MemoryRepository).data);
    const workspace = h.core.projects.list();
    h.core.projects.list();
    expect(workspace.projects).toHaveLength(2);
    expect(workspace.projects[0]).toMatchObject({
      projectId: first.receipt.projectId,
      connectionId: first.receipt.resultId,
      purpose: 'Make exports easy to resume.',
      title: 'Export project',
      focused: false,
      acceptedKeys: [],
      analysis: { state: 'empty', sessionCount: 0, goalText: 'Check a small export.' },
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

  it('keeps up to three explicit Home focus projects and keeps project purpose and title independent of goal', () => {
    const h = harness();
    const a = registerProject(h, { goal: 'First goal.' }).receipt.projectId;
    const b = registerProject(h, { title: 'Second project', cwd: '/tmp/second-project' }).receipt
      .projectId;
    const c = registerProject(h, { title: 'Third project', cwd: '/tmp/third-project' }).receipt
      .projectId;
    const d = registerProject(h, { title: 'Fourth project', cwd: '/tmp/fourth-project' }).receipt
      .projectId;
    const profileA = { title: 'Export tool', purpose: 'Reusable exports.', focused: true };
    const focusA = h.command(a, profileA);
    h.core.projects.settings(a, focusA);
    h.core.projects.settings(
      b,
      h.command(b, { title: 'Second project', purpose: '', focused: true }),
    );
    h.core.projects.settings(
      c,
      h.command(c, { title: 'Third project', purpose: '', focused: true }),
    );
    expect(
      h.core.projects.list().projects.map((project) => [project.projectId, project.focused]),
    ).toEqual([
      [a, true],
      [b, true],
      [c, true],
      [d, false],
    ]);
    expect(() =>
      h.core.projects.settings(
        d,
        h.command(d, { title: 'Fourth project', purpose: '', focused: true }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => h.core.projects.settings(a, { ...focusA, requestId: 'stale-focus' })).toThrowError(
      expect.objectContaining({ code: 'REVISION_CONFLICT' }),
    );
    h.core.describeGoal(a, h.command(a, { text: 'A different current goal.' }));
    expect(h.core.projects.list().projects[0]).toMatchObject({
      title: 'Export tool',
      purpose: 'Reusable exports.',
      focused: true,
      analysis: { goalText: 'A different current goal.' },
    });
    expect(h.core.connection(h.core.project(a).connectionId).title).toBe('Export tool');
    expect(h.core.projects.settings(a, focusA).command).toBe('project-settings');
    expect(h.core.project(a).focused).toBe(true);
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
    h.summary.generateAnalysis = async () => ({ candidates: [projectCandidate()] });
    await h.core.analyses.refresh(receipt.projectId);
    const sources = h.command(receipt.projectId, {
      threadIds: ['thread-a'],
      startTurnIds: {},
      discover: false,
    });
    const result = h.core.projects.sources(receipt.projectId, sources);
    expect(h.core.projects.sources(receipt.projectId, sources)).toEqual(result);
    expect(h.core.connection(receipt.resultId).recordRanges).toEqual({ 'thread-a': range });
    expect(() =>
      h.core.projects.sources(
        receipt.projectId,
        h.command(receipt.projectId, {
          threadIds: ['thread-a'],
          startTurnIds: { unselected: 'turn-a' },
          discover: false,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    h.core.projects.sources(
      receipt.projectId,
      h.command(receipt.projectId, { threadIds: [], startTurnIds: {}, discover: true }),
    );
    expect(h.core.projects.list().projects[0]).toMatchObject({
      purpose: 'Make exports easy to resume.',
      analysis: {
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
    expect(h.core.project(id).purposes).toEqual([]);
    const version = h.core.analyses.view(id).version;
    h.core.analyses.setGoal(id, { version, text: 'A new current goal for the old registration.' });
    expect(h.core.projects.list().projects[0]).toMatchObject({
      title: before.title,
      purpose: before.purpose,
      focused: false,
      analysis: { goalText: 'A new current goal for the old registration.' },
    });
    expect(h.core.project(id).title).toBe(before.title);
  });

  it('keeps the project revision stable when the saved goal text is unchanged', () => {
    const h = harness();
    const id = registerProject(h, { goal: 'Keep this exact goal.' }).receipt.projectId;
    const before = structuredClone(h.core.project(id));
    const version = h.core.analyses.view(id).version;
    const view = h.core.analyses.setGoal(id, { text: '  Keep this exact goal.  ', version });
    expect(h.core.project(id)).toEqual(before);
    expect(view.version).toBe(version);
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
      receipt.projectId,
      h.command(receipt.projectId, {
        threadIds: ['thread-a', 'thread-b'],
        startTurnIds: {},
        discover: false,
      }),
    );
    expect(h.core.connection(receipt.resultId).recordRanges?.['thread-b']).toEqual(range);
    h.core.projects.sources(
      receipt.projectId,
      h.command(receipt.projectId, {
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
    const id = receipt.projectId;
    h.core.projects.settings(id, h.command(id, { title: 'Export', purpose: '', focused: true }));
    h.core.removeConnection(receipt.resultId, h.command(id, {}));
    expect(h.core.project(id).focused).toBe(false);
    h.core.restoreConnection(receipt.resultId, h.command(id, {}));
    expect(h.core.projects.list().projects[0].focused).toBe(false);
  });

  it('counts only user decisions on current visible candidates, never an agent completion', async () => {
    const h = harness();
    const id = registerProject(h, { threadIds: ['thread-a'] }).receipt.projectId;
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
    h.summary.generateAnalysis = async () => ({ candidates: [task] });
    await h.core.analyses.refresh(id);
    expect(h.core.projects.list().projects[0]).toMatchObject({
      acceptedKeys: [],
      analysis: { candidates: [expect.objectContaining({ status: 'done' })] },
    });
    const correct = (kind: 'done' | 'paused' | 'restore') =>
      h.core.analyses.correct(id, {
        candidateKey: task.key,
        version: h.core.analyses.view(id).version,
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
    const view = h.core.analyses.view(id);
    h.core.projects.settings(
      id,
      h.command(id, {
        title: 'Renamed project',
        purpose: 'Make exports easy to resume.',
        focused: true,
      }),
    );
    expect(h.core.analyses.view(id).version).toBe(view.version);
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
      analysis: { candidates: [] },
    });
  });

  it('disconnects and restores the same registration without collection or analysis', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Preserve this manual goal.' });
    const id = receipt.projectId;
    h.core.projects.settings(
      id,
      h.command(id, { title: 'Export', purpose: 'Portable exports.', focused: true }),
    );
    const before = h.core.project(id);
    const remove = h.command(id, {});
    const removed = h.core.projects.disconnect(id, remove);
    expect(h.core.projects.disconnect(id, remove)).toEqual(removed);
    expect(h.core.projects.list().projects[0]).toMatchObject({
      projectId: id,
      connectionId: receipt.resultId,
      focused: true,
      analysis: null,
      disconnectedAt: h.core.clock.now(),
    });
    h.core.projects.settings(
      id,
      h.command(id, { title: 'Export', purpose: 'Portable exports.', focused: true }),
    );
    const restore = h.command(id, {});
    h.core.projects.restore(id, restore);
    expect(h.core.projects.restore(id, restore).command).toBe('project-restore');
    expect(h.core.projects.list().projects[0]).toMatchObject({
      projectId: id,
      connectionId: receipt.resultId,
      title: 'Export',
      purpose: 'Portable exports.',
      focused: true,
      disconnectedAt: null,
      analysis: { goalText: 'Preserve this manual goal.' },
    });
    expect(h.counts().generationCalls).toBe(0);
    expect(h.repo.list('source')).toEqual([]);
  });

  it('uses a curated unavailable result while keeping manual context when a saved read fails', () => {
    const h = harness();
    registerProject(h, { goal: 'Keep my goal.' });
    vi.spyOn(h.core.analyses, 'view').mockImplementation(() => {
      throw new Error('RAW_PROVIDER_PAYLOAD');
    });
    const result = h.core.projects.list();
    expect(result.projects[0]).toMatchObject({
      purpose: 'Make exports easy to resume.',
      analysis: { goalText: 'Keep my goal.', state: 'unavailable', candidates: [] },
    });
    expect(JSON.stringify(result)).not.toContain('RAW_PROVIDER_PAYLOAD');
  });
});
