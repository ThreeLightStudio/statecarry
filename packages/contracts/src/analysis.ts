import { z } from 'zod';
import type { WorkspaceSnapshot } from './workspace';
import type { Capabilities, Continuation } from './index';
import { QUESTION_LIMITS, questionAnswerSchema } from './questions';

function discussionKey(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

/** Group identity survives a reordered analysis; its evidence basis is tracked separately. */
export function workingTreeGroupKey(group?: {
  files: string[];
  title: string;
  id?: string;
}): string {
  if (group?.id) return `working-tree:${group.id}`;
  return group
    ? `working-tree:${discussionKey([group.title, [...group.files].sort()])}`
    : 'working-tree:all';
}

export function workingTreeDiscussionBasis(snapshot: WorkspaceSnapshot): string {
  return discussionKey([
    snapshot.commit,
    snapshot.fileFingerprint ?? snapshot.fingerprint,
    snapshot.inventoryFingerprint,
    snapshot.changedPaths,
    snapshot.diffPreview,
    snapshot.workingTreeAnalysis,
  ]);
}
const text = z.string().min(1).max(1200);
const evidence = z.object({ revisionId: z.string().min(1), quote: text }).strict();

export const outputLanguageSchema = z.enum(['en', 'ko']);
export type OutputLanguage = z.infer<typeof outputLanguageSchema>;
export const analysisRefreshSchema = z
  .object({ outputLanguage: outputLanguageSchema.optional().default('en') })
  .strict();
export type AnalysisRefreshInput = z.infer<typeof analysisRefreshSchema>;
export const analysisLocalizeSchema = z.object({ outputLanguage: outputLanguageSchema }).strict();
export type AnalysisLocalizeInput = z.infer<typeof analysisLocalizeSchema>;

export const analysisLocalizedCandidateSchema = z
  .object({
    key: z.string().min(1).max(160),
    goal: z.string().min(1).max(120),
    recentWork: z.string().min(1).max(200).nullable().optional(),
    currentState: z
      .string()
      .min(1)
      .max(240)
      .regex(/[.!?]$/, 'Use complete sentences, not a clipped fragment'),
    reason: z.string().min(1).max(200),
    nextAction: z.string().min(1).max(240).nullable(),
    doneWhen: z.string().min(1).max(200).nullable(),
    prerequisites: z.array(text).max(5),
  })
  .strict();
export const analysisLocalizationResultSchema = z
  .object({ candidates: z.array(analysisLocalizedCandidateSchema).max(5) })
  .strict();
export type AnalysisLocalizationResult = z.infer<typeof analysisLocalizationResultSchema>;

/**
 * Evidence grouped by the level of progress it can establish.  These fields
 * are optional because an analysis may have evidence for only some progress levels.
 */
export const analysisProgressSchema = z
  .object({
    reported: z.array(evidence).max(6).optional(),
    implemented: z.array(evidence).max(6).optional(),
    verified: z.array(evidence).max(6).optional(),
  })
  .strict();
export type AnalysisProgress = z.infer<typeof analysisProgressSchema>;

/** Completion is kept separate from general progress: a completion report is
 * not an independent verification of the reported result. */
export const analysisCompletionSchema = z
  .object({
    reported: z.array(evidence).max(6).optional(),
    verified: z.array(evidence).max(6).optional(),
  })
  .strict();
export type AnalysisCompletion = z.infer<typeof analysisCompletionSchema>;

export const analysisCoordinationSchema = z
  .object({
    state: z.enum(['recommended', 'unconfirmed', 'none']),
    threadId: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    detail: z.string().min(1).max(600),
    evidence: z.array(evidence).max(6),
  })
  .strict();
export type AnalysisCoordination = z.infer<typeof analysisCoordinationSchema>;

export const analysisCandidateSchema = z
  .object({
    key: z.string().min(1).max(160),
    goal: z.string().min(1).max(120),
    recentWork: z.string().min(1).max(200).nullable().optional(),
    currentState: z
      .string()
      .min(1)
      .max(240)
      .regex(/[.!?]$/, 'Use complete sentences, not a clipped fragment'),
    status: z.enum(['active', 'waiting', 'paused', 'unclear', 'done']),
    reason: z.string().min(1).max(200),
    nextAction: z.string().min(1).max(240).nullable(),
    actionSource: z.enum(['recorded', 'suggested']).nullable(),
    doneWhen: z.string().min(1).max(200).nullable(),
    threadId: z.string().min(1),
    prerequisites: z.array(text).max(5),
    evidence: z
      .array(z.object({ revisionId: z.string(), quote: text }).strict())
      .min(1)
      .max(6),
    progress: analysisProgressSchema.optional(),
    completion: analysisCompletionSchema.optional(),
  })
  .strict();
// A completed check may legitimately find no safe resume candidate. Keep the
// empty result distinct from a failed read so the UI can explain what to do.
export const analysisResultSchema = z
  .object({ candidates: z.array(analysisCandidateSchema).max(5) })
  .strict();
export type AnalysisCandidate = z.infer<typeof analysisCandidateSchema>;
export const analysisCorrectionSchema = z
  .object({
    candidateKey: z.string().min(1),
    version: z.string(),
    kind: z.enum(['wrong-work', 'wrong-action', 'done', 'paused', 'restore']),
    nextAction: text.optional(),
    doneWhen: text.optional(),
  })
  .strict()
  .refine(
    (v) => v.kind !== 'wrong-action' || Boolean(v.nextAction && v.doneWhen),
    'Provide both the next action and its completion condition',
  );
export type AnalysisCorrection = z.infer<typeof analysisCorrectionSchema>;
export const taskDiscussionRequestSchema = z
  .object({
    workItemId: z.string().min(1).max(250),
    version: z.string().min(1).max(512),
    question: z.string().trim().min(1).max(QUESTION_LIMITS.input),
    history: z
      .array(
        z
          .object({
            question: z.string().min(1).max(QUESTION_LIMITS.input),
            answer: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(QUESTION_LIMITS.turns - 1),
  })
  .strict();
export const taskDiscussionResponseSchema = z
  .object({
    answer: questionAnswerSchema,
    limitations: z.array(z.string().min(1).max(1200)).max(8),
  })
  .strict();
export type TaskDiscussionRequest = z.infer<typeof taskDiscussionRequestSchema>;
export type TaskDiscussionResponse = z.infer<typeof taskDiscussionResponseSchema>;
export type AnalysisResult = {
  scope: string;
  version: string;
  generatedAt: string;
  /** Language used for generated explanatory candidate fields. Legacy briefs default to English. */
  outputLanguage?: OutputLanguage;
  candidates: AnalysisCandidate[];
  /** Workspace state captured immediately before and after analysis. */
  workspaceBefore?: WorkspaceSnapshot | null;
  workspaceAfter?: WorkspaceSnapshot | null;
};
export type AnalysisOverride = AnalysisCorrection & { at: string; scope: string };
export type AnalysisWork = {
  /** Normalized analysis/availability state for presentation. */
  state?: 'ready' | 'checking' | 'limited' | 'empty' | 'unavailable' | 'failed';
  /** Plain-language explanation of the current state. */
  stateDetail?: string;
  /** Actions that must wait until the listed limitation is resolved. */
  blockedActions?: string[];
  /** Current limitations, kept separately from evidence and candidate text. */
  limitations?: string[];
  updatesAvailable: boolean;
  goalText: string | null;
  goalOrigin: 'user-input' | 'inferred';
  sessionCount: number;
  projectId: string;
  title: string;
  cwd: string;
  version: string;
  candidates: AnalysisCandidate[];
  busy: boolean;
  error: string | null;
  stale: boolean;
  generatedAt: string | null;
  /** Language currently used by generated overview fields. */
  outputLanguage?: OutputLanguage;
  correctedKeys: string[];
  dismissedKeys: string[];
  /** Whether an explicitly supported coordination conversation was found. */
  coordination?: AnalysisCoordination | null;
  /** Linked conversations that the user may explicitly assign overall-progress ownership to. */
  coordinationChoices?: { threadId: string; title: string }[];
  /** Revision needed when a follow-up continuation is prepared. */
  revision?: number;
  /** Latest durable request to continue this work, when one exists. */
  continuation?: Continuation | null;
  /** Whether the connected Codex environment can create/send a new session. */
  session?: {
    create: 'supported' | 'unsupported';
    send: 'supported' | 'unsupported';
    detail: string;
    verifiedAt: string | null;
  } | null;
  /** Whether opening a linked Codex conversation has been verified here. */
  navigation?: Capabilities['navigation'] | null;
  /** Most recent workspace observation, when a ProjectInspector is configured. */
  workspace?: WorkspaceSnapshot | null;
  /** True when the current workspace differs from the brief's captured state. */
  workspaceChanged?: boolean;
};

export type ProjectAnalysisRecord = { id: string; projectId: string; result: AnalysisResult };
