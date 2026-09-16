import { z } from 'zod';
import { recordRangeSchema } from './goals';
import type { WorkspaceSnapshot } from './workspace';
export * from './goals';
export * from './resume';
export * from './workspace';
export * from './questions';
export * from './explanations';
export * from './projects';

export const idSchema = z.string().min(1).max(250);
export const missingSchema = z.enum([
  'not-in-record',
  'not-collected',
  'ambiguous',
  'conflicting',
  'freshness-unknown',
]);
export const slotSchema = z.enum([
  'purpose',
  'milestone',
  'current',
  'direction',
  'next',
  'reason',
  'review',
  'completion',
]);
export const natureSchema = z.enum([
  'user-request',
  'user-decision',
  'agent-report',
  'agent-interpretation',
  'agent-proposal',
  'tool-result',
  'file-observation',
]);
export const citationSchema = z
  .object({ revisionId: idSchema, quote: z.string().min(1).max(1200) })
  .strict();
export const claimSchema = z
  .object({
    id: idSchema,
    slot: slotSchema,
    text: z.string().max(2500).nullable(),
    nature: natureSchema,
    evidence: z.array(citationSchema).max(12),
    condition: z.string().max(1800).nullable(),
    missing: missingSchema.nullable(),
  })
  .strict();
export const candidateSchema = z
  .object({
    claims: z.array(claimSchema).min(1).max(25),
    limitations: z.array(z.string().max(1500)).max(30),
  })
  .strict();
export const assessmentSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            claimId: idSchema,
            verdict: z.enum(['supported', 'unsupported', 'uncertain']),
            reason: z.string().max(1800),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type ClaimSlot = Claim['slot'];
