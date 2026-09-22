import type {
  AnalysisWork,
  AnalysisCandidate,
  AnalysisCorrection,
  ContinuationPayload,
  OutputLanguage,
  TaskDiscussionRequest,
  TaskDiscussionResponse,
} from '@statecarry/contracts';
const PROJECT_INSPECTION_THREAD = 'project-inspection';
export type { AnalysisWork, AnalysisCandidate, AnalysisCorrection } from '@statecarry/contracts';
export type AnalysisChangeNotice = {
  projectId: string | null;
  kind?: 'collection-settled';
  topic?: 'profile' | 'sources' | 'observation' | 'working-tree-analysis' | 'overview';
};
export interface AnalysisGateway {
  /** Optional change stream. It updates a displayed brief but never starts analysis. */
  subscribe?(
    listener: (change?: AnalysisChangeNotice) => void,
    onConnection?: (state: 'connected' | 'disconnected') => void,
  ): () => void;
  list(): Promise<AnalysisWork[]>;
  setGoal(projectId: string, text: string, version: string): Promise<void>;
  setCoordination?(projectId: string, threadId: string | null, version: string): Promise<void>;
  refresh(projectId: string, outputLanguage?: OutputLanguage): Promise<void>;
  correct(projectId: string, correction: AnalysisCorrection): Promise<void>;
  discussTask?(projectId: string, input: TaskDiscussionRequest): Promise<TaskDiscussionResponse>;
}

/**
 * User facing labels and targets for the compact Resume surface.  The API
 * contract intentionally keeps stable enum values; this presentation layer
 * is the only place where those values become copy shown to a person.
 */
export type AnalysisCandidateViewModel = AnalysisCandidate & {
  /** The intended result, named for the way it is presented on screen. */
  purpose: string;
  statusLabel: string;
  statusHeading: string;
  actionAvailable: boolean;
  actionSourceLabel: string | null;
  roleLabel: string;
  actorLabel: string;
  utteranceTypeLabel: string;
  target: AnalysisTargetViewModel;
};

export type AnalysisTargetDescriptor = {
  mode: 'existing-conversation' | 'new-session' | 'coordination-conversation';
  available: boolean;
  label: string;
  detail: string;
  url?: string;
};

export type AnalysisTargetViewModel = {
  existing: AnalysisTargetDescriptor;
  newSession: AnalysisTargetDescriptor;
  coordination: AnalysisTargetDescriptor;
};

/**
 * Normalized state for the Resume surface. The transport keeps low-level
 * flags (`busy`, `stale`, `error`, and so on); consumers should use this
 * vocabulary when deciding what to show or allow a person to do.
 */
export type AnalysisWorkState =
  | 'ready'
  | 'checking'
  | 'limited'
  | 'empty'
  | 'unavailable'
  | 'failed';
export type AnalysisState = AnalysisWorkState;

export type AnalysisWorkStatus = {
  state: AnalysisWorkState;
  label: string;
  description: string;
  detail: string;
  blockedActions: string[];
  limitations: string[];
  canAct: boolean;
  canRefresh: boolean;
};

export type CoordinationViewModel = {
  state: 'recommended' | 'unconfirmed' | 'none';
  label: string;
  description: string;
  available: boolean;
  threadId: string | null;
  title: string | null;
  choices: { threadId: string; title: string }[];
  evidence: { revisionId: string; quote: string }[];
};

export type AnalysisWorkViewModel = {
  work: AnalysisWork;
  /** Candidates safe to show in the chooser (dismissed candidates are removed). */
  candidates: AnalysisCandidateViewModel[];
  /** Candidates hidden by a user correction, retained for restore. */
  dismissed: AnalysisCandidateViewModel[];
  selected: AnalysisCandidateViewModel | null;
  selectionNeedsReview: boolean;
  status: AnalysisWorkStatus;
  state: AnalysisWorkState;
  stateLabel: string;
  stateDescription: string;
  stateDetail: string;
  statusDetail: string;
  blockedActions: string[];
  limitations: string[];
};

