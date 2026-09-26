import { z } from 'zod';
import type { ProjectObservation } from './workspace';

const id = z.string().min(1).max(250);
const text = z.string().trim().min(1).max(2000);
const timestamp = z.string().datetime({ offset: true });

export const projectPurposeSchema = z
  .object({
    id,
    text: text.max(1200),
    origin: z.enum(['user', 'suggested']),
    confirmed: z.boolean(),
  })
  .strict();
export type ProjectPurpose = z.infer<typeof projectPurposeSchema>;

/** Canonical persisted project registration and public identity. */
export const projectRecordSchema = z
  .object({
    id,
    connectionId: id,
    title: z.string().trim().min(1).max(120),
    cwd: z.string().min(1).max(2000),
    purposes: z.array(projectPurposeSchema).max(12),
    focused: z.boolean(),
    responseLanguage: z.enum(['en', 'ko']).optional(),
    iconAsset: z.string().max(120).nullable(),
    bannerAsset: z.string().max(120).nullable(),
    lifecycle: z.enum(['active', 'disconnected']),
    revision: z.number().int().nonnegative(),
    createdAt: timestamp,
  })
  .strict();
export type ProjectIdentity = z.infer<typeof projectRecordSchema>;

export const directionSchema = z
  .object({
    id,
    projectId: id,
    text: text.max(1200),
    state: z.enum(['active', 'completed', 'stopped']),
    primary: z.boolean(),
    origin: z.enum(['user', 'suggested']),
    confirmed: z.boolean(),
    createdAt: timestamp,
    endedAt: timestamp.nullable().optional(),
  })
  .strict();
export type Direction = z.infer<typeof directionSchema>;

export const workItemSchema = z
  .object({
    id,
    projectId: id,
    title: z.string().trim().min(1).max(160),
    state: z.enum(['active', 'waiting', 'review', 'paused', 'completed', 'stopped']),
    origin: z.enum(['user', 'reconstructed']),
    completionCondition: z.string().trim().min(1).max(1200).nullable().optional(),
    completionConditionOrigin: z.enum(['user', 'suggested']).nullable().optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type WorkItem = z.infer<typeof workItemSchema>;

/** Work states that may be shown as unfinished-work candidates. */
export const openWorkStates = ['active', 'waiting', 'review', 'paused'] as const;

export function isOpenWork(item: Pick<WorkItem, 'state'>): boolean {
  return openWorkStates.includes(item.state as (typeof openWorkStates)[number]);
}

export const workItemCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    completionCondition: z.string().trim().min(1).max(1200).nullable().optional(),
  })
  .strict();
export type WorkItemCreate = z.infer<typeof workItemCreateSchema>;

export const workRelationSchema = z
  .object({
    id,
    projectId: id,
    fromWorkId: id,
    toWorkId: id,
    kind: z.enum(['blocks', 'next-after', 'overlaps']),
    state: z.enum(['active', 'resolved', 'needs-review']),
    basis: z.string().max(512).nullable().optional(),
    confirmedByUser: z.boolean(),
    createdAt: timestamp,
  })
  .strict();
export type WorkRelation = z.infer<typeof workRelationSchema>;

export const workDecisionSchema = z
  .object({
    id,
    projectId: id,
    workItemId: id.nullable().optional(),
    kind: z.string().trim().min(1).max(80),
    value: z.record(z.string().min(1).max(120), z.unknown()).default({}),
    basis: z.array(z.string().min(1).max(512)).max(50).default([]),
    state: z.enum(['valid', 'needs-review', 'superseded']),
    decidedAt: timestamp,
  })
  .strict();
export type WorkDecision = z.infer<typeof workDecisionSchema>;

export const returnPointSchema = z
  .object({
    id,
    projectId: id,
    workItemId: id,
    basis: z.string().min(1).max(512),
    current: z.string().trim().min(1).max(1200),
    remaining: z.string().trim().min(1).max(1200).nullable(),
    next: z.string().trim().min(1).max(1200).nullable(),
    createdAt: timestamp,
  })
  .strict();
export type ReturnPoint = z.infer<typeof returnPointSchema>;

const workDiscussionNatureSchema = z.enum([
  'user-request',
  'user-decision',
  'agent-report',
  'agent-interpretation',
  'agent-proposal',
  'tool-result',
  'file-observation',
]);

export const workDiscussionAnswerSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['record', 'interpretation']),
            nature: workDiscussionNatureSchema,
            text: z.string().max(1500),
            uncertainty: z.string().max(600),
            evidence: z.array(id).max(6),
          })
          .strict(),
      )
      .max(8),
    unknowns: z.array(z.string().max(600)).max(5),
    limitations: z.array(z.string().max(1200)).max(8),
  })
  .strict();
export type WorkDiscussionAnswer = z.infer<typeof workDiscussionAnswerSchema>;

export const workDiscussionTurnSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    answer: workDiscussionAnswerSchema,
    basis: z.string().min(1).max(512),
  })
  .strict();
export type WorkDiscussionTurn = z.infer<typeof workDiscussionTurnSchema>;

