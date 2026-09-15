import type {
  ResumeWork,
  ResumeCandidate,
  ResumeCorrection,
  Continuation,
  ContinuationPayload,
  Receipt,
} from '@statecarry/contracts';
export type {
  ResumeWork,
  ResumeCandidate,
  ResumeCorrection,
  Continuation,
} from '@statecarry/contracts';
export interface ResumeGateway {
  /** Optional change stream. It updates a displayed brief but never starts analysis. */
  subscribe?(listener: () => void): () => void;
  list(): Promise<ResumeWork[]>;
  setGoal(workId: string, text: string, version: string): Promise<void>;
  setCoordination?(workId: string, threadId: string | null, version: string): Promise<void>;
  refresh(workId: string): Promise<void>;
  correct(workId: string, correction: ResumeCorrection): Promise<void>;
  prepareContinuation?(
    workId: string,
    revision: number,
    input: {
      targetMode: 'new-session' | 'existing-session';
      threadId?: string | null;
      payload: ContinuationPayload;
    },
  ): Promise<Continuation>;
  sendContinuation?(workId: string, revision: number, continuationId: string): Promise<Receipt>;
  openContinuation?(workId: string, revision: number, continuationId: string): Promise<Receipt>;
  continuation?(workId: string, id: string): Promise<Continuation>;
}

/**
 * User facing labels and targets for the compact Resume surface.  The API
 * contract intentionally keeps stable enum values; this presentation layer
 * is the only place where those values become copy shown to a person.
 */
export type ResumeCandidateViewModel = ResumeCandidate & {
  /** The intended result, named for the way it is presented on screen. */
  purpose: string;
  statusLabel: string;
  statusHeading: string;
  actionAvailable: boolean;
  actionSourceLabel: string | null;
  roleLabel: string;
  actorLabel: string;
  utteranceTypeLabel: string;
  target: ResumeTargetViewModel;
};

export type ResumeTargetDescriptor = {
  mode: 'existing-conversation' | 'new-session' | 'coordination-conversation';
  available: boolean;
  label: string;
  detail: string;
  url?: string;
};

export type ResumeTargetViewModel = {
  existing: ResumeTargetDescriptor;
  newSession: ResumeTargetDescriptor;
  coordination: ResumeTargetDescriptor;
};

/**
 * Normalized state for the Resume surface. The transport keeps low-level
 * flags (`busy`, `stale`, `error`, and so on); consumers should use this
 * vocabulary when deciding what to show or allow a person to do.
 */
export type ResumeWorkState = 'ready' | 'checking' | 'limited' | 'empty' | 'unavailable' | 'failed';
export type ResumeState = ResumeWorkState;