/** Short aliases for consumers that treat the focused work as the Resume model. */
export type AnalysisViewModel = AnalysisWorkViewModel;

/**
 * Compact compatibility copy for callers that still render two progress
 * paragraphs. The current-state summary is already the model-produced account
 * of what changed, so keep that concrete content instead of replacing it with
 * an evidence-count-derived generic sentence.
 */
export type AnalysisProgressViewModel = { completed: string; remaining: string };

function distinctNarrativeText(value: string | null | undefined, previous: string): string | null {
  const text = value?.trim();
  return text && text !== previous.trim() ? text : null;
}

export function presentResumeProgress(candidate: AnalysisCandidate): AnalysisProgressViewModel {
  const completed = candidate.currentState.trim() || candidate.goal.trim();
  const reason = distinctNarrativeText(candidate.reason, completed);
  const remaining =
    reason ??
    (candidate.status === 'active' && candidate.nextAction
      ? candidate.nextAction
      : candidate.status === 'waiting'
        ? 'A required input is still missing before work can continue.'
        : candidate.status === 'paused'
          ? 'This work remains paused until you choose to resume it.'
          : candidate.status === 'unclear'
            ? 'The available records do not yet establish what should happen next.'
            : 'No further action is recorded in this brief.');
  return { completed, remaining };
}

export type AnalysisNarrativeViewModel = {
  purpose: string;
  currentState: string;
  evidenceNote: string | null;
  transitionHeading: string | null;
  transition: string | null;
  nextAction: string | null;
  doneWhen: string | null;
};

function narrativeEvidenceNote(candidate: AnalysisCandidate): string | null {
  const progress = candidate.progress;
  const completion = candidate.completion;
  const reported = !!(progress?.reported?.length || completion?.reported?.length);
  const implemented = !!progress?.implemented?.length;
  const verified = !!(progress?.verified?.length || completion?.verified?.length);
  const completionReported = !!completion?.reported?.length;
  const completionVerified = !!completion?.verified?.length;

  if (completionVerified) return 'A completion check is recorded for this result.';
  if (completionReported)
    return 'Completion is reported in the connected records; independent verification is not recorded.';
  if (implemented && verified)
    return 'Project evidence records implementation, and an independent check is also recorded.';
  if (implemented)
    return 'Project evidence records implementation; independent verification is not recorded yet.';
  if (reported && verified)
    return 'Connected records report progress, and an independent check is also recorded.';
  if (reported)
    return 'Connected records report progress; independent verification is not recorded yet.';
  if (verified) return 'An independent check is recorded for part of this work.';
  return null;
}

/**
 * Present one compact return narrative from facts that are already in the
 * Resume contract. It never turns stale/blocked action text into an executable
 * next step and never copies raw evidence quotes into the default body.
 */
export function presentResumeNarrative(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): AnalysisNarrativeViewModel {
  const purpose = (work.goalText ?? candidate.goal).trim();
  const currentState = candidate.currentState.trim() || purpose;
  const status = analysisWorkStatus(work);
  const canShowAction =
    candidate.status === 'active' &&
    candidate.actionAvailable &&
    status.canAct &&
    !!candidate.nextAction &&
    !!candidate.doneWhen;
  const reason = distinctNarrativeText(candidate.reason, currentState);

  if (canShowAction) {
    return {
      purpose,
      currentState,
      evidenceNote: narrativeEvidenceNote(candidate),
      transitionHeading: reason ? 'Why this is next' : null,
      transition: reason,
      nextAction: candidate.nextAction,
      doneWhen: candidate.doneWhen,
    };
  }

  const blockedActive = candidate.status === 'active';
  const transition = blockedActive
    ? !status.canAct
      ? distinctNarrativeText(status.description, currentState)
      : reason
    : reason;
  return {
    purpose,
    currentState,
    evidenceNote: narrativeEvidenceNote(candidate),
    transitionHeading: transition
      ? blockedActive
        ? 'Before continuing'
        : candidate.statusHeading
      : null,
    transition,
    nextAction: null,
    doneWhen: null,
  };
}

export const analysisProgressSummary = presentResumeProgress;

