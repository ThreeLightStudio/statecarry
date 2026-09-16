import type {
  Candidate,
  Assessment,
  Capabilities,
  SourceRead,
  SummaryRevision,
  Connection,
  Link,
  Checkpoint,
  SourceRevision,
  Work,
  Overlay,
  Draft,
  Visit,
  Job,
  Handoff,
  Receipt,
  Continuation,
  WorkspaceSnapshot,
  WorkspaceInspectionHints,
} from '@statecarry/contracts';
export type Entities = {
  explanation: import('@statecarry/contracts').ExplanationRevision;
  explanationJob: import('@statecarry/contracts').ExplanationJob;
  questionExecution: import('@statecarry/contracts').QuestionExecution;
  work: Work;
  connection: Connection;
  link: Link;
  checkpoint: Checkpoint;
  source: SourceRevision;
  summary: SummaryRevision;
  overlay: Overlay;
  draft: Draft;
  visit: Visit;
  job: Job;
  handoff: Handoff;
  continuation: Continuation;
  receipt: Receipt;
};
export interface StateRepository {
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] | null;
  list<K extends keyof Entities>(kind: K): Entities[K][];
  put<K extends keyof Entities>(kind: K, entity: Entities[K]): void;
  /** Remove app-owned state only. Call within a transaction for a project deletion. */
  remove<K extends keyof Entities>(kind: K, id: string): void;
  transaction<T>(fn: () => T): T;
}
export interface SourceReader {
  discover(
    cwd: string,
  ): Promise<{
    threads: { id: string; title: string; cwd: string }[];
    complete: boolean;
    limitations: string[];
    manifest?: import('@statecarry/contracts').DiscoveryManifest;
  }>;
  listTurns?(threadId: string): Promise<{ turns: { id: string; at: string | null }[] }>;
  read(threadId: string, startTurnId?: string): Promise<SourceRead>;
  close(): Promise<void>;
}
/** Read-only project state used to keep a return brief tied to its workspace.
 * Implementations may use Git or another local project provider. */
export interface ProjectInspector {
  inspect(cwd: string, hints?: WorkspaceInspectionHints): WorkspaceSnapshot;
  close?(): void | Promise<void>;
}
export type AttemptMeta = {
  pid: number | null;
  threadId: string | null;
  turnId: string | null;
  phase: string;
};
export interface SummaryProvider {
  generateResume?(input: unknown): Promise<unknown>;
  generateExplanation?(
    context: import('@statecarry/contracts').ExplanationContext,
    onRemote: (meta: AttemptMeta) => void,
    validate: () => void,
    repair?: { candidate: unknown; reason: string },
  ): Promise<unknown>;
  checkExplanation?(
    context: import('@statecarry/contracts').ExplanationContext,
    candidate: import('@statecarry/contracts').ExplanationCandidate,
    onRemote: (meta: AttemptMeta) => void,
    validate: () => void,
  ): Promise<unknown>;
  answerQuestion?(
    context: import('@statecarry/contracts').QuestionContext,
    onRemote: (meta: AttemptMeta) => void,
    validate: () => void,
    repair?: import('@statecarry/contracts').QuestionRepair,
  ): Promise<unknown>;
  checkQuestion?(
    context: import('@statecarry/contracts').QuestionContext,
    answer: import('@statecarry/contracts').QuestionAnswer,
    onRemote: (meta: AttemptMeta) => void,
    validate: () => void,
  ): Promise<unknown>;
  configuration(): import('@statecarry/contracts').AnalysisSettings;
  capability(): Capabilities['summary'];
  generate(
    sources: SourceRevision[],
    onRemote: (meta: AttemptMeta) => void,
    goal?: import('@statecarry/contracts').GoalIntent,
  ): Promise<{ candidate: Candidate; model: string }>;
  check(
    candidate: Candidate,
    sources: SourceRevision[],
    onRemote: (meta: AttemptMeta) => void,
    goal?: import('@statecarry/contracts').GoalIntent,
  ): Promise<Assessment>;
  rejectCandidate?(
    sources: SourceRevision[],
    candidate: Candidate,
    assessment: Assessment,
  ): Promise<void>;
  resolve(meta: AttemptMeta | null): Promise<'terminated' | 'unknown'>;
  close(): Promise<void>;
}
export interface Navigator {
  capability(): Capabilities['navigation'];
  open(threadId: string): Promise<void>;
}
export type SessionCreateInput = { workId: string; title: string; cwd: string };
export type SessionSendInput = { workId: string; threadId: string; text: string };
export type SessionCreateResult = { threadId: string; title?: string };
export type SessionSendResult = { turnId: string | null };
export interface SessionExecutor {
  capability(): import('@statecarry/contracts').SessionCapability;
  create(input: SessionCreateInput): Promise<SessionCreateResult>;
  send(input: SessionSendInput): Promise<SessionSendResult>;
  close?(): Promise<void>;
}
export interface Clock {
  now(): string;
}
export interface Identity {
  next(): string;
  hash(value: unknown): string;
}
export interface Events {
  changed(workId: string | null): void;
  /** Completes an observation that a concurrent reader may have seen in progress. */
  collectionSettled?(workId: string): void;
}
