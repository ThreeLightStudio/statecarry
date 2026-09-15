import { it, expect } from 'vitest';
import { presentResumeWork, type ResumeWork } from '@statecarry/presentation';

const work = (navigation: NonNullable<ResumeWork['navigation']>): ResumeWork => ({
  workId: 'work-nav', title: 'Navigation', cwd: '/project', version: 'v1',
  goalText: 'Check navigation', goalOrigin: 'user-input', sessionCount: 1,
  updatesAvailable: false, busy: false, error: null, stale: false,
  generatedAt: '2026-09-15T00:00:00.000Z', correctedKeys: [], dismissedKeys: [], navigation,
  candidates: [{ key: 'candidate', goal: 'Check navigation', currentState: 'The navigation check remains open.', status: 'active', reason: 'The check is open.', nextAction: 'Run the navigation check', actionSource: 'recorded', doneWhen: 'The navigation result is recorded', threadId: 'thread-nav', prerequisites: [], evidence: [{ revisionId: 'record-nav', quote: 'The check is open.' }] }],
});

it('only presents a conversation link when navigation capability is verified', () => {
  const invalid = presentResumeWork(work({ precision: 'thread', state: 'invalid', verifiedAt: '2026-09-15T00:00:00Z', detail: 'Route verification failed.' }));
  expect(invalid.selected?.target.existing.available).toBe(false);
  const verified = presentResumeWork(work({ precision: 'thread', state: 'verified-route', verifiedAt: '2026-09-15T00:00:00Z', detail: 'Route verified.' }));
  expect(verified.selected?.target.existing.available).toBe(true);
});