/** Build the transport-neutral context for a follow-up session.
 * The screen only requests this prepared payload; it does not decide which
 * records count as evidence or which constraints must travel with the work.
 */
export function continuationPayload(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): ContinuationPayload | null {
  // Continuation is an executable handoff. Never promote waiting, paused,
  // unclear, or completed candidates even if an old record still contains
  // stale action text.
  if (
    candidate.status !== 'active' ||
    candidate.actionAvailable === false ||
    !candidate.nextAction ||
    !candidate.doneWhen
  )
    return null;
  const evidence = [
    ...candidate.evidence,
    ...(candidate.progress?.reported ?? []),
    ...(candidate.progress?.implemented ?? []),
    ...(candidate.progress?.verified ?? []),
    ...(candidate.completion?.reported ?? []),
    ...(candidate.completion?.verified ?? []),
  ]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) => other.revisionId === item.revisionId && other.quote === item.quote,
        ) === index,
    )
    .slice(0, 20);
  return {
    goal: work.goalText ?? candidate.goal,
    goalConfirmed: !!work.goalText,
    currentState: candidate.currentState,
    nextAction: candidate.nextAction,
    constraints: [
      ...new Set([
        ...candidate.prerequisites,
        ...(work.workspace?.limitations ?? []).map(handoffLimitation),
        ...(work.limitations ?? []).map(handoffLimitation),
        ...(work.error ? [handoffLimitation(work.error)] : []),
        ...(work.coordination && work.coordination.state !== 'none'
          ? [work.coordination.detail]
          : []),
      ]),
    ].slice(0, 20),
    doneWhen: candidate.doneWhen,
    previousThreadId: candidate.threadId === PROJECT_INSPECTION_THREAD ? null : candidate.threadId,
    evidence,
  };
}

function handoffLimitation(value: string): string {
  if (/workspace state could not be checked|git\s+-C|not a git repository/i.test(value))
    return 'The current project state could not be confirmed.';
  if (/file observations? (?:was|were) limited|read limit|source files/i.test(value))
    return 'Only part of the project files could be checked.';
  if (/could not read|unavailable|partial|incomplete|coverage/i.test(value))
    return 'Some connected records or project files could not be fully checked.';
  return value.length > 240 ? 'Some connected records could not be fully checked.' : value;
}

type CandidateMetadata = {
  role?: string | null;
  actor?: string | null;
  utteranceType?: string | null;
  nature?: string | null;
};

const statusLabels: Record<AnalysisCandidate['status'], string> = {
  active: 'Ready for the next action',
  waiting: 'Waiting for a required input',
  paused: 'Paused until you choose to resume',
  unclear: 'Needs a decision before continuing',
  done: 'Reported as complete',
};

const statusHeadings: Record<AnalysisCandidate['status'], string> = {
  active: 'Next action',
  waiting: 'What is waiting',
  paused: 'Why it is paused',
  unclear: 'What needs deciding',
  done: 'Completion reported',
};

const actionSourceLabels: Record<NonNullable<AnalysisCandidate['actionSource']>, string> = {
  recorded: 'Recorded in the conversation',
  suggested: 'Suggested from the conversation · check before starting',
};

const roleLabels: Record<string, string> = {
  work: 'Work records',
  'controlled-verification': 'Verification conversation',
};

const actorLabels: Record<string, string> = {
  user: 'Your message',
  agent: 'Codex response',
  tool: 'Tool result',
  system: 'System record',
};

const utteranceTypeLabels: Record<string, string> = {
  'user-request': 'Your request',
  'user-decision': 'Your decision',
  'agent-report': 'Codex report',
  'agent-proposal': 'Codex proposal',
  'agent-interpretation': 'Codex interpretation',
  'tool-result': 'Tool output',
  'file-observation': 'File observation',
};