export type ResumeWorkStatus = {
  state: ResumeWorkState;
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

export type ResumeWorkViewModel = {
  work: ResumeWork;
  /** Candidates safe to show in the chooser (dismissed candidates are removed). */
  candidates: ResumeCandidateViewModel[];
  /** Candidates hidden by a user correction, retained for restore. */
  dismissed: ResumeCandidateViewModel[];
  selected: ResumeCandidateViewModel | null;
  selectionNeedsReview: boolean;
  status: ResumeWorkStatus;
  state: ResumeWorkState;
  stateLabel: string;
  stateDescription: string;
  stateDetail: string;
  statusDetail: string;
  blockedActions: string[];
  limitations: string[];
};

/** Short aliases for consumers that treat the focused work as the Resume model. */
export type ResumeViewModel = ResumeWorkViewModel;

/**
 * Goal-oriented progress copy for the compact Resume card. Evidence counts
 * are deliberately not shown here: several citations can support one result,
 * so the person needs a statement about the result and the remaining check.
 */
export type ResumeProgressViewModel = { completed: string; remaining: string };

export function presentResumeProgress(candidate: ResumeCandidate): ResumeProgressViewModel {
  const progress = candidate.progress;
  const completion = candidate.completion;
  const hasReported = !!(progress?.reported?.length || completion?.reported?.length);
  const hasImplemented = !!progress?.implemented?.length;
  const hasVerified = !!(progress?.verified?.length || completion?.verified?.length);

  let completed: string;
  if (candidate.status === 'done' && hasVerified) {
    completed = 'The result is reported complete and an independent check is recorded.';
  } else if (candidate.status === 'done') {
    completed = 'The connected conversation reports that the result is complete.';
  } else if (hasImplemented && hasVerified) {
    completed = 'The implementation is recorded and part of it has an independent check.';
  } else if (hasImplemented) {
    completed = 'The implementation is recorded in project evidence.';
  } else if (hasVerified) {
    completed = 'An independent check is recorded for part of this result.';
  } else if (hasReported) {
    completed = 'The connected conversation reports progress toward this result.';
  } else {
    completed = 'No part of this result is independently confirmed yet.';
  }

  let remaining: string;
  if (candidate.status === 'active') {
    remaining = hasVerified
      ? 'The next action still needs to be completed and checked before this result is finished.'
      : 'The recorded progress still needs an independent check before this result is finished.';
  } else if (candidate.status === 'waiting') {
    remaining = 'A required input is still missing before work can continue.';
  } else if (candidate.status === 'paused') {
    remaining = 'Choose resume when you are ready to continue this result.';
  } else if (candidate.status === 'unclear') {
    remaining = 'Decide what the available records mean before continuing.';
  } else {
    remaining = hasVerified
      ? 'No further action is recorded in this brief.'
      : 'Independent verification is still needed before treating this as finished.';
  }
  return { completed, remaining };
}

export const resumeProgressSummary = presentResumeProgress;

/** Build the transport-neutral context for a follow-up session.
 * The screen only requests this prepared payload; it does not decide which
 * records count as evidence or which constraints must travel with the work.
 */
export function continuationPayload(
  candidate: ResumeCandidateViewModel,
  work: ResumeWork,
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
    previousThreadId: candidate.threadId,
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

const statusLabels: Record<ResumeCandidate['status'], string> = {
  active: 'Ready for the next action',
  waiting: 'Waiting for a required input',
  paused: 'Paused until you choose to resume',
  unclear: 'Needs a decision before continuing',
  done: 'Reported as complete',
};

const statusHeadings: Record<ResumeCandidate['status'], string> = {
  active: 'Next action',
  waiting: 'What is waiting',
  paused: 'Why it is paused',
  unclear: 'What needs deciding',
  done: 'Completion reported',
};

const actionSourceLabels: Record<NonNullable<ResumeCandidate['actionSource']>, string> = {
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

export function resumeStatusLabel(status: ResumeCandidate['status']) {
  return statusLabels[status];
}
export function resumeActionSourceLabel(source: ResumeCandidate['actionSource']) {
  return source ? actionSourceLabels[source] : null;
}
export function resumeRoleLabel(role: string | null | undefined) {
  return role ? (roleLabels[role] ?? 'Connected conversation') : 'Connected conversation';
}
export function resumeActorLabel(actor: string | null | undefined) {
  return actor ? (actorLabels[actor] ?? 'Conversation record') : 'Conversation record';
}
export function resumeUtteranceTypeLabel(type: string | null | undefined) {
  return type ? (utteranceTypeLabels[type] ?? 'Conversation record') : 'Conversation record';
}
/** Alias for callers that use the contracts' existing "nature" name. */
export function resumeNatureLabel(nature: string | null | undefined) {
  return resumeUtteranceTypeLabel(nature);
}

function targetFor(candidate: ResumeCandidate, work: ResumeWork): ResumeTargetViewModel {
  const url = `codex://threads/${encodeURIComponent(candidate.threadId)}`;
  const currentEnough =
    !work.stale && !work.updatesAvailable && !work.workspaceChanged && !work.busy && !work.error;
  const sessionReady =
    candidate.status === 'active' &&
    !!candidate.nextAction &&
    !!candidate.doneWhen &&
    currentEnough &&
    resumeWorkStatus(work).canAct &&
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
      available: navigationReady,
      ...(navigationReady ? { url } : {}),
      label: 'Open the recorded conversation',
      detail: navigationReady
        ? 'Opens the connected Codex conversation. It does not send or execute the next action.'
        : (work.navigation?.detail ?? 'Opening the connected conversation is not available here.'),
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

function candidateView(candidate: ResumeCandidate, work: ResumeWork): ResumeCandidateViewModel {
  const metadata = candidate as ResumeCandidate & CandidateMetadata;
  const status = resumeWorkStatus(work);
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
        : resumeStatusLabel(candidate.status),
    statusHeading: statusHeadings[candidate.status],
    // A candidate backed by an older snapshot remains readable, but cannot be
    // turned into a new action until the changed records have been checked.
    actionAvailable,
    actionSourceLabel: resumeActionSourceLabel(candidate.actionSource),
    roleLabel: resumeRoleLabel(metadata.role),
    actorLabel: resumeActorLabel(metadata.actor),
    utteranceTypeLabel: resumeUtteranceTypeLabel(metadata.utteranceType ?? metadata.nature),
    target: targetFor(candidate, work),
  };
}

const workStateLabels: Record<ResumeWorkState, string> = {
  ready: 'Ready to resume',
  checking: 'Checking connected records',
  limited: 'Review needed before continuing',
  empty: 'No resume work found',
  unavailable: 'Connected records unavailable',
  failed: 'Could not check connected records',
};

const workStateDescriptions: Record<ResumeWorkState, string> = {
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
function workLimitations(work: ResumeWork): string[] {
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
export function resumeWorkStatus(work: ResumeWork): ResumeWorkStatus {
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
  let state: ResumeWorkState;
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
  return {
    state,
    label: workStateLabels[state],
    description: work.stateDetail?.trim() || workStateDescriptions[state],
    detail: work.stateDetail?.trim() || workStateDescriptions[state],
    blockedActions,
    limitations,
    canAct: state === 'ready' && blockedActions.length === 0,
    canRefresh: state !== 'checking',
  };
}

/** Short aliases used by integrations that consume one field at a time. */
export const presentResumeStatus = resumeWorkStatus;
export function resumeWorkState(work: ResumeWork): ResumeWorkState {
  return resumeWorkStatus(work).state;
}
export function resumeStateLabel(state: ResumeWorkState): string {
  return workStateLabels[state];
}
export function resumeStateDescription(state: ResumeWorkState): string {
  return workStateDescriptions[state];
}
export const resumeWorkStateLabel = resumeStateLabel;
export const resumeWorkStateDescription = resumeStateDescription;

/** Present explicit coordination assignment without inferring it from a word. */
export function presentCoordination(work: ResumeWork): CoordinationViewModel {
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
  candidate: ResumeCandidateViewModel,
  work: ResumeWork,
): ManualContinuation | null {
  const payload = continuationPayload(candidate, work);
  return payload ? { payload, text: continuationTextFromPayload(payload) } : null;
}

/** Return only the pasteable text for callers that do not need the payload. */
export function manualContinuationText(
  candidate: ResumeCandidateViewModel,
  work: ResumeWork,
): string | null {
  return manualContinuation(candidate, work)?.text ?? null;
}

/**
 * Build the manual path for a brief that cannot be acted on yet.  This stays
 * beside continuationPayload so the UI never has to decide which evidence or
 * limitations belong in a review handoff.
 */
export function manualReviewContinuationText(
  candidate: ResumeCandidateViewModel,
  work: ResumeWork,
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
    `Previous conversation: ${candidate.threadId}`,
    evidence.length ? `Evidence:\n${evidence.map((item) => `- ${item.quote}`).join('\n')}` : '',
    'Confirm the current project and record state before changing files.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Return the only manual handoff copy the Resume UI needs. */
export function resumeHandoffText(candidate: ResumeCandidateViewModel, work: ResumeWork): string {
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
  candidate: ResumeCandidateViewModel,
  work: ResumeWork,
): string | null;
export function continuationText(
  first: ContinuationPayload | ResumeCandidateViewModel,
  work?: ResumeWork,
): string | null {
  if (work) return manualContinuationText(first as ResumeCandidateViewModel, work);
  return continuationTextFromPayload(first as ContinuationPayload);
}

/**
 * Build the Resume-specific view model. Selection is a presentation concern:
 * callers can pass a candidate key while the returned model filters dismissed
 * candidates and picks the active candidate by default.
 */
export function presentResumeWork(work: ResumeWork, selectedKey?: string): ResumeWorkViewModel {
  const all = work.candidates.map((candidate) => candidateView(candidate, work));
  const dismissedKeys = new Set(work.dismissedKeys);
  const candidates = all.filter((candidate) => !dismissedKeys.has(candidate.key));
  const dismissed = all.filter((candidate) => dismissedKeys.has(candidate.key));
  const selected =
    selectedKey === undefined
      ? (candidates.find((candidate) => candidate.status === 'active') ?? candidates[0] ?? null)
      : (candidates.find((candidate) => candidate.key === selectedKey) ?? null);
  const status = resumeWorkStatus(work);
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

export const presentResume = presentResumeWork;

/** Old bookmarks now read the same work; only explicit details routes open legacy tools. */
export function resumeRoute(hash: string) {
  if (!hash || hash === '#/projects' || hash === '#/resume') return '#/resume';
  if (hash.startsWith('#/work/')) return hash.replace('#/work/', '#/resume/');
  return hash;
}