export const workDiscussionRecordSchema = z
  .object({
    id,
    projectId: id,
    workItemId: id,
    basis: z.string().min(1).max(512),
    turns: z.array(workDiscussionTurnSchema).max(10),
    updatedAt: timestamp,
  })
  .strict();
export type WorkDiscussionRecord = z.infer<typeof workDiscussionRecordSchema>;

export const workDiscussionSyncSchema = z
  .object({
    workItemId: id,
    basis: z.string().min(1).max(512),
    turns: z.array(workDiscussionTurnSchema).max(10),
  })
  .strict();
export type WorkDiscussionSync = z.infer<typeof workDiscussionSyncSchema>;

export const workDecisionKinds = {
  selectCurrentWork: 'select-current-work',
  linkWorkProposal: 'link-work-proposal',
  executionForWork: 'execution-for-work',
  continueDirectionConflict: 'continue-direction-conflict',
  noCurrentDirection: 'no-current-direction',
  pauseWork: 'pause-work',
  resumeWork: 'resume-work',
  completeWork: 'complete-work',
  stopWork: 'stop-work',
} as const;

/**
 * A current-work decision is usable only when its durable record and payload
 * identify the same work item. Stale or malformed records cannot redirect a
 * return view.
 */
export function selectedCurrentWorkId(decision: WorkDecision): string | null {
  if (decision.kind !== workDecisionKinds.selectCurrentWork || decision.state !== 'valid')
    return null;
  const value = decision.value.workItemId;
  return typeof value === 'string' && value === decision.workItemId ? value : null;
}

export type WorkProposal = {
  key: string;
  source: 'analysis-candidate' | 'working-tree-group';
  title: string;
  state: 'active' | 'waiting' | 'paused' | 'unclear' | 'done';
  currentState: string;
  uncertainty: string | null;
  nextAction: string | null;
  doneWhen: string | null;
  evidenceBasis: string | null;
  /** Source references used only to establish continuity between proposals. */
  evidence?: string[];
  /** Exact source excerpts retained for conservative cross-producer continuity. */
  evidenceQuotes?: Array<{ revisionId: string; quote: string }>;
  /** Analysis proposals explicitly identified as the same work by the tree analyzer. */
  relatedProposalKeys?: string[];
  /** Claims retained in their output language for same-language continuity checks. */
  evidenceClaims?: string[];
};

export type WorkProposalMatch = {
  proposal: WorkProposal;
  /** Equivalent current source expressions retained with the displayed proposal. */
  aliases?: WorkProposal[];
  workItemId: string | null;
  confidence: 'explicit' | 'possible' | 'unmatched';
  reason: string;
};

export type WorkProposalDisposition = 'progress' | 'completion-review' | 'evidence-conflict';

/** Classify all current source expressions as one work group, without trusting its representative. */
export function classifyWorkProposalMatches(
  matches: readonly WorkProposalMatch[],
): WorkProposalDisposition {
  const proposals = matches.flatMap((match) => [match.proposal, ...(match.aliases ?? [])]);
  const hasDoneEvidence = proposals.some((proposal) => proposal.state === 'done');
  const hasProgressEvidence = proposals.some((proposal) =>
    ['active', 'waiting', 'paused'].includes(proposal.state),
  );
  if (hasDoneEvidence && hasProgressEvidence) return 'evidence-conflict';
  if (hasDoneEvidence) return 'completion-review';
  return 'progress';
}

/** Unlinked possible matches are one grouped choice, with aliases kept on that match. */
export function isUnlinkedWorkProposalMatch(match: WorkProposalMatch): boolean {
  return match.workItemId === null && match.confidence !== 'explicit';
}

export type ProjectNowAction = {
  kind:
    | 'reconnect-project'
    | 'review-direction'
    | 'review-result'
    | 'review-completion'
    | 'review-work'
    | 'discuss-work'
    | 'review-remaining-changes'
    | 'continue-work'
    | 'resume-work'
    | 'start-work'
    | 'review-work-plan'
    | 'choose-current-work'
    | 'choose-next-work'
    | 'define-direction'
    | 'review-release'
    | 'stop-work'
    | 'check-execution'
    | 'open-request'
    | 'respond-to-request'
    | 'continue-despite-direction-conflict';
  workItemId?: string;
  requestId?: string;
  releaseId?: string;
  text: string;
  reason?: string;
  confidence?: 'high' | 'medium' | 'low';
};

export type ProjectNowExecution = {
  workItemId: string;
  requestId: string;
  status:
    | 'checking'
    | 'running'
    | 'waiting'
    | 'unknown'
    | 'reported'
    | 'completed'
    | 'failed'
    | 'interrupted';
  actions: ProjectNowAction[];
};

export type ProjectNowNotice = {
  level: 'quiet' | 'attention' | 'immediate';
  kind:
    | 'result-ready'
    | 'direction-conflict'
    | 'integration-needed'
    | 'release-ready'
    | 'delivery-problem'
    | 'release-confirmation';
  workItemId?: string;
  requestId?: string;
  releaseId?: string;
  text: string;
  reason: string;
};

