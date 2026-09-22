import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateCarry, type ProjectInspector, type StateRepository } from '@statecarry/core';
import { classifyWorkProposalMatches, type WorkspaceSnapshot } from '@statecarry/contracts';
import { presentProjectNow } from '@statecarry/presentation';
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
          preview: 'Reply language configurable. Diagnostic errors need investigation.',
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
            title: '응답 언어 설정',
            continuesGroupId: input.previousGroups[0]?.id,
            relatedProposalKeys: input.analysisProposals
              .filter((proposal: any) => proposal.title === '응답 언어 설정')
              .map((proposal: any) => proposal.key),
            currentState: '응답 언어를 설정할 수 있습니다.',
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: '응답 언어를 설정할 수 있습니다.',
                sources: [{ revisionId: record.revisionId, quote: 'Reply language configurable.' }],
              },
            ],
          },
          {
            ...analysis().groups[0],
            title: '진단 오류 조사',
            continuesGroupId: input.previousGroups[1]?.id,
            currentState: '진단 오류를 조사해야 합니다.',
            relatedProposalKeys: input.analysisProposals
              .filter((proposal: any) => proposal.title === '진단 오류 조사')
              .map((proposal: any) => proposal.key),
            context: [
              {
                kind: 'unknown',
                nature: 'file-observation',
                text: '진단 오류를 조사해야 합니다.',
                sources: [
                  { revisionId: record.revisionId, quote: 'Diagnostic errors need investigation.' },
                ],
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
            goal: '응답 언어 설정',
            currentState: '응답 언어를 설정할 수 있습니다.',
          },
          {
            ...projectCandidate({
              id: record.revisionId,
              text: 'Diagnostic errors need investigation.',
              threadId: record.threadId,
            } as any),
            key: 'diagnostic-errors',
            goal: '진단 오류 조사',
            currentState: '진단 오류를 조사해야 합니다.',
          },
        ],
      };
    });
    const projectId = register(core);
    core.projectModel.setDirection(projectId, 'Measure the observed project changes.');
    await core.projects.observe(projectId, 'ko');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(2);
    await core.analyses.refresh(projectId, 'ko');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    await core.projects.observe(projectId, 'ko');
    const matches = core.workMatcher.match(projectId);
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(4);
    expect(matches).toHaveLength(2);
    const unresolved = core.now.resolve(projectId);
    const unresolvedView = presentProjectNow(core.projectModel.view(projectId), unresolved);
    expect(unresolved).toMatchObject({
      currentWorkId: null,
      state: 'choose-work',
      otherWorkCount: 2,
      otherWorkCounts: { total: 2, progress: 2, completionReview: 0, evidenceConflict: 0 },
    });
    expect(unresolved.currentWorkSelection).toBeNull();
    expect(unresolved.otherWorkCandidates).toHaveLength(2);
    expect(core.projectModel.view(projectId).workItems).toHaveLength(0);
    expect(unresolved.recommendation).toMatchObject({
      status: 'recommended',
      close: true,
      confidence: 'low',
      selectionState: 'unselected',
    });
    expect([
      unresolved.recommendation.candidate?.id,
      ...unresolved.recommendation.closeAlternatives.map((candidate) => candidate.id),
    ]).toEqual(expect.arrayContaining(matches.map((match) => match.proposal.key)));
    expect([
      unresolved.recommendation.candidate?.id,
      ...unresolved.recommendation.closeAlternatives.map((candidate) => candidate.id),
    ]).toHaveLength(2);
    expect(unresolvedView.otherWork).toHaveLength(2);
    expect(unresolvedView.otherWorkCount).toBe(2);
    expect(unresolvedView.otherWorkCounts).toEqual(unresolved.otherWorkCounts);
    const language = matches.find(
      (match) =>
        match.proposal.title === '응답 언어 설정' ||
        match.aliases?.some((alias) => alias.title === '응답 언어 설정'),
    )!;
    expect(language).toMatchObject({ confidence: 'possible', workItemId: null });
    expect(language.aliases).toHaveLength(1);
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
        match.proposal.title === '진단 오류 조사' ||
        match.aliases?.some((alias) => alias.title === '진단 오류 조사'),
    )!;
    expect(diagnostic).toMatchObject({ confidence: 'possible', workItemId: null });
    expect([diagnostic.proposal, ...(diagnostic.aliases ?? [])]).toHaveLength(2);
    expect(unresolvedView.otherWork.map((item) => item.id)).toEqual(
      expect.arrayContaining([language.proposal.key, diagnostic.proposal.key]),
    );
    expect(unresolvedView.otherWork.map((item) => item.disposition)).toEqual([
      'progress',
      'progress',
    ]);
    core.projectModel.selectProposal(projectId, language.proposal.key);
    const selected = core.now.resolve(projectId);
    const workId = selected.currentWorkId!;
    expect(workId).not.toBeNull();
    expect(selected.currentWorkSelection).toBe('user');
    const alias = language.aliases![0];
    core.projectModel.selectProposal(projectId, alias.key);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);
    core.projectModel.selectProposal(projectId, diagnostic.proposal.key);
    const diagnosticWorkId = core.now.resolve(projectId).currentWorkId!;
    core.projectModel.selectProposal(projectId, diagnostic.aliases![0].key);
    expect(diagnosticWorkId).not.toBe(workId);
    expect(core.now.resolve(projectId).currentWorkId).toBe(diagnosticWorkId);
    expect(core.projectModel.view(projectId).workItems).toHaveLength(2);

    await core.analyses.refresh(projectId, 'ko');
    core.workMatcher.replaceProposals(
      projectId,
      'analysis-candidate',
      core.workMatcher
        .proposals(projectId)
        .filter((proposal) => proposal.source === 'analysis-candidate')
        .map((proposal) => ({ ...proposal, state: 'done' as const })),
      'ko',
    );
    core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      core.workMatcher
        .proposals(projectId)
        .filter(
          (proposal) =>
            proposal.source === 'working-tree-group' && proposal.title === '응답 언어 설정',
        ),
      'ko',
    );
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);

    const reconciledMatches = core.workMatcher.match(projectId);
    const languageConflict = reconciledMatches.find((match) => match.workItemId === workId)!;
    expect(languageConflict.proposal.source).toBe('working-tree-group');
    expect(languageConflict.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'analysis-candidate', state: 'done' }),
      ]),
    );
    expect(classifyWorkProposalMatches([languageConflict])).toBe('evidence-conflict');
    core.projectModel.selectCurrentWork(projectId, workId);
    expect(core.now.resolve(projectId)).toMatchObject({
      currentWorkId: workId,
      currentWorkSelection: 'user',
      state: 'review',
      next: { kind: 'review-work', workItemId: workId },
    });
    expect(
      core.projectModel.view(projectId).workItems.find((item) => item.id === workId)?.state,
    ).toBe('active');

    const diagnosticCompletion = reconciledMatches.find(
      (match) => match.workItemId === diagnosticWorkId,
    )!;
    expect(diagnosticCompletion.proposal).toMatchObject({
      source: 'analysis-candidate',
      state: 'done',
    });
    expect(classifyWorkProposalMatches([diagnosticCompletion])).toBe('completion-review');
    const reconciledView = presentProjectNow(
      core.projectModel.view(projectId),
      core.now.resolve(projectId),
    );
    expect(reconciledView.otherWorkCount).toBe(1);
    expect(reconciledView.otherWorkCounts).toEqual({
      total: 1,
      progress: 0,
      completionReview: 1,
      evidenceConflict: 0,
    });
    expect(reconciledView.otherWork.find((item) => item.id === diagnosticWorkId)).toMatchObject({
      source: 'work-item',
      disposition: 'completion-review',
      statusLabel: 'Completion needs review',
    });
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

  it('keeps selected work through refresh, clean retirement, cached return, and a new basis', async () => {
    const repo = new MemoryRepository();
    const dirtySnapshot = (diffPreview = 'initial implementation diff'): WorkspaceSnapshot => ({
      ...observedSnapshot(),
      diffPreview,
      files: [{ ...observedSnapshot().files![0], preview: 'Return flow stays intact.' }],
    });
    let state = dirtySnapshot();
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
    const analyzeWorkingTree = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      const korean = input.outputLanguage === 'ko';
      return {
        ...analysis(),
        groups: [
          {
            ...analysis().groups[0],
            title: korean ? '반환 흐름 유지' : 'Preserve the return flow',
            currentState: korean
              ? '반환 흐름이 계속 유지됩니다.'
              : state.diffPreview === 'updated implementation diff'
                ? 'The updated implementation keeps the return flow intact.'
                : 'The implementation keeps the return flow intact.',
            relatedProposalKeys: input.analysisProposals.map((proposal: any) => proposal.key),
            continuesGroupId: input.previousGroups[0]?.id,
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: korean ? '반환 흐름이 계속 유지됩니다.' : 'The return flow remains intact.',
                sources: [{ revisionId: record.revisionId, quote: 'Return flow stays intact.' }],
              },
            ],
          },
        ],
      };
    });
    const { core, h } = coreWithObservation(repo, inspector, analyzeWorkingTree);
    h.summary.generateAnalysis = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      const korean = input.outputLanguage === 'ko';
      const candidate = projectCandidate({
        id: record.revisionId,
        threadId: record.threadId,
        text: 'Return flow stays intact.',
      } as any);
      candidate.key = 'return-flow-candidate';
      candidate.goal = korean ? '반환 흐름 유지' : 'Preserve the return flow';
      candidate.currentState = korean
        ? '반환 흐름이 계속 유지됩니다.'
        : 'Return flow stays intact.';
      candidate.evidence = [{ revisionId: record.revisionId, quote: 'Return flow stays intact.' }];
      return { candidates: [candidate] };
    });
    const projectId = register(core);

    await core.analyses.refresh(projectId, 'ko');
    await core.projects.observe(projectId, 'ko');
    const initialMatch = core.workMatcher.match(projectId)[0]!;
    expect(initialMatch.confidence).toBe('possible');
    core.projectModel.selectProposal(projectId, initialMatch.proposal.key);
    const workId = core.now.resolve(projectId).currentWorkId!;
    const savedWork = core.projectModel.view(projectId).workItems;
    const savedDecisions = core.projectModel
      .view(projectId)
      .decisions.filter((decision) => decision.state === 'valid');

    state = {
      ...state,
      dirty: false,
      changedPaths: [],
      changedFiles: [],
      changedFileCount: 0,
      additions: 0,
      deletions: 0,
      diffPreview: '',
      files: [],
    };
    fingerprint = 'clean-b';
    await core.projects.observe(projectId, 'ko');
    expect(
      core.workMatcher.proposals(projectId).filter((item) => item.source === 'working-tree-group'),
    ).toEqual([]);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);

    state = dirtySnapshot();
    fingerprint = 'dirty-cached';
    await core.projects.observe(projectId, 'ko');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);

    state = dirtySnapshot('updated implementation diff');
    fingerprint = 'dirty-new-basis';
    await core.analyses.refresh(projectId, 'en');
    await core.projects.observe(projectId, 'en');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);
    const currentObservation = core.projects.latestObservation(projectId)!;
    const treeProposals = core.workMatcher
      .proposals(projectId)
      .filter((item) => item.source === 'working-tree-group');
    expect(treeProposals).toHaveLength(1);
    expect(treeProposals[0]).toMatchObject({
      evidenceBasis: currentObservation.semanticKey,
      currentState: 'The updated implementation keeps the return flow intact.',
    });
    const continued = core.workMatcher.match(projectId)[0]!;
    expect(continued).toMatchObject({ workItemId: workId, confidence: 'explicit' });
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);
    expect(core.projectModel.view(projectId).workItems).toEqual(savedWork);
    expect(
      core.projectModel.view(projectId).decisions.filter((decision) => decision.state === 'valid'),
    ).toEqual(savedDecisions);
  });

  it('reads legacy cached source IDs and reanalyzes malformed cache without losing selected work', async () => {
    const repo = new MemoryRepository();
    const observed = inspectorFixture();
    const analyzeWorkingTree = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      return {
        ...analysis(),
        groups: [
          {
            ...analysis().groups[0],
            title: 'Stable work',
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: 'The file supports this work.',
                sources: [{ revisionId: record.revisionId, quote: 'return point' }],
              },
            ],
          },
        ],
      };
    });
    const { core } = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
    const projectId = register(core);
    await core.projects.observe(projectId, 'en');
    const proposal = core.workMatcher.proposals(projectId)[0];
    core.projectModel.selectProposal(projectId, proposal.key);
    const workId = core.now.resolve(projectId).currentWorkId!;
    const savedWork = core.projectModel.view(projectId).workItems;
    const savedDecisions = core.projectModel.view(projectId).decisions;
    const record = repo.list('workingTreeAnalysis')[0];
    const legacy = structuredClone(record) as any;
    const revisionId = legacy.result.groups[0].context[0].sources[0].revisionId;
    legacy.result.groups[0].context[0].sources = [revisionId];
    repo.put('workingTreeAnalysis', legacy);

    const readable = await core.projects.workspace(projectId);
    expect(readable.workingTreeAnalysis?.summary).toBe(analysis().summary);
    expect(readable.workingTreeAnalysis?.groups[0].context).toBeUndefined();
    await core.projects.observe(projectId, 'en');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);

    const malformed = structuredClone(legacy);
    malformed.result.groups[0].title = '';
    repo.put('workingTreeAnalysis', malformed);
    expect((await core.projects.workspace(projectId)).workingTreeAnalysis).toBeUndefined();
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);
    await core.projects.observe(projectId, 'en');
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);
    expect(core.now.resolve(projectId).currentWorkId).toBe(workId);
    expect(core.projectModel.view(projectId).workItems).toEqual(savedWork);
    expect(core.projectModel.view(projectId).decisions).toEqual(savedDecisions);
    expect(core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
  });

  it('does not reuse a selected group ID when same-basis cache repair changes the work', async () => {
    const repo = new MemoryRepository();
    const observed = inspectorFixture((inventory) => ({
      ...observedSnapshot(inventory),
      files: [
        {
          ...observedSnapshot(inventory).files![0],
          preview: 'Language preference is configurable. Diagnostic logging needs review.',
        },
      ],
    }));
    let generated = 0;
    const analyzeWorkingTree = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      generated++;
      const languageWork = generated === 1;
      return {
        ...analysis(),
        groups: [
          {
            ...analysis().groups[0],
            title: languageWork ? 'Configure reply language' : 'Investigate diagnostic logging',
            currentState: languageWork
              ? 'The reply language setting is available.'
              : 'Diagnostic logging needs investigation.',
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: languageWork
                  ? 'The reply language setting is available.'
                  : 'Diagnostic logging needs investigation.',
                sources: [
                  {
                    revisionId: record.revisionId,
                    quote: languageWork
                      ? 'Language preference is configurable.'
                      : 'Diagnostic logging needs review.',
                  },
                ],
              },
            ],
          },
        ],
      };
    });
    const { core, h } = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
    h.summary.generateAnalysis = vi.fn(async () => ({ candidates: [] }));
    const projectId = register(core);

    await core.analyses.refresh(projectId, 'en');
    await core.projects.observe(projectId, 'en');
    const selectedProposal = core.workMatcher.proposals(projectId)[0];
    const selectedKey = selectedProposal.key;
    core.projectModel.selectProposal(projectId, selectedKey);
    const selectedWorkId = core.now.resolve(projectId).currentWorkId!;
    const selectedLink = core.projectModel
      .view(projectId)
      .decisions.find((decision) => decision.kind === 'link-work-proposal')!;

    const cached = repo.list('workingTreeAnalysis')[0];
    const corrupted = structuredClone(cached) as any;
    corrupted.result.groups[0].title = '';
    repo.put('workingTreeAnalysis', corrupted);
    await core.projects.observe(projectId, 'en');

    const matches = core.workMatcher.match(projectId);
    expect(analyzeWorkingTree).toHaveBeenCalledTimes(2);
    expect(core.workMatcher.proposals(projectId)).toHaveLength(1);
    expect(core.workMatcher.proposals(projectId)[0].key).not.toBe(selectedKey);
    expect(matches).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
    expect(core.now.resolve(projectId).currentWorkId).toBe(selectedWorkId);
    expect(core.projectModel.view(projectId).workItems).toHaveLength(1);
    expect(core.projectModel.view(projectId).decisions).toContainEqual(selectedLink);

    const replacement = core.workMatcher.proposals(projectId)[0];
    core.projectModel.selectProposal(projectId, replacement.key);
    const replacementWorkId = core.now.resolve(projectId).currentWorkId;
    expect(replacementWorkId).not.toBe(selectedWorkId);
    core.projectModel.selectProposal(projectId, replacement.key);
    expect(core.projectModel.view(projectId).workItems).toHaveLength(2);
    expect(
      core.projectModel
        .view(projectId)
        .decisions.filter(
          (decision) =>
            decision.kind === 'link-work-proposal' &&
            decision.value.proposalKey === replacement.key &&
            decision.state === 'valid',
        ),
    ).toHaveLength(1);
  });

  it('does not join unrelated refreshed and working-tree proposals through a common quote', async () => {
    const repo = new MemoryRepository();
    const observed = inspectorFixture((inventory) => ({
      ...observedSnapshot(inventory),
      files: [{ ...observedSnapshot(inventory).files![0], preview: 'No errors detected.' }],
    }));
    const analyzeWorkingTree = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      return {
        ...analysis(),
        groups: [
          {
            ...analysis().groups[0],
            title: 'Update locale preferences',
            currentState: 'Locale preferences are ready for review.',
            context: [
              {
                kind: 'progress',
                nature: 'file-observation',
                text: 'The locale settings are ready.',
                sources: [{ revisionId: record.revisionId, quote: 'No errors detected.' }],
              },
            ],
          },
        ],
      };
    });
    const { core, h } = coreWithObservation(repo, observed.inspector, analyzeWorkingTree);
    h.summary.generateAnalysis = vi.fn(async (input: any) => {
      const record = input.records.find((item: any) => item.kind === 'fileObservation');
      const candidate = projectCandidate({
        id: record.revisionId,
        threadId: record.threadId,
        text: 'No errors detected.',
      } as any);
      candidate.key = 'database-latency';
      candidate.goal = 'Investigate database latency';
      candidate.currentState = 'Database latency needs investigation.';
      candidate.evidence = [{ revisionId: record.revisionId, quote: 'No errors detected.' }];
      return { candidates: [candidate] };
    });
    const projectId = register(core);

    await core.analyses.refresh(projectId, 'en');
    await core.projects.observe(projectId, 'en');

    expect(analyzeWorkingTree).toHaveBeenCalledTimes(1);
    expect(core.workMatcher.match(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: expect.objectContaining({ title: 'Investigate database latency' }),
          workItemId: null,
          confidence: 'unmatched',
        }),
        expect.objectContaining({
          proposal: expect.objectContaining({ title: 'Update locale preferences' }),
          workItemId: null,
          confidence: 'unmatched',
        }),
      ]),
    );
    expect(core.workMatcher.match(projectId)).toHaveLength(2);
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
