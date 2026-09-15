import { describe, expect, it } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import { harness, source } from './helpers';
import type { ResumeCandidate, WorkspaceSnapshot } from '@statecarry/contracts';

const workspace = (overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  cwd: '/tmp/example', branch: 'main', commit: 'abc123', dirty: false,
  status: 'checked', checkedAt: '2026-09-15T00:00:00.000Z', limitations: [], ...overrides,
});

const candidate = (records: ReturnType<typeof source>[]): ResumeCandidate => ({
  key: 'goal-a', goal: 'Fix export', currentState: 'The export is implemented and its check remains open.',
  status: 'active', reason: 'The export check remains open.', nextAction: 'Run the export check',
  actionSource: 'recorded', doneWhen: 'The export result is recorded', threadId: 'thread-a', prerequisites: [],
  evidence: [{ revisionId: records[0].id, quote: records[0].text }],
  progress: {
    reported: [{ revisionId: records[0].id, quote: records[0].text }],
    implemented: records[1] ? [{ revisionId: records[1].id, quote: records[1].text }] : [],
    verified: records[2] ? [{ revisionId: records[2].id, quote: records[2].text }] : [],
  },
  completion: {
    reported: [{ revisionId: records[0].id, quote: records[0].text }],
    verified: records[2] ? [{ revisionId: records[2].id, quote: records[2].text }] : [],
  },
});

function withInspector() {
  const h = harness();
  let current = workspace();
  const inspector: ProjectInspector = { inspect: () => ({ ...current, limitations: [...current.limitations] }) };
  const core = new StateCarry(h.repo, h.reader, h.summary, h.navigator, h.core.clock, h.core.ids, h.core.events, undefined, inspector);
  const id = core.connect({ requestId: h.core.ids.next(), expectedRevision: 0, payload: { title: 'Project', cwd: '/tmp/example', threadIds: ['thread-a'], discover: false } }).workId;
  return { ...h, core, id, setWorkspace: (next: Partial<WorkspaceSnapshot>) => { current = { ...current, ...next }; } };
}

