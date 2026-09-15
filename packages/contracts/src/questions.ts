import { z } from 'zod';
import type { AnalysisSettings, SourceRevision } from './index';
const idSchema = z.string().min(1).max(250);
const natureSchema = z.enum([
  'user-request',
  'user-decision',
  'agent-report',
  'agent-interpretation',
  'agent-proposal',
  'tool-result',
  'file-observation',
]);

export const QUESTION_LIMITS = {
  input: 2000,
  output: 3000,
  turns: 10,
  history: 16000,
  context: 24000,
  contextTurns: 12,
  pending: 8,
  idleMs: 1800000,
} as const;
export const questionCitationSchema = z
  .object({
    revisionId: idSchema,
    start: z.number().int().nonnegative(),
    quote: z.string().min(1).max(1200),
  })
  .strict();
export const questionAnswerSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: idSchema,
            kind: z.enum(['record', 'interpretation']),
            nature: natureSchema,
            text: z.string().min(1).max(1500),
            uncertainty: z.string().max(600),
            evidence: z.array(questionCitationSchema).min(1).max(6),
          })
          .strict(),
      )
      .max(8),
    unknowns: z.array(z.string().min(1).max(600)).max(5),
  })
  .strict();
export const questionAssessmentSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            itemId: idSchema,
            verdict: z.enum(['supported', 'unsupported', 'uncertain']),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(8),
    unknownsSafe: z.boolean(),
  })
  .strict();
export const questionCreateSchema = z.union([
  z.object({ requestId: idSchema, summaryId: idSchema, claimId: idSchema }).strict(),
  z
    .object({ requestId: idSchema, summaryId: idSchema, explanationId: idSchema, nodeId: idSchema })
    .strict(),
]);
export const questionSubmitSchema = z
  .object({ requestId: idSchema, text: z.string().trim().min(1).max(QUESTION_LIMITS.input) })
  .strict();
export const questionRequestSchema = z.object({ requestId: idSchema }).strict();
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;
export type QuestionAssessment = z.infer<typeof questionAssessmentSchema>;
export type QuestionStatus =
  | 'queued'
  | 'generating'
  | 'repairing'
  | 'checking'
  | 'completed'
  | 'failed'
  | 'result-unknown'
  | 'invalidated';
export type QuestionTurn = {
  id: string;
  text: string;
  status: QuestionStatus;
  attempts: number;
  answer: QuestionAnswer | null;
  assessment: QuestionAssessment | null;
  limitations: string[];
  error: string | null;
  retryable: boolean;
};
export type QuestionSession = {
  id: string;
  workId: string;
  summaryId: string;
  claimId: string | null;
  target?: { kind: 'explanation'; explanationId: string; nodeId: string };
  anchor: string;
  sourceRevisionIds: string[];
  connectionRevision: number;
  linkVersion: number;
  stale: boolean;
  invalidated: boolean;
  turns: QuestionTurn[];
  updatedAt: string;
};
export type QuestionExcerpt = {
  revisionId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  actor: SourceRevision['actor'];
  kind: string;
  eventAt: string | null;
  start: number;
  text: string;
};
export type QuestionContext = {
  anchorSourceRevisionIds?: string[];
  recordOrder?: string[];
  anchorCondition?: string;
  anchorStatus?: { kind: string; nature: string; uncertainty: string; condition: string };
  anchor: string;
  question: string;
  history: { question: string; answer: QuestionAnswer }[];
  excerpts: QuestionExcerpt[];
  limitations: string[];
};
// Only execution metadata is durable. Never store questions, candidates or answers here.
export type QuestionExecution = {
  id: string;
  workId: string;
  sessionId: string;
  turnId: string;
  bodyHash: string;
  attempt: number;
  status: QuestionStatus | 'session' | 'closed';
  remote: {
    pid: number | null;
    threadId: string | null;
    turnId: string | null;
    phase: string;
  } | null;
  analysis: AnalysisSettings;
  updatedAt: string;
  repairs?: number;
  diagnostics?: QuestionDiagnostic[];
};

export type QuestionDiagnostic = {
  stage: 'candidate' | 'meaning';
  violation: 'structure' | 'citation' | 'speaker' | 'unsupported' | 'uncertain' | 'assessment';
  itemId: string | null;
  nature?: QuestionAnswer['items'][number]['nature'];
  actor?: SourceRevision['actor'];
  repairs: number;
};
// The candidate and detailed feedback live only for this request, never in execution storage.
export type QuestionRepair = { candidate: unknown; diagnostic: QuestionDiagnostic; reason: string };
export class QuestionCandidateError extends Error {
  constructor(
    message: string,
    readonly diagnostic: QuestionDiagnostic,
    readonly candidate: unknown,
  ) {
    super(message);
  }
}
