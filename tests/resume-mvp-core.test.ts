import { describe, expect, it } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import type { ResumeCandidate, WorkspaceSnapshot } from '@statecarry/contracts';
import { harness, source } from './helpers';

const candidate = (record = source()): ResumeCandidate => ({
  key: 'goal-a',
  goal: 'Ship the export',
  currentState: 'The export is implemented and its check remains open.',
  status: 'active',
  reason: 'The check remains open.',
  nextAction: 'Run the export check',
  actionSource: 'recorded',
  doneWhen: 'The check result is recorded.',
  threadId: record.threadId,
  prerequisites: [],
  evidence: [{ revisionId: record.id, quote: record.text }],
});
const snapshot = (files: NonNullable<WorkspaceSnapshot['files']>): WorkspaceSnapshot => ({
  cwd: '/tmp/example',
  root: '/tmp/example',
  branch: 'main',
  commit: 'same',
  dirty: true,
  status: 'checked',
  checkedAt: '2026-09-15T00:00:00.000Z',
  limitations: [],
  fileFingerprint: files.map((file) => file.hash).join(':'),
  files,
});

describe('resume MVP core boundaries', () => {
  it('prepares an overview from project inspection when no Codex conversation is connected', async () => {
    const h = harness();
    const current: WorkspaceSnapshot = {
      ...snapshot([
        {
          path: 'src/export.ts',
          hash: 'workspace-only',
          size: 30,
          preview: 'export function run() { return true; }',
          status: 'checked',
          limitation: null,
        },
      ]),
      dirty: false,
      changedPaths: [],
      recentCommits: [
        {
          hash: '1234567890abcdef',
          subject: 'implement export',
          committedAt: '2026-09-15T00:00:00.000Z',
          changedPaths: ['src/export.ts'],
        },
      ],
    };
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      undefined,
      { inspect: () => structuredClone(current) },
    );
    const id = core.projects.create({
      requestId: core.ids.next(),
      expectedRevision: 0,
      payload: {
        title: 'Project',
        purpose: 'Understand the local project and choose the next useful action.',
        cwd: '/tmp/example',
        threadIds: [],
        discover: false,
      },
    }).workId;
    let supplied: any;
    h.summary.generateResume = async (input: any) => {
      supplied = input;
      const git = input.records.find((record: any) => record.kind === 'gitObservation');
      return {
        candidates: [
          {
            key: 'workspace-only',
            goal: 'Continue the local project',
            currentState: 'The local project contains a recent export implementation.',
            status: 'active',
            reason: 'The project inspection supports a bounded next step.',
            nextAction: 'Review the export implementation',
            actionSource: 'suggested',
            doneWhen: 'The export implementation is reviewed.',
            threadId: 'project-inspection',
            prerequisites: [],
            evidence: [{ revisionId: git.revisionId, quote: git.text }],
            progress: { reported: [], implemented: [], verified: [] },
            completion: { reported: [], verified: [] },
          },
        ],
      };
    };
    await core.resumes.refresh(id);
    expect(supplied.sessions).toEqual([{ id: 'project-inspection', title: 'Project inspection' }]);
    expect(supplied.records.some((record: any) => record.kind === 'gitObservation')).toBe(true);
    expect(supplied.records.some((record: any) => record.kind === 'fileObservation')).toBe(true);
    expect(core.resumes.view(id)).toMatchObject({
      sessionCount: 0,
      state: 'ready',
      candidates: [expect.objectContaining({ threadId: 'project-inspection' })],
    });
    expect(core.projects.list().projects[0].resume).toMatchObject({
      sessionCount: 0,
      state: 'ready',
      candidates: [expect.objectContaining({ threadId: 'project-inspection' })],
    });
  });

  it('detects a file edit while Git remains dirty on the same revision', async () => {
    const h = harness();
    let current = snapshot([
      {
        path: 'src/export.ts',
        hash: 'one',
        size: 3,
        preview: 'one',
        status: 'checked',
        limitation: null,
      },
    ]);
    const inspector: ProjectInspector = {
      inspect: () => ({ ...current, files: current.files?.map((file) => ({ ...file })) }),
    };
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      undefined,
      inspector,
    );
    const id = core.connect({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: { title: 'Project', cwd: '/tmp/example', threadIds: ['thread-a'], discover: false },
    }).workId;
    const record = source('The export check is still open.');
    h.records([record]);
    h.summary.generateResume = async () => ({ candidates: [candidate(record)] });
    await core.resumes.refresh(id);
    current = snapshot([
      {
        path: 'src/export.ts',
        hash: 'two',
        size: 3,
        preview: 'two',
        status: 'checked',
        limitation: null,
      },
    ]);
    expect(core.resumes.view(id)).toMatchObject({
      workspaceChanged: true,
      stale: true,
      candidates: [expect.objectContaining({ key: 'goal-a' })],
    });
  });

  it('makes sampled file observations citable implementation evidence', async () => {
    const h = harness();
    const current = snapshot([
      {
        path: 'src/export.ts',
        hash: 'one',
        size: 3,
        preview: 'export function run() {}',
        status: 'checked',
        limitation: null,
      },
    ]);
    const inspector: ProjectInspector = {
      inspect: () => ({ ...current, files: current.files?.map((file) => ({ ...file })) }),
    };
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      undefined,
      inspector,
    );
    const id = core.connect({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: { title: 'Project', cwd: '/tmp/example', threadIds: ['thread-a'], discover: false },
    }).workId;
    let fileRecord: any;
    h.summary.generateResume = async (input: any) => {
      fileRecord = input.records.find((record: any) => record.kind === 'fileObservation');
      return {
        candidates: [
          {
            ...candidate(),
            evidence: [{ revisionId: fileRecord.revisionId, quote: fileRecord.text }],
            progress: {
              reported: [],
              implemented: [{ revisionId: fileRecord.revisionId, quote: fileRecord.text }],
              verified: [],
            },
            completion: { reported: [], verified: [] },
          },
        ],
      };
    };
    await core.resumes.refresh(id);
    expect(fileRecord).toBeTruthy();
    expect(core.resumes.view(id).candidates[0].progress?.implemented?.[0].revisionId).toBe(
      fileRecord.revisionId,
    );
  });

  it('keeps a last-known brief visible while project inspection is unavailable', async () => {
    const h = harness();
    let current: WorkspaceSnapshot = snapshot([
      {
        path: 'src/export.ts',
        hash: 'one',
        size: 3,
        preview: 'one',
        status: 'checked',
        limitation: null,
      },
    ]);
    const inspector: ProjectInspector = {
      inspect: () => ({ ...current, files: current.files?.map((file) => ({ ...file })) }),
    };
    const core = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      undefined,
      inspector,
    );
    const id = core.connect({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: { title: 'Project', cwd: '/tmp/example', threadIds: ['thread-a'], discover: false },
    }).workId;
    const record = source();
    h.records([record]);
    h.summary.generateResume = async () => ({ candidates: [candidate(record)] });
    await core.resumes.refresh(id);
    current = {
      ...current,
      status: 'unknown',
      branch: null,
      commit: null,
      dirty: null,
      limitations: ['Workspace state unavailable'],
    };
    expect(core.resumes.view(id)).toMatchObject({
      state: 'limited',
      candidates: [expect.objectContaining({ key: 'goal-a' })],
      workspaceChanged: false,
    });
  });

  it('stores and clears an explicit coordination conversation', () => {
    const h = harness(),
      id = h.connect(),
      initial = h.core.resumes.view(id),
      firstRevision = h.core.work(id).revision;
    expect(
      h.core.resumes.setCoordination(id, { version: initial.version, threadId: 'thread-a' })
        .coordination,
    ).toMatchObject({ state: 'recommended', threadId: 'thread-a' });
    expect(h.core.work(id).revision).toBe(firstRevision + 1);
    const selected = h.core.resumes.view(id);
    expect(
      h.core.resumes.setCoordination(id, { version: selected.version, threadId: null }).coordination
        ?.state,
    ).toBe('none');
    expect(h.core.work(id).revision).toBe(firstRevision + 2);
  });
  it('keeps the last checked brief when a later collection is partial', async () => {
    const h = harness(),
      id = h.connect(),
      record = source();
    h.records([record]);
    h.summary.generateResume = async () => ({ candidates: [candidate(record)] });
    await h.core.resumes.refresh(id);
    const read = h.reader.read;
    h.reader.read = async (...args) => ({
      ...(await read(...args)),
      status: 'partial',
      limitations: ['A connected record could not be read.'],
    });
    await h.core.resumes.refresh(id);
    expect(h.core.resumes.view(id)).toMatchObject({
      state: 'limited',
      stale: true,
      candidates: [expect.objectContaining({ key: 'goal-a' })],
    });
  });
  it('publishes an empty state when a complete check finds no safe candidate', async () => {
    const h = harness(),
      id = h.connect();
    h.records([source()]);
    h.summary.generateResume = async () => ({ candidates: [] });
    await h.core.resumes.refresh(id);
    expect(h.core.resumes.view(id)).toMatchObject({ state: 'empty', candidates: [], stale: false });
  });

  it('restores a candidate dismissed as the wrong work', async () => {
    const h = harness(),
      id = h.connect(),
      record = source();
    h.records([record]);
    h.summary.generateResume = async () => ({ candidates: [candidate(record)] });
    await h.core.resumes.refresh(id);
    const initial = h.core.resumes.view(id);
    h.core.resumes.correct(id, {
      candidateKey: 'goal-a',
      version: initial.version,
      kind: 'wrong-work',
    });
    const dismissed = h.core.resumes.view(id);
    expect(dismissed.dismissedKeys).toEqual(['goal-a']);
    h.core.resumes.correct(id, {
      candidateKey: 'goal-a',
      version: dismissed.version,
      kind: 'restore',
    });
    expect(h.core.resumes.view(id).candidates).toEqual([
      expect.objectContaining({ key: 'goal-a' }),
    ]);
  });
});