export type CheckedClaim = Claim & {
  verdict: 'supported' | 'unsupported' | 'uncertain';
  checkReason: string;
};
export type Missing = z.infer<typeof missingSchema>;
export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type ReasoningEffort = z.infer<typeof effortSchema>;
export type AnalysisSettings = {
  model: string;
  summaryEffort: ReasoningEffort;
  checkEffort: ReasoningEffort;
  promptVersion: string;
};
export type Freshness = {
  collection: 'unknown' | 'partial' | 'checking' | 'checked';
  summary: 'missing' | 'outdated' | 'current';
  lastCollectedAt: string | null;
  reasons: string[];
};
export const observationSchema = z
  .object({
    id: idSchema,
    kind: z.enum([
      'return',
      'visible',
      'evidence',
      'draft-saved',
      'correction-saved',
      'link-changed',
      'handoff-prepared',
      'handoff-opened',
      'connection-lost',
      'connection-restored',
    ]),
    at: z.string().datetime(),
    workId: idSchema.nullable(),
    summaryId: idSchema.nullable(),
    targetId: idSchema.nullable(),
    result: z.enum(['observed', 'committed', 'failed', 'unknown']),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
export type SourceRevision = {
  id: string;
  key: string;
  provider: 'codex';
  host: 'local';
  threadId: string;
  turnId: string;
  itemId: string;
  kind: string;
  actor: 'user' | 'agent' | 'tool' | 'system';
  text: string;
  contentHash: string;
  eventAt: string | null;
  observedAt: string;
  locator: { path: string | null; line: number | null; aliases: string[] };
  turnStatus: string;
  sourceStatus: string | null;
  pathKind: 'api' | 'jsonl';
  limitations: string[];
};
export type SourceRead = {
  threadId: string;
  title: string;
  cwd: string;
  path: string | null;
  revisions: SourceRevision[];
  status: 'checked' | 'partial';
  limitations: string[];
  observedAt: string;
  generation: string;
  manifest: {
    method: string;
    filter: Record<string, unknown>;
    itemCount: number;
    turnCount: number;
    fingerprint: string;
  };
};
export type DiscoveryManifest = {
  filter: Record<string, unknown>;
  cursors: (string | null)[];
  complete: boolean;
};
export type DiscoveryState = {
  manifest?: DiscoveryManifest;
  status: 'checked' | 'partial' | 'failed';
  attemptedAt: string;
  successfulAt: string | null;
  threadIds: string[];
  limitations: string[];
};
export type Connection = {
  discoveryScope?: {
    startTurnIds: Record<string, string>;
    recordRanges: Record<string, import('./goals').RecordRange>;
  };
  recordRanges?: Record<string, import('./goals').RecordRange>;
  id: string;
  title: string;
  cwd: string;
  threadIds: string[];
  startTurnIds: Record<string, string>;
  discover: boolean;
  revision: number;
  workId: string;
  createdAt: string;
  discovery?: DiscoveryState;
  /** Set when the user removes this connection. Source records and project files remain untouched. */ removedAt?:
    | string
    | null;
};
export type Link = {
  relation?: import('./goals').GoalRelation['kind'];
  id: string;
  workId: string;
  threadId: string;
  title: string;
  status: 'proposed' | 'linked' | 'deferred' | 'separate';
  revision: number;
  evidence: string[];
  rationale: string;
  sourceFingerprint?: string;
  role: 'work' | 'controlled-verification';
  history: { status: Link['status']; at: string }[];
};
export type Checkpoint = {
  id: string;
  threadId: string;
  workId: string;
  revisionIds: string[];
  sourceFingerprint: string;
  generation: string;
  scopeVersion: number;
  lastAttemptAt: string;
  lastSuccessfulAt: string | null;
  status: 'reading' | 'checked' | 'partial' | 'failed';
  limitations: string[];
  manifest: SourceRead['manifest'] | null;
};
export type SummaryRevision = {
  inputCapturedAt?: string | null;
  id: string;
  workId: string;
  inputVersion: string;
  sourceRevisionIds: string[];
  linkVersion: number;
  generatedAt: string;
  model: string;
  analysis?: AnalysisSettings;
  processingMs?: number;
  extractorVersion: string;
  claims: CheckedClaim[];
  limitations: string[];
  attemptToken: string;
  checks: Assessment;
};
export type Overlay = {
  id: string;
  workId: string;
  slot: ClaimSlot;
  text: string;
  baseSummaryId: string;
  revision: number;
  active: boolean;
  updatedAt: string;
  history: { text: string; active: boolean; at: string }[];
};
export type Draft = {
  id: string;
  workId: string;
  threadId: string;
  evidenceIds: string[];
  summaryId: string;
  text: string;
  revision: number;
  updatedAt: string;
};
export type Visit = {
  id: string;
  workId: string;
  summaryId: string;
  evidenceIds: string[];
  at: string;
};
export type JobStatus =
  | 'queued'
  | 'summarizing'
  | 'checking'
  | 'applied'
  | 'failed'
  | 'superseded'
  | 'result-unknown';
export type InputSnapshot = {
  sourceRevisionIds: string[];
  linkVersion: number;
  connectionRevision: number;
  capturedAt: string | null;
  baseSummaryId: string | null;
};
export type PendingRefresh = {
  inputVersion: string;
  configurationHash: string;
  extractorVersion: string;
  queuedAt: string;
};
export type JobPhase = {
  attemptToken: string;
  phase: 'generate' | 'check';
  startedAt: string;
  endedAt: string | null;
};
export type RefreshState = {
  observedAt: string;
  appliedJobId: string | null;
  activeJobId: string | null;
  latestJobId: string | null;
  pending: PendingRefresh | null;
};
export type SummaryCoverage = {
  capturedAt: string | null;
  reflectedIds: string[];
  pendingIds: string[];
  updated: { previousId: string; currentId: string }[];
  absentIds: string[];
  entries: {
    id: string;
    threadId: string;
    turnId: string;
    itemId: string;
    eventAt: string | null;
    observedAt: string;
    accessible: boolean;
  }[];
};
export type Job = {
  inputSnapshot?: InputSnapshot;
  queuedAt?: string | null;
  phases?: JobPhase[];
  id: string;
  workId: string;
  inputVersion: string;
  extractorVersion: string;
  analysis?: AnalysisSettings;
  configurationHash?: string;
  startedAt?: string;
  processingMs?: number;
  status: JobStatus;
  attempts: number;
  attemptToken: string | null;
  remote: {
    pid: number | null;
    threadId: string | null;
    turnId: string | null;
    phase: string;
  } | null;
  candidate: Candidate | null;
  model: string | null;
  error: string | null;
  retryable: boolean;
  updatedAt: string;
  resultId: string | null;
};
export type Work = {
  projectProfile?: import('./projects').ProjectProfile;
  resume?: import('./resume').ResumeStored;
  resumeOverrides?: import('./resume').ResumeOverride[];
  /** User-selected conversation responsible for overall progress. */ coordinationThreadId?:
    | string
    | null;
  coordinationMode?: 'auto' | 'selected' | 'none';
  goal?: import('./goals').GoalIntent;
  goalCandidates?: import('./goals').GoalCandidate[];
  pendingRefresh?: PendingRefresh | null;
  id: string;
  projectId: string;
  title: string;
  revision: number;
  linkVersion: number;
  inputVersion: string;
  latestSummaryId: string | null;
  createdAt: string;
};
export type HandoffTarget = {
  title: string;
  role: Link['role'];
  workId: string;
  expectedRevision: number;
  summaryId: string;
  threadId: string;
  evidenceIds: string[];
  draft: string;
  precision: 'thread' | 'unsupported';
  url: string | null;
};
export type Handoff = {
  id: string;
  target: HandoffTarget;
  state: 'prepared' | 'dispatching' | 'dispatched' | 'failed' | 'result-unknown';
  error: string | null;
  createdAt: string;
};
export type SessionCapability = {
  create: 'supported' | 'unsupported';
  send: 'supported' | 'unsupported';
  detail: string;
  verifiedAt: string | null;
};
export type ContinuationEvidence = { revisionId: string; quote: string };
export type ContinuationPayload = {
  goal: string | null;
  goalConfirmed?: boolean;
  currentState: string;
  nextAction: string;
  constraints: string[];
  doneWhen: string;
  previousThreadId?: string | null;
  evidence?: ContinuationEvidence[];
};
export type ContinuationTarget = {
  mode: 'new-session' | 'existing-session';
  threadId: string | null;
  title: string;
  workId: string;
  payload: ContinuationPayload;
  expectedRevision: number;
};
export type Continuation = {
  id: string;
  workId: string;
  requestId: string;
  target: ContinuationTarget;
  state: 'prepared' | 'dispatching' | 'opening' | 'sent' | 'opened' | 'failed' | 'result-unknown';
  threadId: string | null;
  turnId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Capabilities = {
  apiVersion: 1;
  source: 'codex-local';
  summary: {
    state: 'unverified' | 'ready' | 'failed';
    detail: string;
    model: string | null;
    settings?: AnalysisSettings;
  };
  navigation: {
    precision: 'thread' | 'unsupported';
    verifiedAt: string | null;
    detail: string;
    state?: 'verified-route' | 'missing' | 'invalid' | 'unsupported-environment';
  };
  session?: SessionCapability;
  collectionIntervalMs: number;
  discoveryIntervalMs: number;
};
export type ConversationFlowSource = {
  revisionId: string;
  quote: string;
  quoteStarts: number[];
  available: boolean;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  actor: SourceRevision['actor'] | null;
  eventAt: string | null;
  observedAt: string | null;
  locator: SourceRevision['locator'] | null;
};
export type ConversationFlowItem = {
  id: string;
  claimId: string;
  type: Claim['nature'];
  summary: string;
  condition: string | null;
  status: 'supported' | 'limited';
  checkReason: string;
  limitations: string[];
  sources: ConversationFlowSource[];
};
export type ConversationFlow = {
  id: string;
  summaryId: string;
  sourceRevisionIds: string[];
  claimId: string;
  items: ConversationFlowItem[];
  limitations: string[];
};
export type ReturnContextSnapshot = {
  accessibleEvidenceIds?: string[];
  scopeRecords?: {
    id: string;
    threadId: string;
    turnId: string;
    itemId: string;
    preview: string;
    actor: SourceRevision['actor'];
  }[];
  goalCandidates?: import('./goals').GoalCandidate[];
  explanation?: import('./explanations').ExplanationView;
  conversationFlows?: ConversationFlow[];
  coverage?: SummaryCoverage;
  refresh?: RefreshState;
  freshness?: Freshness;
  workspace?: WorkspaceSnapshot | null;
  continuation?: Continuation | null;
  work: Work;
  connection: Connection;
  links: Link[];
  checkpoints: Checkpoint[];
  summary: SummaryRevision | null;
  overlays: Overlay[];
  draft: Draft | null;
  visit: Visit | null;
  jobs: Job[];
  execution: {
    threadId: string;
    turnId: string;
    status: string;
    evidenceId: string;
    eventAt: string | null;
    role: Link['role'];
  }[];
  sourceRevisionIds: string[];
  sourceIndex: { id: string; threadId: string; actor: SourceRevision['actor']; preview: string }[];
  capabilities: Capabilities;
};
export type ProjectListItem = {
  explanations?: { id: string; summaryId: string; current: string }[];
  id: string;
  title: string;
  cwd: string;
  workId: string;
  revision: number;
  summaryId: string | null;
  current: string | null;
  state: string;
  freshness?: Freshness;
};
export const commandSchema = z
  .object({
    requestId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type Receipt = {
  id: string;
  command: string;
  bodyHash: string;
  workId: string;
  committedRevision: number;
  resultId: string;
  createdAt: string;
};
export type ApiErrorCode =
  | 'VALIDATION'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PROJECT_BUSY'
  | 'PROJECT_DELETION_CHANGED'
  | 'SOURCE_UNAVAILABLE'
  | 'SUMMARY_UNAVAILABLE'
  | 'RESULT_UNKNOWN'
  | 'CAPABILITY_UNSUPPORTED'
  | 'HANDOFF_TARGET_UNLINKED'
  | 'HANDOFF_EVIDENCE_INACCESSIBLE'
  | 'HANDOFF_COLLECTING'
  | 'HANDOFF_SUMMARY_CHANGED'
  | 'HANDOFF_INPUT_CHANGED'
  | 'HANDOFF_CONFIGURATION_CHANGED'
  | 'NOT_FOUND'
  | 'STORAGE_UNAVAILABLE';
export class DomainError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const connectionInputSchema = z
  .object({
    title: z.string().min(1).max(120),
    cwd: z.string().min(1).max(2000),
    threadIds: z.array(idSchema).min(1).max(30),
    startTurnIds: z.record(idSchema, idSchema).default({}),
    recordRanges: z.record(idSchema, recordRangeSchema).optional(),
    discover: z.boolean(),
  })
  .strict();
export const correctionInputSchema = z
  .object({
    slot: slotSchema,
    text: z.string().max(6000),
    baseSummaryId: idSchema,
    active: z.boolean(),
    overlayRevision: z.number().int().nonnegative(),
  })
  .strict();
export const draftInputSchema = z
  .object({
    threadId: idSchema,
    evidenceIds: z.array(idSchema).max(20),
    summaryId: idSchema,
    text: z.string().max(12000),
    draftRevision: z.number().int().nonnegative(),
  })
  .strict();
export const continuationPayloadSchema = z
  .object({
    goal: z.string().max(1200).nullable(),
    goalConfirmed: z.boolean().optional(),
    currentState: z.string().min(1).max(2000),
    nextAction: z.string().min(1).max(2000),
    constraints: z.array(z.string().min(1).max(1200)).max(20),
    doneWhen: z.string().min(1).max(2000),
    previousThreadId: idSchema.nullable().optional(),
    evidence: z
      .array(z.object({ revisionId: idSchema, quote: z.string().min(1).max(1200) }).strict())
      .max(20)
      .optional(),
  })
  .strict();
export const continuationPrepareSchema = z
  .object({
    targetMode: z.enum(['new-session', 'existing-session']),
    threadId: idSchema.nullable().optional(),
    payload: continuationPayloadSchema,
  })
  .strict();
export const continuationSendSchema = z.object({ continuationId: idSchema }).strict();
export const continuationOpenSchema = z.object({ continuationId: idSchema }).strict();
export const linkInputSchema = z
  .object({
    status: z.enum(['linked', 'deferred', 'separate']),
    linkRevision: z.number().int().nonnegative(),
    undo: z.boolean().optional(),
  })
  .strict();
export const visitInputSchema = z
  .object({ summaryId: idSchema, evidenceIds: z.array(idSchema).max(100) })
  .strict();
