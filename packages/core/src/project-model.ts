import {
  DomainError,
  directionSchema,
  projectRecordSchema,
  returnPointSchema,
  selectedCurrentWorkId,
  workDiscussionRecordSchema,
  workDiscussionSyncSchema,
  workDecisionKinds,
  workItemCreateSchema,
  workItemSchema,
  type Direction,
  type ProjectModelView,
  type ProjectIdentity,
  type WorkDiscussionSync,
  type WorkItemCreate,
  type WorkItem,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

/** Owns durable project identity, direction, work choices and return points. */
export class ProjectModel {
  constructor(private core: StateCarry) {}

  project(projectId: string): ProjectIdentity {
    return projectRecordSchema.strip().parse(this.core.project(projectId));
  }

  directions(projectId: string): Direction[] {
    this.project(projectId);
    return this.core.repo.list('direction').filter((item) => item.projectId === projectId);
  }

  initialized(projectId: string): boolean {
    this.project(projectId);
    return !!this.core.analysisRecord(projectId);
  }
  setDirection(projectId: string, rawText: string, finish = false, emit = true): ProjectModelView {
    this.project(projectId);
    const text = rawText.trim();
    if (!text || text.length > 1200)
      throw new DomainError('VALIDATION', 'Describe a direction in 1–1200 characters.');
    const now = this.core.clock.now();
    const active = this.core.repo
      .list('direction')
      .filter((item) => item.projectId === projectId && item.state === 'active');
    const current = active.find((item) => item.primary) ?? active[0] ?? null;
    const nextState: Direction['state'] = finish ? 'completed' : 'active';
    if (
      current &&
      current.text === text &&
      current.state === nextState &&
      current.primary === !finish &&
      current.confirmed
    )
      return this.view(projectId);
    this.core.repo.transaction(() => {
      for (const direction of active) {
        if (direction.id === current?.id && direction.text === text) continue;
        this.core.repo.put('direction', {
          ...direction,
          state: 'stopped',
          primary: false,
          endedAt: now,
        });
      }
      if (current?.text === text)
        this.core.repo.put('direction', {
          ...current,
          state: nextState,
          primary: !finish,
          origin: 'user',
          confirmed: true,
          ...(finish ? { endedAt: now } : { endedAt: null }),
        });
      else
        this.core.repo.put(
          'direction',
          directionSchema.parse({
            id: this.core.ids.next(),
            projectId,
            text,
            state: nextState,
            primary: !finish,
            origin: 'user',
            confirmed: true,
            createdAt: now,
            ...(finish ? { endedAt: now } : {}),
          }),
        );
    });
    if (emit) this.core.events.changed(projectId);
    return this.view(projectId);
  }

  view(projectId: string): ProjectModelView {
    const project = this.project(projectId);
    return {
      project,
      directions: this.directions(projectId),
      workItems: this.core.repo.list('workItem').filter((item) => item.projectId === projectId),
      relations: this.core.repo.list('workRelation').filter((item) => item.projectId === projectId),
      decisions: this.core.repo.list('workDecision').filter((item) => item.projectId === projectId),
      returnPoints: this.core.repo
        .list('returnPoint')
        .filter((item) => item.projectId === projectId),
      discussions: this.core.repo
        .list('workDiscussion')
        .filter((item) => item.projectId === projectId),
      latestObservation: this.core.projects.latestObservation(projectId),
    };
  }

  selectProposal(projectId: string, proposalKey: string): ProjectModelView {
    this.project(projectId);
    const proposal = this.core.workMatcher.proposalForSelection(projectId, proposalKey);
    if (!proposal)
      throw new DomainError('NOT_FOUND', 'The selected proposal is no longer available.', 404);
    const linkedWorkIds = this.core.workMatcher.linkedWorkIdsForProposal(projectId, proposal);
    if (linkedWorkIds.size > 1)
      throw new DomainError(
        'REVISION_CONFLICT',
        'This interpretation is linked to conflicting work. Review the connection first.',
        409,
      );
    const matched = this.core.workMatcher
      .match(projectId)
      .find(
        (item) =>
          (item.proposal.key === proposal.key &&
            item.proposal.source === proposal.source &&
            item.proposal.evidenceBasis === proposal.evidenceBasis) ||
          item.aliases?.some(
            (alias) =>
              alias.key === proposal.key &&
              alias.source === proposal.source &&
              alias.evidenceBasis === proposal.evidenceBasis,
          ),
      );
    // An explicitly selected migration proposal is intentionally selectable
    // even when it is not a current automatic candidate. It remains
    // unmatched until this selection records the durable connection.
    const match =
      matched ??
      (proposal.source === 'analysis-candidate'
        ? {
            proposal,
            workItemId: null,
            confidence: 'unmatched' as const,
            reason: 'This saved migration proposal needs an explicit user selection.',
          }
        : null);
    if (!match)
      throw new DomainError('REVISION_CONFLICT', 'This work connection needs review.', 409);
    // A proposal key is producer-local wording, not durable Work identity.
    // Only an exact current expression can reuse its deterministic selection
    // record; a reused key on a new basis must start a separate Work.
    const proposalIdentity = [
      projectId,
      proposal.key,
      proposal.source,
      proposal.evidenceBasis,
    ] as const;
    const proposalWorkItemId = this.core.ids.hash(['proposal-work-item', ...proposalIdentity]);
    const existingId = match.workItemId ?? proposalWorkItemId;
    const existing = existingId ? this.core.repo.get('workItem', existingId) : null;
    const hasExactLink = this.core.repo
      .list('workDecision')
      .some(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.linkWorkProposal &&
          decision.workItemId === existingId &&
          decision.value.proposalKey === proposal.key &&
          decision.value.proposalSource === proposal.source &&
          decision.value.proposalEvidenceBasis === proposal.evidenceBasis,
      );
    const alreadyCurrent =
      !!existing &&
      this.core.repo
        .list('workDecision')
        .some(
          (decision) =>
            decision.projectId === projectId &&
            decision.kind === workDecisionKinds.selectCurrentWork &&
            decision.state === 'valid' &&
            selectedCurrentWorkId(decision) === existing.id,
        );
    const now = this.core.clock.now();
    const item: WorkItem =
      existing ??
      workItemSchema.parse({
        id: proposalWorkItemId,
        projectId,
        title: proposal.title,
        state:
          proposal.state === 'done'
            ? 'completed'
            : proposal.state === 'unclear'
              ? 'review'
              : proposal.state,
        origin: 'reconstructed',
        completionCondition: proposal.doneWhen,
        completionConditionOrigin: proposal.doneWhen ? 'suggested' : null,
        createdAt: now,
        updatedAt: now,
      });
    this.core.repo.transaction(() => {
      if (!existing) this.core.repo.put('workItem', item);
      if (!hasExactLink)
        this.core.repo.put('workDecision', {
          id: this.core.ids.hash(['link-work-proposal', ...proposalIdentity]),
          projectId,
          workItemId: item.id,
          kind: workDecisionKinds.linkWorkProposal,
          value: {
            proposalKey,
            proposalSource: proposal.source,
            proposalEvidenceBasis: proposal.evidenceBasis,
            proposalEvidence: proposal.evidence ?? [],
            proposalEvidenceQuotes: proposal.evidenceQuotes ?? [],
            proposalOutputLanguage: this.core.workMatcher.proposalOutputLanguage(
              projectId,
              proposal,
            ),
            proposalEvidenceContext: {
              title: proposal.title,
              currentState: proposal.currentState,
              uncertainty: proposal.uncertainty,
              nextAction: proposal.nextAction,
              doneWhen: proposal.doneWhen,
            },
          },
          basis: proposal.evidenceBasis ? [proposal.evidenceBasis] : [],
          state: 'valid',
          decidedAt: now,
        });
      this.selectCurrentWork(projectId, item.id, false);
    });
    if (!existing || !alreadyCurrent || !hasExactLink) this.core.events.changed(projectId);
    return this.view(projectId);
  }

  createWork(projectId: string, input: WorkItemCreate, requestId: string): ProjectModelView {
    this.project(projectId);
    const value = workItemCreateSchema.parse(input);
    const id = this.core.ids.hash(['user-work-item', projectId, requestId]);
    const existing = this.core.repo.get('workItem', id);
    if (existing) {
      this.selectCurrentWork(projectId, id);
      return this.view(projectId);
    }
    const now = this.core.clock.now();
    const item = workItemSchema.parse({
      id,
      projectId,
      title: value.title,
      state: 'active',
      origin: 'user',
      completionCondition: value.completionCondition ?? null,
      completionConditionOrigin: value.completionCondition ? 'user' : null,
      createdAt: now,
      updatedAt: now,
    });
    this.core.repo.transaction(() => {
      this.core.repo.put('workItem', item);
      this.selectCurrentWork(projectId, item.id, false);
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  selectCurrentWork(projectId: string, workItemId: string, emit = true): ProjectModelView {
    this.project(projectId);
    const item = this.core.repo.get('workItem', workItemId);
    if (!item || item.projectId !== projectId)
      throw new DomainError('NOT_FOUND', 'The selected work is no longer available.', 404);
    const alreadySelected = this.core.repo
      .list('workDecision')
      .some(
        (decision) =>
          decision.projectId === projectId &&
          decision.kind === workDecisionKinds.selectCurrentWork &&
          decision.state === 'valid' &&
          selectedCurrentWorkId(decision) === workItemId,
      );
    if (alreadySelected) return this.view(projectId);
    const previous = this.core.repo
      .list('workDecision')
      .filter(
        (decision) =>
          decision.projectId === projectId &&
          decision.kind === workDecisionKinds.selectCurrentWork &&
          decision.state === 'valid',
      )
      .filter((decision) => selectedCurrentWorkId(decision) !== null)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
    const previousId = previous ? selectedCurrentWorkId(previous) : null;
    if (previousId && previousId !== workItemId) this.recordReturnPoint(projectId, previousId);
    const now = this.core.clock.now();
    this.core.repo.transaction(() => {
      for (const decision of this.core.repo.list('workDecision')) {
        if (
          decision.projectId === projectId &&
          decision.kind === workDecisionKinds.selectCurrentWork &&
          decision.state === 'valid'
        )
          this.core.repo.put('workDecision', { ...decision, state: 'superseded' });
      }
      this.core.repo.put('workDecision', {
        id: this.core.ids.next(),
        projectId,
        workItemId,
        kind: workDecisionKinds.selectCurrentWork,
        value: { workItemId },
        basis: [],
        state: 'valid',
        decidedAt: now,
      });
    });
    if (emit) this.core.events.changed(projectId);
    return this.view(projectId);
  }

  private transitionWork(
    projectId: string,
    workItemId: string,
    target: WorkItem['state'],
    kind:
      | typeof workDecisionKinds.pauseWork
      | typeof workDecisionKinds.resumeWork
      | typeof workDecisionKinds.completeWork
      | typeof workDecisionKinds.stopWork,
    allowed: readonly WorkItem['state'][],
  ): ProjectModelView {
    this.project(projectId);
    const item = this.core.repo.get('workItem', workItemId);
    if (!item || item.projectId !== projectId)
      throw new DomainError('NOT_FOUND', 'The selected work is no longer available.', 404);
    if (item.state === target) return this.view(projectId);
    if (!allowed.includes(item.state))
      throw new DomainError('VALIDATION', `This work cannot move from ${item.state} to ${target}.`);
    const now = this.core.clock.now();
    const decisionId = this.core.ids.hash([kind, projectId, workItemId]);
    const transitionKinds = new Set<string>([
      workDecisionKinds.pauseWork,
      workDecisionKinds.resumeWork,
      workDecisionKinds.completeWork,
      workDecisionKinds.stopWork,
    ]);
    this.core.repo.transaction(() => {
      this.core.repo.put('workItem', { ...item, state: target, updatedAt: now });
      for (const decision of this.core.repo.list('workDecision'))
        if (
          decision.projectId === projectId &&
          decision.workItemId === workItemId &&
          transitionKinds.has(decision.kind) &&
          decision.state === 'valid'
        )
          this.core.repo.put('workDecision', { ...decision, state: 'superseded' });
      this.core.repo.put('workDecision', {
        id: decisionId,
        projectId,
        workItemId,
        kind,
        value: { state: target },
        basis: [],
        state: 'valid',
        decidedAt: now,
      });
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  pauseWork(projectId: string, workItemId: string): ProjectModelView {
    return this.transitionWork(projectId, workItemId, 'paused', workDecisionKinds.pauseWork, [
      'active',
      'waiting',
      'review',
    ]);
  }

  resumeWork(projectId: string, workItemId: string): ProjectModelView {
    return this.transitionWork(projectId, workItemId, 'active', workDecisionKinds.resumeWork, [
      'paused',
    ]);
  }

  completeWork(projectId: string, workItemId: string): ProjectModelView {
    return this.transitionWork(projectId, workItemId, 'completed', workDecisionKinds.completeWork, [
      'active',
      'waiting',
      'review',
      'paused',
    ]);
  }

  stopWork(projectId: string, workItemId: string): ProjectModelView {
    return this.transitionWork(projectId, workItemId, 'stopped', workDecisionKinds.stopWork, [
      'active',
      'waiting',
      'review',
      'paused',
    ]);
  }

  private recordReturnPoint(projectId: string, workItemId: string) {
    const item = this.core.repo.get('workItem', workItemId);
    if (!item || item.projectId !== projectId || ['completed', 'stopped'].includes(item.state))
      return;
    const resolved = this.core.now.resolve(projectId);
    if (resolved.currentWorkId !== workItemId) return;
    const model = this.view(projectId);
    const observation = model.latestObservation;
    const basis =
      observation?.snapshot.status === 'checked'
        ? observation.semanticKey
        : `project-revision:${model.project.revision}`;
    const point = returnPointSchema.parse({
      id: this.core.ids.hash([
        'return-point',
        projectId,
        workItemId,
        basis,
        resolved.currentState,
        resolved.uncertainty,
        resolved.next?.text ?? null,
      ]),
      projectId,
      workItemId,
      basis,
      current: resolved.currentState,
      remaining: resolved.uncertainty,
      next: resolved.next?.text ?? null,
      createdAt: this.core.clock.now(),
    });
    if (!this.core.repo.get('returnPoint', point.id)) this.core.repo.put('returnPoint', point);
  }

  syncDiscussion(projectId: string, input: WorkDiscussionSync): ProjectModelView {
    this.project(projectId);
    const value = workDiscussionSyncSchema.parse(input);
    const item = this.core.repo.get('workItem', value.workItemId);
    if (!item || item.projectId !== projectId)
      throw new DomainError('NOT_FOUND', 'The discussion work is no longer available.', 404);
    const id = this.core.ids.hash(['work-discussion', projectId, value.workItemId]);
    const existing = this.core.repo.get('workDiscussion', id);
    const known = new Set((existing?.turns ?? []).map((turn) => this.core.ids.hash(turn)));
    const turns = [
      ...(existing?.turns ?? []),
      ...value.turns.filter((turn) => !known.has(this.core.ids.hash(turn))),
    ].slice(-10);
    if (
      existing &&
      existing.basis === value.basis &&
      JSON.stringify(existing.turns) === JSON.stringify(turns)
    )
      return this.view(projectId);
    const next = workDiscussionRecordSchema.parse({
      id,
      projectId,
      workItemId: value.workItemId,
      basis: value.basis,
      turns,
      updatedAt: this.core.clock.now(),
    });
    this.core.repo.put('workDiscussion', next);
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  continueDirectionConflict(projectId: string): ProjectModelView {
    this.project(projectId);
    const conflict = this.core.repo.get('projectScope', projectId)?.policyConflict;
    if (!conflict || conflict.status !== 'open')
      throw new DomainError('VALIDATION', 'There is no current direction conflict to override.');
    const conflictKey = this.core.ids.hash([
      'direction-conflict',
      conflict.description,
      conflict.source,
    ]);
    const existing = this.core.repo
      .list('workDecision')
      .find(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.continueDirectionConflict &&
          decision.value.conflictKey === conflictKey,
      );
    if (existing) return this.view(projectId);
    const current = this.core.repo
      .list('workDecision')
      .filter(
        (decision) =>
          decision.projectId === projectId &&
          decision.state === 'valid' &&
          decision.kind === workDecisionKinds.selectCurrentWork,
      )
      .filter((decision) => selectedCurrentWorkId(decision) !== null)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
    const workItemId = current ? selectedCurrentWorkId(current) : null;
    this.core.repo.put('workDecision', {
      id: this.core.ids.hash(['continue-direction-conflict', projectId, conflictKey]),
      projectId,
      workItemId,
      kind: workDecisionKinds.continueDirectionConflict,
      value: { conflictKey },
      basis: [conflictKey],
      state: 'valid',
      decidedAt: this.core.clock.now(),
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }
}
