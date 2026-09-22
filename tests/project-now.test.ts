import { describe, expect, it, vi } from 'vitest';
import {
  workDecisionKinds,
  type Continuation,
  type WorkItem,
  type WorkProposal,
  type WorkRelation,
} from '@statecarry/contracts';
import { AT, harness, source } from './helpers';
import { projectCandidate, registerProject } from './project-fixtures';

const LATER = '2026-09-08T13:36:01.780Z';

function observe(
  h: ReturnType<typeof harness>,
  projectId: string,
  semanticKey = 'basis-a',
  dirty = false,
) {
  h.repo.put('projectObservation', {
    id: projectId,
    projectId: projectId,
    checkedAt: AT,
    probeKey: `probe:${semanticKey}`,
    inspectionKey: `inspection:${semanticKey}`,
    semanticKey,
    snapshot: {
      cwd: '/tmp/example',
      branch: 'main',
      commit: 'abc123',
      dirty,
      status: 'checked',
      checkedAt: AT,
      limitations: [],
    },
  });
}

function work(
  h: ReturnType<typeof harness>,
  projectId: string,
  id: string,
  state: WorkItem['state'] = 'active',
  title = id,
) {
  const item: WorkItem = {
    id,
    projectId,
    title,
    state,
    origin: 'user',
    completionCondition: null,
    completionConditionOrigin: null,
    createdAt: AT,
    updatedAt: AT,
  };
  h.repo.put('workItem', item);
  return item;
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

function releasePolicy(h: ReturnType<typeof harness>, projectId: string) {
  return h.core.releases.setPolicy(projectId, {
    name: 'Stable release',
    timing: null,
    channel: 'stable',
    requiredChecks: [],
    inclusionRule: 'ready-only',
    targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
    completionMode: 'user-confirmation',
    postReleaseVerification: 'risk-based',
  });
}

function relation(h: ReturnType<typeof harness>, value: WorkRelation) {
  h.repo.put('workRelation', value);
}

function resultRequest(
  projectId: string,
  id: string,
  status: 'completed' | 'failed' = 'completed',
) {
  return {
    id,
    projectId: projectId,
    requestId: `dispatch:${id}`,
    target: {
      mode: 'new-session',
      threadId: null,
      title: 'Execute work',
      projectId: projectId,
      payload: {
        goal: null,
        currentState: 'Work was sent.',
        nextAction: 'Execute it.',
        constraints: [],
        doneWhen: 'The requested work is finished.',
      },
      expectedRevision: 1,
    },
    state: status === 'failed' ? 'failed' : 'sent',
    threadId: 'thread-result',
    turnId: 'turn-result',
    error: status === 'failed' ? 'Execution failed' : null,
    execution: {
      status,
      report: status === 'failed' ? 'The execution failed.' : 'The execution completed.',
      error: status === 'failed' ? 'Execution failed' : null,
      questions: [],
    },
    createdAt: AT,
    updatedAt: LATER,
  } satisfies Continuation;
}

describe('ProjectNow resolver', () => {
  it('returns ordinary work from the saved return point without reconstructing the whole project', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Improve the return screen');
    select(h, projectId, 'work-a');
    observe(h, projectId, 'basis-a');
    h.repo.put('returnPoint', {
      id: 'return-a',
      projectId,
      workItemId: 'work-a',
      basis: 'basis-a',
      current: 'The new return layout is implemented and ready for behavior review.',
      remaining: 'The return transition still needs to be checked.',
      next: 'Check the return transition.',
      createdAt: AT,
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'work-a',
      currentWorkSelection: 'user',
      state: 'active',
      currentState: 'The new return layout is implemented and ready for behavior review.',
      uncertainty: 'The return transition still needs to be checked.',
      next: { kind: 'continue-work', workItemId: 'work-a', text: 'Check the return transition.' },
      freshness: 'current',
    });
  });

  it('recommends resumable independent work while current work is waiting', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'a', 'waiting', 'Wait for agent result');
    work(h, projectId, 'c', 'active', 'Dependent work');
    work(h, projectId, 'd', 'paused', 'Small independent cleanup');
    work(h, projectId, 'e', 'active', 'Large independent work');
    select(h, projectId, 'a');
    observe(h, projectId);
    relation(h, {
      id: 'a-blocks-c',
      projectId,
      fromWorkId: 'a',
      toWorkId: 'c',
      kind: 'blocks',
      state: 'active',
      basis: null,
      confirmedByUser: true,
      createdAt: AT,
    });
    h.repo.put('returnPoint', {
      id: 'return-d',
      projectId,
      workItemId: 'd',
      basis: 'basis-a',
      current: 'The cleanup is paused at a safe point.',
      remaining: 'One small check remains.',
      next: 'Run the small check.',
      createdAt: AT,
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'a',
      state: 'waiting',
      next: {
        kind: 'start-work',
        workItemId: 'd',
        text: 'Work on Small independent cleanup while this is waiting.',
      },
    });
  });

  it('keeps current work selected while surfacing another result that unblocks downstream work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'a', 'active', 'Earlier agent work');
    work(h, projectId, 'b', 'waiting', 'Blocked follow-up');
    work(h, projectId, 'c', 'active', 'Current focused work');
    select(h, projectId, 'c');
    observe(h, projectId);
    relation(h, {
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
    h.repo.put('continuation', resultRequest(projectId, 'request-a'));

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'c',
      state: 'active',
      next: { kind: 'continue-work', workItemId: 'c' },
      notice: {
        level: 'attention',
        kind: 'result-ready',
        workItemId: 'a',
        requestId: 'request-a',
        reason: 'Reviewing it can unblock 1 dependent work item.',
      },
    });
    const legacy = h.core.project(projectId);
    h.repo.put('project', { ...legacy });
    h.repo.put('projectExecution', {
      id: legacy.id,
      projectId: legacy.id,
      ...{
        version: 1,
        kept: [],
        corrections: {},
        direction: null,
        policyConflict: null,
        requests: ['request-a'],
        accepted: [],
        closed: ['request-a'],
        comparisons: {},
      },
    });
    expect(h.core.now.resolve(projectId).notice).toBeNull();
  });

  it('moves from completed work to an approved queued work and re-checks it when the relation needs review', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'a', 'completed', 'Foundation');
    work(h, projectId, 'c', 'active', 'Follow-up');
    select(h, projectId, 'a');
    observe(h, projectId);
    relation(h, {
      id: 'a-then-c',
      projectId,
      fromWorkId: 'a',
      toWorkId: 'c',
      kind: 'next-after',
      state: 'active',
      basis: 'approved-order',
      confirmedByUser: true,
      createdAt: AT,
    });

    expect(h.core.now.resolve(projectId).next).toMatchObject({
      kind: 'start-work',
      workItemId: 'c',
    });
    h.repo.put('workRelation', {
      ...h.repo.get('workRelation', 'a-then-c')!,
      state: 'needs-review',
    });
    expect(h.core.now.resolve(projectId).next).toMatchObject({
      kind: 'review-work-plan',
      workItemId: 'c',
    });
  });

  it('stops normal progression for a direction conflict until the unchanged conflict is explicitly overridden', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Show more project state.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'a', 'active', 'Add project state panels');
    select(h, projectId, 'a');
    observe(h, projectId);
    const legacy = h.core.project(projectId);
    h.repo.put('project', { ...legacy });
    h.repo.put('projectScope', {
      id: legacy.id,
      projectId: legacy.id,
      ...{
        version: 1,
        kept: [],
        corrections: {},
        direction: null,
        policyConflict: {
          description: 'Showing every state by default increases return-time reading cost.',
          source: 'project-purpose',
          status: 'open',
        },
        requests: [],
        accepted: [],
        comparisons: {},
      },
    });

    const blocked = h.core.now.resolve(projectId);
    expect(blocked).toMatchObject({
      currentWorkId: 'a',
      notice: { level: 'immediate', kind: 'direction-conflict' },
      next: { kind: 'review-direction' },
      secondaryActions: [{ kind: 'continue-despite-direction-conflict', workItemId: 'a' }],
    });
    h.core.projectModel.continueDirectionConflict(projectId);
    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'a',
      notice: null,
      next: { kind: 'continue-work', workItemId: 'a' },
    });
  });

  it('can explicitly conclude that there is nothing to do now', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Finish the current direction.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    const direction = h.repo.list('direction')[0];
    h.repo.put('direction', { ...direction, state: 'completed', primary: false, endedAt: LATER });
    observe(h, projectId);

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: null,
      state: 'idle',
      currentState: 'There is no current work or result that needs attention.',
      next: null,
      otherWorkCount: 0,
    });
  });

  it('re-checks an old return point when a checked project observation has materially changed', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Old implementation approach');
    select(h, projectId, 'work-a');
    observe(h, projectId, 'basis-new');
    h.repo.put('returnPoint', {
      id: 'return-old',
      projectId,
      workItemId: 'work-a',
      basis: 'basis-old',
      current: 'The old approach was partially implemented.',
      remaining: 'Continue the old implementation.',
      next: 'Continue with the old approach.',
      createdAt: AT,
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'work-a',
      freshness: 'changed',
      uncertainty: 'The project changed since this return point was recorded.',
      next: { kind: 'review-work-plan', workItemId: 'work-a' },
    });
  });

  it('keeps the last saved context when the current project state cannot be checked', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Saved work');
    select(h, projectId, 'work-a');
    h.repo.put('returnPoint', {
      id: 'return-a',
      projectId,
      workItemId: 'work-a',
      basis: 'last-known',
      current: 'The saved implementation is ready for one final check.',
      remaining: 'The latest project state is not available yet.',
      next: 'Run the final check.',
      createdAt: AT,
    });
    h.repo.put('projectObservation', {
      id: projectId,
      projectId: projectId,
      checkedAt: AT,
      probeKey: 'probe-unknown',
      inspectionKey: 'inspection-unknown',
      semanticKey: 'unknown-basis',
      snapshot: {
        cwd: '/tmp/example',
        branch: null,
        commit: null,
        dirty: null,
        status: 'unknown',
        checkedAt: AT,
        limitations: ['Git state could not be checked.'],
      },
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'work-a',
      currentState: 'The saved implementation is ready for one final check.',
      freshness: 'unknown',
      uncertainty: 'Git state could not be checked.',
      next: { kind: 'continue-work', text: 'Run the final check.' },
    });
  });

  it('does not let an inferred direction silently drive an existing current work item', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: undefined });
    const projectId = receipt.projectId;
    const legacy = h.core.project(projectId);
    h.repo.put('direction', {
      id: 'suggested-direction',
      projectId: legacy.id,
      text: 'Maybe improve return UX.',
      origin: 'suggested',
      confirmed: false,
      state: 'active',
      primary: false,
      createdAt: AT,
    });
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Current implementation work');
    select(h, projectId, 'work-a');
    observe(h, projectId);

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'work-a',
      state: 'needs-direction',
      primaryDirectionId: null,
      next: { kind: 'define-direction' },
    });
  });

  it('keeps unmatched legacy analysis out of the current-work resolver', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    h.repo.put('project', { ...h.core.project(projectId) });
    h.core.storeAnalysis({
      id: h.core.project(projectId).id,
      projectId: h.core.project(projectId).id,
      result: {
        scope: 'legacy-scope',
        version: 'legacy-version',
        generatedAt: AT,
        candidates: [projectCandidate()],
      },
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: null,
      state: 'complete',
      next: { kind: 'choose-next-work' },
      otherWorkCount: 0,
      proposalMatches: [],
    });
    expect(h.repo.list('workItem')).toEqual([]);
  });

  it('does not present a stale scoped analysis as current work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'selected-work', 'active', 'Durable selected work');
    select(h, projectId, 'selected-work');
    h.core.storeAnalysis({
      id: h.core.project(projectId).id,
      projectId,
      result: {
        scope: 'a'.repeat(64),
        version: 'v1',
        generatedAt: AT,
        candidates: [projectCandidate()],
      },
    });
    observe(h, projectId);

    expect(h.core.workMatcher.proposals(projectId)).toEqual([]);
    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'selected-work',
      freshness: 'changed',
      proposalMatches: [],
    });
  });

  it('uses a generated analysis only for its current scope and restores it after refresh', async () => {
    const h = harness();
    const record = source('Validate the export before shipping it.');
    const { receipt } = registerProject(h, {
      goal: 'Complete the export flow.',
      threadIds: ['thread-a'],
    });
    const projectId = receipt.projectId;
    h.records([record]);
    h.summary.generateAnalysis = async () => ({ candidates: [projectCandidate(record)] });
    work(h, projectId, 'selected-work', 'active', 'Durable selected work');
    select(h, projectId, 'selected-work');

    await h.core.analyses.refresh(projectId);
    expect(h.core.workMatcher.proposals(projectId)).toHaveLength(1);
    h.repo.put('projectObservation', {
      id: projectId,
      projectId,
      checkedAt: AT,
      probeKey: 'unknown-probe',
      inspectionKey: 'unknown-inspection',
      semanticKey: 'unknown-observation',
      snapshot: {
        cwd: '/tmp/example',
        branch: null,
        commit: null,
        dirty: null,
        status: 'unknown',
        checkedAt: AT,
        limitations: ['Repository observation is temporarily unavailable.'],
      },
    });
    // This analysis is grounded in connected records, so an unrelated
    // repository observation cannot revoke its validated basis.
    expect(h.core.workMatcher.proposals(projectId)).toHaveLength(1);
    observe(h, projectId);
    h.repo.put('project', { ...h.core.project(projectId), focused: true });
    expect(h.core.workMatcher.proposals(projectId)).toHaveLength(1);

    h.core.projectModel.setDirection(projectId, 'Ship the export flow safely.');
    expect(h.core.workMatcher.proposals(projectId)).toEqual([]);
    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'selected-work',
      freshness: 'changed',
    });

    h.summary.generateAnalysis = async () => {
      throw new Error('temporary analysis failure');
    };
    await h.core.analyses.refresh(projectId);
    expect(h.core.workMatcher.proposals(projectId)).toEqual([]);
    expect(h.core.now.resolve(projectId).currentWorkId).toBe('selected-work');

    h.summary.generateAnalysis = async () => ({ candidates: [projectCandidate(record)] });
    await h.core.analyses.refresh(projectId);
    expect(h.core.workMatcher.proposals(projectId)).toHaveLength(1);
  });

  it('does not restore a sole unselected work item as current work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Unselected implementation work');
    observe(h, projectId);

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: null,
      currentWorkSelection: null,
      state: 'choose-work',
      next: { kind: 'choose-current-work' },
    });
  });

  it('ignores a current-work decision whose payload names another work item', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'First work');
    work(h, projectId, 'work-b', 'active', 'Second work');
    observe(h, projectId);
    h.repo.put('workDecision', {
      id: 'invalid-selection',
      projectId,
      workItemId: 'work-a',
      kind: workDecisionKinds.selectCurrentWork,
      value: { workItemId: 'work-b' },
      basis: [],
      state: 'valid',
      decidedAt: AT,
    });

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: null,
      currentWorkSelection: null,
      state: 'choose-work',
      next: { kind: 'choose-current-work' },
    });
  });

  it('keeps current implementation work selected while completed work waits for release', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Keep building while ready work ships.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'current-work', 'active', 'Current implementation');
    work(h, projectId, 'ready-work', 'completed', 'Ready feature');
    select(h, projectId, 'current-work');
    observe(h, projectId);
    releasePolicy(h, projectId);

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: 'current-work',
      next: { kind: 'continue-work' },
      notice: { kind: 'release-ready', level: 'quiet' },
      secondaryActions: expect.arrayContaining([
        expect.objectContaining({ kind: 'review-release' }),
      ]),
    });
  });

  it('makes release review the next decision when no implementation work is active', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Ship completed work.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'ready-work', 'completed', 'Ready feature');
    observe(h, projectId);
    releasePolicy(h, projectId);

    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: null,
      state: 'complete',
      next: { kind: 'review-release', releaseId: undefined },
      notice: { kind: 'release-ready' },
    });
  });

  it('surfaces required delivery failure without reopening completed implementation work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Keep current work stable during delivery.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'current-work', 'active', 'Current implementation');
    work(h, projectId, 'ready-work', 'completed', 'Delivered feature');
    select(h, projectId, 'current-work');
    observe(h, projectId);
    releasePolicy(h, projectId);
    let release = h.core.releases.createRelease(
      projectId,
      { title: 'Stable release', workItemIds: ['ready-work'] },
      'release-failure',
    );
    release = h.core.releases.updateTarget(projectId, release.batches[0].id, {
      targetId: release.targets[0].id,
      state: 'failed',
      detail: 'Delivery failed.',
    });

    const now = h.core.now.resolve(projectId);
    expect(now).toMatchObject({
      currentWorkId: 'current-work',
      next: { kind: 'continue-work' },
      notice: { kind: 'delivery-problem', level: 'attention', releaseId: release.batches[0].id },
    });
    expect(h.repo.get('workItem', 'ready-work')?.state).toBe('completed');
  });
});

