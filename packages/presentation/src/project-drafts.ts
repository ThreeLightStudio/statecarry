import type { ProjectNowAction } from '@statecarry/contracts';

/** Runtime UI state. Only unsent inputs and transient view state are persisted locally. */
export type ProjectNowUiActionEntry = {
  kind: ProjectNowAction['kind'];
  selectionKey: string | null;
  requestId: string | null;
  releaseId: string | null;
  mode:
    | 'continue'
    | 'remaining'
    | 'verify'
    | 'policy'
    | 'review'
    | 'direction'
    | 'result'
    | 'new-work'
    | 'release';
};
export type ProjectNowUiActivity = 'base' | 'details' | 'action' | 'discussion';
export type ProjectNowUiMemory = {
  projectId: string;
  lastViewedAt: number;
  screen: 'base' | 'action';
  activity: ProjectNowUiActivity;
  resumePending: boolean;
  actionEntry: ProjectNowUiActionEntry | null;
  selectedWorkId: string | null;
  basis: string;
  policyConflictBasis: string | null;
  otherWorkOpen: boolean;
  projectContextOpen: boolean;
  scroll: number;
};

export function projectNowUiMemoryKey(memory: ProjectNowUiMemory): string {
  switch (memory.actionEntry?.mode) {
    case 'policy':
      return 'project:policy';
    case 'release':
      return `project:release:${memory.actionEntry.releaseId ?? 'current'}`;
    case 'direction':
      return 'project:direction';
    case 'new-work':
      return 'project:next-work';
  }
  const workId = memory.actionEntry?.selectionKey ?? memory.selectedWorkId;
  if (workId) return `work:${workId}`;
  if (memory.actionEntry?.requestId) return `project:request:${memory.actionEntry.requestId}`;
  return 'project:overview';
}

export type AnalysisGoalDraft = { text: string; version: string };
export type AnalysisActionDraft = { action: string; done: string; version: string };
export type AnalysisTaskSnapshot = {
  key: string;
  title: string;
  statusLabel: string;
  currentState: string;
  reason: string;
  nextAction: string | null;
  doneWhen: string | null;
};
export type AnalysisTaskDiscussionAnswer = {
  items: Array<{
    id: string;
    kind: 'record' | 'interpretation';
    nature:
      | 'user-request'
      | 'user-decision'
      | 'agent-report'
      | 'agent-interpretation'
      | 'agent-proposal'
      | 'tool-result'
      | 'file-observation';
    text: string;
    uncertainty: string;
    evidence: string[];
  }>;
  unknowns: string[];
  limitations: string[];
};
export type AnalysisTaskDiscussion = {
  version: string;
  input: string;
  turns: Array<{ question: string; answer: AnalysisTaskDiscussionAnswer; version?: string }>;
};
export type ProjectDrafts = {
  selectedKey?: string;
  /** Runtime marker for an explicit task selection; never stored in the browser. */
  selectedExplicit?: boolean;
  /** Keeps the last user-selected task understandable if a later overview no longer returns it. */
  selectedTaskSnapshot?: AnalysisTaskSnapshot | null;
  /** A working-tree fingerprint the user explicitly chose to leave as-is. */
  keptWorkingTreeKey?: string;
  workingTreeFocus?: {
    key: string;
    basis: string;
    mode: 'idle' | 'continue' | 'review' | 'discuss' | 'stopped';
    stopped?: boolean;
  };
  /** Editable context prepared for a goal discussion in an external Codex session. */
  goalDiscussionDraft?: AnalysisGoalDraft | null;
  /** Runtime discussion shape. Durable turns may be hydrated from Core; unsent input stays local. */
  taskDiscussions?: [string, AnalysisTaskDiscussion][];
  /** Short-lived Project screen position. It never contains action authority. */
  projectNowUi?: ProjectNowUiMemory;
  /** Recent screen state keyed by selected work or by project-level action. */
  projectNowUiByIdentity?: ProjectNowUiMemory[];
  goalDraft: AnalysisGoalDraft | null;
  actionDrafts: [string, AnalysisActionDraft][];
  expanded: string[];
  scroll: number;
};
export interface AnalysisMemory {
  read(projectId: string): ProjectDrafts | null;
  write(projectId: string, state: ProjectDrafts): void;
  /** Prune only after a successful, complete server list. Include disconnected
   * registrations: their drafts still belong to an existing project. */
  prune?(activeIds: readonly string[]): void;
}
