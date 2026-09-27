import { describe, expect, it } from 'vitest';
import type { AnalysisCandidate } from '@statecarry/contracts';
import { harness, source } from './helpers';

const candidate = (): AnalysisCandidate => ({
  key: 'reentry-check',
  goal: 'Finish the checked result',
  currentState: 'The implementation is recorded; the final check remains.',
  status: 'active',
  reason: 'The final check has not been recorded.',
  nextAction: 'Run the final check',
  actionSource: 'recorded',
  doneWhen: 'The check result is recorded',
  threadId: 'thread-a',
  prerequisites: [],
  evidence: [{ revisionId: source().id, quote: source().text }],
});

describe('resume re-entry refresh behavior', () => {
  it('does not analyze again when a saved brief is only viewed again', async () => {
    const h = harness();
    const id = h.connect();
    let calls = 0;
    h.summary.generateAnalysis = async () => {
      calls += 1;
      return { candidates: [candidate()] };
    };

    await h.core.analyses.refresh(id);
    expect(calls).toBe(1);

    // These are the reads performed by a route remount/restart. Reading the
    // stored brief must never be an implicit request for another model call.
    expect(h.core.analyses.view(id).candidates).toHaveLength(1);
    expect(h.core.analyses.view(id).candidates[0].key).toBe('reentry-check');
    expect(calls).toBe(1);
  });

  it('coalesces concurrent explicit refresh requests into one analysis', async () => {
    const h = harness();
    const id = h.connect();
    let calls = 0;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.summary.generateAnalysis = async () => {
      calls += 1;
      entered();
      await gate;
      return { candidates: [candidate()] };
    };

    const first = h.core.analyses.refresh(id);
    await started;
    let secondSettled = false;
    const second = h.core.analyses.refresh(id).then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(h.core.analyses.view(id).candidates).toHaveLength(1);
  });

  it('keeps the saved brief after an explicit refresh fails without retrying on view', async () => {
    const h = harness();
    const id = h.connect();
    let calls = 0;
    h.summary.generateAnalysis = async () => {
      calls += 1;
      return { candidates: [candidate()] };
    };
    await h.core.analyses.refresh(id);

    h.summary.generateAnalysis = async () => {
      calls += 1;
      throw new Error('provider unavailable');
    };
    await h.core.analyses.refresh(id);

    expect(h.core.analyses.view(id)).toMatchObject({
      state: 'limited',
      candidates: [expect.objectContaining({ key: 'reentry-check' })],
    });
    expect(calls).toBe(2);
    h.core.analyses.view(id);
    expect(calls).toBe(2);
  });
});
