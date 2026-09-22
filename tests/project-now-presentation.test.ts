import { describe, expect, it } from 'vitest';
import {
  presentProjectCompact,
  presentProjectCompacts,
  presentProjectNow,
} from '@statecarry/presentation';
import { workDecisionKinds, type WorkItem } from '@statecarry/contracts';
import { AT, harness } from './helpers';
import { registerProject } from './project-fixtures';

function setup(goal = 'Improve project return.') {
  const h = harness();
  const { receipt } = registerProject(h, { title: 'StateCarry', goal });
  const projectId = receipt.projectId;
  h.core.projectModel.view(projectId);
  return { h, projectId };
}

function addWork(
  h: ReturnType<typeof harness>,
  projectId: string,
  id: string,
  title: string,
  state: WorkItem['state'] = 'active',
) {
  h.repo.put('workItem', {
    id,
    projectId,
    title,
    state,
    origin: 'user',
    completionCondition: null,
    completionConditionOrigin: null,
    createdAt: AT,
    updatedAt: AT,
  });
}

function select(h: ReturnType<typeof harness>, projectId: string, workItemId: string) {
  h.repo.put('workDecision', {
    id: `select:${workItemId}`,
    projectId,
    workItemId,
    kind: workDecisionKinds.selectCurrentWork,
    value: { workItemId },
    basis: [],
    state: 'valid',
    decidedAt: AT,
  });
}

function observe(h: ReturnType<typeof harness>, projectId: string, basis = 'basis-a') {
  h.repo.put('projectObservation', {
    id: projectId,
    projectId: projectId,
    checkedAt: AT,
    probeKey: `probe:${basis}`,
    inspectionKey: `inspection:${basis}`,
    semanticKey: basis,
    snapshot: {
      cwd: '/tmp/example',
      branch: 'main',
      commit: 'abc',
      dirty: false,
      status: 'checked',
      checkedAt: AT,
      limitations: [],
    },
  });
}

