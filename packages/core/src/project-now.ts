import {
  isOpenWork,
  selectedCurrentWorkId,
  workDecisionKinds,
  type Continuation,
  type ProjectNow,
  type ProjectNowAction,
  type ProjectNowNotice,
  type WorkDecision,
  type WorkItem,
  type WorkRelation,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

type ResultInfo = {
  workItemId: string;
  request: Continuation;
  downstream: number;
  failed: boolean;
};

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
      if (!requestId || ignored.has(requestId)) return [];
      const request = this.core.repo.get('continuation', requestId);
      if (!request) return [];
      const resultReady =
        !!request.externalReport ||
        ['completed', 'failed', 'interrupted'].includes(request.execution?.status ?? '') ||
        request.state === 'failed';
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

  private waitingAlternative(
    current: WorkItem,
    items: WorkItem[],
    relations: WorkRelation[],
    projectId: string,
  ): WorkItem | null {
    const returnPoints = this.core.repo
      .list('returnPoint')
      .filter((point) => point.projectId === projectId);
    const candidates = items.filter(
      (item) =>
        item.id !== current.id &&
        !['completed', 'stopped', 'waiting'].includes(item.state) &&
        !this.isBlocked(item, items, relations),
    );
    const restartScore = (item: WorkItem) => {
      const hasReturnPoint = returnPoints.some((point) => point.workItemId === item.id);
      if (item.state === 'paused' && hasReturnPoint) return 0;
      if (item.state === 'active' && hasReturnPoint) return 1;
      if (item.state === 'active') return 2;
      if (item.state === 'paused') return 3;
      if (item.state === 'review') return 4;
      return 5;
    };
    return (
      [...candidates].sort(
        (a, b) => restartScore(a) - restartScore(b) || a.createdAt.localeCompare(b.createdAt),
      )[0] ?? null
    );
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
    const unmatchedProposals = matches.filter(
      (match) => match.confidence === 'unmatched' && !match.workItemId,
    );
    const otherWorkCount =
      model.workItems.filter(
        (item) => item.id !== current?.id && item.state !== 'completed' && item.state !== 'stopped',
      ).length + unmatchedProposals.length;
    const observation = model.latestObservation;
    const freshness = input.checking
      ? ('checking' as const)
      : !observation || observation.snapshot.status !== 'checked'
        ? ('unknown' as const)
        : this.core.workMatcher.hasStaleWorkingTreeProposals(projectId)
          ? ('changed' as const)
          : ('current' as const);

    if (model.project.lifecycle === 'disconnected')
      return {
        projectId,
        primaryDirectionId: primaryDirection?.id ?? null,
        currentWorkId: current?.id ?? null,
        currentWorkSelection: selection.selection,
        state: 'disconnected',
        currentState: 'The project is disconnected, so its current state cannot be checked.',
        uncertainty: 'Only the last saved StateCarry context is available.',
        next: { kind: 'reconnect-project', text: 'Reconnect this project.' },
        secondaryActions: [],
        notice: null,
        otherWorkCount,
        freshness: 'unknown',
        proposalMatches: matches,
      };

    const conflict = this.directionConflict(projectId);
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
        freshness,
        proposalMatches: matches,
      };

    if (!current) {
      const open = model.workItems.filter(isOpenWork);
      if (open.length === 0 && unmatchedProposals.length > 0)
        return {
          projectId,
          primaryDirectionId: primaryDirection?.id ?? null,
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'choose-work',
          currentState:
            unmatchedProposals.length === 1
              ? 'StateCarry found unfinished work, but it has not been confirmed as the current work.'
              : `StateCarry found ${unmatchedProposals.length} pieces of unfinished work, but none is confirmed as current.`,
          uncertainty: null,
          next: {
            kind: 'choose-current-work',
            text:
              unmatchedProposals.length === 1
                ? 'Confirm whether this is the work you want to continue.'
                : 'Choose which work is current before continuing.',
            confidence: unmatchedProposals.length === 1 ? 'medium' : 'low',
          },
          secondaryActions: [],
          notice,
          otherWorkCount,
          freshness,
          proposalMatches: matches,
        };
      if (open.length > 0)
        return {
          projectId,
          primaryDirectionId: primaryDirection?.id ?? null,
          currentWorkId: null,
          currentWorkSelection: null,
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
            otherWorkCount: 0,
            freshness,
            proposalMatches: matches,
          };
        return {
          projectId,
          primaryDirectionId: null,
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'needs-direction',
          currentState: 'No confirmed current direction is available.',
          uncertainty: null,
          next: { kind: 'define-direction', text: 'Confirm or define the current direction.' },
          secondaryActions: [],
          notice,
          otherWorkCount,
          freshness,
          proposalMatches: matches,
        };
      }

      return {
        projectId,
        primaryDirectionId: primaryDirection.id,
        currentWorkId: null,
        currentWorkSelection: null,
        state: 'complete',
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
        freshness,
        proposalMatches: matches,
      };
    }

    const match = this.core.workMatcher.bestForWork(projectId, current);
    const returnPoint = model.returnPoints
      .filter((point) => point.workItemId === current.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const returnPointStale =
      !!returnPoint &&
      !!observation &&
      observation.snapshot.status === 'checked' &&
      returnPoint.basis !== observation.semanticKey;
    const possibleMatch = match?.confidence === 'possible';
    const currentState =
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
    let uncertainty = possibleMatch
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

    if (currentResult) {
      state = 'review';
      next = {
        kind: 'review-result',
        workItemId: current.id,
        requestId: currentResult.request.id,
        text: `Review the result for ${current.title}.`,
      };
    } else if (!primaryDirection) {
      state = 'needs-direction';
      next = {
        kind: 'define-direction',
        text: 'Confirm or define the current direction before choosing what should come next.',
      };
    } else if (current.state === 'completed') {
      const queued = this.queuedNext(current, model.workItems, model.relations);
      if (queued?.item) {
        next =
          queued.relation.state === 'needs-review'
            ? {
                kind: 'review-work-plan',
                workItemId: queued.item.id,
                text: `Re-check ${queued.item.title} before starting it.`,
              }
            : {
                kind: 'start-work',
                workItemId: queued.item.id,
                text: `Continue with ${queued.item.title}.`,
              };
      } else if (primaryDirection) {
        next = { kind: 'choose-next-work', text: 'Decide the next work for this direction.' };
      }
    } else if (current.state === 'waiting') {
      const alternative = this.waitingAlternative(
        current,
        model.workItems,
        model.relations,
        projectId,
      );
      if (alternative)
        next = {
          kind: 'start-work',
          workItemId: alternative.id,
          text: `Work on ${alternative.title} while this is waiting.`,
          reason:
            'It is independent and has relatively low restart cost from the available saved state.',
          confidence: 'medium',
        };
      secondaryActions.push({
        kind: 'stop-work',
        workItemId: current.id,
        text: `Stop ${current.title}.`,
      });
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
        : { kind: 'define-direction', text: 'Confirm or define the current direction.' };
    } else if (current.state === 'review') {
      next = { kind: 'review-work', workItemId: current.id, text: `Review ${current.title}.` };
      secondaryActions.push({
        kind: 'stop-work',
        workItemId: current.id,
        text: `Stop ${current.title}.`,
      });
    } else if (match?.proposal.state === 'done') {
      next = {
        kind: 'review-completion',
        workItemId: current.id,
        text: `Review whether ${current.title} is complete.`,
      };
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
      state,
      currentState,
      uncertainty,
      next,
      secondaryActions,
      notice,
      otherWorkCount,
      freshness: finalFreshness,
      proposalMatches: matches,
    };
  }
}
