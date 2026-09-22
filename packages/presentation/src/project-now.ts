import {
  classifyWorkProposalMatches,
  isUnlinkedWorkProposalMatch,
  type ProjectModelView,
  type ProjectNow,
  type ProjectNowAction,
  type ProjectNowNotice,
  type WorkItem,
  type WorkProposalDisposition,
} from '@statecarry/contracts';

export type PresentedProjectAction = {
  kind: ProjectNowAction['kind'];
  label: string;
  workItemId: string | null;
  requestId: string | null;
  releaseId: string | null;
  emphasis: 'primary' | 'secondary';
};

export type PresentedProjectNotice = {
  level: ProjectNowNotice['level'];
  kind: ProjectNowNotice['kind'];
  title: string;
  text: string;
  reason: string;
  workItemId: string | null;
  requestId: string | null;
  releaseId: string | null;
};

export type ProjectNowView = {
  project: {
    id: string;
    title: string;
    iconAsset: string | null;
    bannerAsset: string | null;
    disconnected: boolean;
  };
  direction: { id: string; text: string } | null;
  work: {
    id: string;
    title: string;
    state: WorkItem['state'];
    completionCondition: string | null;
  } | null;
  state: ProjectNow['state'];
  currentState: string;
  stillToCheck: string | null;
  nextText: string | null;
  primaryAction: PresentedProjectAction | null;
  secondaryActions: PresentedProjectAction[];
  notice: PresentedProjectNotice | null;
  otherWorkCount: number;
  otherWork: Array<{
    id: string;
    title: string;
    state: WorkItem['state'] | 'proposal';
    statusLabel: string;
    source: 'work-item' | 'proposal';
    disposition: WorkProposalDisposition;
    currentState?: string;
    uncertainty?: string | null;
    nextAction?: string | null;
  }>;
  checking: boolean;
  freshness: ProjectNow['freshness'];
};