describe('ProjectNow presentation', () => {
  it('projects ordinary return into state, still-to-check, Next and one primary action', () => {
    const { h, projectId } = setup();
    addWork(h, projectId, 'work-a', 'Improve the return screen');
    select(h, projectId, 'work-a');
    observe(h, projectId);
    h.repo.put('returnPoint', {
      id: 'return-a',
      projectId,
      workItemId: 'work-a',
      basis: 'basis-a',
      current:
        'The new layout is implemented. This second sentence must not become default reading.',
      remaining: 'The return transition still needs one behavior check. Raw details belong deeper.',
      next: 'Check the return transition. Then decide whether another change is needed.',
      createdAt: AT,
    });

    const model = h.core.projectModel.view(projectId);
    const view = presentProjectNow(model, h.core.now.resolve(projectId));
    expect(view).toMatchObject({
      project: { id: projectId, title: 'StateCarry' },
      direction: { text: 'Improve project return.' },
      work: { id: 'work-a', title: 'Improve the return screen' },
      currentState: 'The new layout is implemented.',
      stillToCheck: 'The return transition still needs one behavior check.',
      nextText: 'Check the return transition.',
      primaryAction: { kind: 'continue-work', label: 'Continue work', emphasis: 'primary' },
      otherWorkCount: 0,
      checking: false,
    });
    expect(view.secondaryActions).toHaveLength(2);
    expect(view.secondaryActions[0]).toMatchObject({ label: 'Review work', emphasis: 'secondary' });
    expect(view.secondaryActions[1]).toMatchObject({
      kind: 'stop-work',
      label: 'Stop work',
      emphasis: 'secondary',
    });
  });

  it('keeps waiting work as the visible work while presenting the alternative as Next', () => {
    const { h, projectId } = setup();
    addWork(h, projectId, 'a', 'Waiting for agent', 'waiting');
    addWork(h, projectId, 'd', 'Small independent cleanup', 'paused');
    select(h, projectId, 'a');
    observe(h, projectId);
    h.repo.put('returnPoint', {
      id: 'return-d',
      projectId,
      workItemId: 'd',
      basis: 'basis-a',
      current: 'The cleanup has a safe restart point.',
      remaining: 'One check remains.',
      next: 'Run the check.',
      createdAt: AT,
    });

    const view = presentProjectNow(
      h.core.projectModel.view(projectId),
      h.core.now.resolve(projectId),
    );
    expect(view.work?.id).toBe('a');
    expect(view.state).toBe('waiting');
    expect(view.nextText).toBe('Work on Small independent cleanup while this is waiting.');
    expect(view.primaryAction).toMatchObject({
      kind: 'start-work',
      workItemId: 'd',
      label: 'Start work',
    });
  });

  it('shows a background result as a notice without replacing the current work or primary action', () => {
    const { h, projectId } = setup();
    addWork(h, projectId, 'a', 'Earlier work');
    addWork(h, projectId, 'b', 'Dependent follow-up', 'waiting');
    addWork(h, projectId, 'c', 'Current focused work');
    select(h, projectId, 'c');
    observe(h, projectId);
    h.repo.put('workRelation', {
      id: 'a-blocks-b',
      projectId,
      fromWorkId: 'a',
      toWorkId: 'b',
      kind: 'blocks',
      state: 'active',
      basis: null,
      confirmedByUser: true,
      createdAt: AT,
    });
    h.repo.put('workDecision', {
      id: 'execution-a',
      projectId,
      workItemId: 'a',
      kind: workDecisionKinds.executionForWork,
      value: { requestId: 'request-a' },
      basis: [],
      state: 'valid',
      decidedAt: AT,
    });
    h.repo.put('continuation', {
      id: 'request-a',
      projectId: projectId,
      requestId: 'dispatch-a',
      target: {
        mode: 'new-session',
        threadId: null,
        title: 'Run work',
        projectId: projectId,
        payload: {
          goal: null,
          currentState: 'Sent.',
          nextAction: 'Run it.',
          constraints: [],
          doneWhen: 'Done.',
        },
        expectedRevision: 1,
      },
      state: 'sent',
      threadId: 'thread-a',
      turnId: 'turn-a',
      error: null,
      execution: { status: 'completed', report: 'Done.', error: null, questions: [] },
      createdAt: AT,
      updatedAt: AT,
    });

    const view = presentProjectNow(
      h.core.projectModel.view(projectId),
      h.core.now.resolve(projectId),
    );
    expect(view.work?.id).toBe('c');
    expect(view.primaryAction).toMatchObject({ kind: 'continue-work', workItemId: 'c' });
    expect(view.notice).toMatchObject({
      level: 'attention',
      title: 'Result ready',
      workItemId: 'a',
      requestId: 'request-a',
    });
  });

  it('presents a direction conflict as immediate attention and one review action', () => {
    const { h, projectId } = setup('Show all project state.');
    addWork(h, projectId, 'a', 'Add more status panels');
    select(h, projectId, 'a');
    observe(h, projectId);
    h.repo.put('project', { ...h.core.project(projectId) });
    h.repo.put('projectScope', {
      id: h.core.project(projectId).id,
      projectId: h.core.project(projectId).id,
      ...{
        version: 1,
        kept: [],
        corrections: {},
        direction: null,
        policyConflict: {
          description: 'This may increase the amount a returning user must read.',
          source: 'project-purpose',
          status: 'open',
        },
        requests: [],
        accepted: [],
        comparisons: {},
      },
    });

    const view = presentProjectNow(
      h.core.projectModel.view(projectId),
      h.core.now.resolve(projectId),
    );
    expect(view.notice).toMatchObject({
      level: 'immediate',
      title: 'Direction needs review',
      reason: 'This may increase the amount a returning user must read.',
    });
    expect(view.nextText).toBe('Review whether the current direction should continue.');
    expect(view.primaryAction).toMatchObject({
      kind: 'review-direction',
      label: 'Review direction',
    });
    expect(view.secondaryActions).toEqual([
      expect.objectContaining({
        kind: 'continue-despite-direction-conflict',
        label: 'Continue anyway',
        emphasis: 'secondary',
      }),
    ]);
  });

  it('keeps last-known state visible when freshness is unknown and exposes checking separately', () => {
    const { h, projectId } = setup();
    addWork(h, projectId, 'a', 'Saved work');
    select(h, projectId, 'a');
    h.repo.put('returnPoint', {
      id: 'return-a',
      projectId,
      workItemId: 'a',
      basis: 'last-known',
      current: 'The saved work is ready for one final check.',
      remaining: 'The latest project state is unavailable.',
      next: 'Run the final check.',
      createdAt: AT,
    });

    const model = h.core.projectModel.view(projectId);
    const unknown = presentProjectNow(model, h.core.now.resolve(projectId));
    expect(unknown).toMatchObject({
      currentState: 'The saved work is ready for one final check.',
      freshness: 'unknown',
      checking: false,
    });
    const checking = presentProjectNow(model, h.core.now.resolve(projectId, { checking: true }));
    expect(checking.currentState).toBe('The saved work is ready for one final check.');
    expect(checking.checking).toBe(true);
    expect(checking.freshness).toBe('checking');
  });

  it('projects Home/Projects compact state without changing Focus or inventing work', () => {
    const { h, projectId } = setup('Finish this direction.');
    const direction = h.repo.list('direction')[0];
    h.repo.put('direction', {
      ...direction,
      state: 'completed',
      primary: false,
      endedAt: '2026-09-08T13:36:01.780Z',
    });
    observe(h, projectId);
    const model = h.core.projectModel.view(projectId);
    const now = h.core.now.resolve(projectId);
    const compact = presentProjectCompact(model, now, {
      recommended: true,
      reason: 'This project has no urgent follow-up, but it is a reasonable place to review next.',
    });
    expect(compact).toEqual({
      projectId,
      title: 'StateCarry',
      iconAsset: null,
      focused: false,
      disconnected: false,
      current: 'No current work',
      status: 'Nothing to do right now',
      reason: null,
      recommended: true,
      recommendationReason:
        'This project has no urgent follow-up, but it is a reasonable place to review next.',
    });
  });

  it('preserves project order when one compact card is recommended', () => {
    const h = harness();
    const first = registerProject(h, {
      title: 'First project',
      cwd: '/tmp/first-project',
      goal: 'First direction.',
    }).receipt.projectId;
    const second = registerProject(h, {
      title: 'Second project',
      cwd: '/tmp/second-project',
      goal: 'Second direction.',
    }).receipt.projectId;
    h.core.projectModel.view(first);
    h.core.projectModel.view(second);
    addWork(h, first, 'first-work', 'First work');
    addWork(h, second, 'second-work', 'Second work');
    select(h, first, 'first-work');
    select(h, second, 'second-work');
    observe(h, first);
    observe(h, second);

    const cards = presentProjectCompacts(
      [first, second].map((projectId) => ({
        initialized: true,
        model: h.core.projectModel.view(projectId),
        now: h.core.now.resolve(projectId),
      })),
      { projectId: second, reason: 'Its result is worth checking next.' },
    );
    expect(cards.map((card) => card.title)).toEqual(['First project', 'Second project']);
    expect(cards.map((card) => card.recommended)).toEqual([false, true]);
    expect(cards[1].recommendationReason).toBe('Its result is worth checking next.');
  });

  it('presents delivery attention and release review without replacing current implementation work', () => {
    const { h, projectId } = setup('Keep implementation and delivery separate.');
    addWork(h, projectId, 'current-work', 'Current implementation', 'active');
    addWork(h, projectId, 'ready-work', 'Completed feature', 'completed');
    select(h, projectId, 'current-work');
    observe(h, projectId);
    h.core.releases.setPolicy(projectId, {
      name: 'Stable release',
      timing: null,
      channel: 'stable',
      requiredChecks: [],
      inclusionRule: 'ready-only',
      targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
      completionMode: 'user-confirmation',
      postReleaseVerification: 'none',
    });
    let release = h.core.releases.createRelease(
      projectId,
      { title: 'Stable release', workItemIds: ['ready-work'] },
      'release-presentation',
    );
    const releaseId = release.batches[0].id;
    release = h.core.releases.updateTarget(projectId, releaseId, {
      targetId: release.targets.find((target) => target.releaseId === releaseId)!.id,
      state: 'failed',
      detail: 'Delivery failed.',
    });

    const view = presentProjectNow(
      h.core.projectModel.view(projectId),
      h.core.now.resolve(projectId),
    );
    expect(view.work).toMatchObject({ id: 'current-work', title: 'Current implementation' });
    expect(view.primaryAction).toMatchObject({ kind: 'continue-work', label: 'Continue work' });
    expect(view.notice).toMatchObject({
      kind: 'delivery-problem',
      title: 'Delivery needs attention',
      releaseId,
    });
    expect(view.secondaryActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'review-release', label: 'Review release', releaseId }),
      ]),
    );
  });
});
