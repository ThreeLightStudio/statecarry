import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateCarry, type ProjectInspector, type StateRepository } from '@statecarry/core';
import type { WorkspaceSnapshot } from '@statecarry/contracts';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { identity } from '../apps/server/src/adapters/identity';
import { harness, MemoryRepository } from './helpers';
import { projectCandidate } from './project-fixtures';

const AT = '2026-09-19T00:00:00.000Z';

function observedSnapshot(inventoryFingerprint = 'inventory-a'): WorkspaceSnapshot {
  return {
    cwd: '/tmp/observed-project',
    root: '/tmp/observed-project',
    branch: 'main',
    commit: 'abcdef',
    dirty: true,
    changedPaths: ['src/main.ts'],
    changedFiles: [{ path: 'src/main.ts', status: 'modified' }],
    changedFileCount: 1,
    additions: 2,
    deletions: 1,
    untrackedCount: 0,
    diffPreview: 'diff --git a/src/main.ts b/src/main.ts\n+changed',
    recentCommits: [],
    status: 'checked',
    checkedAt: AT,
    limitations: [],
    fileFingerprint: 'semantic-files-a',
    inventoryFingerprint,
    files: [
      {
        path: 'src/main.ts',
        hash: 'content-a',
        size: 42,
        preview: 'export const changed = true;',
        status: 'checked',
        selection: 'related',
      },
    ],
  };
}

function cleanSnapshot(): WorkspaceSnapshot {
  return {
    ...observedSnapshot(),
    dirty: false,
    changedPaths: [],
    changedFiles: [],
    changedFileCount: 0,
    additions: 0,
    deletions: 0,
    diffPreview: '',
    files: [],
  };
}

function unknownSnapshot(): WorkspaceSnapshot {
  return {
    ...observedSnapshot(),
    dirty: null,
    status: 'unknown',
    limitations: ['Git state could not be read.'],
  };
}

function inspectorFixture(snapshot = observedSnapshot) {
  let probeFingerprint = 'probe-a';
  let inventoryFingerprint = 'inventory-a';
  let probes = 0;
  let inspections = 0;
  const inspector: ProjectInspector = {
    probe: (cwd) => {
      probes++;
      return {
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: probeFingerprint,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      };
    },
    inspect: () => {
      inspections++;
      return snapshot(inventoryFingerprint);
    },
  };
  return {
    inspector,
    counts: () => ({ probes, inspections }),
    changeProbe: (value: string, inventory: string) => {
      probeFingerprint = value;
      inventoryFingerprint = inventory;
    },
  };
}

function coreWithObservation(
  repo: StateRepository,
  inspector: ProjectInspector,
  analyzeWorkingTree: ReturnType<typeof vi.fn>,
) {
  const h = harness(repo);
  h.summary.analyzeWorkingTree = analyzeWorkingTree;
  const events = vi.fn();
  const core = new StateCarry(
    repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    identity,
    { changed: events },
    inspector,
  );
  return { core, h, events };
}

function register(core: StateCarry) {
  return core.projects.create({
    requestId: identity.next(),
    expectedRevision: 0,
    payload: {
      title: 'Observed project',
      purpose: 'Measure observation reuse.',
      cwd: '/tmp/observed-project',
      threadIds: [],
      discover: false,
    },
  }).projectId;
}

function analysis() {
  return {
    summary: 'One semantic change is in progress.',
    groups: [
      {
        title: 'Current change',
        summary: 'The current diff changes one source file.',
        currentState: 'The source file is modified.',
        openItems: [],
        suggestedNextStep: 'Review the change.',
        reason: 'The diff contains one modification.',
        doneWhen: 'The change is verified.',
        files: ['src/main.ts'],
      },
    ],
  };
}