export type ProjectNowWorkCandidate =
  | {
      id: string;
      title: string;
      state: WorkItem['state'];
      source: 'work-item';
      disposition: WorkProposalDisposition;
    }
  | {
      id: string;
      title: string;
      state: 'proposal';
      source: 'proposal';
      disposition: WorkProposalDisposition;
      proposalState: WorkProposal['state'];
      currentState: string;
      uncertainty: string | null;
      nextAction: string | null;
    };

export type ProjectNowOtherWorkCounts = {
  total: number;
  progress: number;
  completionReview: number;
  evidenceConflict: number;
};

export type ProjectNowRecommendationEvidenceGap =
  | 'purpose-alignment'
  | 'direction-alignment'
  | 'user-impact'
  | 'user-priority'
  | 'long-term-benefit'
  | 'switching-cost'
  | 'dependency-coverage';

type ProjectNowRecommendationContext = {
  /** Distinguishes missing ranking evidence from a user's still-unselected work. */
  selectionState: 'unselected' | 'current-retained' | 'not-applicable';
};

export type ProjectNowRecommendation =
  | (ProjectNowRecommendationContext & {
      /** Derived for this read; never a saved user decision. */
      status: 'recommended';
      /** One grouped D candidate; proposal aliases do not compete separately. */
      candidate: ProjectNowWorkCandidate;
      /** The explicit selection flow available if the user chooses this candidate. */
      action: 'select-work-item' | 'choose-work';
      /** A concise explanation based only on recorded evidence. */
      reason: string;
      confidence: 'medium' | 'low';
      /** True when multiple candidates remain equally or incomparably supported. */
      close: boolean;
      /** Other undominated grouped candidates when close is true. */
      closeAlternatives: Array<Pick<ProjectNowWorkCandidate, 'id' | 'title' | 'source'>>;
      /** Ranking factors the current product records cannot establish. */
      evidenceGaps: ProjectNowRecommendationEvidenceGap[];
    })
  | (ProjectNowRecommendationContext & {
      status: 'insufficient-evidence';
      candidate: null;
      action: null;
      reason: string;
      confidence: null;
      close: false;
      closeAlternatives: [];
      evidenceGaps: ProjectNowRecommendationEvidenceGap[];
    })
  | (ProjectNowRecommendationContext & {
      status: 'none';
      candidate: null;
      action: null;
      reason: null;
      confidence: null;
      close: false;
      closeAlternatives: [];
      evidenceGaps: [];
    });

export type ProjectNowBootstrapSuggestion = {
  text: string;
  source: 'project-file' | 'current-work' | 'project-state';
  detail: string;
  basis: string;
};

export type ProjectNowBootstrap = {
  purposeSuggestion: ProjectNowBootstrapSuggestion | null;
  directionSuggestion: ProjectNowBootstrapSuggestion | null;
  directionDeferred: boolean;
};

export type ProjectNow = {
  projectId: string;
  primaryDirectionId: string | null;
  currentWorkId: string | null;
  /** Only a valid explicit user decision can set the current work. */
  currentWorkSelection: 'user' | null;
  /** An execution status derived from a request mapped to Work; never persists a Work transition. */
  execution?: ProjectNowExecution | null;
  state:
    | 'disconnected'
    | 'needs-direction'
    | 'choose-work'
    | 'choose-next-work'
    | 'active'
    | 'waiting'
    | 'review'
    | 'paused'
    | 'stopped'
    | 'complete'
    | 'idle';
  currentState: string;
  uncertainty: string | null;
  next: ProjectNowAction | null;
  secondaryActions: ProjectNowAction[];
  notice: ProjectNowNotice | null;
  otherWorkCount: number;
  otherWorkCounts: ProjectNowOtherWorkCounts;
  otherWorkCandidates: ProjectNowWorkCandidate[];
  recommendation: ProjectNowRecommendation;
  bootstrap?: ProjectNowBootstrap;
  freshness: 'current' | 'checking' | 'changed' | 'unknown';
  proposalMatches: WorkProposalMatch[];
};

export type ProjectModelView = {
  project: ProjectIdentity;
  directions: Direction[];
  workItems: WorkItem[];
  relations: WorkRelation[];
  decisions: WorkDecision[];
  returnPoints: ReturnPoint[];
  discussions: WorkDiscussionRecord[];
  latestObservation: ProjectObservation | null;
};

export type WorkProposalRecord = {
  id: string;
  projectId: string;
  proposal: WorkProposal;
  outputLanguage: 'en' | 'ko';
  generatedAt: string;
  /**
   * Earlier interpretations replaced by this current proposal. These retain
   * source identity and basis for an explicit user connection, but never make
   * a retired proposal current again.
   */
  history?: Array<{
    key: string;
    source: WorkProposal['source'];
    evidenceBasis: string | null;
    /** The original expression remains inspectable; identity alone is not evidence. */
    proposal?: WorkProposal;
  }>;
};
