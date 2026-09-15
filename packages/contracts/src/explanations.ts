import { z } from 'zod';
import type { AnalysisSettings, QuestionExcerpt } from './index';

export const EXPLANATION_POLICY = 'context-first-explanation-5';
export class ExplanationCandidateError extends Error {
  constructor(
    message: string,
    readonly candidate: unknown,
  ) {
    super(message);
  }
}
export const EXPLANATION_LIMITS = {
  context: 64000,
  nodes: 32,
  output: 8000,
  transport: 64000,
  calls: 4,
  repairs: 1,
  retries: 1,
  pending: 8,
} as const;
const id = z.string().min(1).max(250);
const kind = z.enum(['record', 'interpretation']);
const citation = z
  .object({
    revisionId: id,
    start: z.number().int().nonnegative(),
    quote: z.string().min(1).max(1200),
  })
  .strict();
const evidence = z.array(citation).min(1).max(6);
const unknown = z
  .object({
    text: z.string().min(1).max(600),
    impact: z.string().min(1).max(600),
    cause: z.enum(['not-in-record', 'not-selected', 'not-collected', 'ambiguous', 'conflicting']),
  })
  .strict();
export const explanationNodeSchema = z
  .object({
    id,
    role: z.enum([
      'background',
      'goal',
      'choice',
      'progress',
      'state',
      'action',
      'followup',
      'premise',
    ]),
    kind,
    nature: z.enum([
      'user-report',
      'user-request',
      'user-decision',
      'agent-report',
      'agent-interpretation',
      'agent-proposal',
      'tool-result',
      'file-observation',
    ]),
    text: z.string().min(1).max(1000),
    uncertainty: z.string().max(600),
    condition: z.string().max(600),
    evidence,
    unknowns: z.array(unknown).max(5),
  })
  .strict();
export const explanationLinkSchema = z
  .object({
    id,
    parentId: id,
    childId: id,
    question: z.string().min(1).max(200),
    kind,
    uncertainty: z.string().max(600),
    evidence,
  })
  .strict();
export const explanationCandidateSchema = z
  .object({
    sections: z
      .array(
        z
          .object({ id, title: z.string().min(1).max(100), bodyIds: z.array(id).min(1).max(32) })
          .strict(),
      )
      .min(1)
      .max(8),
    nodes: z.array(explanationNodeSchema).min(1).max(EXPLANATION_LIMITS.nodes),
    links: z.array(explanationLinkSchema).max(64),
    unknowns: z.array(unknown).max(8),
  })
  .strict();
const verdict = z
  .object({
    id,
    verdict: z.enum(['supported', 'unsupported', 'uncertain']),
    reason: z.string().max(1000),
  })
  .strict();
export const explanationAssessmentSchema = z
  .object({
    nodes: z.array(verdict).max(32),
    links: z.array(verdict).max(64),
    unknownsSafe: z.boolean(),
    narrativeComplete: z.boolean(),
    reason: z.string().max(1500),
  })
  .strict();
export type ExplanationCandidate = z.infer<typeof explanationCandidateSchema>;
export type ExplanationNode = z.infer<typeof explanationNodeSchema>;
export type ExplanationAssessment = z.infer<typeof explanationAssessmentSchema>;
export type ExplanationInput = {
  goal?: {
    intent: import('./goals').GoalIntent;
    relations: import('./goals').GoalRelation[];
    recordRanges: Record<string, import('./goals').RecordRange>;
  };
  workId: string;
  summaryId: string;
  sourceRevisionIds: string[];
  connectionRevision: number;
  linkVersion: number;
  policyVersion: string;
  analysis: AnalysisSettings;
  capturedAt: string;
  ranges: { revisionId: string; start: number; end: number }[];
  selectionComplete: boolean;
  limitations: string[];
};
export type ExplanationContext = {
  input: ExplanationInput;
  guide: { role: string; text: string; sourceRevisionIds?: string[] }[];
  excerpts: QuestionExcerpt[];
};
export type ExplanationRevision = {
  id: string;
  workId: string;
  summaryId: string;
  input: ExplanationInput;
  candidate: ExplanationCandidate;
  assessment: ExplanationAssessment;
  generatedAt: string;
  jobId: string;
  attemptToken: string;
};
export type ExplanationStatus =
  | 'waiting'
  | 'queued'
  | 'generating'
  | 'repairing'
  | 'checking'
  | 'ready'
  | 'failed'
  | 'superseded'
  | 'result-unknown';
export type ExplanationJob = {
  id: string;
  workId: string;
  summaryId: string;
  input: ExplanationInput;
  status: ExplanationStatus;
  calls: number;
  repairs: number;
  retries: number;
  attemptToken: string | null;
  remote: {
    pid: number | null;
    threadId: string | null;
    turnId: string | null;
    phase: string;
  } | null;
  candidate: ExplanationCandidate | null;
  resultId: string | null;
  error: string | null;
  queuedAt: string;
  updatedAt: string;
  phases: { phase: string; startedAt: string; endedAt: string | null }[];
};
export type ExplanationView = {
  revision: ExplanationRevision | null;
  job:
    | ({ canRetry?: boolean } & Pick<
        ExplanationJob,
        | 'id'
        | 'status'
        | 'calls'
        | 'repairs'
        | 'retries'
        | 'error'
        | 'queuedAt'
        | 'updatedAt'
        | 'phases'
      >)
    | null;
  policyVersion: string;
  accessibleIds: string[];
  available: boolean;
};
export const explanationPrepareSchema = z.object({ requestId: id, summaryId: id }).strict();
export const explanationRetrySchema = z.object({ requestId: id }).strict();