export function analysisStatusLabel(status: AnalysisCandidate['status']) {
  return statusLabels[status];
}
export function analysisActionSourceLabel(source: AnalysisCandidate['actionSource']) {
  return source ? actionSourceLabels[source] : null;
}
export function analysisRoleLabel(role: string | null | undefined) {
  return role ? (roleLabels[role] ?? 'Connected conversation') : 'Connected conversation';
}
export function analysisActorLabel(actor: string | null | undefined) {
  return actor ? (actorLabels[actor] ?? 'Conversation record') : 'Conversation record';
}
export function analysisUtteranceTypeLabel(type: string | null | undefined) {
  return type ? (utteranceTypeLabels[type] ?? 'Conversation record') : 'Conversation record';
}
/** Alias for callers that use the contracts' existing "nature" name. */
export function analysisNatureLabel(nature: string | null | undefined) {
  return analysisUtteranceTypeLabel(nature);
}

function targetFor(candidate: AnalysisCandidate, work: AnalysisWork): AnalysisTargetViewModel {
  const inspectionOnly = candidate.threadId === PROJECT_INSPECTION_THREAD;
  const url = `codex://threads/${encodeURIComponent(candidate.threadId)}`;
  const currentEnough =
    !work.stale && !work.updatesAvailable && !work.workspaceChanged && !work.busy && !work.error;
  const sessionReady =
    candidate.status === 'active' &&
    !!candidate.nextAction &&
    !!candidate.doneWhen &&
    currentEnough &&
    analysisWorkStatus(work).canAct &&
    work.session?.create === 'supported' &&
    work.session.send === 'supported';
  // Older callers do not provide navigation capability; preserve their
  // existing deep-link behavior. A server that has checked the capability
  // must not present an unsupported route as an executable action.
  const navigationReady = work.navigation
    ? work.navigation.precision === 'thread' &&
      (!work.navigation.state || work.navigation.state === 'verified-route')
    : true;
  const coordination = work.coordination ?? null;
  const coordinationReady =
    navigationReady && coordination?.state === 'recommended' && !!coordination.threadId;
  return {
    existing: {
      mode: 'existing-conversation',
      available: navigationReady && !inspectionOnly,
      ...(navigationReady && !inspectionOnly ? { url } : {}),
      label: inspectionOnly ? 'Project inspection source' : 'Open the recorded conversation',
      detail: inspectionOnly
        ? 'This overview came from the local project inspection, so there is no Codex conversation to open.'
        : navigationReady
          ? 'Opens the connected Codex conversation. It does not send or execute the next action.'
          : (work.navigation?.detail ??
            'Opening the connected conversation is not available here.'),
    },
    newSession: {
      mode: 'new-session',
      available: sessionReady,
      label: 'Start a new Codex session',
      detail: !currentEnough
        ? 'Recheck the current records before starting a new session; this brief may be out of date.'
        : sessionReady
          ? 'Create a new session with this work summary and a link to the recorded conversation.'
          : (work.session?.detail ??
            'Creating a new session is not connected here. Use the recorded conversation to keep the existing work together.'),
    },
    coordination: {
      mode: 'coordination-conversation',
      available: coordinationReady,
      ...(coordinationReady
        ? { url: `codex://threads/${encodeURIComponent(coordination!.threadId!)}` }
        : {}),
      label:
        coordination?.state === 'recommended'
          ? 'Open coordination conversation'
          : 'Check for a coordination conversation',
      detail:
        coordination?.detail ?? 'The role of each connected conversation has not been confirmed.',
    },
  };
}

function candidateView(
  candidate: AnalysisCandidate,
  work: AnalysisWork,
): AnalysisCandidateViewModel {
  const metadata = candidate as AnalysisCandidate & CandidateMetadata;
  const status = analysisWorkStatus(work);
  const actionAvailable =
    candidate.status === 'active' &&
    !!candidate.nextAction &&
    !!candidate.doneWhen &&
    !!candidate.actionSource &&
    status.canAct;
  return {
    ...candidate,
    purpose: candidate.goal,
    statusLabel:
      candidate.status === 'active' && !actionAvailable
        ? 'Review required before the next action'
        : analysisStatusLabel(candidate.status),
    statusHeading: statusHeadings[candidate.status],
    // A candidate backed by an older snapshot remains readable, but cannot be
    // turned into a new action until the changed records have been checked.
    actionAvailable,
    actionSourceLabel: analysisActionSourceLabel(candidate.actionSource),
    roleLabel: analysisRoleLabel(metadata.role),
    actorLabel: analysisActorLabel(metadata.actor),
    utteranceTypeLabel: analysisUtteranceTypeLabel(metadata.utteranceType ?? metadata.nature),
    target: targetFor(candidate, work),
  };
}

