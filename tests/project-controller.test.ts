import { describe, expect, it, vi } from 'vitest';
import {
  ProjectController,
  presentProjects,
  parseProjectRoute,
  projectRouteHref,
  type ProjectGateway,
  type ProjectWorkspace,
  type ResumeGateway,
  type ResumeMemory,
  type SavedResumeEdits,
} from '@statecarry/presentation';
import type { Receipt } from '@statecarry/contracts';
import { source } from './helpers';

const RAW = 'RAW_RECORD_SHOULD_NOT_BE_AN_EXPLANATION';
const receipt = (id: string): Receipt => ({
  id: 'request',
  command: 'test',
  bodyHash: 'body',
  workId: id,
  committedRevision: 2,
  resultId: id,
  createdAt: '2026-09-16T00:00:00Z',
});
function workspace(): ProjectWorkspace {
  return {
    projects: ['a', 'b'].map((id) => ({
      workId: id,
      connectionId: `connection-${id}`,
      title: `Project ${id}`,
      cwd: `/project/${id}`,
      purpose: 'Make the saved result useful.',
      focused: id === 'b',
      revision: 1,
      disconnectedAt: null,
      acceptedKeys: [],
      pausedKeys: [],
      resume: {
        workId: id,
        title: `Work ${id}`,
        cwd: `/project/${id}`,
        goalText: 'Review the export',
        goalOrigin: 'user-input',
        sessionCount: 1,
        version: 'v1',
        revision: 1,
        updatesAvailable: false,
        busy: false,
        error: null,
        stale: false,
        generatedAt: '2026-09-16T00:00:00Z',
        correctedKeys: [],
        dismissedKeys: [],
        state: 'ready',
        candidates: ['first', 'second'].map((key) => ({
          key,
          goal: `${key} export`,
          currentState: 'The export is ready for its review.',
          status: 'active',
          reason: 'The expected result needs checking.',
          nextAction: 'Review the exported document',
          doneWhen: 'The reviewed outcome is recorded.',
          actionSource: 'recorded',
          threadId: `thread-${id}`,
          prerequisites: [],
          evidence: [{ revisionId: `source-${id}`, quote: RAW }],
        })),
      },
    })),
  };
}
function setup() {
  let rows = workspace();
  const storage = new Map<string, SavedResumeEdits>();
  const memory: ResumeMemory = {
    read: (id) => structuredClone(storage.get(id) ?? null),
    write: (id, state) => {
      storage.set(id, structuredClone(state));
    },
  };
  const gateway: ProjectGateway = {
    list: vi.fn(async () => structuredClone(rows)),
    create: vi.fn(async () => receipt('new')),
    settings: vi.fn(async (id) => receipt(id)),
    sources: vi.fn(async (id) => receipt(id)),
    disconnect: vi.fn(async (id) => receipt(id)),
    restore: vi.fn(async (id) => receipt(id)),
    deletionPreview: vi.fn(async (id) => ({
      workId: id,
      title: `Project ${id}`,
      revision: 1,
      token: 'preview',
      ownedRecords: 3,
      exclusiveSources: 1,
      sharedSources: 0,
      blocked: false,
      explanation: 'Remove this saved project only.',
    })),
    delete: vi.fn(async (id) => {
      rows.projects = rows.projects.filter((entry) => entry.workId !== id);
      return receipt(id);
    }),
    connections: vi.fn(async () => []),
    discover: vi.fn(async () => ({ threads: [], complete: true, limitations: [] })),
    turns: vi.fn(async () => ({ turns: [] })),
    evidence: vi.fn(async () => source(RAW)),
  };
  const resume: ResumeGateway = {
    list: vi.fn(async () => []),
    refresh: vi.fn(async () => {}),
    setGoal: vi.fn(async () => {}),
    correct: vi.fn(async () => {}),
  };
  return {
    gateway,
    resume,
    memory,
    storage,
    rows: () => rows,
    setRows: (value: ProjectWorkspace) => {
      rows = value;
    },
    controller: () => new ProjectController(gateway, resume, memory),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe('project-oriented presentation and return memory', () => {
  it('keeps source payloads out of Home/project views and distinguishes focus, reported completion and acceptance', () => {
    const rows = workspace();
    const candidate = rows.projects[0].resume!.candidates[0];
    candidate.status = 'done';
    candidate.completion = { reported: [{ revisionId: 'source-a', quote: RAW }], verified: [] };
    let projects = presentProjects(rows);
    expect(projects[0].id).toBe('b');
    expect(projects.find((entry) => entry.id === 'a')!.tasks[0].status).toBe('review');
    expect(JSON.stringify(projects)).not.toContain(RAW);
    rows.projects[0].acceptedKeys = ['first'];
    projects = presentProjects(rows);
    expect(projects.find((entry) => entry.id === 'a')!.tasks[0]).toMatchObject({
      status: 'accepted',
      nextAction: null,
      canAct: false,
    });
    expect(projects.find((entry) => entry.id === 'a')!.tasks[1].status).toBe('continue');
  });
  it('keeps manual context useful and allows a project-first refresh without Codex context', () => {
    const rows = workspace();
    Object.assign(rows.projects[0].resume!, {
      sessionCount: 0,
      candidates: [],
      stale: true,
      generatedAt: null,
      state: 'empty',
    });
    const view = presentProjects(rows).find((entry) => entry.id === 'a')!;
    expect(view.goal).toBe('Review the export');
    expect(view.stateDescription).toContain('current information');
    expect(view.canRefresh).toBe(true);
    expect(view.sourceSummary.map((source) => source.label)).toEqual(['Codebase', 'Git', 'Codex']);
    expect(view.sourceSummary.find((source) => source.kind === 'codex')?.detail).toContain(
      'optional',
    );
    expect(view.projectState.next).toContain('Prepare the first overview');
    expect(view.tasks).toEqual([]);
  });
  it('projects codebase, Git and Codex as human-readable evidence kinds', () => {
    const rows = workspace();
    rows.projects[0].resume!.workspace = {
      cwd: '/project/a',
      branch: 'feature/project-first',
      commit: '1234567890abcdef',
      dirty: true,
      status: 'checked',
      checkedAt: '2026-09-16T00:00:00Z',
      limitations: [],
      recentCommits: [
        {
          hash: 'abcdef1234567890',
          subject: 'Refine project overview flow',
          committedAt: '2026-09-16T00:00:00Z',
          changedPaths: ['src/index.ts'],
        },
      ],
      files: [
        { path: 'src/index.ts', hash: 'one', preview: 'export const value = 1;' },
        { path: 'src/state.ts', hash: 'two', preview: 'export const state = {};' },
      ],
    };
    rows.projects[0].resume!.candidates[0].evidence = [
      { revisionId: 'workspace-file:file-one', quote: RAW },
      { revisionId: 'workspace-git:git-one', quote: RAW },
      { revisionId: 'source-a', quote: RAW },
    ];
    const view = presentProjects(rows).find((entry) => entry.id === 'a')!;
    expect(view.sourceSummary).toEqual([
      expect.objectContaining({
        kind: 'codebase',
        label: 'Codebase',
        detail: expect.stringContaining('2 project files'),
      }),
      expect.objectContaining({
        kind: 'git',
        label: 'Git',
        detail: expect.stringContaining('feature/project-first'),
      }),
      expect.objectContaining({
        kind: 'codex',
        label: 'Codex',
        detail: expect.stringContaining('1 Codex conversation'),
      }),
    ]);
    expect(view.projectState.recentWork).toContain('Refine project overview flow');
    expect(view.projectState.recentWork).toContain('working-tree changes');
    expect(view.tasks[0].evidenceSources.map((source) => source.label)).toEqual([
      'Codebase',
      'Git',
      'Codex',
    ]);
    expect(view.tasks[0].originals.map((source) => source.id)).toEqual([
      'workspace-file:file-one',
      'source-a',
    ]);
    expect(JSON.stringify(view)).not.toContain(RAW);
  });
  it('uses the saved response language for deterministic project-state fallback text', () => {
    const rows = workspace();
    const resume = rows.projects[0].resume!;
    resume.outputLanguage = 'ko';
    resume.candidates = [];
    resume.workspace = {
      cwd: '/project/a',
      branch: 'main',
      commit: '1234567890abcdef',
      dirty: true,
      status: 'checked',
      checkedAt: '2026-09-16T00:00:00Z',
      limitations: [],
      recentCommits: [
        {
          hash: 'abcdef1234567890',
          subject: 'Keep code identifiers unchanged',
          committedAt: '2026-09-16T00:00:00Z',
          changedPaths: ['src/index.ts'],
        },
      ],
      files: [{ path: 'src/index.ts', hash: 'one', preview: 'export const value = 1;' }],
    };
    const view = presentProjects(rows).find((entry) => entry.id === 'a')!;
    expect(view.outputLanguage).toBe('ko');
    expect(view.projectState.currentState).toContain('저장된 Overview');
    expect(view.projectState.recentWork).toContain('최신 커밋: Keep code identifiers unchanged');
    expect(view.projectState.openOrUncertain).toContain('첫 Overview');
    expect(view.projectState.next).toContain('업데이트된 Overview');
  });
  it('uses the corrected next action without treating older completion evidence as acceptance', () => {
    const rows = workspace();
    const work = rows.projects[0].resume!;
    work.correctedKeys = ['first'];
    Object.assign(work.candidates[0], {
      status: 'active',
      nextAction: 'Fix the missing export label',
      doneWhen: 'The missing label appears in the reviewed export.',
      completion: { reported: [{ revisionId: 'source-a', quote: RAW }], verified: [] },
    });
    const task = presentProjects(rows).find((item) => item.id === 'a')!.tasks[0];
    expect(task).toMatchObject({
      status: 'continue',
      canAct: true,
      sourceLabel: 'Corrected by you',
      nextAction: 'Fix the missing export label',
    });
    expect(task.evidenceExplanation.join(' ')).toContain('earlier checks do not establish');
    expect(rows.projects[0].acceptedKeys).toEqual([]);
    expect(JSON.stringify(task)).not.toContain(RAW);
  });
  it('keeps selected work and original draft versions through navigation and a new controller', async () => {
    const h = setup();
    let controller = h.controller();
    await controller.start({ page: 'project', workId: 'a', candidateKey: 'second' });
    controller.editGoal('a', 'Unsaved goal');
    controller.editAction('a', 'second', 'Unsaved action', 'Keep this condition');
    controller.navigate({ page: 'home' });
    await controller.refresh();
    controller.stop();
    h.rows().projects[0].resume!.version = 'v2';
    controller = h.controller();
    await controller.start({ page: 'project', workId: 'a' });
    expect(controller.getSnapshot().edits.a).toMatchObject({
      selectedKey: 'second',
      goalDraft: { text: 'Unsaved goal', version: 'v1' },
      actionDrafts: [
        ['second', { action: 'Unsaved action', done: 'Keep this condition', version: 'v1' }],
      ],
    });
    expect(h.resume.refresh).not.toHaveBeenCalled();
    h.rows().projects[0].resume!.candidates = [];
    await controller.refresh();
    expect(controller.getSnapshot().projects.find((item) => item.id === 'a')!.tasks).toEqual([]);
    expect(controller.getSnapshot().edits.a.selectedKey).toBe('second');
    controller.stop();
  });
  it('keeps a new edit when an earlier save completes after moving to another project', async () => {
    const h = setup();
    const controller = h.controller();
    const saved = deferred<void>();
    h.resume.setGoal = vi.fn(() => saved.promise);
    await controller.start({ page: 'project', workId: 'a' });
    controller.editGoal('a', 'Submitted goal');
    const save = controller.saveGoal('a');
    controller.editGoal('a', 'A newer unsaved goal');
    controller.navigate({ page: 'project', workId: 'b' });
    controller.editGoal('b', 'Other project draft');
    saved.resolve();
    await save;
    expect(h.resume.setGoal).toHaveBeenCalledWith('a', 'Submitted goal', 'v1');
    expect(controller.getSnapshot().route.workId).toBe('b');
    expect(controller.getSnapshot().edits.a.goalDraft?.text).toBe('A newer unsaved goal');
    expect(controller.getSnapshot().edits.b.goalDraft?.text).toBe('Other project draft');
    expect(controller.getSnapshot().notice).toBeNull();
    controller.stop();
  });
  it('does not clear restarted-controller input when an old save finishes', async () => {
    const h = setup();
    const previous = h.controller();
    const saved = deferred<void>();
    h.resume.setGoal = vi.fn(() => saved.promise);
    await previous.start({ page: 'project', workId: 'a' });
    previous.editGoal('a', 'Submitted before leaving');
    const pending = previous.saveGoal('a');
    previous.stop();
    const restarted = h.controller();
    await restarted.start({ page: 'project', workId: 'a' });
    restarted.editGoal('a', 'Written in the new controller');
    saved.resolve();
    await pending;
    expect(h.storage.get('a')?.goalDraft?.text).toBe('Written in the new controller');
    expect(restarted.getSnapshot().edits.a.goalDraft?.text).toBe('Written in the new controller');
    restarted.stop();
  });
  it('keeps stale-version input until explicit review and never exposes an arbitrary failure string', async () => {
    const h = setup();
    const controller = h.controller();
    await controller.start({ page: 'project', workId: 'a' });
    controller.editGoal('a', 'Keep me');
    h.rows().projects[0].resume!.version = 'v2';
    h.resume.setGoal = vi.fn(async () => {
      throw Object.assign(new Error(RAW), { code: 'REVISION_CONFLICT' });
    });
    await controller.saveGoal('a');
    expect(controller.getSnapshot().edits.a.goalDraft).toEqual({ text: 'Keep me', version: 'v1' });
    expect(controller.getSnapshot().error).toContain('project changed');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    controller.rebaseGoal('a');
    expect(controller.getSnapshot().edits.a.goalDraft?.version).toBe('v2');
    h.gateway.list = vi.fn(async () => {
      throw new Error(RAW);
    });
    await controller.refresh();
    expect(controller.getSnapshot().online).toBe(false);
    expect(
      controller.getSnapshot().projects.every((entry) => entry.tasks.every((task) => !task.canAct)),
    ).toBe(true);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    controller.stop();
  });
  it('opens source text only by explicit inspection and rejects a late source after leaving', async () => {
    const h = setup();
    const controller = h.controller();
    const evidence = deferred<ReturnType<typeof source>>();
    await controller.start({ page: 'project', workId: 'a' });
    expect(h.gateway.evidence).not.toHaveBeenCalled();
    h.gateway.evidence = vi.fn(() => evidence.promise);
    controller.navigate({
      page: 'original',
      workId: 'a',
      sourceId: 'source-a',
      candidateKey: 'second',
    });
    const reading = controller.refresh();
    await new Promise((ok) => setTimeout(ok, 0));
    controller.navigate({ page: 'home' });
    evidence.resolve(source(RAW));
    await reading;
    expect(h.gateway.evidence).toHaveBeenCalledWith('a', 'source-a');
    expect(controller.getSnapshot().inspection).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    controller.navigate({ page: 'original', workId: 'a', sourceId: 'source-a' });
    await controller.refresh();
    expect(controller.getSnapshot().inspection?.text).toBe(RAW);
    controller.navigate({ page: 'project', workId: 'a' });
    expect(controller.getSnapshot().inspection).toBeNull();
    controller.stop();
  });
  it('does not restore action permission from a read started before the connection was lost', async () => {
    const h = setup();
    let connection!: (state: 'connected' | 'disconnected') => void;
    h.resume.subscribe = (_change, onConnection) => {
      connection = onConnection!;
      return () => {};
    };
    const controller = h.controller();
    await controller.start({ page: 'project', workId: 'a' });
    const oldRead = deferred<ProjectWorkspace>();
    const oldRows = structuredClone(h.rows());
    h.gateway.list = vi.fn(() => oldRead.promise);
    const reading = controller.refresh();
    connection('disconnected');
    oldRead.resolve(oldRows);
    await reading;
    expect(controller.getSnapshot()).toMatchObject({ online: false, checkingCurrent: true });
    expect(controller.getSnapshot().projects.every((project) => !project.canDecide)).toBe(true);
    expect(
      controller
        .getSnapshot()
        .projects.flatMap((project) => project.tasks)
        .every((task) => !task.canAct),
    ).toBe(true);
    h.gateway.list = vi.fn(async () => structuredClone(h.rows()));
    connection('connected');
    await vi.waitFor(() =>
      expect(controller.getSnapshot()).toMatchObject({ online: true, checkingCurrent: false }),
    );
    expect(h.resume.refresh).not.toHaveBeenCalled();
    controller.stop();
  });
  it.each(['during', 'after'] as const)(
    'confirms once after stream connection when the first GET resolves %s an unobserved scope change',
    async (timing) => {
      const h = setup();
      const firstRead = deferred<ProjectWorkspace>();
      const oldRows = structuredClone(h.rows());
      vi.mocked(h.gateway.list).mockImplementationOnce(() => firstRead.promise);
      let connected!: (state: 'connected' | 'disconnected') => void;
      h.resume.subscribe = (_listener, onConnection) => {
        connected = onConnection!;
        return () => {};
      };
      const controller = h.controller();
      const started = controller.start({ page: 'project', workId: 'a' });
      if (timing === 'after') {
        firstRead.resolve(oldRows);
        await started;
      }
      // This mutation happened before the server installed the SSE listener, so
      // there is no change event to replay for the initial GET.
      h.rows().projects[0].resume!.candidates = [];
      connected('connected');
      expect(controller.getSnapshot().checkingCurrent).toBe(true);
      expect(controller.getSnapshot().projects.every((project) => !project.canDecide)).toBe(true);
      if (timing === 'during') firstRead.resolve(oldRows);
      await started;
      await vi.waitFor(() => expect(controller.getSnapshot().checkingCurrent).toBe(false));
      connected('connected');
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(
        controller.getSnapshot().projects.find((project) => project.id === 'a')!.tasks,
      ).toEqual([]);
      expect(controller.getSnapshot()).toMatchObject({ online: true, checkingCurrent: false });
      expect(h.resume.refresh).not.toHaveBeenCalled();
      controller.stop();
    },
  );
  it('coalesces a burst of changes without loading or locking unrelated projects', async () => {
    vi.useFakeTimers();
    const h = setup();
    let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
    h.resume.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    const controller = h.controller();
    try {
      await controller.start({ page: 'project', workId: 'a', candidateKey: 'second' });
      controller.editAction('a', 'second', 'Keep this writing', 'Keep this condition');
      const savedDraft = structuredClone(controller.getSnapshot().edits.a);
      for (let index = 0; index < 10; index++) changed({ workId: 'a', kind: 'collection-settled' });
      expect(controller.getSnapshot().checkingCurrent).toBe(false);
      expect(h.gateway.list).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 20; index++) changed({ workId: 'b' });
      expect(h.gateway.list).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().loading).toBe(false);
      expect(controller.getSnapshot().projects.find((project) => project.id === 'a')).toMatchObject(
        { canDecide: true },
      );
      expect(controller.getSnapshot().projects.find((project) => project.id === 'b')).toMatchObject(
        { canDecide: false, updating: true },
      );
      await vi.advanceTimersByTimeAsync(150);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot()).toMatchObject({ checkingCurrent: false, loading: false });
      expect(controller.getSnapshot().edits.a).toEqual(savedDraft);
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(h.resume.refresh).not.toHaveBeenCalled();
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
  it('keeps original inspection open across unrelated changes but withdraws it immediately for its own project', async () => {
    vi.useFakeTimers();
    const h = setup();
    let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
    h.resume.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    const controller = h.controller();
    try {
      await controller.start({ page: 'original', workId: 'a', sourceId: 'source-a' });
      expect(controller.getSnapshot().inspection?.text).toBe(RAW);
      changed({ workId: 'b' });
      expect(controller.getSnapshot().inspection?.text).toBe(RAW);
      await vi.advanceTimersByTimeAsync(150);
      expect(h.gateway.evidence).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().inspection?.text).toBe(RAW);
      h.rows().projects[0].resume!.candidates = [];
      changed({ workId: 'a' });
      expect(controller.getSnapshot().inspection).toBeNull();
      await vi.advanceTimersByTimeAsync(150);
      expect(controller.getSnapshot().inspection).toBeNull();
      expect(h.gateway.evidence).toHaveBeenCalledTimes(1);
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
  it('cancels scheduled changes on disconnect and stop without losing the single recovery read', async () => {
    vi.useFakeTimers();
    const h = setup();
    let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
    let connected!: (state: 'connected' | 'disconnected') => void;
    h.resume.subscribe = (listener, onConnection) => {
      changed = listener;
      connected = onConnection!;
      return () => {};
    };
    const controller = h.controller();
    try {
      await controller.start({ page: 'project', workId: 'a' });
      changed({ workId: 'a' });
      connected('disconnected');
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.gateway.list).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().online).toBe(false);
      connected('connected');
      await vi.advanceTimersByTimeAsync(0);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot().online).toBe(true);
      changed({ workId: 'a' });
      controller.stop();
      changed({ workId: 'a' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(h.resume.refresh).not.toHaveBeenCalled();
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
  it('recovers a displayed collecting snapshot once while ignoring later unchanged completions', async () => {
    vi.useFakeTimers();
    const h = setup();
    let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
    h.resume.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    h.rows().projects[0].collecting = true;
    h.rows().projects[0].resume!.state = 'limited';
    const controller = h.controller();
    try {
      await controller.start({ page: 'project', workId: 'a' });
      expect(
        controller.getSnapshot().projects.find((project) => project.id === 'a')!.canDecide,
      ).toBe(false);
      h.rows().projects[0].collecting = false;
      h.rows().projects[0].resume!.state = 'ready';
      changed({ workId: 'a', kind: 'collection-settled' });
      await vi.advanceTimersByTimeAsync(150);
      expect(
        controller.getSnapshot().projects.find((project) => project.id === 'a')!.canDecide,
      ).toBe(true);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      changed({ workId: 'a', kind: 'collection-settled' });
      await vi.advanceTimersByTimeAsync(60000);
      expect(h.gateway.list).toHaveBeenCalledTimes(2);
      expect(h.resume.refresh).not.toHaveBeenCalled();
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
  it('follows up once when collection settles before the pending GET returns its collecting snapshot', async () => {
    const h = setup();
    let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
    h.resume.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    const controller = h.controller();
    await controller.start({ page: 'project', workId: 'a' });
    const pending = deferred<ProjectWorkspace>();
    vi.mocked(h.gateway.list).mockImplementationOnce(() => pending.promise);
    const reading = controller.refresh(true);
    changed({ workId: 'a', kind: 'collection-settled' });
    const captured = structuredClone(h.rows());
    captured.projects[0].collecting = true;
    captured.projects[0].resume!.state = 'limited';
    pending.resolve(captured);
    await reading;
    expect(h.gateway.list).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ loading: false, checkingCurrent: false });
    expect(controller.getSnapshot().projects.find((project) => project.id === 'a')!.canDecide).toBe(
      true,
    );
    expect(h.resume.refresh).not.toHaveBeenCalled();
    controller.stop();
  });
  it('invalidates an original immediately on a scope change without waiting for its old response', async () => {
    const h = setup();
    let changed!: () => void;
    h.resume.subscribe = (listener) => {
      changed = listener;
      return () => {};
    };
    const controller = h.controller();
    await controller.start({ page: 'project', workId: 'a' });
    const original = deferred<ReturnType<typeof source>>();
    h.gateway.evidence = vi.fn(() => original.promise);
    controller.navigate({
      page: 'original',
      workId: 'a',
      candidateKey: 'first',
      sourceId: 'source-a',
    });
    await controller.refresh();
    expect(h.gateway.evidence).toHaveBeenCalledWith('a', 'source-a');
    const freshRead = deferred<ProjectWorkspace>();
    h.gateway.list = vi.fn(() => freshRead.promise);
    changed();
    expect(controller.getSnapshot()).toMatchObject({ inspection: null, checkingCurrent: true });
    expect(controller.getSnapshot().projects.every((project) => !project.canDecide)).toBe(true);
    h.rows().projects[0].resume!.candidates = [];
    freshRead.resolve(structuredClone(h.rows()));
    await vi.waitFor(() => expect(controller.getSnapshot().checkingCurrent).toBe(false));
    expect(controller.getSnapshot().projects.find((project) => project.id === 'a')!.tasks).toEqual(
      [],
    );
    original.resolve(source(RAW));
    await new Promise((done) => setTimeout(done, 0));
    expect(controller.getSnapshot().inspection).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    expect(h.resume.refresh).not.toHaveBeenCalled();
    controller.stop();
  });
  it('clears removed local edits and never restores a removed project from storage', async () => {
    const h = setup();
    const controller = h.controller();
    await controller.start({ page: 'settings', workId: 'a' });
    controller.editGoal('a', 'Remove this input');
    await controller.previewDeletion('a');
    expect(await controller.remove('a')).toBe(true);
    expect(h.gateway.delete).toHaveBeenCalledWith('a', 1, 'preview');
    expect(controller.getSnapshot().projects.some((entry) => entry.id === 'a')).toBe(false);
    expect(h.storage.get('a')?.goalDraft).toBeNull();
    const cleared = structuredClone(h.storage.get('a'));
    controller.recordScroll('a', 300);
    controller.select('a', 'old-task');
    expect(h.storage.get('a')).toEqual(cleared);
    expect(controller.getSnapshot().edits.a).toBeUndefined();
    controller.stop();
    const restarted = h.controller();
    await restarted.start({ page: 'project', workId: 'a' });
    expect(restarted.getSnapshot().projects.some((entry) => entry.id === 'a')).toBe(false);
    expect(h.resume.refresh).not.toHaveBeenCalled();
    restarted.stop();
  });
  it('prunes retired browser drafts only after an authoritative successful list, including disconnected IDs', async () => {
    const h = setup();
    h.rows().projects[1].disconnectedAt = '2026-09-16T00:00:00Z';
    const prune = vi.fn();
    h.memory.prune = prune;
    const controller = h.controller();
    try {
      await controller.start({ page: 'home' });
      expect(prune).toHaveBeenLastCalledWith(['a', 'b']);
      prune.mockClear();
      h.gateway.list = vi.fn(async () => {
        throw new Error('Unavailable');
      });
      await controller.refresh();
      expect(prune).not.toHaveBeenCalled();
      h.rows().projects = [h.rows().projects[1]];
      h.gateway.list = vi.fn(async () => structuredClone(h.rows()));
      await controller.refresh();
      expect(prune).toHaveBeenLastCalledWith(['b']);
      expect(controller.getSnapshot().projects.map((project) => project.id)).toEqual(['b']);
      expect(h.resume.refresh).not.toHaveBeenCalled();
    } finally {
      controller.stop();
    }
  });
  it('reports browser cleanup failure while keeping the new server projects authoritative', async () => {
    const h = setup();
    h.memory.prune = () => {
      throw new Error(RAW);
    };
    const controller = h.controller();
    try {
      await controller.start({ page: 'home' });
      expect(controller.getSnapshot().memoryError).toContain(
        'Old browser drafts could not be cleared',
      );
      expect(controller.getSnapshot().projects).toHaveLength(2);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    } finally {
      controller.stop();
    }
  });
  it('returns a reused registration without applying the submitted goal or sources to it', async () => {
    const h = setup();
    h.gateway.create = vi.fn(async () => ({ ...receipt('a'), command: 'project-reuse' }));
    const controller = h.controller();
    try {
      await controller.start({ page: 'new' });
      expect(
        await controller.create({
          title: 'Another session',
          cwd: '/project/a',
          purpose: 'Do not overwrite',
          goal: 'Do not reuse',
          threadIds: ['another-thread'],
          discover: true,
        }),
      ).toEqual({ workId: 'a', reused: true });
      expect(controller.getSnapshot().projects.find((project) => project.id === 'a')?.goal).toBe(
        'Review the export',
      );
      expect(h.gateway.sources).not.toHaveBeenCalled();
      expect(h.resume.setGoal).not.toHaveBeenCalled();
      expect(h.resume.refresh).not.toHaveBeenCalled();
    } finally {
      controller.stop();
    }
  });
  it('requests the first overview after a new registration without making refresh failure a create failure', async () => {
    const h = setup();
    const controller = h.controller();
    try {
      await controller.start({ page: 'new' });
      expect(
        await controller.create({
          title: 'New project',
          cwd: '/project/new',
          purpose: 'Understand this project.',
          threadIds: [],
          discover: false,
        }),
      ).toEqual({ workId: 'new', reused: false });
      expect(h.resume.refresh).toHaveBeenCalledExactlyOnceWith('new');

      h.resume.refresh = vi.fn(async () => {
        throw new Error(RAW);
      });
      expect(
        await controller.create({
          title: 'Another project',
          cwd: '/project/another',
          purpose: '',
          threadIds: [],
          discover: false,
        }),
      ).toEqual({ workId: 'new', reused: false });
      expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    } finally {
      controller.stop();
    }
  });
  it('adds related Codex conversations discovered from the project folder before the first overview', async () => {
    const h = setup();
    h.gateway.discover = vi.fn(async () => ({
      threads: [
        { id: 'related-a', title: 'A', cwd: '/project/new' },
        { id: 'related-b', title: 'B', cwd: '/project/new' },
      ],
      complete: true,
      limitations: [],
    }));
    const controller = h.controller();
    try {
      await controller.start({ page: 'new' });
      await controller.create({
        title: 'New project',
        cwd: '/project/new',
        purpose: '',
        threadIds: [],
        discover: false,
      });
      expect(h.gateway.discover).toHaveBeenCalledExactlyOnceWith('/project/new');
      expect(h.gateway.create).toHaveBeenCalledExactlyOnceWith({
        title: 'New project',
        cwd: '/project/new',
        purpose: '',
        threadIds: ['related-a', 'related-b'],
        discover: true,
      });
      expect(h.resume.refresh).toHaveBeenCalledExactlyOnceWith('new');
    } finally {
      controller.stop();
    }
  });
  it('continues a zero-thread create and first overview when Codex discovery fails', async () => {
    const h = setup();
    h.gateway.discover = vi.fn(async () => {
      throw new Error(RAW);
    });
    const controller = h.controller();
    try {
      await controller.start({ page: 'new' });
      await controller.create({
        title: 'Local project',
        cwd: '/project/local',
        purpose: '',
        threadIds: [],
        discover: false,
      });
      expect(h.gateway.create).toHaveBeenCalledExactlyOnceWith({
        title: 'Local project',
        cwd: '/project/local',
        purpose: '',
        threadIds: [],
        discover: false,
      });
      expect(h.resume.refresh).toHaveBeenCalledExactlyOnceWith('new');
      expect(JSON.stringify(controller.getSnapshot())).not.toContain(RAW);
    } finally {
      controller.stop();
    }
  });
  it('does not rediscover Codex context when project creation already carries an explicit source selection', async () => {
    const h = setup();
    const controller = h.controller();
    try {
      await controller.start({ page: 'new' });
      await controller.create({
        title: 'Explicit project',
        cwd: '/project/explicit',
        purpose: '',
        threadIds: ['chosen-thread'],
        discover: false,
      });
      expect(h.gateway.discover).not.toHaveBeenCalled();
      expect(h.gateway.create).toHaveBeenCalledWith(
        expect.objectContaining({ threadIds: ['chosen-thread'], discover: false }),
      );
    } finally {
      controller.stop();
    }
  });
  it('canonicalizes old links without reopening the legacy journey', () => {
    expect(projectRouteHref(parseProjectRoute('#/details/a'))).toBe('#/project/a');
    expect(projectRouteHref(parseProjectRoute('#/resume/a?task=second'))).toBe(
      '#/project/a?task=second',
    );
    expect(projectRouteHref(parseProjectRoute('#/projects'))).toBe('#/home');
    expect(projectRouteHref(parseProjectRoute('#/project/%ZZ'))).toBe('#/home');
  });
});
