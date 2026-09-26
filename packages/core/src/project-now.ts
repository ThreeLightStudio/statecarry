import {
  classifyWorkProposalMatches,
  isUnlinkedWorkProposalMatch,
  isOpenWork,
  selectedCurrentWorkId,
  workDecisionKinds,
  type Continuation,
  type ProjectNow,
  type ProjectNowAction,
  type ProjectNowBootstrap,
  type ProjectNowExecution,
  type ProjectNowNotice,
  type ProjectNowOtherWorkCounts,
  type ProjectNowRecommendation,
  type ProjectNowRecommendationEvidenceGap,
  type ProjectNowWorkCandidate,
  type ProjectModelView,
  type WorkProposalDisposition,
  type WorkDecision,
  type WorkItem,
  type WorkProposalMatch,
  type WorkRelation,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

type ResultInfo = {
  workItemId: string;
  request: Continuation;
  downstream: number;
  failed: boolean;
};

type RankedWorkCandidate = {
  candidate: ProjectNowWorkCandidate;
  downstreamCount: number;
  currentReturnPoint: boolean;
};

const recommendationEvidenceGaps: ProjectNowRecommendationEvidenceGap[] = [
  'purpose-alignment',
  'direction-alignment',
  'user-impact',
  'user-priority',
  'long-term-benefit',
  'switching-cost',
  'dependency-coverage',
];

function noRecommendation(
  selectionState: ProjectNowRecommendation['selectionState'],
): ProjectNowRecommendation {
  return {
    status: 'none',
    candidate: null,
    action: null,
    reason: null,
    confidence: null,
    close: false,
    closeAlternatives: [],
    selectionState,
    evidenceGaps: [],
  };
}

function latest<T extends { decidedAt: string }>(items: T[]): T | null {
  return [...items].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0] ?? null;
}

function decisionString(decision: WorkDecision | null, key: string): string | null {
  const value = decision?.value[key];
  return typeof value === 'string' ? value : null;
}

function nowState(item: WorkItem): ProjectNow['state'] {
  if (item.state === 'completed') return 'complete';
  return item.state;
}

function readmePurpose(text: string, projectTitle: string): string | null {
  const normalized = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\r/g, '');
  const title = projectTitle.trim().toLowerCase();
  for (const raw of normalized.split('\n')) {
    const line = raw
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (line.length < 20 || line.length > 500) continue;
    if (line.toLowerCase() === title) continue;
    if (/^(website|download|docs?|license|install|installation)\b/i.test(line)) continue;
    if (/https?:\/\//i.test(line) || /shields\.io/i.test(line)) continue;
    const sentence = line.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? line;
    if (sentence.length >= 20) return sentence.slice(0, 360);
  }
  return null;
}

