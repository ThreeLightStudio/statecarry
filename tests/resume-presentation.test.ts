import { describe, expect, it } from 'vitest';
import {
  manualContinuation,
  manualContinuationText,
  presentResumeWork,
  presentCoordination,
  continuationText,
  presentResumeProgress,
  resumeWorkStatus,
  type ResumeWork,
} from '@statecarry/presentation';

const candidate = {
  key: 'candidate-a',
  goal: 'Ship the export fix',
  currentState: 'The export fix is implemented; the focused check is still open.',
  status: 'active' as const,
  reason: 'The focused check has not been recorded yet.',
  nextAction: 'Run the focused export check',
  actionSource: 'recorded' as const,
  doneWhen: 'The focused export check result is recorded',
  threadId: 'thread-a',
  prerequisites: ['Use the connected project'],
  evidence: [{ revisionId: 'record-a', quote: 'The export fix is implemented.' }],
  progress: {
    reported: [{ revisionId: 'record-a', quote: 'The export fix is implemented.' }],
    implemented: [{ revisionId: 'record-a', quote: 'The export fix is implemented.' }],
    verified: [],
  },
};

function work(patch: Partial<ResumeWork> = {}): ResumeWork {
  return {
    workId: 'work-a',
    title: 'Export fix',
    cwd: '/project',
    version: 'v1',
    goalText: null,
    goalOrigin: 'inferred',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    generatedAt: '2026-09-15T00:00:00.000Z',
    correctedKeys: [],
    dismissedKeys: [],
    candidates: [candidate],
    ...patch,
  };
}

describe('resume presentation status', () => {
  it.each([
    ['ready', work(), 'ready'],
    ['checking', work({ busy: true }), 'checking'],
    ['limited when the workspace changed', work({ workspaceChanged: true }), 'limited'],
    ['empty when analysis has no candidate', work({ candidates: [] }), 'empty'],
    [
      'unavailable before the first analysis',
      work({ generatedAt: null, candidates: [] }),
      'unavailable',
    ],
    ['limited when the brief time is unknown', work({ generatedAt: null }), 'limited'],
    ['failed when the latest check failed', work({ error: 'offline' }), 'failed'],
  ])('%s', (_name, value, expected) => {
    expect(resumeWorkStatus(value as ResumeWork).state).toBe(expected);
  });

  it('keeps the state decision and blocked actions in the UI-independent view model', () => {
    const view = presentResumeWork(work({ updatesAvailable: true }));
    expect(view.state).toBe('limited');
    expect(view.status.canAct).toBe(false);
    expect(view.blockedActions).toContain('send-continuation');
    expect(view.limitations).toContain(
      'New connected records arrived after this brief was captured.',
    );
  });

  it('does not expose a new-session target while the work is limited', () => {
    const view = presentResumeWork(
      work({
        session: {
          create: 'supported',
          send: 'supported',
          detail: 'Sessions are available.',
          verifiedAt: '2026-09-15T00:00:00Z',
        },
        workspaceChanged: true,
      }),
    );
    expect(view.selected?.target.newSession.available).toBe(false);
  });

  it('does not expose a new-session target for a waiting candidate', () => {
    const value = work({
      session: {
        create: 'supported',
        send: 'supported',
        detail: 'Sessions are available.',
        verifiedAt: '2026-09-15T00:00:00Z',
      },
      candidates: [
        { ...candidate, status: 'waiting', nextAction: null, doneWhen: null, actionSource: null },
      ],
    });
    expect(presentResumeWork(value).selected?.target.newSession.available).toBe(false);
  });

  it('preserves a producer-provided explanation and blocked action policy', () => {
    const view = presentResumeWork(
      work({
        state: 'limited',
        stateDetail: 'The project check is still running.',
        blockedActions: ['send-continuation'],
        limitations: ['The project check is still running.'],
      }),
    );
    expect(view.stateDescription).toBe('The project check is still running.');
    expect(view.blockedActions).toEqual(['send-continuation']);
    expect(view.selected?.actionAvailable).toBe(false);
  });

  it('does not call an empty explicitly-ready work item ready', () => {
    expect(resumeWorkStatus(work({ state: 'ready', candidates: [] })).state).toBe('empty');
  });

  it('keeps a retained brief in the limited state after a check error', () => {
    const view = presentResumeWork(
      work({
        state: 'limited',
        error: 'A connected record could not be read.',
        stateDetail: 'The last brief is retained while the connection is checked again.',
      }),
    );
    expect(view.state).toBe('limited');
    expect(view.stateDescription).toContain('last brief is retained');
    expect(view.selected?.actionAvailable).toBe(false);
  });
});

describe('manual continuation', () => {
  it('builds stable pasteable text from the same payload used by a session handoff', () => {
    const current = work({ goalText: 'Ship the export fix' });
    const view = presentResumeWork(current).selected!;
    const handoff = manualContinuation(view, current)!;
    expect(handoff.payload.goal).toBe('Ship the export fix');
    expect(handoff.text).toBe(
      [
        'Continue this work from the connected StateCarry brief.',
        'Goal: Ship the export fix',
        'Current state: The export fix is implemented; the focused check is still open.',
        'Next action: Run the focused export check',
        'Done when: The focused export check result is recorded',
        'Constraints:',
        '- Use the connected project',
        'Related records:',
        '- The export fix is implemented. (record record-a)',
        'Previous conversation: thread-a',
        'Confirm the current state before changing files, then report the result against the done-when condition.',
      ].join('\n'),
    );
    expect(manualContinuationText(view, current)).toBe(handoff.text);
    expect(continuationText(handoff.payload)).toBe(handoff.text);
  });

  it('does not invent a continuation when no next action or completion condition exists', () => {
    const current = work({
      candidates: [{ ...candidate, nextAction: null, doneWhen: null, actionSource: null }],
    });
    const view = presentResumeWork(current).selected!;
    expect(manualContinuation(view, current)).toBeNull();
    expect(manualContinuationText(view, current)).toBeNull();
  });

  it('does not resurrect stale action text from a non-active candidate', () => {
    const current = work({
      candidates: [
        { ...candidate, status: 'done', nextAction: 'Run it again', doneWhen: 'It passes' },
      ],
    });
    const view = presentResumeWork(current).selected!;
    expect(manualContinuationText(view, current)).toBeNull();
  });
});

describe('goal-oriented progress presentation', () => {
  it('describes result progress without turning evidence citations into work counts', () => {
    const view = presentResumeWork(work()).selected!;
    const summary = presentResumeProgress(view);
    expect(summary.completed).toContain('implementation');
    expect(summary.completed).not.toMatch(/\b\d+\b/);
    expect(summary.remaining).toContain('independent check');
  });
});

describe('coordination presentation', () => {
  it('keeps an unconfirmed role visible without treating it as a selected conversation', () => {
    const result = presentCoordination(
      work({
        coordinationChoices: [{ threadId: 'thread-a', title: 'Progress notes' }],
        coordination: {
          state: 'unconfirmed',
          threadId: 'thread-a',
          title: 'Progress notes',
          detail: 'The role of this conversation has not been confirmed.',
          evidence: [],
        },
      }),
    );
    expect(result.state).toBe('unconfirmed');
    expect(result.available).toBe(false);
    expect(result.description).toContain('not been confirmed');
    expect(result.choices).toEqual([{ threadId: 'thread-a', title: 'Progress notes' }]);
  });
});