const workStateLabels: Record<AnalysisWorkState, string> = {
  ready: 'Ready to resume',
  checking: 'Checking connected records',
  limited: 'Review needed before continuing',
  empty: 'No resume work found',
  unavailable: 'Connected records unavailable',
  failed: 'Could not check connected records',
};

const workStateDescriptions: Record<AnalysisWorkState, string> = {
  ready:
    'A current resume brief is ready. Review the next action and its completion condition before starting.',
  checking:
    'StateCarry is checking the connected records for a safe place to resume. Actions that depend on this check are paused.',
  limited:
    'A previous brief is available, but some current project or record checks are missing. Review the limits before acting.',
  empty:
    'No resume candidate was found in the connected records yet. Check the connection or add the missing records, then try again.',
  unavailable:
    'The connected records are unavailable, so StateCarry cannot establish where to resume. Check the connection and try again.',
  failed:
    'The latest records could not be checked. Your previous brief is kept; retry the check or open the recorded conversation to inspect it.',
};

/** Return all current limitations without leaking them into the main goal copy. */
function workLimitations(work: AnalysisWork): string[] {
  const values = [
    ...(work.limitations ?? []),
    ...(work.workspace?.limitations ?? []),
    ...(work.workspace && work.workspace.status !== 'checked'
      ? ['The current project state could not be confirmed.']
      : []),
    ...(work.workspaceChanged ? ['The project changed since this brief was captured.'] : []),
    ...(work.updatesAvailable
      ? ['New connected records arrived after this brief was captured.']
      : []),
    ...(work.stale
      ? ['This brief needs a fresh check before its next action can be trusted.']
      : []),
    ...(work.generatedAt === null && work.candidates.length
      ? ['The time this brief was checked is unavailable.']
      : []),
  ];
  return [...new Set(values.filter(Boolean))].slice(0, 20);
}

/**
 * Combine persisted Resume flags into a user-facing state and action policy.
 * This function is deliberately pure so it can be checked without rendering
 * the application or contacting the gateway.
 */
export function analysisWorkStatus(work: AnalysisWork): AnalysisWorkStatus {
  const limitations = workLimitations(work);
  // Limit descriptions are context, not an instruction to re-run analysis.
  // Currentness flags and explicit producer blocks decide action availability.
  const needsReview =
    work.stale ||
    work.updatesAvailable ||
    !!work.workspaceChanged ||
    !!work.error ||
    (!!work.workspace && work.workspace.status !== 'checked') ||
    (work.generatedAt === null && work.candidates.length > 0) ||
    !!work.blockedActions?.length;
  let state: AnalysisWorkState;
  // `state` is produced by Core and distinguishes a retained last brief
  // (`limited`) from a first-check failure (`failed`). Prefer it whenever it
  // is present; only the live busy flag supersedes it while a check runs.
  if (work.busy) state = 'checking';
  else if (work.state) state = work.state;
  else if (work.error) state = 'failed';
  else if (!work.generatedAt && !work.candidates.length) state = 'unavailable';
  else if (!work.candidates.length) state = 'empty';
  else if (needsReview) state = 'limited';
  else state = 'ready';
  if (state === 'ready' && !work.candidates.length) state = 'empty';
  // A ready label must not override stale inputs or an actual action block.
  if (state === 'ready' && needsReview) state = 'limited';

  const blockedActions = work.blockedActions?.length
    ? [...new Set(work.blockedActions)]
    : state === 'ready'
      ? []
      : state === 'limited'
        ? ['start-session', 'send-continuation']
        : ['resume', 'start-session', 'send-continuation'];
  const description =
    work.state && state !== work.state
      ? workStateDescriptions[state]
      : work.stateDetail?.trim() || workStateDescriptions[state];
  return {
    state,
    label: workStateLabels[state],
    description,
    detail: description,
    blockedActions,
    limitations,
    canAct: state === 'ready' && blockedActions.length === 0,
    canRefresh: state !== 'checking',
  };
}

