import { describe, expect, it } from 'vitest';
import { buildContinuationPayload, continuationText } from '@statecarry/core';
import type { ResumeCandidate, ResumeWork } from '@statecarry/contracts';

const candidate = (overrides: Partial<ResumeCandidate> = {}): ResumeCandidate => ({
  key: 'resume',
  goal: 'Ship the export',
  currentState: 'The export is implemented and its check remains open.',
  status: 'active',
  reason: 'The check remains open.',
  nextAction: 'Run the export check',
  actionSource: 'recorded',
  doneWhen: 'The check result is recorded.',
  threadId: 'thread-a',
  prerequisites: [],
  evidence: [{ revisionId: 'record-a', quote: 'The export is implemented.' }],
  ...overrides,
});

const work = (overrides: Partial<ResumeWork> = {}): ResumeWork => ({
  state: 'ready',
  stateDetail: 'Ready.',
  blockedActions: [],
  limitations: [],
  updatesAvailable: false,
  goalText: 'Ship the export',
  goalOrigin: 'user-input',
  sessionCount: 1,
  workId: 'work-a',
  title: 'Export',
  cwd: '/tmp/export',
  version: 'version-a',
  revision: 1,
  session: null,
  navigation: null,
  coordination: null,
  coordinationChoices: [],
  busy: false,
  generatedAt: '2026-09-15T00:00:00.000Z',
  correctedKeys: [],
  dismissedKeys: [],
  continuation: null,
  workspace: null,
  workspaceChanged: false,
  stale: false,
  error: null,
  candidates: [],
  ...overrides,
});

describe('Core continuation payload', () => {
  it('builds deterministic context from the candidate and preserves evidence and constraints', () => {
    const payload = buildContinuationPayload(
      candidate({ prerequisites: ['Use the connected project.'] }),
      work({ limitations: ['Only part of the project files could be checked.'] }),
    );
    expect(payload).toMatchObject({
      goal: 'Ship the export',
      goalConfirmed: true,
      nextAction: 'Run the export check',
      doneWhen: 'The check result is recorded.',
      previousThreadId: 'thread-a',
    });
    expect(payload?.constraints).toContain('Use the connected project.');
    expect(payload?.constraints).toContain('Only part of the project files could be checked.');
    expect(continuationText(payload!)).toContain('Run the export check');
  });

  it('does not turn a retained stale action into an executable continuation', () => {
    expect(
      buildContinuationPayload(candidate(), work({ state: 'limited', stale: true })),
    ).toBeNull();
    expect(buildContinuationPayload(candidate({ status: 'done' }), work())).toBeNull();
  });
});
