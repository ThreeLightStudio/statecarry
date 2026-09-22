import { z } from 'zod';
import type { Continuation, SessionCapability } from './index';
import type { WorkspaceSnapshot } from './workspace';

export const decisionOperationSchema = z.enum([
  'verify',
  'continue',
  'commit',
  'revert',
  'unstage',
  'direction',
  'policy',
]);
export type DecisionOperation = z.infer<typeof decisionOperationSchema>;
export type ChangeScope = {
  id: string;
  path: string;
  layer: 'staged' | 'unstaged' | 'untracked';
  kind: 'hunk' | 'file';
  description: string;
  patch: string;
};
export type ScopeObservation = {
  basis: string;
  checkedAt: string;
  complete: boolean;
  scopes: ChangeScope[];
  limitations: string[];
  /** The file inventory and its content fingerprints were read successfully. */
  inventoryComplete?: boolean;
  files?: ScopeFile[];
};
export type ScopeFileSelection = { path: string; layer: ChangeScope['layer'] };
export type ScopeFile = ScopeFileSelection & {
  id: string;
  detail: 'ready' | 'unread' | 'unavailable';
  limitation: string | null;
};
export type SessionQuestion = {
  id: string;
  kind: 'command' | 'file-change' | 'permissions' | 'question';
  title: string;
  detail: string;
  questions?: Array<{ id: string; question: string; options: string[] }>;
};
export type SessionRun = {
  checks?: Array<{ command: string; exitCode: number | null; output: string }>;
  turnId?: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'unknown';
  report: string;
  error: string | null;
  questions: SessionQuestion[];
};
export const projectExecutionContextSchema = z
  .object({
    basis: z.string().min(1).max(256),
    scopeIds: z.array(z.string().min(1).max(256)).max(300),
    operation: decisionOperationSchema,
    workItemId: z.string().min(1).max(250).optional(),
  })
  .strict();
export type ProjectExecutionContext = z.infer<typeof projectExecutionContextSchema>;
export type ProjectScopeRecord = {
  id: string;
  projectId: string;
  version: number;
  observation?: ScopeObservation;
  observedWorkspaceBasis?: string;
  expandedFiles?: ScopeFileSelection[];
  kept: Array<{ id: string; scopeIds: string[]; scopes: ChangeScope[]; at: string }>;
  corrections: Record<string, string>;
  policyConflict: { description: string; source: string; status: 'open' | 'resolved' } | null;
};
export type ProjectExecutionRecord = {
  id: string;
  projectId: string;
  version: number;
  requests: string[];
  accepted: string[];
  closed?: string[];
  comparisons: Record<
    string,
    { checkedAt: string; remaining: string[]; changed: string[]; basis: string }
  >;
};
export type ProjectActionState = ProjectScopeRecord & ProjectExecutionRecord;
export type ProjectExecutionWorkspace = {
  analysisCurrent: boolean;
  scopeCurrent: boolean;
  record: ProjectActionState & {
    direction: { text: string; status: 'confirmed' | 'finished'; at: string } | null;
  };
  workspace: WorkspaceSnapshot | null;
  requests: Continuation[];
  capability: SessionCapability;
};
const text = z.string().trim().min(1).max(8000);
const ids = z.array(z.string().min(1).max(256)).max(300);
export const projectExecutionCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('read-scope-file'),
      basis: text,
      path: z.string().min(1).max(2000),
      layer: z.enum(['staged', 'unstaged', 'untracked']),
      outputLanguage: z.enum(['en', 'ko']).default('en'),
    })
    .strict(),
  z
    .object({ action: z.literal('observe'), outputLanguage: z.enum(['en', 'ko']).default('en') })
    .strict(),
  z
    .object({ action: z.literal('analyze'), outputLanguage: z.enum(['en', 'ko']).default('en') })
    .strict(),
  z.object({ action: z.literal('keep'), basis: text, scopeIds: ids.min(1) }).strict(),
  z.object({ action: z.literal('reopen'), id: text }).strict(),
  z.object({ action: z.literal('correct'), key: text, text }).strict(),
  z.object({ action: z.literal('direction'), text, finish: z.boolean() }).strict(),
  z.object({ action: z.literal('conflict'), description: text, source: text }).strict(),
  z.object({ action: z.literal('resolve-conflict'), requestId: text }).strict(),
  z
    .object({
      action: z.literal('prepare'),
      context: projectExecutionContextSchema,
      text: text.max(2000),
      doneWhen: text.max(2000),
      threadId: z.string().min(1).max(256).nullable().default(null),
    })
    .strict(),
  z.object({ action: z.literal('close-request'), requestId: text }).strict(),
  z.object({ action: z.literal('record-result'), requestId: text, report: text }).strict(),
  z.object({ action: z.literal('review'), requestId: text }).strict(),
  z.object({ action: z.literal('resolve-direction'), text: text.max(400) }).strict(),
  z.object({ action: z.literal('send'), requestId: text }).strict(),
  z.object({ action: z.literal('sync'), requestId: text }).strict(),
  z.object({ action: z.literal('interrupt'), requestId: text }).strict(),
  z
    .object({
      action: z.literal('answer'),
      requestId: text,
      questionId: text,
      accept: z.boolean(),
      answers: z.record(z.string(), z.array(z.string().max(4000)).max(8)).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('compare'),
      requestId: text,
      outputLanguage: z.enum(['en', 'ko']).default('en'),
    })
    .strict(),
  z.object({ action: z.literal('accept'), requestId: text }).strict(),
]);
export type ProjectExecutionCommand = z.infer<typeof projectExecutionCommandSchema>;