/** Short aliases used by integrations that consume one field at a time. */
export const presentResumeStatus = analysisWorkStatus;
export function analysisWorkState(work: AnalysisWork): AnalysisWorkState {
  return analysisWorkStatus(work).state;
}
export function analysisStateLabel(state: AnalysisWorkState): string {
  return workStateLabels[state];
}
export function analysisStateDescription(state: AnalysisWorkState): string {
  return workStateDescriptions[state];
}
export const analysisWorkStateLabel = analysisStateLabel;
export const analysisWorkStateDescription = analysisStateDescription;

/** Present explicit coordination assignment without inferring it from a word. */
export function presentCoordination(work: AnalysisWork): CoordinationViewModel {
  const coordination = work.coordination;
  if (!coordination || coordination.state === 'none')
    return {
      state: 'none',
      label: 'No coordination conversation selected',
      description: 'The connected conversations do not have a confirmed overall-progress role.',
      available: false,
      threadId: null,
      title: null,
      choices: work.coordinationChoices ?? [],
      evidence: [],
    };
  if (coordination.state === 'recommended')
    return {
      state: 'recommended',
      label: 'Coordination conversation',
      description: coordination.detail,
      available: !!coordination.threadId,
      threadId: coordination.threadId,
      title: coordination.title,
      choices: work.coordinationChoices ?? [],
      evidence: coordination.evidence,
    };
  return {
    state: 'unconfirmed',
    label: 'Coordination role unconfirmed',
    description: coordination.detail,
    available: false,
    threadId: null,
    title: coordination.title,
    choices: work.coordinationChoices ?? [],
    evidence: coordination.evidence,
  };
}

export const coordinationView = presentCoordination;

export type ManualContinuation = {
  payload: ContinuationPayload;
  /** Stable plain-text message that can be pasted into a Codex conversation. */
  text: string;
};

function continuationTextFromPayload(payload: ContinuationPayload): string {
  const lines = [
    'Continue this work from the connected StateCarry brief.',
    `Goal: ${payload.goal ?? 'No goal has been confirmed yet.'}`,
    `Current state: ${payload.currentState}`,
    `Next action: ${payload.nextAction}`,
    `Done when: ${payload.doneWhen}`,
  ];
  if (payload.goalConfirmed === false)
    lines.splice(2, 0, 'Goal status: Inferred from connected records; confirm it before acting.');
  const constraints = (payload.constraints ?? []).filter(Boolean);
  lines.push('Constraints:');
  if (constraints.length) for (const constraint of constraints) lines.push(`- ${constraint}`);
  else lines.push('- None recorded');
  if (payload.evidence?.length) {
    lines.push('Related records:');
    for (const item of payload.evidence) lines.push(`- ${item.quote} (record ${item.revisionId})`);
  }
  if (payload.previousThreadId) lines.push(`Previous conversation: ${payload.previousThreadId}`);
  lines.push(
    'Confirm the current state before changing files, then report the result against the done-when condition.',
  );
  return lines.join('\n');
}

/**
 * Build a deterministic manual handoff. It has no browser or gateway
 * dependency, so a disconnected environment can still provide a useful
 * continuation path.
 */
export function manualContinuation(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): ManualContinuation | null {
  const payload = continuationPayload(candidate, work);
  return payload ? { payload, text: continuationTextFromPayload(payload) } : null;
}

/** Return only the pasteable text for callers that do not need the payload. */
export function manualContinuationText(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): string | null {
  return manualContinuation(candidate, work)?.text ?? null;
}

/**
 * Build the manual path for a brief that cannot be acted on yet.  This stays
 * beside continuationPayload so the UI never has to decide which evidence or
 * limitations belong in a review handoff.
 */
