import { z } from 'zod';

const id = z.string().min(1).max(250);
const timestamp = z.string().datetime({ offset: true });

export const releaseTargetRuleSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    required: z.boolean(),
  })
  .strict();
export type ReleaseTargetRule = z.infer<typeof releaseTargetRuleSchema>;

const targetRulesSchema = z
  .array(releaseTargetRuleSchema)
  .min(1)
  .max(12)
  .superRefine((targets, ctx) => {
    if (new Set(targets.map((target) => target.key)).size !== targets.length)
      ctx.addIssue({ code: 'custom', message: 'Release target keys must be unique.' });
    if (!targets.some((target) => target.required))
      ctx.addIssue({ code: 'custom', message: 'At least one release target must be required.' });
  });

export const releasePolicyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timing: z.string().trim().max(500).nullable().default(null),
    channel: z.string().trim().max(160).nullable().default(null),
    requiredChecks: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    inclusionRule: z.enum(['ready-only', 'explicit']).default('ready-only'),
    targets: targetRulesSchema,
    completionMode: z.enum(['automatic', 'user-confirmation']).default('user-confirmation'),
    postReleaseVerification: z.enum(['none', 'risk-based', 'required']).default('risk-based'),
  })
  .strict();
export type ReleasePolicyInput = z.infer<typeof releasePolicyInputSchema>;

export const releasePolicySchema = releasePolicyInputSchema
  .extend({ id, projectId: id, createdAt: timestamp, updatedAt: timestamp })
  .strict();
export type ReleasePolicy = z.infer<typeof releasePolicySchema>;

export const releaseBatchStateSchema = z.enum([
  'planned',
  'delivering',
  'partial',
  'awaiting-confirmation',
  'completed',
  'rolled-back',
]);
export type ReleaseBatchState = z.infer<typeof releaseBatchStateSchema>;

export const releaseCheckSchema = z
  .object({
    id,
    label: z.string().trim().min(1).max(300),
    phase: z.enum(['pre-delivery', 'post-delivery']),
    state: z.enum(['pending', 'passed', 'failed']),
    detail: z.string().trim().max(2000).nullable(),
  })
  .strict();
export type ReleaseCheck = z.infer<typeof releaseCheckSchema>;

export const releaseBatchSchema = z
  .object({
    id,
    projectId: id,
    policyId: id.nullable(),
    exceptionId: id.nullable(),
    title: z.string().trim().min(1).max(160),
    workItemIds: z.array(id).min(1).max(100),
    completionMode: z.enum(['automatic', 'user-confirmation']),
    checks: z.array(releaseCheckSchema).max(24),
    state: releaseBatchStateSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp.nullable(),
  })
  .strict();
export type ReleaseBatch = z.infer<typeof releaseBatchSchema>;

export const deliveryTargetStateSchema = z.enum([
  'pending',
  'delivering',
  'succeeded',
  'failed',
  'rolled-back',
]);
export type DeliveryTargetState = z.infer<typeof deliveryTargetStateSchema>;

export const deliveryTargetSchema = z
  .object({
    id,
    projectId: id,
    releaseId: id,
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    required: z.boolean(),
    state: deliveryTargetStateSchema,
    detail: z.string().trim().max(2000).nullable(),
    updatedAt: timestamp,
  })
  .strict();
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;

export const releaseCreateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    workItemIds: z.array(id).min(1).max(100),
    targets: targetRulesSchema.optional(),
    exceptionId: id.nullable().optional(),
  })
  .strict();
export type ReleaseCreateInput = z.infer<typeof releaseCreateInputSchema>;

export const deliveryTargetUpdateSchema = z
  .object({
    targetId: id,
    state: z.enum(['delivering', 'succeeded', 'failed', 'rolled-back']),
    detail: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type DeliveryTargetUpdate = z.infer<typeof deliveryTargetUpdateSchema>;

export const releaseCheckUpdateSchema = z
  .object({
    checkId: id,
    state: z.enum(['pending', 'passed', 'failed']),
    detail: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type ReleaseCheckUpdate = z.infer<typeof releaseCheckUpdateSchema>;

export const releasePolicyExceptionInputSchema = z
  .object({ reason: z.string().trim().min(1).max(1200) })
  .strict();
export type ReleasePolicyExceptionInput = z.infer<typeof releasePolicyExceptionInputSchema>;

export const releasePolicyExceptionSchema = z
  .object({
    id,
    projectId: id,
    policyId: id,
    reason: z.string().trim().min(1).max(1200),
    state: z.enum(['active', 'used', 'superseded']),
    createdAt: timestamp,
  })
  .strict();
export type ReleasePolicyException = z.infer<typeof releasePolicyExceptionSchema>;

export type ReleaseProjectView = {
  policy: ReleasePolicy | null;
  policyNeedsReview: boolean;
  batches: ReleaseBatch[];
  targets: DeliveryTarget[];
  exceptions: ReleasePolicyException[];
  pendingWork: Array<{ id: string; title: string }>;
};