describe('WorkMatcher', () => {
  it('keeps an explicit connection when a stable proposal key receives a newer basis', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Return flow');
    observe(h, projectId, 'basis-a', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'working-tree:stable',
          source: 'working-tree-group',
          title: '응답 언어 설정',
          state: 'active',
          currentState: '응답 언어를 설정할 수 있습니다.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-a',
          evidence: ['revision:return-flow'],
          evidenceQuotes: [{ revisionId: 'return-flow', quote: 'Reply language is configurable.' }],
        },
      ],
      'ko',
    );
    h.core.projectModel.selectProposal(projectId, 'working-tree:stable');
    const linkedWorkId = h.core.now.resolve(projectId).currentWorkId;

    observe(h, projectId, 'basis-b', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'working-tree:stable',
          source: 'working-tree-group',
          title: 'Configure reply language',
          state: 'active',
          currentState: 'Reply language is configurable.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-b',
          evidence: ['revision:return-flow'],
          evidenceQuotes: [{ revisionId: 'return-flow', quote: 'Reply language is configurable.' }],
        },
      ],
      'en',
    );

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({
        proposal: expect.objectContaining({ key: 'working-tree:stable', evidenceBasis: 'basis-b' }),
        workItemId: linkedWorkId,
        confidence: 'explicit',
      }),
    ]);
    expect(h.repo.list('workProposal')[0].history).toEqual([
      expect.objectContaining({
        key: 'working-tree:stable',
        source: 'working-tree-group',
        evidenceBasis: 'basis-a',
        proposal: expect.objectContaining({
          title: '응답 언어 설정',
          currentState: '응답 언어를 설정할 수 있습니다.',
          evidence: ['revision:return-flow'],
        }),
      }),
    ]);
    h.core.projectModel.selectProposal(projectId, 'working-tree:stable');
    expect(h.core.now.resolve(projectId).currentWorkId).toBe(linkedWorkId);
    expect(h.core.projectModel.view(projectId).workItems).toHaveLength(2);
  });

  it('does not inherit one candidate connection into another candidate with the same basis', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    observe(h, projectId, 'basis-a', true);
    const proposals = [
      {
        key: 'group:implementation',
        source: 'working-tree-group' as const,
        title: 'Implement return flow',
        state: 'active' as const,
        currentState: 'Implementation is in progress.',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'basis-a',
        evidenceQuotes: [{ revisionId: 'source-implementation', quote: 'Return flow is active.' }],
      },
      {
        key: 'group:diagnostic',
        source: 'working-tree-group' as const,
        title: 'Investigate an error',
        state: 'active' as const,
        currentState: 'The error still needs investigation.',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'basis-a',
      },
    ];
    h.core.workMatcher.replaceProposals(projectId, 'working-tree-group', proposals, 'en');
    h.core.projectModel.selectProposal(projectId, 'group:implementation');
    const linkedWorkId = h.core.now.resolve(projectId).currentWorkId;

    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      proposals.map((proposal) => ({
        ...proposal,
        currentState: `${proposal.currentState} Updated.`,
      })),
      'en',
    );

    const matches = h.core.workMatcher.match(projectId);
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'group:implementation' }),
          workItemId: linkedWorkId,
          confidence: 'explicit',
        }),
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'group:diagnostic' }),
          workItemId: null,
          confidence: 'unmatched',
        }),
      ]),
    );
  });

  it('does not connect work from a title match or a one-item fallback', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Return flow');
    observe(h, projectId, 'basis-a', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:unlinked',
          source: 'working-tree-group',
          title: 'Return flow',
          state: 'active',
          currentState: 'A matching title is not proof of identity.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-a',
        },
      ],
      'en',
    );

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
  });

  it('leaves conflicting explicit connections unresolved', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'First work');
    work(h, projectId, 'work-b', 'active', 'Second work');
    observe(h, projectId, 'basis-a', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:shared',
          source: 'working-tree-group',
          title: 'Shared interpretation',
          state: 'active',
          currentState: 'This needs a user correction.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-a',
          evidenceQuotes: [{ revisionId: 'source-shared', quote: 'This needs a user correction.' }],
        },
      ],
      'en',
    );
    for (const workItemId of ['work-a', 'work-b'])
      h.repo.put('workDecision', {
        id: `link:${workItemId}`,
        projectId,
        workItemId,
        kind: workDecisionKinds.linkWorkProposal,
        value: {
          proposalKey: 'group:shared',
          proposalSource: 'working-tree-group',
          proposalEvidenceBasis: 'basis-a',
          proposalEvidenceQuotes: [
            { revisionId: 'source-shared', quote: 'This needs a user correction.' },
          ],
          proposalEvidenceContext: {
            title: 'Shared interpretation',
            currentState: 'This needs a user correction.',
            uncertainty: null,
            nextAction: null,
            doneWhen: null,
          },
        },
        basis: ['basis-a'],
        state: 'valid',
        decidedAt: AT,
      });

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
    const before = structuredClone((h.repo as import('./helpers').MemoryRepository).data);
    expect(() => h.core.projectModel.selectProposal(projectId, 'group:shared')).toThrow(
      'linked to conflicting work',
    );
    expect((h.repo as import('./helpers').MemoryRepository).data).toEqual(before);
  });

  it('rejects selecting a conflicting connected alias without changing saved data', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    work(h, projectId, 'work-a', 'active', 'First work');
    work(h, projectId, 'work-b', 'active', 'Second work');
    observe(h, projectId, 'tree-basis', true);
    const sharedQuote = [{ revisionId: 'source-shared', quote: 'The return point is preserved.' }];
    const proposals = [
      {
        key: 'analysis:shared',
        source: 'analysis-candidate' as const,
        title: 'Return point analysis',
        state: 'active' as const,
        currentState: 'The return point is preserved in the analysis.',
        uncertainty: null,
        nextAction: 'Review the return point.',
        doneWhen: 'The return point is reviewed.',
        evidenceBasis: 'analysis-basis',
        evidenceQuotes: sharedQuote,
      },
      {
        key: 'tree:shared',
        source: 'working-tree-group' as const,
        title: 'Working-tree return point',
        state: 'active' as const,
        currentState: 'The return point is preserved in the changed files.',
        uncertainty: null,
        nextAction: 'Review the return point.',
        doneWhen: 'The return point is reviewed.',
        evidenceBasis: 'tree-basis',
        evidenceQuotes: sharedQuote,
        relatedProposalKeys: ['analysis:shared'],
      },
    ];
    vi.spyOn(h.core.workMatcher, 'proposals').mockReturnValue(proposals);
    for (const [index, proposal] of proposals.entries()) {
      const workItemId = index === 0 ? 'work-a' : 'work-b';
      h.repo.put('workDecision', {
        id: `alias-conflict:${workItemId}`,
        projectId,
        workItemId,
        kind: workDecisionKinds.linkWorkProposal,
        value: {
          proposalKey: proposal.key,
          proposalSource: proposal.source,
          proposalEvidenceBasis: proposal.evidenceBasis,
          proposalEvidenceQuotes: proposal.evidenceQuotes,
          proposalEvidenceContext: {
            title: proposal.title,
            currentState: proposal.currentState,
            uncertainty: proposal.uncertainty,
            nextAction: proposal.nextAction,
            doneWhen: proposal.doneWhen,
          },
        },
        basis: [proposal.evidenceBasis!],
        state: 'valid',
        decidedAt: AT,
      });
    }

    expect(h.core.workMatcher.match(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
        expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
      ]),
    );
    const before = structuredClone((h.repo as import('./helpers').MemoryRepository).data);
    expect(() => h.core.projectModel.selectProposal(projectId, 'tree:shared')).toThrow(
      'linked to conflicting work',
    );
    expect((h.repo as import('./helpers').MemoryRepository).data).toEqual(before);
  });

  it('preserves every transitive source expression and rejects continuity links to different work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'First work');
    work(h, projectId, 'work-c', 'active', 'Second work');
    const proposals = [
      {
        key: 'analysis:a',
        source: 'analysis-candidate' as const,
        title: 'First work analysis',
        state: 'active' as const,
        currentState: 'The first work is active.',
        uncertainty: null,
        nextAction: 'Review the analysis.',
        doneWhen: 'The analysis is reviewed.',
        evidenceBasis: 'analysis-basis',
        evidence: ['revision:source-a'],
        evidenceQuotes: [{ revisionId: 'source-a', quote: 'The first work is active.' }],
      },
      {
        key: 'group:b',
        source: 'working-tree-group' as const,
        title: 'Bridge from the first work to the second work',
        state: 'active' as const,
        currentState: 'The first work and the second work are active.',
        uncertainty: null,
        nextAction: 'Review the bridge.',
        doneWhen: 'The bridge is reviewed.',
        evidenceBasis: 'tree-basis',
        evidence: ['revision:source-a', 'revision:source-c'],
        evidenceQuotes: [
          { revisionId: 'source-a', quote: 'The first work is active.' },
          { revisionId: 'source-c', quote: 'The second work is active.' },
        ],
        relatedProposalKeys: ['analysis:a', 'analysis:c'],
      },
      {
        key: 'analysis:c',
        source: 'analysis-candidate' as const,
        title: 'Second work analysis',
        state: 'active' as const,
        currentState: 'The second work is active.',
        uncertainty: null,
        nextAction: 'Review the later analysis.',
        doneWhen: 'The later analysis is reviewed.',
        evidenceBasis: 'analysis-basis',
        evidence: ['revision:source-c'],
        evidenceQuotes: [{ revisionId: 'source-c', quote: 'The second work is active.' }],
      },
    ];
    vi.spyOn(h.core.workMatcher, 'proposals').mockReturnValue(proposals);

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({
        proposal: expect.objectContaining({ key: 'group:b', evidence: proposals[1].evidence }),
        aliases: expect.arrayContaining([
          expect.objectContaining({ key: 'analysis:a', title: 'First work analysis' }),
          expect.objectContaining({ key: 'analysis:c', title: 'Second work analysis' }),
        ]),
        workItemId: null,
        confidence: 'possible',
      }),
    ]);

    for (const [workItemId, proposal] of [
      ['work-a', proposals[0]],
      ['work-c', proposals[2]],
    ] as const)
      h.repo.put('workDecision', {
        id: `link:${workItemId}`,
        projectId,
        workItemId,
        kind: workDecisionKinds.linkWorkProposal,
        value: {
          proposalKey: proposal.key,
          proposalSource: proposal.source,
          proposalEvidenceBasis: proposal.evidenceBasis,
          proposalEvidence: proposal.evidence,
          proposalEvidenceQuotes: proposal.evidenceQuotes,
          proposalEvidenceContext: {
            title: proposal.title,
            currentState: proposal.currentState,
            uncertainty: proposal.uncertainty,
            nextAction: proposal.nextAction,
            doneWhen: proposal.doneWhen,
          },
        },
        basis: [proposal.evidenceBasis],
        state: 'valid',
        decidedAt: AT,
      });

    expect(h.core.workMatcher.match(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'analysis:a' }),
          workItemId: null,
        }),
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'group:b' }),
          workItemId: null,
        }),
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'analysis:c' }),
          workItemId: null,
        }),
      ]),
    );
    expect(() => h.core.projectModel.selectProposal(projectId, 'group:b')).toThrow(
      'linked to conflicting work',
    );
  });

  it('does not merge different excerpts from the same source revision', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    vi.spyOn(h.core.workMatcher, 'proposals').mockReturnValue([
      {
        key: 'analysis:settings',
        source: 'analysis-candidate',
        title: 'Change settings',
        state: 'active',
        currentState: 'A setting still needs review.',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'analysis-basis',
        evidence: ['revision:shared-record'],
        evidenceQuotes: [{ revisionId: 'shared-record', quote: 'Change the setting.' }],
      },
      {
        key: 'group:error',
        source: 'working-tree-group',
        title: 'Investigate an error',
        state: 'active',
        currentState: 'An error still needs investigation.',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'tree-basis',
        evidence: ['revision:shared-record'],
        evidenceQuotes: [{ revisionId: 'shared-record', quote: 'The error is still open.' }],
      },
    ]);

    expect(h.core.workMatcher.match(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: expect.objectContaining({ key: 'analysis:settings' }),
        }),
        expect.objectContaining({ proposal: expect.objectContaining({ key: 'group:error' }) }),
      ]),
    );
    expect(h.core.workMatcher.match(projectId)).toHaveLength(2);
  });

  it('retains distinct current evidence as aliases when explicitly linked to one work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    work(h, projectId, 'work-a', 'active', 'Durable work');
    const proposals = [
      {
        key: 'analysis:a',
        source: 'analysis-candidate' as const,
        title: 'Analysis',
        state: 'active' as const,
        currentState: 'A',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'analysis',
        evidenceQuotes: [{ revisionId: 'a', quote: 'Analysis evidence.' }],
      },
      {
        key: 'group:b',
        source: 'working-tree-group' as const,
        title: 'Tree',
        state: 'active' as const,
        currentState: 'B',
        uncertainty: null,
        nextAction: null,
        doneWhen: null,
        evidenceBasis: 'tree',
        evidenceQuotes: [{ revisionId: 'b', quote: 'Tree evidence.' }],
      },
    ];
    vi.spyOn(h.core.workMatcher, 'proposals').mockReturnValue(proposals);
    for (const proposal of proposals)
      h.repo.put('workDecision', {
        id: `link:${proposal.key}`,
        projectId,
        workItemId: 'work-a',
        kind: workDecisionKinds.linkWorkProposal,
        value: {
          proposalKey: proposal.key,
          proposalSource: proposal.source,
          proposalEvidenceBasis: proposal.evidenceBasis,
          proposalEvidenceQuotes: proposal.evidenceQuotes,
          proposalEvidenceContext: {
            title: proposal.title,
            currentState: proposal.currentState,
            uncertainty: proposal.uncertainty,
            nextAction: proposal.nextAction,
            doneWhen: proposal.doneWhen,
          },
        },
        basis: [proposal.evidenceBasis],
        state: 'valid',
        decidedAt: AT,
      });
    const [match] = h.core.workMatcher.match(projectId);
    expect(match).toMatchObject({ workItemId: 'work-a', confidence: 'explicit' });
    expect([match.proposal, ...(match.aliases ?? [])]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'analysis:a', evidenceQuotes: proposals[0].evidenceQuotes }),
        expect.objectContaining({ key: 'group:b', evidenceQuotes: proposals[1].evidenceQuotes }),
      ]),
    );
  });

  it('does not carry a saved Work through a generic quote after a language change', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    const quote = [{ revisionId: 'shared-record', quote: 'No errors detected.' }];
    observe(h, projectId, 'basis-a', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:reused',
          source: 'working-tree-group',
          title: 'Investigate database latency',
          state: 'active',
          currentState: 'Database latency remains under investigation.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-a',
          evidenceQuotes: quote,
        },
      ],
      'en',
    );
    h.core.projectModel.selectProposal(projectId, 'group:reused');
    const oldWorkId = h.core.now.resolve(projectId).currentWorkId!;

    observe(h, projectId, 'basis-b', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:reused',
          source: 'working-tree-group',
          title: '진단 오류 조사',
          state: 'active',
          currentState: '진단 오류를 조사해야 합니다.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-b',
          evidenceQuotes: quote,
        },
      ],
      'ko',
    );

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
    h.core.projectModel.selectProposal(projectId, 'group:reused');
    const newWorkId = h.core.now.resolve(projectId).currentWorkId!;
    expect(newWorkId).not.toBe(oldWorkId);
    h.core.projectModel.selectProposal(projectId, 'group:reused');
    expect(h.repo.list('workItem')).toHaveLength(2);
    expect(
      h.repo
        .list('workDecision')
        .filter(
          (decision) =>
            decision.kind === workDecisionKinds.linkWorkProposal &&
            decision.workItemId === newWorkId &&
            decision.value.proposalEvidenceBasis === 'basis-b' &&
            decision.state === 'valid',
        ),
    ).toHaveLength(1);
  });

  it('does not reuse an exact proposal identity when its translated claim changes work', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    const quote = [{ revisionId: 'shared-record', quote: 'No errors detected.' }];
    observe(h, projectId, 'basis-a', true);
    const original: WorkProposal = {
      key: 'analysis:language-settings',
      source: 'analysis-candidate',
      title: 'Configure reply language',
      state: 'active',
      currentState: 'Reply language is configurable.',
      uncertainty: null,
      nextAction: null,
      doneWhen: null,
      evidenceBasis: 'basis-a',
      evidenceQuotes: quote,
    };
    h.core.workMatcher.replaceProposals(projectId, 'analysis-candidate', [original], 'en');
    const available = vi.spyOn(h.core.workMatcher, 'proposals').mockReturnValue([original]);
    h.core.projectModel.selectProposal(projectId, original.key);
    const oldWorkId = h.core.now.resolve(projectId).currentWorkId!;

    const unrelated: WorkProposal = {
      ...original,
      title: '진단 오류 조사',
      currentState: '진단 오류를 조사해야 합니다.',
    };
    h.core.workMatcher.replaceProposals(projectId, 'analysis-candidate', [unrelated], 'ko');
    available.mockReturnValue([unrelated]);

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
    h.core.projectModel.selectProposal(projectId, unrelated.key);
    const newWorkId = h.core.now.resolve(projectId).currentWorkId!;
    expect(newWorkId).not.toBe(oldWorkId);
    expect(h.repo.list('workItem')).toHaveLength(2);
  });

  it('keeps translated analysis work through its saved verified tree alias', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    const evidenceQuotes = [{ revisionId: 'source-a', quote: 'Reply language is configurable.' }];
    const originalTree: WorkProposal = {
      key: 'working-tree:reply-language',
      source: 'working-tree-group',
      title: 'Configure reply language',
      state: 'active',
      currentState: 'Reply language is configurable.',
      uncertainty: null,
      nextAction: null,
      doneWhen: null,
      evidenceBasis: 'tree-basis-a',
      evidenceQuotes,
      relatedProposalKeys: ['analysis:reply-language'],
    };
    const originalAnalysis: WorkProposal = {
      key: 'analysis:reply-language',
      source: 'analysis-candidate',
      title: 'Configure reply language',
      state: 'active',
      currentState: 'Reply language is configurable.',
      uncertainty: null,
      nextAction: null,
      doneWhen: null,
      evidenceBasis: 'analysis-basis-a',
      evidenceQuotes,
    };
    h.core.workMatcher.replaceProposals(projectId, 'working-tree-group', [originalTree], 'en');
    h.core.workMatcher.replaceProposals(projectId, 'analysis-candidate', [originalAnalysis], 'en');
    const available = vi
      .spyOn(h.core.workMatcher, 'proposals')
      .mockReturnValue([originalTree, originalAnalysis]);
    h.core.projectModel.selectProposal(projectId, originalAnalysis.key);
    const workId = h.core.now.resolve(projectId).currentWorkId!;

    const translatedTree: WorkProposal = {
      ...originalTree,
      title: '응답 언어 설정',
      currentState: '응답 언어를 설정할 수 있습니다.',
      evidenceBasis: 'tree-basis-b',
    };
    const translatedAnalysis: WorkProposal = {
      ...originalAnalysis,
      title: '응답 언어 설정',
      currentState: '응답 언어를 설정할 수 있습니다.',
      evidenceBasis: 'analysis-basis-b',
    };
    h.core.workMatcher.replaceProposals(projectId, 'working-tree-group', [translatedTree], 'ko');
    h.core.workMatcher.replaceProposals(
      projectId,
      'analysis-candidate',
      [translatedAnalysis],
      'ko',
    );
    available.mockReturnValue([translatedTree, translatedAnalysis]);

    const [match] = h.core.workMatcher.match(projectId);
    expect(match).toMatchObject({ workItemId: workId, confidence: 'explicit' });
    expect([match.proposal, ...(match.aliases ?? [])]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: translatedTree.key }),
        expect.objectContaining({ key: translatedAnalysis.key }),
      ]),
    );
  });

  it('creates new work when a reused key has unrelated current evidence', () => {
    const h = harness();
    const changed = vi.spyOn(h.core.events, 'changed');
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    observe(h, projectId, 'basis-a', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:reused',
          source: 'working-tree-group',
          title: 'Initial export work',
          state: 'active',
          currentState: 'The initial export work is active.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-a',
          evidence: ['revision:record-a'],
          evidenceQuotes: [{ revisionId: 'record-a', quote: 'Export work is active.' }],
        },
      ],
      'en',
    );
    h.core.projectModel.selectProposal(projectId, 'group:reused');
    const firstWorkId = h.core.now.resolve(projectId).currentWorkId!;
    changed.mockClear();

    observe(h, projectId, 'basis-b', true);
    h.core.workMatcher.replaceProposals(
      projectId,
      'working-tree-group',
      [
        {
          key: 'group:reused',
          source: 'working-tree-group',
          title: 'Investigate export error',
          state: 'active',
          currentState: 'The export error still needs diagnosis.',
          uncertainty: null,
          nextAction: null,
          doneWhen: null,
          evidenceBasis: 'basis-b',
          evidence: ['revision:record-b'],
          evidenceQuotes: [{ revisionId: 'record-b', quote: 'The export error is open.' }],
        },
      ],
      'en',
    );

    expect(h.core.workMatcher.match(projectId)).toEqual([
      expect.objectContaining({ workItemId: null, confidence: 'unmatched' }),
    ]);
    h.core.projectModel.selectProposal(projectId, 'group:reused');
    const secondWorkId = h.core.now.resolve(projectId).currentWorkId!;
    expect(secondWorkId).not.toBe(firstWorkId);
    expect(h.repo.get('workItem', firstWorkId)).toMatchObject({
      title: 'Initial export work',
      state: 'active',
    });
    expect(
      h.repo
        .list('workDecision')
        .filter(
          (decision) =>
            decision.kind === workDecisionKinds.linkWorkProposal &&
            decision.workItemId === firstWorkId &&
            decision.value.proposalEvidenceBasis === 'basis-a',
        ),
    ).toHaveLength(1);

    h.core.projectModel.selectProposal(projectId, 'group:reused');
    expect(h.core.now.resolve(projectId).currentWorkId).toBe(secondWorkId);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does not auto-match an unverified legacy analysis proposal', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.core.projectModel.view(projectId);
    work(h, projectId, 'work-a', 'active', 'Return flow');
    select(h, projectId, 'work-a');
    const legacy = h.core.project(projectId);
    h.repo.put('project', { ...legacy });
    h.core.storeAnalysis({
      id: legacy.id,
      projectId: legacy.id,
      result: {
        scope: 'scope-a',
        version: 'v1',
        generatedAt: AT,
        candidates: [projectCandidate()],
      },
    });

    const possible = h.core.workMatcher.match(projectId);
    expect(possible).toEqual([]);
    expect(h.repo.list('workItem')).toHaveLength(1);

    h.repo.put('workDecision', {
      id: 'link-proposal',
      projectId,
      workItemId: 'work-a',
      kind: workDecisionKinds.linkWorkProposal,
      value: { proposalKey: 'analysis:export-check' },
      basis: ['scope-a'],
      state: 'valid',
      decidedAt: AT,
    });
    h.repo.put('project', { ...h.core.project(projectId) });
    h.core.storeAnalysis({
      id: h.core.project(projectId).id,
      projectId: h.core.project(projectId).id,
      result: {
        ...h.core.analysisRecord(projectId)!.result,
        version: 'v2',
        candidates: [
          {
            ...projectCandidate(),
            goal: 'A newly worded return-flow analysis',
            currentState: 'The analysis wording changed, but its proposal key stayed stable.',
          },
        ],
      },
    });
    expect(h.core.workMatcher.match(projectId)).toEqual([]);
    expect(h.repo.list('workItem')).toHaveLength(1);
  });
});