export function manualReviewContinuationText(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): string {
  const constraints = [
    ...new Set(
      [
        ...candidate.prerequisites,
        ...(work.workspace?.limitations ?? []).map(handoffLimitation),
        ...(work.limitations ?? []).map(handoffLimitation),
        ...(work.error ? [handoffLimitation(work.error)] : []),
        ...(work.coordination && work.coordination.state !== 'none'
          ? [work.coordination.detail]
          : []),
      ].filter(Boolean),
    ),
  ].slice(0, 20);
  const evidence = [
    ...candidate.evidence,
    ...(candidate.progress?.reported ?? []),
    ...(candidate.progress?.implemented ?? []),
    ...(candidate.progress?.verified ?? []),
    ...(candidate.completion?.reported ?? []),
    ...(candidate.completion?.verified ?? []),
  ]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) => other.revisionId === item.revisionId && other.quote === item.quote,
        ) === index,
    )
    .slice(0, 20);
  return [
    'Review the saved StateCarry brief before continuing.',
    `Goal: ${work.goalText ?? candidate.goal}`,
    `Current state: ${candidate.currentState}`,
    `Next action: ${candidate.nextAction ?? 'Confirm the next action from the connected records.'}`,
    `Constraints: ${constraints.length ? constraints.join('; ') : 'None recorded'}`,
    `Done when: ${candidate.doneWhen ?? 'Record the completion check after the next action is confirmed.'}`,
    candidate.threadId === PROJECT_INSPECTION_THREAD
      ? 'Previous source: local project inspection'
      : `Previous conversation: ${candidate.threadId}`,
    evidence.length ? `Evidence:\n${evidence.map((item) => `- ${item.quote}`).join('\n')}` : '',
    'Confirm the current project and record state before changing files.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Return the only manual handoff copy the Resume UI needs. */
export function analysisHandoffText(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): string {
  return manualContinuationText(candidate, work) ?? manualReviewContinuationText(candidate, work);
}

/** Stable aliases for adapters that call the handoff a brief or a message. */
export const continuationBrief = manualContinuation;
export const continuationMessage = manualContinuationText;
export const buildContinuationText = manualContinuationText;
export const handoffText = manualContinuationText;

/**
 * Render an already prepared payload when a gateway has done the candidate
 * selection itself. The overload keeps the same deterministic format as the
 * candidate/work helper above.
 */
export function continuationText(payload: ContinuationPayload): string;
export function continuationText(
  candidate: AnalysisCandidateViewModel,
  work: AnalysisWork,
): string | null;
export function continuationText(
  first: ContinuationPayload | AnalysisCandidateViewModel,
  work?: AnalysisWork,
): string | null {
  if (work) return manualContinuationText(first as AnalysisCandidateViewModel, work);
  return continuationTextFromPayload(first as ContinuationPayload);
}

/**
 * Build the Resume-specific view model. Selection is a presentation concern:
 * callers can pass a candidate key while the returned model filters dismissed
 * candidates and picks the active candidate by default.
 */
export function presentProjectAnalysis(
  work: AnalysisWork,
  selectedKey?: string,
): AnalysisWorkViewModel {
  const all = work.candidates.map((candidate) => candidateView(candidate, work));
  const dismissedKeys = new Set(work.dismissedKeys);
  const candidates = all.filter((candidate) => !dismissedKeys.has(candidate.key));
  const dismissed = all.filter((candidate) => dismissedKeys.has(candidate.key));
  const selected =
    selectedKey === undefined
      ? (candidates.find((candidate) => candidate.status === 'active') ?? candidates[0] ?? null)
      : (candidates.find((candidate) => candidate.key === selectedKey) ?? null);
  const status = analysisWorkStatus(work);
  return {
    work,
    candidates,
    dismissed,
    selected,
    selectionNeedsReview: selectedKey !== undefined && selected === null,
    status,
    state: status.state,
    stateLabel: status.label,
    stateDescription: status.description,
    stateDetail: status.description,
    statusDetail: status.description,
    blockedActions: status.blockedActions,
    limitations: status.limitations,
  };
}