function waitForRelease() {
  let release!: () => void;
  return {
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

describe('project observation reuse', () => {
  it('joins refreshed and working-tree proposals from one verified file record', async () => {
    const repo = new MemoryRepository();
    const observed = inspectorFixture((inventory) => ({
      ...observedSnapshot(inventory),
      files: [
        {
          ...observedSnapshot(inventory).files![0],
          preview: 'Reply language configurable. Diagnostic errors details.',
        },
      ],
    }));
    const analyzeWorkingTree = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      return {
        ...analysis(),
        groups: [
          {
            ...analysis().groups[0],
            title: 'Configure reply language',
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: 'Reply language is configurable.',
                sources: [{ revisionId: record.revisionId, quote: 'Reply language configurable.' }],
              },
            ],
          },
          {
            ...analysis().groups[0],
            title: 'Investigate diagnostic errors',
            currentState: 'Diagnostic errors need review.',
            context: [
              {
                kind: 'unknown',
                nature: 'file-observation',
                text: 'Diagnostic errors are present.',
                sources: [{ revisionId: record.revisionId, quote: 'Diagnostic errors details.' }],
              },
            ],
          },
        ],
      };
    });
    const { core, h } = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
    h.summary.generateAnalysis = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      return {
        candidates: [
          {
            ...projectCandidate({
              id: record.revisionId,
              text: 'Reply language configurable.',
              threadId: record.threadId,
            } as any),
            goal: 'Make reply language configurable',
            currentState: 'The reply language setting is in the current file change.',
          },
          {
            ...projectCandidate({
              id: record.revisionId,
              text: 'Diagnostic errors details.',
              threadId: record.threadId,
            } as any),
            key: 'diagnostic-errors',
            goal: 'Investigate diagnostic errors',
            currentState: 'Diagnostic errors are in the current file change.',
          },
        ],
      };
    });
    const projectId = register(core);
    await core.analyses.refresh(projectId, 'en');
    await core.projects.observe(projectId, 'en');
    const matches = core.workMatcher.match(projectId);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(4);
    expect(matches).toHaveLength(2);
    const language = matches.find(
      (match) =>
        match.proposal.title === 'Configure reply language' ||
        match.aliases?.some((alias) => alias.title === 'Configure reply language'),
    )!;
    expect(language).toMatchObject({ confidence: 'possible' });
    expect([language.proposal, ...(language.aliases ?? [])]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'analysis-candidate',
          evidenceQuotes: [expect.any(Object)],
        }),
        expect.objectContaining({
          source: 'working-tree-group',
          evidenceQuotes: [expect.any(Object)],
        }),
      ]),
    );
    const diagnostic = matches.find(
      (match) =>
        match.proposal.title === 'Investigate diagnostic errors' ||
        match.aliases?.some((alias) => alias.title === 'Investigate diagnostic errors'),
    )!;
    expect([diagnostic.proposal, ...(diagnostic.aliases ?? [])]).toHaveLength(2);
    core.projectModel.selectProposal(projectId, language.proposal.key);
    const workId = core.now.resolve(projectId).currentWorkId;
    const alias = language.aliases![0];
    core.projectModel.selectProposal(projectId, alias.key);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);
    core.projectModel.selectProposal(projectId, diagnostic.proposal.key);
    const diagnosticWorkId = core.now.resolve(projectId).currentWorkId;
    core.projectModel.selectProposal(projectId, diagnostic.aliases![0].key);
    expect(diagnosticWorkId).not.toBe(workId);
    expect(core.now.resolve(projectId).currentWorkId).toBe(diagnosticWorkId);
    expect(core.projectModel.view(projectId).workItems).toHaveLength(2);
  });
  it('keeps reads passive and reenters an unchanged project with probe only', async () => {
    const repo = new MemoryRepository();
    const observed = inspectorFixture();
    const analyzeWorkingTree = vi.fn(async () => analysis());
    const { core, events } = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
    const projectId = register(core);
    events.mockClear();

    core.projects.list();
    await core.projects.workspace(projectId);
    expect(observed.counts()).toEqual({ probes: 0, inspections: 0 });
    expect(analyzeWorkingTree).not.toHaveBeenCalled();

    await core.projects.observe(projectId, 'en');
    expect(observed.counts()).toEqual({ probes: 1, inspections: 1 });
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    const firstAnalysisInput = (analyzeWorkingTree.mock.calls as unknown[][])[0][0];
    expect(firstAnalysisInput).toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({
          revisionId: expect.stringMatching(/^workspace-git:/),
          actor: 'tool',
          text: expect.stringContaining('Git workspace: branch main'),
        }),
        expect.objectContaining({
          revisionId: expect.stringMatching(/^workspace-file:/),
          actor: 'tool',
          text: expect.stringContaining('File observation: src/main.ts'),
        }),
      ]),
    });

    const saved = await core.projects.workspace(projectId);
    expect(saved.workingTreeAnalysis?.summary).toContain('semantic change');
    expect(observed.counts()).toEqual({ probes: 1, inspections: 1 });
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);

    await core.projects.observe(projectId, 'en');
    expect(observed.counts()).toEqual({ probes: 2, inspections: 1 });
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);

    await core.projects.analyzeLatest(projectId, 'ko');
    expect(observed.counts()).toEqual({ probes: 2, inspections: 1 });
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);

    observed.changeProbe('probe-b', 'inventory-mtime-only');
    await core.projects.observe(projectId, 'en');
    expect(observed.counts()).toEqual({ probes: 3, inspections: 2 });
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);

    const profile = core.project(projectId);
    core.projects.settings(projectId, {
      requestId: identity.next(),
      expectedRevision: core.project(projectId).revision,
      payload: {
        title: profile.title,
        focused: profile.focused,
        iconAsset: profile.iconAsset,
        bannerAsset: profile.bannerAsset,
        purpose: 'Profile only.',
      },
    });
    expect(events).toHaveBeenLastCalledWith(projectId, 'profile');
    expect(
      events.mock.calls.filter(([id, topic]) => id === projectId && topic === 'profile'),
    ).toHaveLength(1);
    expect(observed.counts()).toEqual({ probes: 3, inspections: 2 });
  });

  it('restores observation and semantic analysis from SQLite after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-observation-restart-'));
    const observed = inspectorFixture();
    const analyzeWorkingTree = vi.fn(async () => analysis());
    let repo = new SQLiteRepository(directory);
    try {
      const first = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
      const projectId = register(first.core);
      await first.core.projects.observe(projectId, 'en');
      expect(observed.counts()).toEqual({ probes: 1, inspections: 1 });
      expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
      repo.close();

      repo = new SQLiteRepository(directory);
      const restarted = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
      const restored = await restarted.core.projects.workspace(projectId);
      expect(restored.workingTreeAnalysis?.summary).toBe('One semantic change is in progress.');
      expect(observed.counts()).toEqual({ probes: 1, inspections: 1 });
      expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);

      await restarted.core.projects.observe(projectId, 'en');
      expect(observed.counts()).toEqual({ probes: 2, inspections: 1 });
      expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes clean working-tree proposals and restores them from a matching cached observation', async () => {
    const repo = new MemoryRepository();
    let dirty = true;
    let fingerprint = 'dirty-a';
    const inspector: ProjectInspector = {
      probe: (cwd) => ({
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: fingerprint,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      }),
      inspect: () =>
        dirty
          ? observedSnapshot()
          : {
              ...observedSnapshot(),
              dirty: false,
              changedPaths: [],
              changedFiles: [],
              changedFileCount: 0,
              additions: 0,
              deletions: 0,
              diffPreview: '',
              files: [],
            },
    };
    const generate = vi.fn(async () => analysis());
    const { core } = coreWithObservation(repo, inspector, generate);
    const projectId = register(core);

    await core.projects.observe(projectId);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(1);

    dirty = false;
    fingerprint = 'clean-b';
    await core.projects.observe(projectId);
    expect(core.workMatcher.proposals(projectId)).toEqual([]);

    dirty = true;
    fingerprint = 'dirty-c';
    await core.projects.observe(projectId);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not let a late dirty analysis restore proposals after a newer clean observation', async () => {
    const repo = new MemoryRepository();
    let dirty = true;
    let fingerprint = 'dirty-a';
    const inspector: ProjectInspector = {
      probe: (cwd) => ({
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: fingerprint,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      }),
      inspect: () =>
        dirty
          ? observedSnapshot()
          : {
              ...observedSnapshot(),
              dirty: false,
              changedPaths: [],
              changedFiles: [],
              changedFileCount: 0,
              additions: 0,
              deletions: 0,
              diffPreview: '',
              files: [],
            },
    };
    const started = waitForRelease();
    const release = waitForRelease();
    const generate = vi.fn(async () => {
      started.release();
      await release.wait;
      return analysis();
    });
    const { core } = coreWithObservation(repo, inspector, generate);
    const projectId = register(core);

    const first = core.projects.observe(projectId);
    await started.wait;
    dirty = false;
    fingerprint = 'clean-b';
    await core.projects.observe(projectId);
    release.release();
    await first;

    expect(core.projects.latestSnapshot(projectId).dirty).toBe(false);
    expect(core.workMatcher.proposals(projectId)).toEqual([]);
  });

  it('keeps a newer observation when an older inspection response arrives late', async () => {
    const entered = waitForRelease();
    const release = waitForRelease();
    let inspections = 0;
    const clean = {
      ...observedSnapshot(),
      dirty: false,
      changedPaths: [],
      changedFiles: [],
      changedFileCount: 0,
      additions: 0,
      deletions: 0,
      diffPreview: '',
      files: [],
    };
    const inspector: ProjectInspector = {
      inspect: () => clean,
      inspectAsync: async () => {
        inspections++;
        if (inspections === 1) {
          entered.release();
          await release.wait;
          return observedSnapshot();
        }
        return clean;
      },
    };
    const { core } = coreWithObservation(new MemoryRepository(), inspector, vi.fn());
    const projectId = register(core);

    const older = core.projects.observe(projectId, 'en', undefined, false);
    await entered.wait;
    await core.projects.observe(projectId, 'en', undefined, false);
    release.release();
    await older;

    expect(core.projects.latestSnapshot(projectId).dirty).toBe(false);
  });

  it('keeps saved proposals when the current repository state cannot be observed', async () => {
    let state: WorkspaceSnapshot = observedSnapshot();
    let fingerprint = 'dirty-a';
    const inspector: ProjectInspector = {
      probe: (cwd) => ({
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: fingerprint,
        status: state.status,
        checkedAt: AT,
        limitations: state.limitations,
      }),
      inspect: () => state,
    };
    const { core } = coreWithObservation(
      new MemoryRepository(),
      inspector,
      vi.fn(async () => analysis()),
    );
    const projectId = register(core);

    await core.projects.observe(projectId);
    state = unknownSnapshot();
    fingerprint = 'unknown-b';
    await core.projects.observe(projectId);

    expect(core.repo.list('workProposal')).toHaveLength(1);
    expect(core.workMatcher.proposals(projectId)).toEqual([]);
    expect(core.now.resolve(projectId).freshness).toBe('unknown');
  });

  it('does not present an older dirty proposal as current after a new unchecked analysis basis', async () => {
    let state: WorkspaceSnapshot = observedSnapshot();
    let fingerprint = 'dirty-a';
    const inspector: ProjectInspector = {
      probe: (cwd) => ({
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: fingerprint,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      }),
      inspect: () => state,
    };
    const { core } = coreWithObservation(
      new MemoryRepository(),
      inspector,
      vi.fn(async () => analysis()),
    );
    const projectId = register(core);

    await core.projects.observe(projectId);
    state = { ...observedSnapshot(), diffPreview: 'diff --git a/src/main.ts b/src/main.ts\n+new' };
    fingerprint = 'dirty-b';
    await core.projects.observe(projectId, 'en', undefined, false);

    expect(core.repo.list('workProposal')).toHaveLength(1);
    expect(core.workMatcher.proposals(projectId)).toEqual([]);
    expect(core.now.resolve(projectId).freshness).toBe('changed');
  });

  it('replaces old proposals when a fresh analysis establishes no unfinished groups', async () => {
    let state: WorkspaceSnapshot = observedSnapshot();
    let fingerprint = 'dirty-a';
    const inspector: ProjectInspector = {
      probe: (cwd) => ({
        cwd,
        root: cwd,
        branch: 'main',
        commit: 'abcdef',
        statusFingerprint: fingerprint,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      }),
      inspect: () => state,
    };
    const generate = vi
      .fn()
      .mockResolvedValueOnce(analysis())
      .mockResolvedValueOnce({ summary: 'No unfinished changes remain.', groups: [] });
    const { core } = coreWithObservation(new MemoryRepository(), inspector, generate);
    const projectId = register(core);

    await core.projects.observe(projectId);
    state = {
      ...observedSnapshot(),
      diffPreview: 'diff --git a/src/main.ts b/src/main.ts\n+empty',
    };
    fingerprint = 'dirty-b';
    await core.projects.observe(projectId);

    expect(core.workMatcher.proposals(projectId)).toEqual([]);
    expect(core.now.resolve(projectId).freshness).toBe('current');
  });

  it('shares one normalized analysis result between concurrent callers', async () => {
    const started = waitForRelease();
    const release = waitForRelease();
    const generate = vi.fn(async () => {
      started.release();
      await release.wait;
      return analysis();
    });
    const observed = inspectorFixture();
    const { core } = coreWithObservation(new MemoryRepository(), observed.inspector, generate);
    const projectId = register(core);

    const first = core.projects.observe(projectId);
    await started.wait;
    const second = core.projects.analyzeLatest(projectId);
    release.release();
    const [fromObservation, fromLatest] = await Promise.all([first, second]);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(fromObservation.workingTreeAnalysis?.groups[0].id).toBe(
      fromLatest.workingTreeAnalysis?.groups[0].id,
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'returns the newest safe result to all pending callers after clean state on late %s',
    async (outcome) => {
      let dirty = true;
      let fingerprint = 'dirty-a';
      const inspector: ProjectInspector = {
        probe: (cwd) => ({
          cwd,
          root: cwd,
          branch: 'main',
          commit: 'abcdef',
          statusFingerprint: fingerprint,
          status: 'checked',
          checkedAt: AT,
          limitations: [],
        }),
        inspect: () => (dirty ? observedSnapshot() : cleanSnapshot()),
      };
      const started = waitForRelease();
      const release = waitForRelease();
      const generate = vi.fn(async () => {
        started.release();
        await release.wait;
        if (outcome === 'reject') throw new Error('late provider failure');
        return analysis();
      });
      const { core } = coreWithObservation(new MemoryRepository(), inspector, generate);
      const projectId = register(core);

      const first = core.projects.observe(projectId);
      await started.wait;
      const second = core.projects.analyzeLatest(projectId);
      dirty = false;
      fingerprint = 'clean-b';
      await core.projects.observe(projectId);
      release.release();
      const results = await Promise.all([first, second]);

      expect(results.every((snapshot) => snapshot.dirty === false)).toBe(true);
      expect(core.workMatcher.proposals(projectId)).toEqual([]);
    },
  );
});

it('keeps saved working-tree analysis when the project language changes until explicitly generated again', async () => {
  const observed = inspectorFixture();
  const generate = vi.fn(async () => analysis());
  const { core } = coreWithObservation(new MemoryRepository(), observed.inspector, generate);
  const id = register(core);
  const before = await core.projects.observe(id);
  core.projects.settings(id, {
    requestId: identity.next(),
    expectedRevision: core.project(id).revision,
    payload: {
      title: 'Observed project',
      purpose: 'Measure observation reuse.',
      focused: false,
      responseLanguage: 'ko',
    },
  });
  expect((await core.projects.workspace(id)).workingTreeAnalysis).toEqual(
    before.workingTreeAnalysis,
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(observed.counts()).toEqual({ probes: 1, inspections: 1 });
  await core.projects.analyzeLatest(id);
  expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ outputLanguage: 'ko' }));
  expect(generate).toHaveBeenCalledTimes(2);
});