describe('resume workspace evidence', () => {
  it('captures project state before and after analysis and passes it to the provider', async () => {
    const h = withInspector();
    const records = [source('The export was requested.', 'thread-a', 'request'), { ...source('The export was implemented.', 'thread-a', 'implementation'), actor: 'agent' as const }, { ...source('The export check passed.', 'thread-a', 'verification'), actor: 'tool' as const, kind: 'toolResult' }];
    h.records(records);
    let input: any;
    h.summary.generateResume = async value => { input = value; return { candidates: [candidate(records)] }; };
    await h.core.resumes.refresh(h.id);
    expect(input.workspace).toMatchObject({ branch: 'main', commit: 'abc123', dirty: false });
    expect(h.core.work(h.id).resume).toMatchObject({ workspaceBefore: { branch: 'main' }, workspaceAfter: { commit: 'abc123' } });
    expect(h.core.resumes.view(h.id).workspace).toMatchObject({ branch: 'main', commit: 'abc123' });
    expect(h.core.resumes.view(h.id).candidates[0].completion?.verified).toHaveLength(1);
  });

  it('does not publish a brief when the workspace changes during analysis', async () => {
    const h = withInspector();
    const records = [source()];
    h.records(records);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.summary.generateResume = async () => { await gate; return { candidates: [candidate(records)] }; };
    const pending = h.core.resumes.refresh(h.id);
    await new Promise(resolve => setTimeout(resolve, 0));
    h.setWorkspace({ branch: 'feature' });
    release();
    await pending;
    expect(h.core.work(h.id).resume).toBeUndefined();
    expect(h.core.resumes.view(h.id).error).toContain('changed while analysis');
  });

  it('marks a stored brief stale when the workspace later changes', async () => {
    const h = withInspector();
    const records = [source()];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [candidate(records)] });
    await h.core.resumes.refresh(h.id);
    h.setWorkspace({ commit: 'new-commit' });
 expect(h.core.resumes.view(h.id)).toMatchObject({ stale: true, workspaceChanged: true, candidates: [expect.objectContaining({ key: 'goal-a' })] });
  });

  it('keeps an unreadable workspace distinct from a detected project change', async () => {
    const h = withInspector();
    const records = [source()];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [candidate(records)] });
    await h.core.resumes.refresh(h.id);
    h.setWorkspace({ status: 'unknown', branch: null, commit: null, dirty: null, limitations: ['Workspace check unavailable'] });
    expect(h.core.resumes.view(h.id)).toMatchObject({ state: 'limited', stale: true, workspaceChanged: false, candidates: [expect.objectContaining({ key: 'goal-a' })] });
  });

  it('invalidates a brief when a workspace limitation changes', async () => {
    const h = withInspector();
    const records = [source()];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [candidate(records)] });
    await h.core.resumes.refresh(h.id);
    h.setWorkspace({ limitations: ['Only the project metadata was checked.'] });
 expect(h.core.resumes.view(h.id)).toMatchObject({ stale: true, workspaceChanged: true, candidates: [expect.objectContaining({ key: 'goal-a' })] });
  });

  it('does not use a brief whose captured workspace changed during analysis', async () => {
    const h = withInspector();
    const records = [source()];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [candidate(records)] });
    await h.core.resumes.refresh(h.id);
    const work = h.core.work(h.id), stored = work.resume!;
    h.repo.put('work', {
      ...work,
      resume: {
        ...stored,
        workspaceBefore: workspace({ branch: 'main' }),
        workspaceAfter: workspace({ branch: 'feature' }),
      },
    });
 expect(h.core.resumes.view(h.id)).toMatchObject({ stale: true, workspaceChanged: true, candidates: [expect.objectContaining({ key: 'goal-a' })] });
  });

  it('does not accept a user or agent report as verification evidence', async () => {
    const h = withInspector();
    const records = [source(), { ...source('An agent reported the check passed.', 'thread-a', 'report'), actor: 'agent' as const }];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [{ ...candidate(records), progress: { verified: [{ revisionId: records[1].id, quote: records[1].text }] } }] });
    await h.core.resumes.refresh(h.id);
    expect(h.core.resumes.view(h.id).candidates).toEqual([]);
    expect(h.core.resumes.view(h.id).error).toContain('verification evidence');
  });

  it('keeps agent implementation reports separate from confirmed implementation observations', async () => {
    const h = withInspector();
    const report = { ...source('The export was implemented.', 'thread-a', 'implementation'), actor: 'agent' as const };
    h.records([report]);
    h.summary.generateResume = async () => ({ candidates: [{
      ...candidate([report]),
      progress: { implemented: [{ revisionId: report.id, quote: report.text }] },
    }] });
    await h.core.resumes.refresh(h.id);
    const saved = h.core.resumes.view(h.id).candidates[0];
    expect(saved.progress?.implemented).toEqual([]);
    expect(saved.progress?.reported).toEqual([{ revisionId: report.id, quote: report.text }]);
    expect(saved.prerequisites[0]).toContain('no file or tool observation');
  });

  it('does not present an explicit report-only completion as finished work', async () => {
    const h = withInspector();
    const report = source('The export was reported complete.', 'thread-a', 'completion');
    h.records([report]);
    h.summary.generateResume = async () => ({ candidates: [{
      ...candidate([report]),
      status: 'done',
      completion: { reported: [{ revisionId: report.id, quote: report.text }], verified: [] },
    }] });
    await h.core.resumes.refresh(h.id);
    expect(h.core.resumes.view(h.id).candidates[0]).toMatchObject({
      status: 'unclear',
      reason: 'Completion was reported, but independent verification is not recorded.',
      nextAction: null,
      doneWhen: null,
    });
  });

  it('downgrades legacy stored report-only completion after restart', async () => {
    const h = withInspector();
    const report = source('The export was reported complete.', 'thread-a', 'legacy-completion');
    h.records([report]);
    h.summary.generateResume = async () => ({ candidates: [candidate([report])] });
    await h.core.resumes.refresh(h.id);
    const work = h.core.work(h.id);
    const stored = work.resume!;
    h.repo.put('work', {
      ...work,
      resume: {
        ...stored,
        candidates: [{
          ...candidate([report]),
          status: 'done',
          completion: { reported: [{ revisionId: report.id, quote: report.text }], verified: [] },
        }],
      },
    });
    const restored = h.core.resumes.view(h.id).candidates[0];
    expect(restored).toMatchObject({
      status: 'unclear',
      nextAction: null,
      doneWhen: null,
      actionSource: null,
    });
    h.core.resumes.correct(h.id, { candidateKey: restored.key, version: h.core.resumes.view(h.id).version, kind: 'restore' });
    expect(h.core.resumes.view(h.id).candidates[0].status).toBe('unclear');
  });

  it('invalidates a brief when a nested progress or completion quote is no longer readable', async () => {
    const h = withInspector();
    const records = [source('The export was requested.', 'thread-a', 'request'), source('The export was implemented.', 'thread-a', 'implementation'), source('The export check passed.', 'thread-a', 'verification')];
    h.records(records);
    h.summary.generateResume = async () => ({ candidates: [candidate(records)] });
    await h.core.resumes.refresh(h.id);

    // Keep the revision ID linked but change its stored text. The quote is no
    // longer safe to display or use as completion evidence.
    h.repo.put('source', { ...records[2], text: 'The verification record is unavailable.' });
    expect(h.core.resumes.view(h.id)).toMatchObject({ stale: true, candidates: [] });
  });
});
