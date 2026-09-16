import { z } from 'zod';
import type { WorkspaceSnapshot } from './workspace';
import type { Capabilities, Continuation } from './index';
const text = z.string().min(1).max(1200);
const evidence = z.object({ revisionId: z.string().min(1), quote: text }).strict();

export const outputLanguageSchema = z.enum(['en', 'ko']);
export type OutputLanguage = z.infer<typeof outputLanguageSchema>;
export const resumeRefreshSchema = z
  .object({ outputLanguage: outputLanguageSchema.optional().default('en') })
  .strict();
export type ResumeRefreshInput = z.infer<typeof resumeRefreshSchema>;
export const resumeLocalizeSchema = z.object({ outputLanguage: outputLanguageSchema }).strict();
export type ResumeLocalizeInput = z.infer<typeof resumeLocalizeSchema>;

export const resumeLocalizedCandidateSchema = z
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
export const resumeLocalizationResultSchema = z
  .object({ candidates: z.array(resumeLocalizedCandidateSchema).max(5) })
  .strict();
export type ResumeLocalizationResult = z.infer<typeof resumeLocalizationResultSchema>;

/**
 * Evidence grouped by the level of progress it can establish.  These fields
 * are optional so stored resume briefs written before progress attribution was
 * added remain valid and continue to render.
 */
export const resumeProgressSchema = z
  .object({
    reported: z.array(evidence).max(6).optional(),
    implemented: z.array(evidence).max(6).optional(),
    verified: z.array(evidence).max(6).optional(),
  })
  .strict();
export type ResumeProgress = z.infer<typeof resumeProgressSchema>;

/** Completion is kept separate from general progress: a completion report is
 * not an independent verification of the reported result. */
export const resumeCompletionSchema = z
  .object({
    reported: z.array(evidence).max(6).optional(),
    verified: z.array(evidence).max(6).optional(),
  })
  .strict();
export type ResumeCompletion = z.infer<typeof resumeCompletionSchema>;

export const resumeCoordinationSchema = z
  .object({
    state: z.enum(['recommended', 'unconfirmed', 'none']),
    threadId: z.string().min(1).nullable(),
    title: z.string().min(1).nullable(),
    detail: z.string().min(1).max(600),
    evidence: z.array(evidence).max(6),
  })
  .strict();
export type ResumeCoordination = z.infer<typeof resumeCoordinationSchema>;

export const resumeCandidateSchema = z
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
    progress: resumeProgressSchema.optional(),
    completion: resumeCompletionSchema.optional(),
  })
  .strict();
// A completed check may legitimately find no safe resume candidate. Keep the
// empty result distinct from a failed read so the UI can explain what to do.
export const resumeResultSchema = z
  .object({ candidates: z.array(resumeCandidateSchema).max(5) })
  .strict();
export type ResumeCandidate = z.infer<typeof resumeCandidateSchema>;
export const resumeCorrectionSchema = z
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
export type ResumeCorrection = z.infer<typeof resumeCorrectionSchema>;
export type ResumeStored = {
  scope: string;
  version: string;
  generatedAt: string;
  /** Language used for generated explanatory candidate fields. Legacy briefs default to English. */
  outputLanguage?: OutputLanguage;
  candidates: ResumeCandidate[];
  /** Workspace state captured immediately before and after analysis. */
  workspaceBefore?: WorkspaceSnapshot | null;
  workspaceAfter?: WorkspaceSnapshot | null;
};
export type ResumeOverride = ResumeCorrection & { at: string; scope: string };
export type ResumeWork = {
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
  workId: string;
  title: string;
  cwd: string;
  version: string;
  candidates: ResumeCandidate[];
  busy: boolean;
  error: string | null;
  stale: boolean;
  generatedAt: string | null;
  /** Language currently used by generated overview fields. */
  outputLanguage?: OutputLanguage;
  correctedKeys: string[];
  dismissedKeys: string[];
  /** Whether an explicitly supported coordination conversation was found. */
  coordination?: ResumeCoordination | null;
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
