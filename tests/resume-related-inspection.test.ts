import { describe, expect, it } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import type { ResumeCandidate, WorkspaceSnapshot, WorkspaceInspectionHints } from '@statecarry/contracts';
import { harness, source } from './helpers';

const candidate = (record: ReturnType<typeof source>): ResumeCandidate => ({
  key: 'related', goal: 'Ship the export', currentState: 'The export is implemented and its check remains open.',
  status: 'active', reason: 'The check remains open.', nextAction: 'Run the export check', actionSource: 'recorded',
  doneWhen: 'The check result is recorded.', threadId: record.threadId, prerequisites: [],
  evidence: [{ revisionId: record.id, quote: record.text }],
});

describe('resume inspection hints', () => {
  it('passes connected path and function clues to project inspection before analysis', async () => {
    const h = harness();
    let received: WorkspaceInspectionHints | undefined;
    const snapshot: WorkspaceSnapshot = {
      cwd: '/tmp/example', root: '/tmp/example', branch: null, commit: null, dirty: null, status: 'unknown',
      checkedAt: '2026-09-15T00:00:00.000Z', limitations: ['Git state unavailable'], files: [],
    };
    const inspector: ProjectInspector = { inspect: (_cwd, hints) => { received = hints; return snapshot; } };
    const core = new StateCarry(h.repo, h.reader, h.summary, h.navigator, h.core.clock, h.core.ids, h.core.events, undefined, inspector);
    const id = core.connect({ requestId: h.core.ids.next(), expectedRevision: 0, payload: { title: 'Project', cwd: '/tmp/example', threadIds: ['thread-a'], discover: false } }).workId;
    const record = source('The implementation is in src/later.ts and calls importantFunction().');
    h.records([record]);
    h.summary.generateResume = async () => ({ candidates: [candidate(record)] });
    await core.resumes.refresh(id);
    expect(received?.paths).toContain('src/later.ts');
    expect(received?.symbols).toContain('importantFunction');
  });
});
