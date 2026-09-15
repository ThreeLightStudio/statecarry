import { describe, expect, it, vi } from 'vitest';
import { StateCarry, buildContinuationPayload, type SessionExecutor } from '@statecarry/core';
import type { ResumeCandidate, WorkspaceSnapshot } from '@statecarry/contracts';
import {
  continuationPayload,
  manualContinuation,
  presentResumeWork,
} from '@statecarry/presentation';
import { harness, source } from './helpers';

const inspectionLimit =
  'File observations were limited to 120 selected files; 35 discovered files were not read.';

async function prepared(patch: Partial<WorkspaceSnapshot> = {}) {
  const h = harness();
  let snapshot: WorkspaceSnapshot = {
    cwd: '/tmp/example',
    root: '/tmp/example',
    branch: 'main',
    commit: 'same-commit',
    dirty: false,
    status: 'checked',
    checkedAt: '2026-09-15T00:00:00.000Z',
    limitations: [],
    files: [],
    ...patch,
  };
  const executor: SessionExecutor = {
    capability: () => ({
      create: 'supported',
      send: 'supported',
      verifiedAt: null,
      detail: 'Fake',
    }),
    create: vi.fn(async () => ({ threadId: 'new-thread' })),
    send: vi.fn(async () => ({ turnId: 'new-turn' })),
  };
  const core = new StateCarry(
    h.repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    h.core.ids,
    h.core.events,
    executor,
    { inspect: () => structuredClone(snapshot) },
  );
  const id = core.connect({
    requestId: core.ids.next(),
    expectedRevision: 0,
    payload: {
      title: 'Export work',
      cwd: '/tmp/example',
      threadIds: ['thread-a'],
      discover: false,
    },
  }).workId;
  const request = source('Review the export check before shipping.', 'thread-a', 'request');
  const proof = {
    ...source('The focused export test passed.', 'thread-a', 'proof'),
    actor: 'tool' as const,
    kind: 'toolResult',
  };
  const candidate: ResumeCandidate = {
    key: 'export-check',
    goal: 'Ship the export',
    currentState: 'The export awaits its final check.',
    status: 'active',
    reason: 'The final check is still required.',
    nextAction: 'Review the export check',
    doneWhen: 'The final result is recorded.',
    actionSource: 'recorded',
    threadId: 'thread-a',
    prerequisites: [],
    evidence: [{ revisionId: request.id, quote: request.text }],
    progress: { verified: [{ revisionId: proof.id, quote: proof.text }] },
  };
  h.records([request, proof]);
  const generate = vi.fn(async () => ({ candidates: [candidate] }));
  h.summary.generateResume = generate;
  await core.resumes.refresh(id);
  const command = (payload: Record<string, unknown>) => ({
    requestId: core.ids.next(),
    expectedRevision: core.work(id).revision,
    payload,
  });
  return {
    ...h,
    core,
    id,
    request,
    proof,
    candidate,
    generate,
    executor,
    command,
    inspect: (next: Partial<WorkspaceSnapshot>) => {
      snapshot = { ...snapshot, ...next };
    },
  };
}

