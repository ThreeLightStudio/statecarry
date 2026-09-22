import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { AT, harness } from './helpers';
import { deletionCommand, registerProject } from './project-fixtures';

function completedWork(h: ReturnType<typeof harness>, projectId: string, id: string, title = id) {
  h.repo.put('workItem', {
    id,
    projectId,
    title,
    state: 'completed',
    origin: 'user',
    completionCondition: `${title} is implemented.`,
    completionConditionOrigin: 'user',
    createdAt: AT,
    updatedAt: AT,
  });
}

function activeWork(h: ReturnType<typeof harness>, projectId: string, id: string) {
  h.repo.put('workItem', {
    id,
    projectId,
    title: id,
    state: 'active',
    origin: 'user',
    completionCondition: null,
    completionConditionOrigin: null,
    createdAt: AT,
    updatedAt: AT,
  });
}

function policyInput(
  completionMode: 'automatic' | 'user-confirmation' = 'user-confirmation',
  requiredChecks: string[] = [],
  postReleaseVerification: 'none' | 'risk-based' | 'required' = 'risk-based',
) {
  return {
    name: 'Stable release policy',
    timing: 'Ship when a bounded set of completed work is ready.',
    channel: 'stable',
    requiredChecks,
    inclusionRule: 'ready-only' as const,
    targets: [
      { key: 'desktop', label: 'Desktop app', required: true },
      { key: 'docs', label: 'Documentation site', required: false },
    ],
    completionMode,
    postReleaseVerification,
  };
}

function setup(
  completionMode: 'automatic' | 'user-confirmation' = 'user-confirmation',
  requiredChecks: string[] = [],
  postReleaseVerification: 'none' | 'risk-based' | 'required' = 'risk-based',
) {
  const h = harness();
  const projectId = registerProject(h, { goal: 'Ship completed project work safely.' }).receipt
    .projectId;
  h.core.projectModel.view(projectId);
  completedWork(h, projectId, 'work-a', 'Feature A');
  completedWork(h, projectId, 'work-b', 'Feature B');
  activeWork(h, projectId, 'work-c');
  const policy = h.core.releases.setPolicy(
    projectId,
    policyInput(completionMode, requiredChecks, postReleaseVerification),
  );
  return { h, projectId, policy };
}

function target(
  view: ReturnType<ReturnType<typeof harness>['core']['releases']['view']>,
  key: string,
) {
  return view.targets.find((item) => item.key === key)!;
}

