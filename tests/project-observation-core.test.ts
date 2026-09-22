import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StateCarry, type ProjectInspector, type StateRepository } from '@statecarry/core';
import type { WorkspaceSnapshot } from '@statecarry/contracts';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { identity } from '../apps/server/src/adapters/identity';
import { harness, MemoryRepository } from './helpers';

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

function inspectorFixture() {
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
      return observedSnapshot(inventoryFingerprint);
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

describe('project observation reuse', () => {
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
