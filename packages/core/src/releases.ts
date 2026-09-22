import {
  DomainError,
  deliveryTargetSchema,
  deliveryTargetUpdateSchema,
  releaseBatchSchema,
  releaseCheckSchema,
  releaseCheckUpdateSchema,
  releaseCreateInputSchema,
  releasePolicyExceptionInputSchema,
  releasePolicyExceptionSchema,
  releasePolicyInputSchema,
  releasePolicySchema,
  type DeliveryTarget,
  type ReleaseBatch,
  type ReleaseCreateInput,
  type ReleasePolicyInput,
  type ReleasePolicyExceptionInput,
  type ReleaseProjectView,
  type ReleaseTargetRule,
  type ReleaseCheckUpdate,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

export type ReleaseAttention = {
  kind: 'ready' | 'in-progress' | 'confirm' | 'problem';
  releaseId: string | null;
  text: string;
  reason: string;
};

function sameTargets(a: ReleaseTargetRule[], b: ReleaseTargetRule[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Releases {
  constructor(private core: StateCarry) {}

  policy(projectId: string) {
    this.core.projectModel.project(projectId);
    return (
      [...this.core.repo.list('releasePolicy')]
        .reverse()
        .filter((policy) => policy.projectId === projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }

  setPolicy(projectId: string, input: ReleasePolicyInput) {
    this.core.projectModel.project(projectId);
    const value = releasePolicyInputSchema.parse(input);
    const now = this.core.clock.now();
    const id = this.core.ids.hash(['release-policy', projectId, value]);
    const existing = this.core.repo.get('releasePolicy', id);
    if (existing) return existing;
    const policy = releasePolicySchema.parse({
      ...value,
      id,
      projectId,
      createdAt: now,
      updatedAt: now,
    });
    this.core.repo.put('releasePolicy', policy);
    this.core.events.changed(projectId);
    return policy;
  }

  createException(projectId: string, input: ReleasePolicyExceptionInput, requestId: string) {
    const policy = this.policy(projectId);
    if (!policy)
      throw new DomainError(
        'VALIDATION',
        'A release policy must exist before recording a policy exception.',
      );
    const value = releasePolicyExceptionInputSchema.parse(input);
    const id = this.core.ids.hash(['release-policy-exception', projectId, requestId]);
    const existing = this.core.repo.get('releasePolicyException', id);
    if (existing) return existing;
    const exception = releasePolicyExceptionSchema.parse({
      id,
      projectId,
      policyId: policy.id,
      reason: value.reason,
      state: 'active',
      createdAt: this.core.clock.now(),
    });
    this.core.repo.put('releasePolicyException', exception);
    this.core.events.changed(projectId);
    return exception;
  }

  policyNeedsReview(projectId: string) {
    const policy = this.policy(projectId);
    if (!policy) return false;
    return (
      this.core.repo
        .list('releasePolicyException')
        .filter(
          (item) =>
            item.projectId === projectId &&
            item.policyId === policy.id &&
            item.state !== 'superseded',
        ).length >= 2
    );
  }

  private targetsForRelease(
    projectId: string,
    input: ReleaseCreateInput,
    policy: ReturnType<Releases['policy']>,
  ) {
    const exception = input.exceptionId
      ? this.core.repo.get('releasePolicyException', input.exceptionId)
      : null;
    if (input.exceptionId) {
      if (
        !exception ||
        exception.projectId !== projectId ||
        exception.policyId !== policy?.id ||
        exception.state !== 'active'
      )
        throw new DomainError('VALIDATION', 'The selected release policy exception is not active.');
    }
    if (!policy) {
      if (!input.targets)
        throw new DomainError(
          'VALIDATION',
          'Choose delivery targets when no release policy is configured.',
        );
      return { targets: input.targets, exception: null };
    }
    if (input.targets && !sameTargets(input.targets, policy.targets) && !exception)
      throw new DomainError(
        'VALIDATION',
        'A policy exception is required to change the configured delivery targets.',
      );
    return { targets: input.targets ?? policy.targets, exception };
  }

  createRelease(
    projectId: string,
    input: ReleaseCreateInput,
    requestId: string,
  ): ReleaseProjectView {
    this.core.projectModel.project(projectId);
    const value = releaseCreateInputSchema.parse(input);
    const workIds = [...new Set(value.workItemIds)];
    const id = this.core.ids.hash(['release-batch', projectId, requestId]);
    if (this.core.repo.get('releaseBatch', id)) return this.view(projectId);
    const workItems = workIds.map((id) => this.core.repo.get('workItem', id));
    if (
      workItems.some(
        (item, index) =>
          !item ||
          item.projectId !== projectId ||
          item.id !== workIds[index] ||
          item.state !== 'completed',
      )
    )
      throw new DomainError(
        'VALIDATION',
        'Only completed work from this project can be included in a release.',
      );
    const unavailable = workIds.find(
      (workItemId) =>
        this.deliveryState(projectId, workItemId) === 'delivered' ||
        this.core.repo
          .list('releaseBatch')
          .some(
            (batch) =>
              batch.projectId === projectId &&
              batch.workItemIds.includes(workItemId) &&
              !['completed', 'rolled-back'].includes(batch.state),
          ),
    );
    if (unavailable)
      throw new DomainError(
        'VALIDATION',
        'Only delivery-pending completed work can be added to a new release.',
      );

    const policy = this.policy(projectId);
    const { targets, exception } = this.targetsForRelease(projectId, value, policy);
    const now = this.core.clock.now();
    const checks = [...new Set(policy?.requiredChecks ?? [])].map((label) =>
      releaseCheckSchema.parse({
        id: this.core.ids.hash(['release-check', id, label]),
        label,
        phase: 'pre-delivery',
        state: 'pending',
        detail: null,
      }),
    );
    if (policy?.postReleaseVerification === 'required')
      checks.push(
        releaseCheckSchema.parse({
          id: this.core.ids.hash(['release-check', id, 'post-release-verification']),
          label: 'Post-release behavior verification',
          phase: 'post-delivery',
          state: 'pending',
          detail: null,
        }),
      );
    const batch = releaseBatchSchema.parse({
      id,
      projectId,
      policyId: policy?.id ?? null,
      exceptionId: exception?.id ?? null,
      title: value.title,
      workItemIds: workIds,
      completionMode: policy?.completionMode ?? 'user-confirmation',
      checks,
      state: 'planned',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    this.core.repo.transaction(() => {
      this.core.repo.put('releaseBatch', batch);
      for (const target of targets)
        this.core.repo.put(
          'deliveryTarget',
          deliveryTargetSchema.parse({
            id: this.core.ids.hash(['delivery-target', id, target.key]),
            projectId,
            releaseId: id,
            key: target.key,
            label: target.label,
            required: target.required,
            state: 'pending',
            detail: null,
            updatedAt: now,
          }),
        );
      if (exception) this.core.repo.put('releasePolicyException', { ...exception, state: 'used' });
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  private batch(projectId: string, releaseId: string) {
    const batch = this.core.repo.get('releaseBatch', releaseId);
    if (!batch || batch.projectId !== projectId)
      throw new DomainError('NOT_FOUND', 'The release is no longer available.', 404);
    return batch;
  }

  private recompute(batch: ReleaseBatch, targets: DeliveryTarget[]) {
    const required = targets.filter((target) => target.required);
    const anyRequiredRollback = required.some((target) => target.state === 'rolled-back');
    const anyRequiredFailure = required.some((target) => target.state === 'failed');
    const allRequiredSucceeded = required.every((target) => target.state === 'succeeded');
    const anyStarted = targets.some((target) => target.state !== 'pending');
    const anyCheckFailure = batch.checks.some((check) => check.state === 'failed');
    const allChecksPassed = batch.checks.every((check) => check.state === 'passed');
    const anyCheckStarted = batch.checks.some((check) => check.state !== 'pending');
    const now = this.core.clock.now();
    let state: ReleaseBatch['state'];
    let completedAt = batch.completedAt;
    if (anyRequiredRollback) state = 'rolled-back';
    else if (anyRequiredFailure || anyCheckFailure) state = 'partial';
    else if (allRequiredSucceeded && allChecksPassed) {
      state = batch.completionMode === 'automatic' ? 'completed' : 'awaiting-confirmation';
      if (state === 'completed') completedAt = completedAt ?? now;
    } else state = anyStarted || anyCheckStarted ? 'delivering' : 'planned';
    return releaseBatchSchema.parse({ ...batch, state, updatedAt: now, completedAt });
  }

  updateTarget(projectId: string, releaseId: string, input: unknown): ReleaseProjectView {
    const batch = this.batch(projectId, releaseId);
    if (batch.state === 'completed' && (input as { state?: string })?.state !== 'rolled-back')
      throw new DomainError('VALIDATION', 'A completed release can only be rolled back.');
    const value = deliveryTargetUpdateSchema.parse(input);
    const target = this.core.repo.get('deliveryTarget', value.targetId);
    if (!target || target.projectId !== projectId || target.releaseId !== releaseId)
      throw new DomainError('NOT_FOUND', 'The delivery target is no longer available.', 404);
    if (target.state === 'rolled-back')
      throw new DomainError(
        'VALIDATION',
        'A rolled-back target requires a new release before it can be delivered again.',
      );
    if (value.state === 'rolled-back' && target.state !== 'succeeded')
      throw new DomainError(
        'VALIDATION',
        'Only a successfully delivered target can be recorded as rolled back.',
      );
    const now = this.core.clock.now();
    const nextTarget = deliveryTargetSchema.parse({
      ...target,
      state: value.state,
      detail: value.detail ?? null,
      updatedAt: now,
    });
    this.core.repo.transaction(() => {
      this.core.repo.put('deliveryTarget', nextTarget);
      const targets = this.core.repo
        .list('deliveryTarget')
        .filter((item) => item.releaseId === releaseId)
        .map((item) => (item.id === nextTarget.id ? nextTarget : item));
      this.core.repo.put('releaseBatch', this.recompute(batch, targets));
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  updateCheck(projectId: string, releaseId: string, input: ReleaseCheckUpdate): ReleaseProjectView {
    const batch = this.batch(projectId, releaseId);
    if (batch.state === 'completed')
      throw new DomainError('VALIDATION', 'A completed release check cannot be changed.');
    const value = releaseCheckUpdateSchema.parse(input);
    const existing = batch.checks.find((check) => check.id === value.checkId);
    if (!existing)
      throw new DomainError('NOT_FOUND', 'The release check is no longer available.', 404);
    const targets = this.core.repo
      .list('deliveryTarget')
      .filter((target) => target.releaseId === releaseId);
    if (
      existing.phase === 'post-delivery' &&
      value.state !== 'pending' &&
      !targets.filter((target) => target.required).every((target) => target.state === 'succeeded')
    )
      throw new DomainError(
        'VALIDATION',
        'Post-release verification can be recorded only after required delivery targets succeed.',
      );
    const checks = batch.checks.map((check) =>
      check.id === value.checkId
        ? releaseCheckSchema.parse({ ...check, state: value.state, detail: value.detail ?? null })
        : check,
    );
    this.core.repo.put(
      'releaseBatch',
      this.recompute(releaseBatchSchema.parse({ ...batch, checks }), targets),
    );
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  confirmRelease(projectId: string, releaseId: string): ReleaseProjectView {
    const batch = this.batch(projectId, releaseId);
    if (batch.state !== 'awaiting-confirmation')
      throw new DomainError(
        'VALIDATION',
        'This release is not waiting for completion confirmation.',
      );
    const now = this.core.clock.now();
    this.core.repo.put('releaseBatch', {
      ...batch,
      state: 'completed',
      updatedAt: now,
      completedAt: now,
    });
    this.core.events.changed(projectId);
    return this.view(projectId);
  }

  deliveryState(projectId: string, workItemId: string): 'pending' | 'delivered' {
    const item = this.core.repo.get('workItem', workItemId);
    if (!item || item.projectId !== projectId || item.state !== 'completed') return 'pending';
    const latest = [...this.core.repo.list('releaseBatch')]
      .reverse()
      .filter((batch) => batch.projectId === projectId && batch.workItemIds.includes(workItemId))
      .sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt),
      )[0];
    return latest?.state === 'completed' ? 'delivered' : 'pending';
  }

  view(projectId: string): ReleaseProjectView {
    this.core.projectModel.project(projectId);
    const batches = [...this.core.repo.list('releaseBatch')]
      .reverse()
      .filter((batch) => batch.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const pendingWork = this.core.repo
      .list('workItem')
      .filter(
        (item) =>
          item.projectId === projectId &&
          item.state === 'completed' &&
          this.deliveryState(projectId, item.id) === 'pending',
      )
      .map((item) => ({ id: item.id, title: item.title }));
    return {
      policy: this.policy(projectId),
      policyNeedsReview: this.policyNeedsReview(projectId),
      batches,
      targets: this.core.repo
        .list('deliveryTarget')
        .filter((target) => target.projectId === projectId),
      exceptions: this.core.repo
        .list('releasePolicyException')
        .filter((exception) => exception.projectId === projectId),
      pendingWork,
    };
  }

  attention(projectId: string): ReleaseAttention | null {
    const view = this.view(projectId);
    const active =
      view.batches.find((batch) => !['completed', 'rolled-back'].includes(batch.state)) ??
      view.batches.find(
        (batch) =>
          batch.state === 'rolled-back' &&
          batch.workItemIds.some(
            (workItemId) => this.deliveryState(projectId, workItemId) === 'pending',
          ),
      );
    if (active) {
      if (active.state === 'partial' || active.state === 'rolled-back')
        return {
          kind: 'problem',
          releaseId: active.id,
          text:
            active.state === 'rolled-back'
              ? `${active.title} was rolled back.`
              : `${active.title} has a required delivery target that failed.`,
          reason:
            'Implementation work remains complete; delivery needs a separate decision before these changes are considered delivered.',
        };
      if (active.state === 'awaiting-confirmation')
        return {
          kind: 'confirm',
          releaseId: active.id,
          text: `${active.title} reached its required delivery targets.`,
          reason: 'The release policy requires explicit completion confirmation.',
        };
      return {
        kind: 'in-progress',
        releaseId: active.id,
        text: `${active.title} is still being delivered.`,
        reason: 'Delivery targets are tracked independently until the release is complete.',
      };
    }
    if (view.policy && view.pendingWork.length)
      return {
        kind: 'ready',
        releaseId: null,
        text: `${view.pendingWork.length} completed work item${view.pendingWork.length === 1 ? '' : 's'} are ready for delivery review.`,
        reason:
          'A release policy is configured and these completed changes are not currently delivered.',
      };
    return null;
  }
}