export type ProjectCompactView = {
  projectId: string;
  title: string;
  iconAsset: string | null;
  focused: boolean;
  disconnected: boolean;
  current: string;
  status: string;
  reason: string | null;
  recommended: boolean;
  recommendationReason: string | null;
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function firstSentence(value: string, max = 240) {
  const clean = compactWhitespace(value);
  if (!clean) return '';
  const match = clean.match(/^.*?[.!?](?:\s|$)/);
  const sentence = match?.[0].trim() || clean;
  if (sentence.length <= max) return sentence;
  const clipped = sentence
    .slice(0, max - 1)
    .replace(/\s+\S*$/, '')
    .trimEnd();
  return `${clipped || sentence.slice(0, max - 1)}…`;
}

function actionLabel(kind: ProjectNowAction['kind']) {
  switch (kind) {
    case 'reconnect-project':
      return 'Reconnect project';
    case 'review-direction':
      return 'Review direction';
    case 'review-result':
      return 'Review result';
    case 'review-completion':
      return 'Review completion';
    case 'review-work':
      return 'Review work';
    case 'continue-work':
      return 'Continue work';
    case 'resume-work':
      return 'Resume work';
    case 'start-work':
      return 'Start work';
    case 'review-work-plan':
      return 'Re-check work';
    case 'choose-current-work':
      return 'Choose current work';
    case 'choose-next-work':
      return 'Decide next work';
    case 'define-direction':
      return 'Define direction';
    case 'review-release':
      return 'Review release';
    case 'stop-work':
      return 'Stop work';
    case 'continue-despite-direction-conflict':
      return 'Continue anyway';
  }
}

function presentAction(
  action: ProjectNowAction,
  emphasis: PresentedProjectAction['emphasis'],
): PresentedProjectAction {
  return {
    kind: action.kind,
    label: actionLabel(action.kind),
    workItemId: action.workItemId ?? null,
    requestId: action.requestId ?? null,
    releaseId: action.releaseId ?? null,
    emphasis,
  };
}

function noticeTitle(notice: ProjectNowNotice) {
  switch (notice.kind) {
    case 'result-ready':
      return 'Result ready';
    case 'direction-conflict':
      return 'Direction needs review';
    case 'integration-needed':
      return 'Integration needs attention';
    case 'release-ready':
      return 'Release ready';
    case 'delivery-problem':
      return 'Delivery needs attention';
    case 'release-confirmation':
      return 'Release completion';
  }
}

function presentNotice(notice: ProjectNowNotice): PresentedProjectNotice {
  return {
    level: notice.level,
    kind: notice.kind,
    title: noticeTitle(notice),
    text: firstSentence(notice.text, 200),
    reason: firstSentence(notice.reason, 220),
    workItemId: notice.workItemId ?? null,
    requestId: notice.requestId ?? null,
    releaseId: notice.releaseId ?? null,
  };
}

function currentWork(model: ProjectModelView, now: ProjectNow) {
  if (!now.currentWorkId) return null;
  return model.workItems.find((item) => item.id === now.currentWorkId) ?? null;
}

function currentDirection(model: ProjectModelView, now: ProjectNow) {
  if (!now.primaryDirectionId) return null;
  return model.directions.find((item) => item.id === now.primaryDirectionId) ?? null;
}

function workStatusLabel(state: WorkItem['state']) {
  switch (state) {
    case 'active':
      return 'Ready';
    case 'waiting':
      return 'Waiting';
    case 'review':
      return 'Needs review';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Complete';
    case 'stopped':
      return 'Stopped';
  }
}

function proposalStatusLabel(
  disposition: WorkProposalDisposition,
  state: 'active' | 'waiting' | 'paused' | 'unclear' | 'done',
) {
  if (disposition === 'completion-review') return 'Completion needs review';
  if (disposition === 'evidence-conflict') return 'Project state needs review';
  if (state === 'waiting') return 'Waiting';
  if (state === 'paused') return 'Paused';
  if (state === 'unclear') return 'Needs review';
  return 'Found from project state';
}

/**
 * Presentation owns wording density and action labels only. Core has already
 * selected current ProjectRecord, notice priority and the next action.
 */
export function presentProjectNow(model: ProjectModelView, now: ProjectNow): ProjectNowView {
  if (model.project.id !== now.projectId) throw new Error('ProjectNow belongs to another project.');
  const work = currentWork(model, now);
  const direction = currentDirection(model, now);
  const workDispositions = new Map<string, WorkProposalDisposition>();
  for (const match of now.proposalMatches) {
    if (!match.workItemId || workDispositions.has(match.workItemId)) continue;
    const linkedMatches = now.proposalMatches.filter(
      (candidate) => candidate.workItemId === match.workItemId,
    );
    workDispositions.set(match.workItemId, classifyWorkProposalMatches(linkedMatches));
  }
  return {
    project: {
      id: model.project.id,
      title: model.project.title,
      iconAsset: model.project.iconAsset,
      bannerAsset: model.project.bannerAsset,
      disconnected: model.project.lifecycle === 'disconnected',
    },
    direction: direction ? { id: direction.id, text: firstSentence(direction.text, 180) } : null,
    work: work
      ? {
          id: work.id,
          title: compactWhitespace(work.title),
          state: work.state,
          completionCondition: work.completionCondition ?? null,
        }
      : null,
    state: now.state,
    currentState: firstSentence(now.currentState),
    stillToCheck: now.uncertainty ? firstSentence(now.uncertainty, 220) : null,
    nextText: now.next ? firstSentence(now.next.text, 220) : null,
    primaryAction: now.next ? presentAction(now.next, 'primary') : null,
    secondaryActions: now.secondaryActions
      .slice(0, 2)
      .map((action) => presentAction(action, 'secondary')),
    notice: now.notice ? presentNotice(now.notice) : null,
    otherWorkCount: now.otherWorkCount,
    otherWork: [
      ...model.workItems
        .filter(
          (item) =>
            item.id !== now.currentWorkId && item.state !== 'completed' && item.state !== 'stopped',
        )
        .map((item) => ({
          id: item.id,
          title: compactWhitespace(item.title),
          state: item.state,
          statusLabel:
            workDispositions.get(item.id) === 'completion-review'
              ? 'Completion needs review'
              : workDispositions.get(item.id) === 'evidence-conflict'
                ? 'Project state needs review'
                : workStatusLabel(item.state),
          source: 'work-item' as const,
          disposition: workDispositions.get(item.id) ?? 'progress',
        })),
      ...now.proposalMatches
        .filter(isUnlinkedWorkProposalMatch)
        .map((match) => ({
          disposition: classifyWorkProposalMatches([match]),
          id: match.proposal.key,
          title: compactWhitespace(match.proposal.title),
          state: 'proposal' as const,
          statusLabel: proposalStatusLabel(
            classifyWorkProposalMatches([match]),
            match.proposal.state,
          ),
          source: 'proposal' as const,
          currentState: match.proposal.currentState,
          uncertainty: match.proposal.uncertainty,
          nextAction: match.proposal.nextAction,
        })),
    ],
    checking: now.freshness === 'checking',
    freshness: now.freshness,
  };
}

function compactStatus(now: ProjectNow) {
  if (now.notice?.kind === 'result-ready') return 'Result to review';
  if (now.notice?.kind === 'delivery-problem') return 'Delivery needs attention';
  if (now.notice?.kind === 'release-confirmation') return 'Release completion';
  if (now.notice?.kind === 'release-ready') return 'Release ready';
  switch (now.state) {
    case 'disconnected':
      return 'Disconnected';
    case 'needs-direction':
      return 'Direction needed';
    case 'choose-work':
      return 'Choose current work';
    case 'choose-next-work':
      return 'Choose next work';
    case 'waiting':
      return 'Waiting';
    case 'review':
      return 'Needs review';
    case 'paused':
      return 'Paused';
    case 'stopped':
      return 'Stopped';
    case 'complete':
      return 'Work complete';
    case 'idle':
      return 'Nothing to do right now';
    case 'active':
      return 'Ready to continue';
  }
}

function compactCurrent(model: ProjectModelView, now: ProjectNow) {
  const work = currentWork(model, now);
  if (work) return compactWhitespace(work.title);
  if (now.next?.kind === 'define-direction') return 'Define the current direction';
  if (now.next?.kind === 'choose-current-work') return 'Choose current work';
  if (now.next?.kind === 'choose-next-work') return 'Decide the next work';
  if (now.state === 'idle') return 'No current work';
  return firstSentence(now.currentState, 120);
}

/** Compact projection for Home and Projects. It never reorders projects. */
export function presentProjectCompact(
  model: ProjectModelView,
  now: ProjectNow,
  recommendation?: { recommended: boolean; reason?: string | null },
): ProjectCompactView {
  if (model.project.id !== now.projectId) throw new Error('ProjectNow belongs to another project.');
  const reason = now.notice
    ? now.notice.reason
    : now.state === 'waiting' ||
        now.state === 'needs-direction' ||
        now.state === 'choose-work' ||
        now.state === 'choose-next-work'
      ? now.currentState
      : null;
  return {
    projectId: model.project.id,
    title: model.project.title,
    iconAsset: model.project.iconAsset,
    focused: model.project.focused,
    disconnected: model.project.lifecycle === 'disconnected',
    current: compactCurrent(model, now),
    status: compactStatus(now),
    reason: reason ? firstSentence(reason, 150) : null,
    recommended: recommendation?.recommended ?? false,
    recommendationReason:
      recommendation?.recommended && recommendation.reason
        ? firstSentence(recommendation.reason, 150)
        : null,
  };
}

/**
 * Batch projection for Home/Projects. Mapping is intentionally order-preserving:
 * recommendation changes emphasis only, never project order or Focus membership.
 */
export function presentProjectCompacts(
  projects: Array<{ model: ProjectModelView; now: ProjectNow }>,
  recommendation?: { projectId: string; reason?: string | null } | null,
): ProjectCompactView[] {
  return projects.map(({ model, now }) =>
    presentProjectCompact(
      model,
      now,
      recommendation?.projectId === model.project.id
        ? { recommended: true, reason: recommendation.reason }
        : { recommended: false },
    ),
  );
}