function purposeSuggestion(model: ProjectModelView): ProjectNowBootstrap['purposeSuggestion'] {
  if (model.project.purposes.some((purpose) => purpose.confirmed)) return null;
  const observation = model.latestObservation;
  if (!observation || observation.snapshot.status !== 'checked') return null;
  const files = observation.snapshot.files ?? [];
  const readme = files
    .filter(
      (file) =>
        file.status === 'checked' && !!file.preview && /(^|\/)readme(?:\.[^/]+)?$/i.test(file.path),
    )
    .sort(
      (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
    )[0];
  if (readme?.preview) {
    const text = readmePurpose(readme.preview, model.project.title);
    if (text)
      return { text, source: 'project-file', detail: readme.path, basis: observation.semanticKey };
  }
  const packageFile = files.find(
    (file) =>
      file.status === 'checked' && !!file.preview && /(^|\/)package\.json$/i.test(file.path),
  );
  if (packageFile?.preview)
    try {
      const description = JSON.parse(packageFile.preview).description;
      if (typeof description === 'string' && description.trim().length >= 20)
        return {
          text: description.trim().slice(0, 360),
          source: 'project-file',
          detail: packageFile.path,
          basis: observation.semanticKey,
        };
    } catch {
      // A truncated package file is simply not a bootstrap source.
    }
  return null;
}

function evidenceReviewAction(
  item: WorkItem,
  disposition: WorkProposalDisposition | undefined | null,
): ProjectNowAction | null {
  if (disposition === 'completion-review')
    return {
      kind: 'review-completion',
      workItemId: item.id,
      text: `Review whether ${item.title} is complete.`,
    };
  if (disposition === 'evidence-conflict')
    return {
      kind: 'review-work',
      workItemId: item.id,
      text: `Review the project state for ${item.title}.`,
    };
  return null;
}

export class ProjectNowResolver {
  constructor(private core: StateCarry) {}

  private currentSelection(projectId: string, items: WorkItem[]) {
    const selected = latest(
      this.core.repo
        .list('workDecision')
        .filter(
          (decision) =>
            decision.projectId === projectId &&
            decision.state === 'valid' &&
            decision.kind === workDecisionKinds.selectCurrentWork,
        ),
    );
    const selectedId = selected ? selectedCurrentWorkId(selected) : null;
    const explicit = items.find((item) => item.id === selectedId) ?? null;
    if (explicit) return { item: explicit, selection: 'user' as const };
    return { item: null, selection: null };
  }

  private executionForWork(projectId: string, workItemId?: string): ProjectNowExecution | null {
    const record = this.core.repo.get('projectExecution', projectId);
    const ignored = new Set([...(record?.accepted ?? []), ...(record?.closed ?? [])]);
    const mapped = this.core.repo
      .list('workDecision')
      .filter(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.executionForWork &&
          !!decision.workItemId &&
          (!workItemId || decision.workItemId === workItemId),
      )
      .flatMap((decision) => {
        const requestId = decisionString(decision, 'requestId');
        if (!requestId) return [];
        const request = this.core.repo.get('continuation', requestId);
        if (!request || request.projectId !== projectId) return [];
        const terminal = ['completed', 'failed', 'interrupted'].includes(
          request.execution?.status ?? '',
        );
        const inFlight =
          ['dispatching', 'sent', 'result-unknown'].includes(request.state) && !terminal;
        if (!inFlight && ignored.has(request.id)) return [];
        if (!inFlight && !request.externalReport && !terminal && request.state !== 'failed')
          return [];
        let status: ProjectNowExecution['status'];
        if (request.externalReport && !inFlight) status = 'reported';
        else if (request.execution?.status) status = request.execution.status;
        else if (request.state === 'failed') status = 'failed';
        else if (request.state === 'result-unknown' || request.state === 'dispatching')
          status = 'unknown';
        else if (request.state === 'sent') status = 'checking';
        else return [];
        return [{ workItemId: decision.workItemId!, request, status, inFlight }];
      })
      .sort(
        (left, right) =>
          Number(right.inFlight) - Number(left.inFlight) ||
          right.request.updatedAt.localeCompare(left.request.updatedAt),
      );
    const selected = mapped[0];
    if (!selected) return null;
    const actions: ProjectNowAction[] = [];
    if (selected.status === 'waiting') {
      actions.push({
        kind: 'respond-to-request',
        workItemId: selected.workItemId,
        requestId: selected.request.id,
        text: 'Respond to Codex.',
      });
    } else if (selected.status === 'unknown' || selected.status === 'checking') {
      actions.push({
        kind: 'check-execution',
        workItemId: selected.workItemId,
        requestId: selected.request.id,
        text: 'Check this execution state.',
      });
      actions.push({
        kind: 'open-request',
        workItemId: selected.workItemId,
        requestId: selected.request.id,
        text: 'Open the Codex request.',
      });
    } else if (selected.inFlight) {
      actions.push({
        kind: 'open-request',
        workItemId: selected.workItemId,
        requestId: selected.request.id,
        text: 'Open the Codex request.',
      });
    } else {
      actions.push({
        kind: 'review-result',
        workItemId: selected.workItemId,
        requestId: selected.request.id,
        text: 'Review the returned result.',
      });
    }
    return {
      workItemId: selected.workItemId,
      requestId: selected.request.id,
      status: selected.status,
      actions,
    };
  }

  private resultInfo(projectId: string, relations: WorkRelation[]): ResultInfo[] {
    const project = this.core.project(projectId);
    const ignored = new Set([
      ...(this.core.repo.get('projectExecution', project.id)?.accepted ?? []),
      ...(this.core.repo.get('projectExecution', project.id)?.closed ?? []),
    ]);
    const mappings = this.core.repo
      .list('workDecision')
      .filter(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.executionForWork &&
          !!decision.workItemId,
      );
    return mappings.flatMap((decision) => {
      const requestId = decisionString(decision, 'requestId');
      if (!requestId) return [];
      const request = this.core.repo.get('continuation', requestId);
      if (!request) return [];
      const terminal = ['completed', 'failed', 'interrupted'].includes(
        request.execution?.status ?? '',
      );
      const inFlight =
        ['dispatching', 'sent', 'result-unknown'].includes(request.state) && !terminal;
      if (ignored.has(request.id) && !inFlight) return [];
      const resultReady =
        terminal || (!inFlight && (!!request.externalReport || request.state === 'failed'));
      if (!resultReady) return [];
      const downstream = relations.filter(
        (relation) =>
          relation.fromWorkId === decision.workItemId &&
          relation.state === 'active' &&
          (relation.kind === 'blocks' || relation.kind === 'next-after'),
      ).length;
      return [
        {
          workItemId: decision.workItemId!,
          request,
          downstream,
          failed: request.state === 'failed' || request.execution?.status === 'failed',
        },
      ];
    });
  }

  private directionConflict(projectId: string): ProjectNowNotice | null {
    const conflict = this.core.repo.get('projectScope', projectId)?.policyConflict;
    if (!conflict || conflict.status !== 'open') return null;
    const key = this.core.ids.hash(['direction-conflict', conflict.description, conflict.source]);
    const override = this.core.repo
      .list('workDecision')
      .some(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.continueDirectionConflict &&
          decision.value.conflictKey === key,
      );
    if (override) return null;
    return {
      level: 'immediate',
      kind: 'direction-conflict',
      text: 'The current direction conflicts with a recorded project constraint.',
      reason: conflict.description,
    };
  }

  private isBlocked(item: WorkItem, items: WorkItem[], relations: WorkRelation[]) {
    return relations.some((relation) => {
      if (
        relation.toWorkId !== item.id ||
        relation.state !== 'active' ||
        (relation.kind !== 'blocks' && relation.kind !== 'next-after')
      )
        return false;
      const source = items.find((candidate) => candidate.id === relation.fromWorkId);
      return source?.state !== 'completed';
    });
  }

  private workRecommendation(
    model: ProjectModelView,
    current: WorkItem | null,
    executionWaiting: boolean,
    primaryDirection: ProjectModelView['directions'][number] | undefined,
    conflict: ProjectNowNotice | null,
    candidates: ProjectNowWorkCandidate[],
    matchesByWorkItem: Map<string, WorkProposalMatch[]>,
  ): ProjectNowRecommendation {
    const selectionState: ProjectNowRecommendation['selectionState'] = current
      ? 'current-retained'
      : candidates.length
        ? 'unselected'
        : 'not-applicable';
    const none = () => noRecommendation(selectionState);
    const insufficient = (reason: string): ProjectNowRecommendation => ({
      status: 'insufficient-evidence',
      candidate: null,
      action: null,
      reason,
      confidence: null,
      close: false,
      closeAlternatives: [],
      selectionState,
      evidenceGaps: [...recommendationEvidenceGaps],
    });

    const waitingCurrent = current?.state === 'waiting' || executionWaiting;
    const needsChoice =
      !current || waitingCurrent || ['completed', 'stopped'].includes(current.state);
    if (!needsChoice) return none();
    if (candidates.length === 0) return none();
    if (conflict) return insufficient('Review the project direction before choosing other work.');
    if (!primaryDirection)
      return insufficient('A confirmed current direction is not available to rank this work.');
    if (!model.project.purposes.some((purpose) => purpose.confirmed))
      return insufficient('A confirmed project purpose is not available to rank this work.');

    if (waitingCurrent && current) {
      const currentEvidence = matchesByWorkItem.get(current.id) ?? [];
      if (evidenceReviewAction(current, classifyWorkProposalMatches(currentEvidence)))
        return insufficient('Review the selected work before choosing another piece of work.');
    }

    const queued =
      current?.state === 'completed'
        ? this.queuedNext(current, model.workItems, model.relations)
        : undefined;
    if (queued?.item) {
      const candidate = candidates.find(
        (item) => item.source === 'work-item' && item.id === queued.item?.id,
      );
      const queuedDisposition = candidate?.disposition;
      const reviewAction = evidenceReviewAction(queued.item, queuedDisposition);
      if (reviewAction)
        return insufficient(
          `Review completion evidence for ${queued.item.title} before starting it.`,
        );
      if (queued.relation.state === 'needs-review')
        return insufficient(`Re-check the saved sequence before starting ${queued.item.title}.`);
      if (!candidate || !this.recommendationCandidateIsReady(candidate, model, current, false))
        return insufficient(`Re-check ${queued.item.title} before deciding whether to start it.`);
      return {
        status: 'recommended',
        candidate,
        action: 'select-work-item',
        reason: `The saved sequence puts ${queued.item.title} next after the completed work.`,
        confidence: 'medium',
        close: false,
        closeAlternatives: [],
        selectionState,
        evidenceGaps: [...recommendationEvidenceGaps],
      };
    }

    const readyCandidates = candidates.filter((candidate) =>
      this.recommendationCandidateIsReady(candidate, model, current, waitingCurrent),
    );
    if (readyCandidates.length === 0) {
      if (candidates.some((candidate) => candidate.disposition === 'completion-review'))
        return insufficient(
          'Completion evidence needs review before this work can be recommended to start.',
        );
      if (candidates.some((candidate) => candidate.disposition === 'evidence-conflict'))
        return insufficient(
          'Project sources disagree about whether this work is still in progress.',
        );
      if (
        waitingCurrent &&
        candidates.some(
          (candidate) =>
            candidate.source === 'proposal' &&
            (candidate.proposalState === 'active' || candidate.proposalState === 'paused'),
        )
      )
        return insufficient(
          'A provisional work proposal has no saved dependency details, so it cannot be confirmed as safe to start while the selected work is waiting.',
        );
      return insufficient(
        'The available work is waiting, blocked, or has an unclear state or dependency that needs review.',
      );
    }

    const observation = model.latestObservation;
    const currentBasis =
      observation?.snapshot.status === 'checked' ? observation.semanticKey : null;
    const ranked: RankedWorkCandidate[] = readyCandidates.map((candidate) => {
      const downstream = new Set(
        model.relations
          .filter(
            (relation) =>
              relation.fromWorkId === candidate.id &&
              relation.state === 'active' &&
              (relation.kind === 'blocks' || relation.kind === 'next-after'),
          )
          .map((relation) => relation.toWorkId)
          .filter((workItemId) => {
            const dependent = model.workItems.find((item) => item.id === workItemId);
            return dependent ? isOpenWork(dependent) : false;
          }),
      );
      const currentReturnPoint =
        candidate.source === 'work-item' &&
        currentBasis !== null &&
        model.returnPoints.some(
          (point) => point.workItemId === candidate.id && point.basis === currentBasis,
        );
      return { candidate, downstreamCount: downstream.size, currentReturnPoint };
    });
    const dominates = (left: RankedWorkCandidate, right: RankedWorkCandidate) =>
      left.downstreamCount >= right.downstreamCount &&
      Number(left.currentReturnPoint) >= Number(right.currentReturnPoint) &&
      (left.downstreamCount > right.downstreamCount ||
        left.currentReturnPoint !== right.currentReturnPoint);
    const frontier = ranked
      .filter(
        (candidate) => !ranked.some((other) => other !== candidate && dominates(other, candidate)),
      )
      .sort(
        (left, right) =>
          left.candidate.source.localeCompare(right.candidate.source) ||
          left.candidate.id.localeCompare(right.candidate.id),
      );
    const winner = frontier[0];
    if (!winner) return insufficient('There is not enough current evidence to compare this work.');

    const reasons: string[] = [];
    if (winner.downstreamCount > 0)
      reasons.push(
        `can unblock ${winner.downstreamCount} dependent piece${winner.downstreamCount === 1 ? '' : 's'} of work`,
      );
    if (winner.currentReturnPoint)
      reasons.push('has a return point for the latest checked project state');
    const close = frontier.length > 1;
    let reason = reasons.length ? `It ${reasons.join(' and ')}.` : '';
    if (close) {
      const alternative = frontier[1];
      const contrast = alternative
        ? alternative.currentReturnPoint && winner.downstreamCount > alternative.downstreamCount
          ? ` This is a close choice: ${alternative.candidate.title} has a return point for the latest checked project state.`
          : alternative.downstreamCount > winner.downstreamCount && winner.currentReturnPoint
            ? ` This is a close choice: ${alternative.candidate.title} can unblock ${alternative.downstreamCount} dependent piece${alternative.downstreamCount === 1 ? '' : 's'} of work.`
            : ''
        : '';
      reason = reason
        ? `${reason}${contrast || ' The available dependency and return-point evidence does not distinguish these choices, so this is a close recommendation.'}`
        : 'The available dependency and return-point evidence does not distinguish these choices, so this is a close recommendation.';
    } else if (!reason) {
      reason =
        'It is the only available progress option with no blocking dependency recorded for it.';
    }

    return {
      status: 'recommended',
      candidate: winner.candidate,
      action: winner.candidate.source === 'work-item' ? 'select-work-item' : 'choose-work',
      reason,
      confidence:
        !close && (winner.downstreamCount > 0 || winner.currentReturnPoint) ? 'medium' : 'low',
      close,
      closeAlternatives: frontier
        .slice(1)
        .map(({ candidate }) => ({
          id: candidate.id,
          title: candidate.title,
          source: candidate.source,
        })),
      selectionState,
      evidenceGaps: [...recommendationEvidenceGaps],
    };
  }

  private bootstrap(
    model: ProjectModelView,
    current: WorkItem | null,
    primaryDirection: ProjectModelView['directions'][number] | undefined,
    matches: WorkProposalMatch[],
  ): ProjectNowBootstrap {
    const directionDeferred = this.core.projectModel.directionDeferred(model.project.id);
    let directionSuggestion: ProjectNowBootstrap['directionSuggestion'] = null;
    if (!primaryDirection && !directionDeferred) {
      const observationBasis = model.latestObservation?.semanticKey ?? null;
      if (current && isOpenWork(current))
        directionSuggestion = {
          text: current.title,
          source: 'current-work',
          detail: 'the work you already selected',
          basis: observationBasis ?? `work:${current.id}:${current.updatedAt}`,
        };
      else {
        const open = model.workItems.filter(isOpenWork);
        if (open.length === 1)
          directionSuggestion = {
            text: open[0].title,
            source: 'current-work',
            detail: 'the only unfinished saved work',
            basis: observationBasis ?? `work:${open[0].id}:${open[0].updatedAt}`,
          };
        else {
          const choices = matches
            .filter(isUnlinkedWorkProposalMatch)
            .filter(
              (match) =>
                classifyWorkProposalMatches([match]) === 'progress' &&
                (match.proposal.state === 'active' || match.proposal.state === 'paused'),
            );
          if (choices.length === 1)
            directionSuggestion = {
              text: choices[0].proposal.title,
              source: 'project-state',
              detail: 'the current project analysis',
              basis:
                choices[0].proposal.evidenceBasis ?? observationBasis ?? 'current-project-state',
            };
        }
      }
    }
    return { purposeSuggestion: purposeSuggestion(model), directionSuggestion, directionDeferred };
  }

  private recommendationCandidateIsReady(
    candidate: ProjectNowWorkCandidate,
    model: ProjectModelView,
    current: WorkItem | null,
    waitingCurrent: boolean,
  ): boolean {
    if (candidate.disposition !== 'progress') return false;
    if (candidate.source === 'proposal')
      return (
        !waitingCurrent &&
        (candidate.proposalState === 'active' || candidate.proposalState === 'paused')
      );

    const item = model.workItems.find((workItem) => workItem.id === candidate.id);
    if (
      !item ||
      item.id === current?.id ||
      ['completed', 'stopped', 'waiting'].includes(item.state)
    )
      return false;
    if (this.isBlocked(item, model.workItems, model.relations)) return false;
    const needsDependencyReview = model.relations.some(
      (relation) =>
        relation.toWorkId === item.id &&
        relation.state === 'needs-review' &&
        (relation.kind === 'blocks' || relation.kind === 'next-after'),
    );
    if (needsDependencyReview) return false;
    const overlapsUnfinishedWork = model.relations.some((relation) => {
      if (relation.kind !== 'overlaps' || relation.state === 'resolved') return false;
      const otherWorkId =
        relation.fromWorkId === item.id
          ? relation.toWorkId
          : relation.toWorkId === item.id
            ? relation.fromWorkId
            : null;
      const other = otherWorkId
        ? model.workItems.find((workItem) => workItem.id === otherWorkId)
        : null;
      return !!other && isOpenWork(other);
    });
    return !overlapsUnfinishedWork;
  }

  private queuedNext(current: WorkItem, items: WorkItem[], relations: WorkRelation[]) {
    return relations
      .filter(
        (relation) =>
          relation.fromWorkId === current.id &&
          relation.kind === 'next-after' &&
          relation.state !== 'resolved',
      )
      .map((relation) => ({ relation, item: items.find((item) => item.id === relation.toWorkId) }))
      .find(({ item }) => item && item.state !== 'completed' && item.state !== 'stopped');
  }

  resolve(projectId: string, input: { checking?: boolean } = {}): ProjectNow {
    const model = this.core.projectModel.view(projectId);
    const matches =
      model.project.lifecycle === 'active' ? this.core.workMatcher.match(projectId) : [];
    const primaryDirection =
      model.directions.find(
        (direction) => direction.state === 'active' && direction.confirmed && direction.primary,
      ) ??
      model.directions.find((direction) => direction.state === 'active' && direction.confirmed);
    const selection = this.currentSelection(projectId, model.workItems);
    const current = selection.item;
    const matchesByWorkItem = new Map(
      model.workItems.map((item) => [
        item.id,
        matches.filter((match) => match.workItemId === item.id),
      ]),
    );
    const workDispositions = new Map(
      [...matchesByWorkItem]
        .filter(([, workMatches]) => workMatches.length > 0)
        .map(([workItemId, workMatches]) => [workItemId, classifyWorkProposalMatches(workMatches)]),
    );
    const proposalChoices = matches.filter(isUnlinkedWorkProposalMatch);
    const otherWorkCandidates: ProjectNowWorkCandidate[] = [
      ...model.workItems
        .filter(
          (item) =>
            item.id !== current?.id && item.state !== 'completed' && item.state !== 'stopped',
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          source: 'work-item' as const,
          disposition: workDispositions.get(item.id) ?? 'progress',
        })),
      ...proposalChoices.map((match) => ({
        id: match.proposal.key,
        title: match.proposal.title,
        state: 'proposal' as const,
        source: 'proposal' as const,
        disposition: classifyWorkProposalMatches([match]),
        proposalState: match.proposal.state,
        currentState: match.proposal.currentState,
        uncertainty: match.proposal.uncertainty,
        nextAction: match.proposal.nextAction,
      })),
    ];
    const otherWorkCounts: ProjectNowOtherWorkCounts = {
      total: otherWorkCandidates.length,
      progress: otherWorkCandidates.filter((candidate) => candidate.disposition === 'progress')
        .length,
      completionReview: otherWorkCandidates.filter(
        (candidate) => candidate.disposition === 'completion-review',
      ).length,
      evidenceConflict: otherWorkCandidates.filter(
        (candidate) => candidate.disposition === 'evidence-conflict',
      ).length,
    };
    const otherWorkCount = otherWorkCounts.total;
    const observation = model.latestObservation;
    const freshness = input.checking
      ? ('checking' as const)
      : !observation || observation.snapshot.status !== 'checked'
        ? ('unknown' as const)
        : this.core.workMatcher.hasStaleProposals(projectId)
          ? ('changed' as const)
          : ('current' as const);
    const bootstrap = this.bootstrap(model, current, primaryDirection, matches);
    const projectExecution = this.executionForWork(projectId);

    if (model.project.lifecycle === 'disconnected')
      return {
        projectId,
        primaryDirectionId: primaryDirection?.id ?? null,
        currentWorkId: current?.id ?? null,
        currentWorkSelection: selection.selection,
        execution: projectExecution,
        state: 'disconnected',
        currentState: 'The project is disconnected, so its current state cannot be checked.',
        uncertainty: 'Only the last saved StateCarry context is available.',
        next: { kind: 'reconnect-project', text: 'Reconnect this project.' },
        secondaryActions: [],
        notice: null,
        otherWorkCount,
        otherWorkCounts,
        otherWorkCandidates,
        recommendation: noRecommendation(
          current
            ? 'current-retained'
            : otherWorkCandidates.length > 0
              ? 'unselected'
              : 'not-applicable',
        ),
        bootstrap,
        freshness: 'unknown',
        proposalMatches: matches,
      };

    const conflict = this.directionConflict(projectId);
    const currentExecution = current ? this.executionForWork(projectId, current.id) : null;
    const activeExecutionWaiting =
      current?.state === 'active' &&
      !!currentExecution &&
      ['checking', 'running', 'waiting', 'unknown'].includes(currentExecution.status);
    const recommendation = this.workRecommendation(
      model,
      current,
      activeExecutionWaiting,
      primaryDirection,
      conflict,
      otherWorkCandidates,
      matchesByWorkItem,
    );
    const results = this.resultInfo(projectId, model.relations).sort(
      (a, b) => b.downstream - a.downstream || Number(b.failed) - Number(a.failed),
    );
    const currentResult = current
      ? results.find((result) => result.workItemId === current.id)
      : null;
    const otherResult = results.find((result) => result.workItemId !== current?.id) ?? null;
    const releaseAttention = this.core.releases.attention(projectId);
    let notice: ProjectNowNotice | null = conflict;
    if (
      !notice &&
      releaseAttention &&
      (releaseAttention.kind === 'problem' || releaseAttention.kind === 'confirm')
    )
      notice = {
        level: 'attention',
        kind: releaseAttention.kind === 'problem' ? 'delivery-problem' : 'release-confirmation',
        releaseId: releaseAttention.releaseId ?? undefined,
        text: releaseAttention.text,
        reason: releaseAttention.reason,
      };
    if (!notice && otherResult) {
      const work = model.workItems.find((item) => item.id === otherResult.workItemId);
      notice = {
        level: otherResult.downstream > 0 || otherResult.failed ? 'attention' : 'quiet',
        kind: 'result-ready',
        workItemId: otherResult.workItemId,
        requestId: otherResult.request.id,
        text: `${work?.title ?? 'Other work'} has a result ready to review.`,
        reason:
          otherResult.downstream > 0
            ? `Reviewing it can unblock ${otherResult.downstream} dependent work item${otherResult.downstream === 1 ? '' : 's'}.`
            : 'It does not currently block the selected work.',
      };
    }
    if (!notice && releaseAttention?.kind === 'ready')
      notice = {
        level: 'quiet',
        kind: 'release-ready',
        text: releaseAttention.text,
        reason: releaseAttention.reason,
      };

    if (conflict)
      return {
        projectId,
        primaryDirectionId: primaryDirection?.id ?? null,
        currentWorkId: current?.id ?? null,
        currentWorkSelection: selection.selection,
        execution: current ? this.executionForWork(projectId, current.id) : projectExecution,
        state: current ? nowState(current) : 'needs-direction',
        currentState: current
          ? `Current work: ${current.title}.`
          : 'The project direction needs review.',
        uncertainty: conflict.reason,
        next: {
          kind: 'review-direction',
          text: 'Review whether the current direction should continue.',
        },
        secondaryActions: current
          ? [
              {
                kind: 'continue-despite-direction-conflict',
                workItemId: current.id,
                text: 'Continue the current work anyway.',
              },
            ]
          : [],
        notice,
        otherWorkCount,
        otherWorkCounts,
        otherWorkCandidates,
        recommendation,
        bootstrap,
        freshness,
        proposalMatches: matches,
      };

    if (!current) {
      const open = model.workItems.filter(isOpenWork);
      if (open.length === 0 && proposalChoices.length > 0)
        return {
          projectId,
          primaryDirectionId: primaryDirection?.id ?? null,
          currentWorkId: null,
          currentWorkSelection: null,
          execution: projectExecution,
          state: 'choose-work',
          currentState:
            proposalChoices.length === 1
              ? 'There is work to choose from, but none is selected as current.'
              : 'Several pieces of work are available, but none is selected as current.',
          uncertainty: null,
          next: {
            kind: 'choose-current-work',
            text: 'Choose which work is current before continuing.',
            confidence: proposalChoices.length === 1 ? 'medium' : 'low',
          },
          secondaryActions: [],
          notice,
          otherWorkCount,
          otherWorkCounts,
          otherWorkCandidates,
          recommendation,
          bootstrap,
          freshness,
          proposalMatches: matches,
        };
      if (open.length > 0)
        return {
          projectId,
          primaryDirectionId: primaryDirection?.id ?? null,
          currentWorkId: null,
          currentWorkSelection: null,
          execution: projectExecution,
          state: 'choose-work',
          currentState:
            open.length === 1
              ? 'There is unfinished work, but none is selected as current.'
              : 'Several pieces of work are available, but none is selected as current.',
          uncertainty: null,
          next: {
            kind: 'choose-current-work',
            text: 'Choose which work is current before continuing.',
            confidence: 'low',
          },
          secondaryActions: [],
          notice,
          otherWorkCount,
          otherWorkCounts,
          otherWorkCandidates,
          recommendation,
          bootstrap,
          freshness,
          proposalMatches: matches,
        };

      if (!primaryDirection) {
        const allDirectionsEnded =
          model.directions.length > 0 &&
          model.directions.every((direction) => direction.state !== 'active');
        if (allDirectionsEnded && open.length === 0)
          return {
            projectId,
            primaryDirectionId: null,
            currentWorkId: null,
            currentWorkSelection: null,
            execution: projectExecution,
            state: 'idle',
            currentState:
              releaseAttention?.text ?? 'There is no current work or result that needs attention.',
            uncertainty: null,
            next: releaseAttention
              ? {
                  kind: 'review-release',
                  releaseId: releaseAttention.releaseId ?? undefined,
                  text: 'Review release and delivery state.',
                }
              : null,
            secondaryActions: [],
            notice,
            otherWorkCount,
            otherWorkCounts,
            otherWorkCandidates,
            recommendation,
            bootstrap,
            freshness,
            proposalMatches: matches,
          };
        if (bootstrap.directionDeferred)
          return {
            projectId,
            primaryDirectionId: null,
            currentWorkId: null,
            currentWorkSelection: null,
            execution: projectExecution,
            state: 'idle',
            currentState: 'No current direction is set. Saved project context remains available.',
            uncertainty: null,
            next: releaseAttention
              ? {
                  kind: 'review-release',
                  releaseId: releaseAttention.releaseId ?? undefined,
                  text: 'Review release and delivery state.',
                }
              : null,
            secondaryActions: [],
            notice,
            otherWorkCount,
            otherWorkCounts,
            otherWorkCandidates,
            recommendation,
            bootstrap,
            freshness,
            proposalMatches: matches,
          };
        return {
          projectId,
          primaryDirectionId: null,
          currentWorkId: null,
          currentWorkSelection: null,
          execution: projectExecution,
          state: 'needs-direction',
          currentState: 'No confirmed current direction is available.',
          uncertainty: null,
          next: { kind: 'define-direction', text: 'Confirm or define the current direction.' },
          secondaryActions: [],
          notice,
          otherWorkCount,
          otherWorkCounts,
          otherWorkCandidates,
          recommendation,
          bootstrap,
          freshness,
          proposalMatches: matches,
        };
      }

      return {
        projectId,
        primaryDirectionId: primaryDirection.id,
        currentWorkId: null,
        currentWorkSelection: null,
        execution: projectExecution,
        state: releaseAttention ? 'complete' : 'choose-next-work',
        currentState: 'The current direction is active, but no work is selected to continue it.',
        uncertainty: null,
        next: releaseAttention
          ? {
              kind: 'review-release',
              releaseId: releaseAttention.releaseId ?? undefined,
              text: 'Review release and delivery state.',
            }
          : { kind: 'choose-next-work', text: 'Decide the next work for this direction.' },
        secondaryActions: [],
        notice,
        otherWorkCount,
        otherWorkCounts,
        otherWorkCandidates,
        recommendation,
        bootstrap,
        freshness,
        proposalMatches: matches,
      };
    }

    const match = this.core.workMatcher.bestForWork(projectId, current);
    const currentMatches = matches.filter((candidate) => candidate.workItemId === current.id);
    const matchDisposition =
      currentMatches.length > 0 ? classifyWorkProposalMatches(currentMatches) : null;
    const matchReviewAction = evidenceReviewAction(current, matchDisposition);
    const returnPoint = model.returnPoints
      .filter((point) => point.workItemId === current.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const returnPointStale =
      !!returnPoint &&
      !!observation &&
      observation.snapshot.status === 'checked' &&
      returnPoint.basis !== observation.semanticKey;
    const possibleMatch = match?.confidence === 'possible';
    const recordedState =
      current.state === 'completed'
        ? 'This work is complete.'
        : current.state === 'stopped'
          ? 'This work was stopped.'
          : current.state === 'paused'
            ? 'This work is paused.'
            : null;
    let currentState =
      recordedState ??
      match?.proposal.currentState ??
      returnPoint?.current ??
      (current.state === 'waiting'
        ? 'This work is waiting before it can continue.'
        : current.state === 'paused'
          ? 'This work is paused.'
          : current.state === 'review'
            ? 'This work has something ready to review.'
            : current.state === 'completed'
              ? 'This work is complete.'
              : 'This work is ready to continue.');
    let uncertainty =
      matchDisposition === 'evidence-conflict'
        ? 'Current project sources disagree about whether this work is still in progress or complete.'
        : possibleMatch
          ? 'The current project interpretation has not been explicitly linked to this work.'
          : (match?.proposal.uncertainty ?? returnPoint?.remaining ?? null);
    if (freshness === 'unknown')
      uncertainty =
        observation?.snapshot.limitations[0] ??
        'The current project state has not been checked, so this is the last known work context.';
    if (returnPointStale && match?.confidence !== 'explicit')
      uncertainty = 'The project changed since this return point was recorded.';

    let next: ProjectNowAction | null = null;
    let state: ProjectNow['state'] = nowState(current);
    const secondaryActions: ProjectNowAction[] = [];

    const preserveWorkDecision =
      !!current && ['paused', 'stopped', 'completed'].includes(current.state);
    if (currentResult && !preserveWorkDecision) {
      state = 'review';
      next = {
        kind: 'review-result',
        workItemId: current.id,
        requestId: currentResult.request.id,
        text: `Review the result for ${current.title}.`,
      };
    } else if (!primaryDirection && !bootstrap.directionDeferred && !preserveWorkDecision) {
      state = 'needs-direction';
      next = {
        kind: 'define-direction',
        text: 'Confirm or define the current direction before choosing what should come next.',
      };
    } else if (current.state === 'completed') {
      const queued = bootstrap.directionDeferred
        ? undefined
        : this.queuedNext(current, model.workItems, model.relations);
      if (queued?.item) {
        const queuedReviewAction = evidenceReviewAction(
          queued.item,
          workDispositions.get(queued.item.id),
        );
        next = queuedReviewAction
          ? {
              kind: 'choose-next-work',
              text: `Review ${queued.item.title} before deciding whether to continue.`,
            }
          : queued.relation.state === 'needs-review'
            ? {
                kind: 'review-work-plan',
                workItemId: queued.item.id,
                text: `Re-check ${queued.item.title} before starting it.`,
              }
            : recommendation.status === 'recommended' &&
                recommendation.candidate?.source === 'work-item' &&
                recommendation.candidate.id === queued.item.id
              ? {
                  kind: 'start-work',
                  workItemId: queued.item.id,
                  text: `Continue with ${queued.item.title}.`,
                  reason: recommendation.reason ?? undefined,
                  confidence: recommendation.confidence ?? undefined,
                }
              : {
                  kind: 'choose-next-work',
                  workItemId: queued.item.id,
                  text: `Re-check ${queued.item.title} before deciding whether to start it.`,
                };
      } else if (primaryDirection) {
        next = { kind: 'choose-next-work', text: 'Decide the next work for this direction.' };
      }
    } else if (current.state === 'waiting') {
      if (currentExecution?.status === 'waiting') {
        state = 'waiting';
        currentState = 'This work is waiting for your response to the Codex request.';
        next = {
          kind: 'respond-to-request',
          workItemId: current.id,
          requestId: currentExecution.requestId,
          text: 'Respond to Codex before this work can continue.',
        };
      } else if (
        currentExecution?.status === 'unknown' ||
        currentExecution?.status === 'checking'
      ) {
        state = 'waiting';
        currentState = 'This work is waiting while StateCarry checks the Codex request.';
        next = {
          kind: 'open-request',
          workItemId: current.id,
          requestId: currentExecution.requestId,
          text: 'Check the Codex request before sending it again.',
        };
      } else if (currentExecution?.status === 'running') {
        state = 'waiting';
        currentState = 'This work is waiting for Codex to finish the request.';
        if (recommendation.status === 'recommended' && recommendation.candidate) {
          next =
            recommendation.candidate.source === 'work-item'
              ? {
                  kind: 'start-work',
                  workItemId: recommendation.candidate.id,
                  text: `Work on ${recommendation.candidate.title} while this is waiting.`,
                  reason: recommendation.reason ?? undefined,
                  confidence: recommendation.confidence ?? undefined,
                }
              : {
                  kind: 'choose-current-work',
                  text: `Choose whether to work on ${recommendation.candidate.title} while this is waiting.`,
                  reason: recommendation.reason ?? undefined,
                  confidence: recommendation.confidence ?? undefined,
                };
        } else {
          next = {
            kind: 'open-request',
            workItemId: current.id,
            requestId: currentExecution.requestId,
            text: 'Open the Codex request.',
          };
        }
      } else if (matchReviewAction) {
        state = 'review';
        next = matchReviewAction;
      } else {
        if (recommendation.status === 'recommended' && recommendation.candidate) {
          next =
            recommendation.candidate.source === 'work-item'
              ? {
                  kind: 'start-work',
                  workItemId: recommendation.candidate.id,
                  text: `Work on ${recommendation.candidate.title} while this is waiting.`,
                  reason: recommendation.reason ?? undefined,
                  confidence: recommendation.confidence ?? undefined,
                }
              : {
                  kind: 'choose-current-work',
                  text: `Choose whether to work on ${recommendation.candidate.title} while this is waiting.`,
                  reason: recommendation.reason ?? undefined,
                  confidence: recommendation.confidence ?? undefined,
                };
        }
        secondaryActions.push({
          kind: 'stop-work',
          workItemId: current.id,
          text: `Stop ${current.title}.`,
        });
      }
    } else if (current.state === 'paused') {
      next = { kind: 'resume-work', workItemId: current.id, text: `Resume ${current.title}.` };
      secondaryActions.push({
        kind: 'stop-work',
        workItemId: current.id,
        text: `Stop ${current.title}.`,
      });
    } else if (current.state === 'stopped') {
      next = primaryDirection
        ? { kind: 'choose-next-work', text: 'Decide the next work for this direction.' }
        : bootstrap.directionDeferred
          ? null
          : { kind: 'define-direction', text: 'Confirm or define the current direction.' };
    } else if (current.state === 'review') {
      next = { kind: 'review-work', workItemId: current.id, text: `Review ${current.title}.` };
      secondaryActions.push({
        kind: 'stop-work',
        workItemId: current.id,
        text: `Stop ${current.title}.`,
      });
    } else if (matchReviewAction) {
      state = 'review';
      next = matchReviewAction;
    } else if (returnPointStale && match?.confidence !== 'explicit') {
      next = {
        kind: 'review-work-plan',
        workItemId: current.id,
        text: 'Re-check this work against the current project state.',
      };
    } else {
      next = {
        kind: 'continue-work',
        workItemId: current.id,
        text: match?.proposal.nextAction ?? returnPoint?.next ?? `Continue ${current.title}.`,
      };
      secondaryActions.push({
        kind: 'review-work',
        workItemId: current.id,
        text: `Review the current state of ${current.title}.`,
      });
      secondaryActions.push({
        kind: 'stop-work',
        workItemId: current.id,
        text: `Stop ${current.title}.`,
      });
    }

    if (activeExecutionWaiting && current) {
      state = 'waiting';
      currentState =
        currentExecution.status === 'waiting'
          ? 'This work is waiting for your response to the Codex request.'
          : currentExecution.status === 'unknown'
            ? 'This work is waiting while you check the Codex request.'
            : currentExecution.status === 'checking'
              ? 'This work is waiting while StateCarry checks the Codex request.'
              : 'This work is waiting for Codex to finish the request.';
      if (currentExecution.status === 'waiting') {
        next = {
          kind: 'respond-to-request',
          workItemId: current.id,
          requestId: currentExecution.requestId,
          text: 'Respond to Codex before this work can continue.',
        };
      } else if (currentExecution.status === 'unknown' || currentExecution.status === 'checking') {
        next = {
          kind: 'open-request',
          workItemId: current.id,
          requestId: currentExecution.requestId,
          text: 'Check the Codex request before sending it again.',
        };
      } else if (
        !(recommendation.status === 'recommended' && recommendation.candidate) &&
        next?.kind === 'continue-work'
      ) {
        next = {
          kind: 'open-request',
          workItemId: current.id,
          requestId: currentExecution.requestId,
          text: 'Open the Codex request.',
        };
      }
      for (let index = secondaryActions.length - 1; index >= 0; index--)
        if (secondaryActions[index]?.kind === 'stop-work') secondaryActions.splice(index, 1);
    }

    const visibleExecution = currentExecution ?? this.executionForWork(projectId);

    if (releaseAttention && primaryDirection) {
      const releaseAction: ProjectNowAction = {
        kind: 'review-release',
        releaseId: releaseAttention.releaseId ?? undefined,
        text: 'Review release and delivery state.',
      };
      if (
        (current.state === 'completed' || current.state === 'stopped') &&
        (!next || next.kind === 'choose-next-work')
      )
        next = releaseAction;
      else if (next?.kind !== 'review-release')
        secondaryActions.splice(Math.min(1, secondaryActions.length), 0, releaseAction);
    }

    const finalFreshness =
      freshness === 'current' && returnPointStale && match?.confidence !== 'explicit'
        ? ('changed' as const)
        : freshness;

    return {
      projectId,
      primaryDirectionId: primaryDirection?.id ?? null,
      currentWorkId: current.id,
      currentWorkSelection: selection.selection,
      execution: visibleExecution,
      state,
      currentState,
      uncertainty,
      next,
      secondaryActions,
      notice,
      otherWorkCount,
      otherWorkCounts,
      otherWorkCandidates,
      recommendation,
      bootstrap,
      freshness: finalFreshness,
      proposalMatches: matches,
    };
  }
}