describe('resume goal and evidence validity', () => {
  it('keeps cited historical evidence readable during a failed read of the same bounded scope', async () => {
    const h = await prepared();
    const connection = h.core.connection(h.core.work(h.id).projectId);
    h.core.updateConnection(
      connection.id,
      h.command({
        title: connection.title,
        cwd: connection.cwd,
        threadIds: ['thread-a'],
        discover: false,
        recordRanges: {
          'thread-a': { start: { turnId: h.request.turnId, itemId: h.request.itemId } },
        },
      }),
    );
    await h.core.resumes.refresh(h.id);
    h.reader.read = async () => {
      throw new Error('Synthetic read outage');
    };
    await h.core.resumes.refresh(h.id);
    const view = h.core.resumes.view(h.id);
    expect(view).toMatchObject({
      stale: true,
      state: 'limited',
      candidates: [expect.objectContaining({ key: h.candidate.key })],
    });
    expect(h.core.evidence(h.request.id, h.id).text).toBe(h.request.text);
    expect(presentResumeWork(view).selected?.actionAvailable).toBe(false);
    const unrelated = source('Unrelated historical text', 'thread-a', 'unrelated');
    h.repo.put('source', unrelated);
    expect(h.core.accessibleSource(h.id, unrelated.id)).toBeNull();
    h.core.resumes.setGoal(h.id, { text: 'A new goal', version: view.version });
    expect(h.core.accessibleSource(h.id, h.request.id)).toBeNull();
    expect(h.core.resumes.view(h.id).candidates).toEqual([]);
  });
  it.each(['unavailable workspace', 'changed workspace', 'failed refresh'] as const)(
    'does not retain the old action under a changed goal with %s',
    async (condition) => {
      const h = await prepared();
      const stored = h.core.work(h.id).resume;
      if (condition === 'unavailable workspace') h.inspect({ status: 'unknown' });
      if (condition === 'changed workspace') h.inspect({ commit: 'different-commit' });
      if (condition === 'failed refresh') {
        h.summary.generateResume = async () => {
          throw new Error('Synthetic provider failure');
        };
        await h.core.resumes.refresh(h.id);
      }
      const view = h.core.resumes.setGoal(h.id, {
        text: 'Investigate a separate billing issue',
        version: h.core.resumes.view(h.id).version,
      });
      expect(view).toMatchObject({
        goalText: 'Investigate a separate billing issue',
        stale: true,
        candidates: [],
      });
      expect(presentResumeWork(view).selected).toBeNull();
      expect(view.stateDetail).toMatch(/goal|scope/i);
      // Invalidation affects the current reading; it does not destroy the saved history.
      expect(h.core.work(h.id).resume).toEqual(stored);
    },
  );

  it('hides the old brief after the connected record range changes and collection is partial', async () => {
    const h = await prepared();
    const connection = h.core.connection(h.core.work(h.id).projectId);
    h.core.updateConnection(
      connection.id,
      h.command({
        title: connection.title,
        cwd: connection.cwd,
        threadIds: ['thread-a'],
        discover: false,
        recordRanges: { 'thread-a': { start: { turnId: h.proof.turnId, itemId: h.proof.itemId } } },
      }),
    );
    const read = h.reader.read;
    h.reader.read = async (...args) => ({
      ...(await read(...args)),
      status: 'partial',
      limitations: ['Synthetic partial read'],
    });
    await h.core.collect(h.id);
    const view = h.core.resumes.view(h.id);
    expect(view.candidates).toEqual([]);
    expect(presentResumeWork(view).selected).toBeNull();
    expect(h.repo.get('source', h.request.id)?.text).toBe(h.request.text);
  });

  it('does not preserve an inaccessible nested quote when the workspace also becomes unavailable', async () => {
    const h = await prepared();
    h.repo.put('source', { ...h.proof, text: 'The original proof is no longer available.' });
    h.inspect({ status: 'unknown' });
    const view = h.core.resumes.view(h.id);
    expect(view).toMatchObject({ stale: true, candidates: [] });
    expect(view.stateDetail).toMatch(/evidence|record/i);
    expect(presentResumeWork(view).selected).toBeNull();
  });

  it('does not revive an incompatible saved result on an inspection failure', async () => {
    const h = await prepared();
    const work = h.core.work(h.id);
    work.resume!.candidates[0].currentState = 'Clipped fragment';
    h.repo.put('work', work);
    h.inspect({ status: 'unknown' });
    expect(h.core.resumes.view(h.id)).toMatchObject({ stale: true, candidates: [] });
  });

  it('rejects restoring an old candidate into a new goal scope', async () => {
    const h = await prepared();
    h.core.resumes.setGoal(h.id, {
      text: 'Investigate billing',
      version: h.core.resumes.view(h.id).version,
    });
    const before = h.core.work(h.id).resumeOverrides;
    expect(() =>
      h.core.resumes.correct(h.id, {
        candidateKey: h.candidate.key,
        version: h.core.resumes.view(h.id).version,
        kind: 'restore',
      }),
    ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(h.core.work(h.id).resumeOverrides).toEqual(before);
  });

  it('rejects a late result for the previous goal and never analyzes on a read', async () => {
    const h = await prepared();
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      enter();
      await gate;
      return { candidates: [h.candidate] };
    });
    h.summary.generateResume = generate;
    const refreshing = h.core.resumes.refresh(h.id);
    await entered;
    h.core.resumes.setGoal(h.id, {
      text: 'Investigate billing',
      version: h.core.resumes.view(h.id).version,
    });
    release();
    await refreshing;
    expect(h.core.resumes.view(h.id)).toMatchObject({ candidates: [], stale: true });
    expect(h.core.resumes.view(h.id).error).toContain('changed');
    h.core.resumes.list();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('inspection limits and actual action blockers', () => {
  it('retains inspection limits without requiring another identical analysis to continue', async () => {
    const h = await prepared({ limitations: [inspectionLimit] });
    for (let visit = 0; visit < 2; visit++) {
      const view = h.core.resumes.view(h.id);
      expect(view).toMatchObject({ state: 'ready', stale: false, updatesAvailable: false });
      const presented = presentResumeWork(view);
      expect(presented.status.canAct).toBe(true);
      expect(presented.selected?.actionAvailable).toBe(true);
      expect(presented.blockedActions).toEqual([]);
      expect(presented.limitations).toContain(inspectionLimit);
      expect(
        manualContinuation(presented.selected!, view)?.payload.constraints.length,
      ).toBeGreaterThan(0);
      expect(buildContinuationPayload(view.candidates[0], view)).not.toBeNull();
      if (visit === 0) await h.core.resumes.refresh(h.id);
    }
    expect(h.generate).toHaveBeenCalledTimes(2);
  });

  it('permits the same bounded candidate through preparation and sending without dropping its constraints', async () => {
    const h = await prepared({ limitations: [inspectionLimit] });
    const view = h.core.resumes.view(h.id);
    const payload = continuationPayload(presentResumeWork(view).selected!, view);
    expect(payload).not.toBeNull();
    const request = h.core.continuations.prepare(
      h.id,
      h.command({ targetMode: 'new-session', payload }),
    );
    await h.core.continuations.send(h.id, h.command({ continuationId: request.id }));
    expect(h.executor.create).toHaveBeenCalledTimes(1);
    expect(h.executor.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.executor.send).mock.calls[0][0].text).toMatch(/part of|limited to/);
  });

  it.each(['changed workspace', 'unavailable workspace', 'failed refresh', 'new records'] as const)(
    'keeps the same-goal brief readable but blocks actions for %s',
    async (condition) => {
      const h = await prepared({ limitations: [inspectionLimit] });
      if (condition === 'changed workspace') h.inspect({ commit: 'new-commit' });
      if (condition === 'unavailable workspace') h.inspect({ status: 'unknown' });
      if (condition === 'failed refresh') {
        h.summary.generateResume = async () => {
          throw new Error('Synthetic failure');
        };
        await h.core.resumes.refresh(h.id);
      }
      if (condition === 'new records') {
        h.records([
          h.request,
          h.proof,
          source('An additional decision arrived.', 'thread-a', 'new'),
        ]);
        await h.core.collect(h.id);
      }
      const view = h.core.resumes.view(h.id);
      const presented = presentResumeWork(view);
      expect(presented.selected?.key).toBe(h.candidate.key);
      expect(presented.selected?.actionAvailable).toBe(false);
      expect(presented.selected?.statusLabel).not.toBe('Ready for the next action');
      expect(continuationPayload(presented.selected!, view)).toBeNull();
      expect(presented.selected?.target.existing.available).toBe(true);
      expect(() =>
        h.core.continuations.prepare(
          h.id,
          h.command({
            targetMode: 'new-session',
            payload: {
              goal: h.candidate.goal,
              currentState: h.candidate.currentState,
              nextAction: h.candidate.nextAction,
              doneWhen: h.candidate.doneWhen,
              constraints: [],
            },
          }),
        ),
      ).toThrow();
      expect(h.executor.send).not.toHaveBeenCalled();
    },
  );

  it('keeps an explicit Core action block even when a caller also labels the work ready', async () => {
    const h = await prepared();
    const view = {
      ...h.core.resumes.view(h.id),
      blockedActions: ['Confirm the required input first.'],
    };
    expect(presentResumeWork(view).selected?.actionAvailable).toBe(false);
    expect(buildContinuationPayload(view.candidates[0], view)).toBeNull();
  });
});