describe('release and delivery domain', () => {
  it('groups completed work without changing implementation completion and rejects unfinished work', () => {
    const { h, projectId, policy } = setup();
    const view = h.core.releases.createRelease(
      projectId,
      { title: 'Release A+B', workItemIds: ['work-a', 'work-b'] },
      'release-request',
    );
    expect(view.batches[0]).toMatchObject({
      policyId: policy.id,
      workItemIds: ['work-a', 'work-b'],
      state: 'planned',
    });
    expect(view.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'desktop', required: true, state: 'pending' }),
        expect.objectContaining({ key: 'docs', required: false, state: 'pending' }),
      ]),
    );
    expect(h.repo.get('workItem', 'work-a')?.state).toBe('completed');
    expect(h.repo.get('workItem', 'work-b')?.state).toBe('completed');
    expect(() =>
      h.core.releases.createRelease(
        projectId,
        { title: 'Invalid release', workItemIds: ['work-c'] },
        'invalid-release',
      ),
    ).toThrow('Only completed work');
  });

  it('tracks targets independently and lets optional failure coexist with release completion', () => {
    const { h, projectId } = setup();
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'Independent targets', workItemIds: ['work-a'] },
      'independent',
    );
    const releaseId = view.batches[0].id;
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'docs').id,
      state: 'failed',
      detail: 'Docs deploy timed out.',
    });
    expect(view.batches[0].state).toBe('delivering');
    expect(target(view, 'docs').state).toBe('failed');

    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('awaiting-confirmation');
    expect(target(view, 'desktop').state).toBe('succeeded');
    expect(target(view, 'docs').state).toBe('failed');

    view = h.core.releases.confirmRelease(projectId, releaseId);
    expect(view.batches[0].state).toBe('completed');
    expect(h.core.releases.deliveryState(projectId, 'work-a')).toBe('delivered');
  });

  it('keeps required target failure partial and can recover without erasing successful targets', () => {
    const { h, projectId } = setup();
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'Partial release', workItemIds: ['work-a', 'work-b'] },
      'partial',
    );
    const releaseId = view.batches[0].id;
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'docs').id,
      state: 'succeeded',
    });
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'failed',
      detail: 'Desktop delivery failed.',
    });
    expect(view.batches[0].state).toBe('partial');
    expect(target(view, 'docs').state).toBe('succeeded');
    expect(h.repo.get('workItem', 'work-a')?.state).toBe('completed');

    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'delivering',
    });
    expect(view.batches[0].state).toBe('delivering');
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('awaiting-confirmation');
    expect(target(view, 'docs').state).toBe('succeeded');
  });

  it('automatically completes only when policy says objective target success is enough', () => {
    const { h, projectId } = setup('automatic');
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'Automatic release', workItemIds: ['work-a'] },
      'automatic',
    );
    const releaseId = view.batches[0].id;
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('completed');
    expect(view.batches[0].completedAt).toBe(AT);
  });

  it('requires policy checks before release completion and snapshots them into the release', () => {
    const { h, projectId } = setup('automatic', ['Build passes'], 'required');
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'Checked release', workItemIds: ['work-a'] },
      'checked-release',
    );
    const releaseId = view.batches[0].id;
    expect(view.batches[0].checks.map((check) => check.label)).toEqual([
      'Build passes',
      'Post-release behavior verification',
    ]);
    expect(view.batches[0].checks.map((check) => check.phase)).toEqual([
      'pre-delivery',
      'post-delivery',
    ]);
    const [build, verification] = view.batches[0].checks;
    expect(() =>
      h.core.releases.updateCheck(projectId, releaseId, {
        checkId: verification.id,
        state: 'failed',
        detail: 'This cannot be checked before delivery.',
      }),
    ).toThrow('after required delivery targets succeed');
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('delivering');

    view = h.core.releases.updateCheck(projectId, releaseId, {
      checkId: build.id,
      state: 'passed',
    });
    expect(view.batches[0].state).toBe('delivering');
    view = h.core.releases.updateCheck(projectId, releaseId, {
      checkId: verification.id,
      state: 'failed',
      detail: 'The user path failed.',
    });
    expect(view.batches[0].state).toBe('partial');
    view = h.core.releases.updateCheck(projectId, releaseId, {
      checkId: verification.id,
      state: 'pending',
      detail: 'Retrying the user path.',
    });
    expect(view.batches[0].state).toBe('delivering');
    view = h.core.releases.updateCheck(projectId, releaseId, {
      checkId: verification.id,
      state: 'passed',
    });
    expect(view.batches[0].state).toBe('completed');
  });

  it('does not allow completed work to be delivered twice or enter two active releases', () => {
    const { h, projectId } = setup('automatic');
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'First release', workItemIds: ['work-a'] },
      'first-release',
    );
    expect(() =>
      h.core.releases.createRelease(
        projectId,
        { title: 'Overlapping release', workItemIds: ['work-a'] },
        'overlap-release',
      ),
    ).toThrow('delivery-pending');
    view = h.core.releases.updateTarget(projectId, view.batches[0].id, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('completed');
    expect(() =>
      h.core.releases.createRelease(
        projectId,
        { title: 'Duplicate delivery', workItemIds: ['work-a'] },
        'duplicate-delivery',
      ),
    ).toThrow('delivery-pending');
  });

  it('returns rolled-back completed work to delivery-pending without reopening implementation work', () => {
    const { h, projectId } = setup('automatic');
    let view = h.core.releases.createRelease(
      projectId,
      { title: 'Rollback release', workItemIds: ['work-a', 'work-b'] },
      'rollback',
    );
    const releaseId = view.batches[0].id;
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'succeeded',
    });
    expect(view.batches[0].state).toBe('completed');
    view = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: target(view, 'desktop').id,
      state: 'rolled-back',
      detail: 'Rolled back after a production problem.',
    });
    expect(view.batches[0].state).toBe('rolled-back');
    expect(h.core.releases.deliveryState(projectId, 'work-a')).toBe('pending');
    expect(h.core.releases.deliveryState(projectId, 'work-b')).toBe('pending');
    expect(h.repo.get('workItem', 'work-a')?.state).toBe('completed');
    expect(h.repo.get('workItem', 'work-b')?.state).toBe('completed');

    view = h.core.releases.createRelease(
      projectId,
      { title: 'Rollback release re-delivery', workItemIds: ['work-a', 'work-b'] },
      'rollback-redelivery',
    );
    expect(view.batches[0]).toMatchObject({
      title: 'Rollback release re-delivery',
      state: 'planned',
    });
    const redeliveryId = view.batches[0].id;
    const redeliveryTarget = view.targets.find(
      (item) => item.releaseId === redeliveryId && item.key === 'desktop',
    )!;
    view = h.core.releases.updateTarget(projectId, redeliveryId, {
      targetId: redeliveryTarget.id,
      state: 'succeeded',
    });
    expect(view.batches[0]).toMatchObject({
      title: 'Rollback release re-delivery',
      state: 'completed',
    });
    expect(h.core.releases.deliveryState(projectId, 'work-a')).toBe('delivered');
    expect(h.core.releases.deliveryState(projectId, 'work-b')).toBe('delivered');
    expect(h.core.releases.attention(projectId)).toBeNull();

    h.core.projectModel.createWork(
      projectId,
      { title: 'Repair production regression', completionCondition: 'The regression is fixed.' },
      'repair-work',
    );
    expect(h.repo.get('workItem', 'work-a')?.state).toBe('completed');
    expect(
      h.repo.list('workItem').find((item) => item.title === 'Repair production regression')?.state,
    ).toBe('active');
  });

  it('requires an explicit exception to override policy targets and treats repeated exceptions as policy-review signal', () => {
    const { h, projectId, policy } = setup();
    const emergencyTargets = [{ key: 'hotfix', label: 'Emergency hotfix channel', required: true }];
    expect(() =>
      h.core.releases.createRelease(
        projectId,
        { title: 'Emergency', workItemIds: ['work-a'], targets: emergencyTargets },
        'without-exception',
      ),
    ).toThrow('policy exception');

    const exception = h.core.releases.createException(
      projectId,
      { reason: 'Severe user impact requires a hotfix channel.' },
      'exception-one',
    );
    let view = h.core.releases.createRelease(
      projectId,
      {
        title: 'Emergency',
        workItemIds: ['work-a'],
        targets: emergencyTargets,
        exceptionId: exception.id,
      },
      'with-exception',
    );
    expect(view.batches[0].exceptionId).toBe(exception.id);
    expect(view.exceptions.find((item) => item.id === exception.id)?.state).toBe('used');
    expect(h.core.releases.policy(projectId)).toEqual(policy);

    h.core.releases.createException(
      projectId,
      { reason: 'A second exception shows the stable policy may need revision.' },
      'exception-two',
    );
    expect(h.core.releases.policyNeedsReview(projectId)).toBe(true);
    expect(h.core.releases.view(projectId).policyNeedsReview).toBe(true);
    expect(h.core.releases.policy(projectId)).toEqual(policy);

    const revised = h.core.releases.setPolicy(projectId, {
      ...policyInput(),
      name: 'Revised stable release policy',
      channel: 'stable-v2',
    });
    expect(revised.id).not.toBe(policy.id);
    expect(h.core.releases.policy(projectId)?.id).toBe(revised.id);
    expect(h.core.releases.policyNeedsReview(projectId)).toBe(false);
    expect(view.batches[0].policyId).toBe(policy.id);
  });

  it('persists release state across restart and deletes it with the project', () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-release-'));
    let repo = new SQLiteRepository(directory);
    try {
      let h = harness(repo);
      const projectId = registerProject(h, { goal: 'Ship safely.' }).receipt.projectId;
      h.core.projectModel.view(projectId);
      completedWork(h, projectId, 'work-a', 'Persisted work');
      h.core.releases.setPolicy(projectId, policyInput());
      let view = h.core.releases.createRelease(
        projectId,
        { title: 'Persisted release', workItemIds: ['work-a'] },
        'persisted-release',
      );
      view = h.core.releases.updateTarget(projectId, view.batches[0].id, {
        targetId: target(view, 'desktop').id,
        state: 'failed',
        detail: 'Persist this failure.',
      });
      expect(view.batches[0].state).toBe('partial');

      repo.close();
      repo = new SQLiteRepository(directory);
      h = harness(repo);
      expect(h.core.releases.view(projectId)).toMatchObject({
        policy: { name: 'Stable release policy' },
        batches: [expect.objectContaining({ state: 'partial' })],
        targets: expect.arrayContaining([
          expect.objectContaining({ key: 'desktop', state: 'failed' }),
        ]),
      });

      h.core.projects.delete(projectId, deletionCommand(h, projectId));
      expect(repo.list('releasePolicy')).toEqual([]);
      expect(repo.list('releaseBatch')).toEqual([]);
      expect(repo.list('deliveryTarget')).toEqual([]);
      expect(repo.list('releasePolicyException')).toEqual([]);
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
