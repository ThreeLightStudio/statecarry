import { describe, expect, it } from 'vitest';
import {
  presentResumeNarrative,
  presentResumeProgress,
  presentResumeWork,
  type ResumeCandidate,
  type ResumeWork,
} from '@statecarry/presentation';

const candidate: ResumeCandidate = {
  key: 'candidate-a',
  goal: 'Ship the export fix',
  currentState: 'The export fix is implemented; the focused check is still open.',
  status: 'active',
  reason: 'The focused check has not been recorded yet.',
  nextAction: 'Run the focused export check',
  actionSource: 'recorded',
  doneWhen: 'The focused export check result is recorded',
  threadId: 'thread-a',
  prerequisites: [],
  evidence: [{ revisionId: 'record-a', quote: 'raw evidence should stay in details' }],
  progress: {
    reported: [{ revisionId: 'record-a', quote: 'reported' }],
    implemented: [{ revisionId: 'file-a', quote: 'implemented' }],
    verified: [],
  },
};

function work(patch: Partial<ResumeWork> = {}): ResumeWork {
  return {
    workId: 'work-a',
    title: 'Export fix',
    cwd: '/synthetic-project',
    version: 'v1',
    goalText: null,
    goalOrigin: 'inferred',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    state: 'ready',
    generatedAt: '2026-09-15T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    candidates: [candidate],
    ...patch,
  };
}

function narrative(value = work()) {
  const selected = presentResumeWork(value).selected!;
  return presentResumeNarrative(selected, value);
}

describe('resume narrative presentation', () => {
  it('uses the actual current-state summary and recorded reason/action instead of generic progress copy', () => {
    const result = narrative();
    expect(result).toEqual({
      purpose: 'Ship the export fix',
      currentState: 'The export fix is implemented; the focused check is still open.',
      evidenceNote:
        'Project evidence records implementation; independent verification is not recorded yet.',
      transitionHeading: 'Why this is next',
      transition: 'The focused check has not been recorded yet.',
      nextAction: 'Run the focused export check',
      doneWhen: 'The focused export check result is recorded',
    });
    expect(JSON.stringify(result)).not.toContain('raw evidence should stay in details');
  });

  it('keeps presentResumeProgress content-specific for compatibility callers', () => {
    expect(presentResumeProgress(candidate)).toEqual({
      completed: candidate.currentState,
      remaining: candidate.reason,
    });
  });

  it('does not surface a stale active action while the work is limited', () => {
    const limited = work({
      state: 'limited',
      stateDetail:
        'The project changed since this brief. Check the current workspace before acting.',
      stale: true,
    });
    const result = narrative(limited);
    expect(result.transitionHeading).toBe('Before continuing');
    expect(result.transition).toContain('project changed');
    expect(result.nextAction).toBeNull();
    expect(result.doneWhen).toBeNull();
  });

  it('uses the recorded reason when an otherwise-current active brief has no executable action', () => {
    const value = work({
      candidates: [{ ...candidate, nextAction: null, doneWhen: null, actionSource: null }],
    });
    const result = narrative(value);
    expect(result.transitionHeading).toBe('Before continuing');
    expect(result.transition).toBe(candidate.reason);
    expect(result.nextAction).toBeNull();
  });

  it.each([
    ['waiting', 'What is waiting'],
    ['paused', 'Why it is paused'],
    ['unclear', 'What needs deciding'],
    ['done', 'Completion reported'],
  ] as const)(
    'keeps %s state descriptive without inventing an executable action',
    (status, heading) => {
      const value = work({
        candidates: [
          {
            ...candidate,
            status,
            reason: `${status} reason from the connected records.`,
            nextAction: null,
            doneWhen: null,
            actionSource: null,
          },
        ],
      });
      const result = narrative(value);
      expect(result.transitionHeading).toBe(heading);
      expect(result.transition).toBe(`${status} reason from the connected records.`);
      expect(result.nextAction).toBeNull();
      expect(result.doneWhen).toBeNull();
    },
  );

  it('distinguishes reported completion from independently checked completion', () => {
    const reported = work({
      candidates: [
        {
          ...candidate,
          status: 'done',
          nextAction: null,
          doneWhen: null,
          actionSource: null,
          completion: { reported: [{ revisionId: 'record-a', quote: 'done' }], verified: [] },
        },
      ],
    });
    expect(narrative(reported).evidenceNote).toContain('reported');
    expect(narrative(reported).evidenceNote).toContain('not recorded');

    const verified = work({
      candidates: [
        {
          ...reported.candidates[0],
          completion: {
            reported: [{ revisionId: 'record-a', quote: 'done' }],
            verified: [{ revisionId: 'check-a', quote: 'checked' }],
          },
        },
      ],
    });
    expect(narrative(verified).evidenceNote).toBe(
      'A completion check is recorded for this result.',
    );
  });
});
