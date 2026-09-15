import type {
  ReturnContextSnapshot,
  SourceRevision,
  ClaimSlot,
  HandoffTarget,
  ProjectListItem,
} from '@statecarry/contracts';
import { presentFlow, type FlowView } from './conversation-flow';
import { userRelationLabel } from './labels';
export type { FlowView } from './conversation-flow';

const slotNames: Record<ClaimSlot, string> = {
  purpose: 'Purpose of this work',
  milestone: 'Key developments',
  current: 'Current status',
  direction: 'Direction',
  next: 'Next action',
  reason: 'Why this action now',
  review: 'Review',
  completion: 'Completion reports',
};
const natureNames: Record<string, string> = {
  'user-report': 'Your report',
  'user-request': 'Your request',
  'user-decision': 'Your decision',
  'agent-report': 'Codex report',
  'agent-interpretation': 'Codex interpretation',
  'agent-proposal': 'Codex proposal',
  'tool-result': 'Tool result',
  'file-observation': 'File observation',
};
const missingNames = {
  'not-in-record': 'Not found in the records read',
  'not-collected': 'The required scope could not be collected',
  ambiguous: 'The interpretation is still ambiguous',
  conflicting: 'The evidence conflicts',
  'freshness-unknown': 'Freshness could not be confirmed',
};
const jobNames: Record<string, string> = {
  queued: 'Waiting for an automatic summary',
  summarizing: 'Summarizing new records',
  checking: 'Checking evidence and meaning',
  applied: 'Summary applied',
  failed: 'Summary failed',
  superseded: 'Stopped after processing assumptions changed',
  'result-unknown': 'Summary response unknown',
};
const collectionNames: Record<string, string> = {
  reading: 'Collecting',
  checked: 'Selected scope checked',
  partial: 'Scope partially checked',
  failed: 'Collection failed',
};
const executionNames: Record<string, string> = {
  completed: 'Turn ended',
  failed: 'Turn failed',
  inProgress: 'Turn in progress',
  interrupted: 'Turn interrupted',
  unknown: 'Turn status unknown',
};
export function userNatureLabel(nature: string | null | undefined) {
  return nature ? (natureNames[nature] ?? 'Conversation record') : 'Conversation record';
}
export function userActorLabel(actor: string | null | undefined) {
  return actor === 'user'
    ? 'Your message'
    : actor === 'agent'
      ? 'Codex response'
      : actor === 'tool'
        ? 'Tool result'
        : actor === 'system'
          ? 'System record'
          : 'Conversation record';
}
export function userRoleLabel(role: string | null | undefined) {
  return role === 'controlled-verification'
    ? 'Verification conversation'
    : role === 'work'
      ? 'Work records'
      : 'Connected conversation';
}
export function userJobStatusLabel(status: string | null | undefined) {
  return status
    ? (jobNames[status] ?? 'Background work status unavailable')
    : 'Background work status unavailable';
}
export function userExecutionLabel(status: string | null | undefined) {
  return status ? (executionNames[status] ?? 'Turn status unavailable') : 'Turn status unavailable';
}
export type ClaimView = {
  id: string;
  slot: ClaimSlot;
  label: string;
  text: string;
  nature: string;
  condition: string | null;
  uncertainty: string | null;
  evidenceIds: string[];
  checkReason: string;
  edited: boolean;
  overlayChanged: boolean;
  flow: FlowView;
};
export type ReturnContextViewModel = {
  inputCapturedAt: string;
  pendingLabel: string | null;
  refreshTiming: string;
  summaryStatusLabel: string;
  scopeNotice: string | null;
  ranges: { label: string; items: { id: string; label: string; accessible: boolean }[] }[];
  priorAttemptError: string | null;
  freshnessLabel: string;
  freshnessReasons: string[];
  lastCollectedAt: string;
  effortLabel: string;
  processingLabel: string;
  viewedEvidenceCount: number;
  viewedSummaryId: string | null;
  viewedAt: string;
  workId: string;
  title: string;
  revision: number;
  summaryId: string | null;
  hasNewSummary: boolean;
  stale: boolean;
  purpose: ClaimView[];
  milestones: ClaimView[];
  current: ClaimView[];
  next: ClaimView[];
  reason: ClaimView[];
  other: ClaimView[];
  sourceCount: number;
  recentEvidenceIds: string[];
  inputCount: number;
  summarizedAt: string;
  model: string;
  jobLabel: string;
  error: string | null;
  retryJobId: string | null;
  checkpoints: {
    id: string;
    title: string;
    label: string;
    at: string;
    count: number;
    limitations: string[];
  }[];
  links: {
    rationale?: string;
    relation?: string;
    id: string;
    threadId: string;
    title: string;
    status: string;
    statusLabel: string;
    revision: number;
    role: string;
    canUndo: boolean;
    evidenceIds: string[];
  }[];
  execution: { id: string; text: string; evidenceId: string; at: string }[];
  limitations: string[];
  navigationDetail: string;
  navigationLabel: string;
  navigationEnabled: boolean;
  reviewLabel: string;
  serverDraft: { revision: number; text: string };
  scope: {
    records?: {
      id: string;
      threadId: string;
      turnId: string;
      itemId: string;
      preview: string;
      actor: string;
    }[];
    recordRanges?: import('@statecarry/contracts').Connection['recordRanges'];
    connectionId: string;
    cwd: string;
    threadIds: string[];
    startTurnIds: Record<string, string>;
    discover: boolean;
    discoveryLabel: string;
  };
  sourceIndex: { id: string; label: string; summarized: boolean }[];
};
export function presentReturnContext(
  snapshot: ReturnContextSnapshot,
  options: {
    timeZone?: string;
    locale?: string;
    baselineSummaryId?: string | null;
    milestoneLimit?: number;
  } = {},
): ReturnContextViewModel {
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(options.locale ?? 'en-US', {
          timeZone: options.timeZone ?? 'Asia/Seoul',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(value))
      : 'Check time unavailable';
  const summary = snapshot.summary;
  const freshness = snapshot.freshness;
  const freshnessLabel = freshness
    ? `${{ unknown: 'Freshness unknown', partial: 'Scope partially checked', checking: 'Checking new records', checked: 'Selected scope checked' }[freshness.collection]} · ${{ missing: 'Waiting for summary', outdated: 'Earlier scope reflected', current: 'Latest collected scope reflected' }[freshness.summary]}`
    : 'Latest checked scope unknown';

  const claims: ClaimView[] = (summary?.claims ?? []).map((c) => {
    const overlay = snapshot.overlays.find((o) => o.slot === c.slot && o.active);
    const storedFlow = snapshot.conversationFlows?.find(
      (f) =>
        f.summaryId === summary!.id &&
        f.claimId === c.id &&
        f.items.some((i) => i.claimId === c.id) &&
        f.sourceRevisionIds.length === summary!.sourceRevisionIds.length &&
        f.sourceRevisionIds.every((id) => summary!.sourceRevisionIds.includes(id)),
    );
    const flow = presentFlow(
      storedFlow ?? {
        id: `flow:${JSON.stringify([summary!.id, c.id])}`,
        summaryId: summary!.id,
        claimId: c.id,
        sourceRevisionIds: summary!.sourceRevisionIds,
        limitations: [
          'The previous explanation run has not been confirmed to have ended. Automatic retry is stopped.',
          ...summary!.limitations,
        ],
        items: [
          {
            id: `flow-item:${JSON.stringify([summary!.id, c.id])}`,
            claimId: c.id,
            type: c.nature,
            summary: c.text ?? 'This stage is unconfirmed.',
            condition: c.condition,
            status: 'limited',
            checkReason: c.checkReason,
            limitations: ['Open the source to check its attribution.'],
            sources: c.evidence.map((ref) => ({
              ...ref,
              available: true,
              quoteStarts: [],
              threadId: null,
              turnId: null,
              itemId: null,
              actor: null,
              eventAt: null,
              observedAt: null,
              locator: null,
            })),
          },
        ],
      },
      !!overlay,
    );
    return {
      id: c.id,
      slot: c.slot,
      label: slotNames[c.slot],
      text: overlay
        ? overlay.text || 'Marked the next action as undecided'
        : (c.text ?? missingNames[c.missing ?? 'not-in-record']),
      nature: overlay ? 'Edited by you' : userNatureLabel(c.nature),
      condition: c.condition,
      uncertainty: overlay
        ? 'Display edits are not automatically checked for meaning. Evidence and check reasons refer to the original summary.'
        : c.verdict === 'supported'
          ? c.missing
            ? missingNames[c.missing]
            : null
          : c.verdict === 'unsupported'
            ? 'Interpretation not established by the evidence'
            : 'Unconfirmed interpretation',
      flow,
      evidenceIds: [...new Set(c.evidence.map((e) => e.revisionId))],
      checkReason: c.checkReason,
      edited: !!overlay,
      overlayChanged: !!overlay && overlay.baseSummaryId !== summary?.id && overlay.text !== c.text,
    };
  });
  const select = (slot: ClaimSlot) => claims.filter((c) => c.slot === slot);
  const refresh = snapshot.refresh;
  const applied = snapshot.jobs.find((j) => j.resultId === summary?.id && j.status === 'applied');
  const active = refresh ? snapshot.jobs.find((j) => j.id === refresh.activeJobId) : undefined;
  const latest = refresh
    ? snapshot.jobs.find((j) => j.id === refresh.latestJobId)
    : snapshot.jobs.filter((j) => j.inputVersion === snapshot.work.inputVersion).at(-1);
  const job = active ?? (refresh?.pending ? undefined : latest);
  const seconds = (from: string | null | undefined, to: string | null | undefined) =>
    from && to ? Math.max(0, Math.ceil((Date.parse(to) - Date.parse(from)) / 1000)) : null;
  const elapsed = seconds(job?.startedAt, active ? refresh?.observedAt : job?.updatedAt);
  const queue = seconds(applied?.queuedAt, applied?.startedAt);
  const entryMap = new Map(snapshot.coverage?.entries.map((e) => [e.id, e]) ?? []);
  const range = (label: string, ids: string[]) => ({
    label,
    items: ids.map((id) => {
      const e = entryMap.get(id);
      return {
        id,
        accessible: e?.accessible ?? false,
        label: e
          ? `${e.threadId} / ${e.turnId} / ${e.itemId} · Source ${id.slice(0, 10)} · ${e.eventAt ? `Record ${date(e.eventAt)}` : 'Send time unknown'}`
          : `Source ${id} · Boundary information unavailable`,
      };
    }),
  });
  const coverage = snapshot.coverage;
  const updated = new Set(coverage?.updated.map((x) => x.currentId) ?? []);
  const ranges = coverage
    ? [
        range('Source versions reflected in the summary', coverage.reflectedIds),
        range(
          'New sources not yet reflected',
          coverage.pendingIds.filter((id) => !updated.has(id)),
        ),
        range(
          'Updated sources not yet reflected',
          coverage.updated.map((x) => x.currentId),
        ),
        range(
          'Previously reflected versions',
          coverage.updated.map((x) => x.previousId),
        ),
        range('Earlier sources not found in the current collection', coverage.absentIds),
      ]
    : [];
  const phaseLabels = (job?.phases ?? []).map(
    (p) =>
      `${p.phase === 'generate' ? 'Generation call' : 'Check call'} ${p.endedAt ? `${seconds(p.startedAt, p.endedAt)}s` : p.attemptToken === job?.attemptToken && active ? `${seconds(p.startedAt, refresh?.observedAt)}s observed` : 'End time unknown'}`,
  );
  const scopeNotice =
    summary && (freshness?.summary !== 'current' || freshness?.collection !== 'checked')
      ? 'The status, next action and reasons below reflect an earlier or partially checked scope. Later corrections may not be reflected yet.'
      : null;
  return {
    inputCapturedAt: date(summary?.inputCapturedAt ?? null),
    scopeNotice,
    ranges,
    summaryStatusLabel: summary
      ? freshness?.summary === 'current'
        ? 'Latest collected scope reflected'
        : 'Earlier scope reflected'
      : 'No validated summary',
    pendingLabel: refresh?.pending
      ? `Waiting for a follow-up summary · ${seconds(refresh.pending.queuedAt, refresh.observedAt)}s observed · New and changed records will be included in the next scope.`
      : null,
    refreshTiming: job
      ? `${job.attempts}/2 attempts · ${elapsed == null ? 'Processing time not recorded' : `Since start ${elapsed}s${active ? ' Observation' : ''}`} ${phaseLabels.join(' · ')}`
      : '',
    freshnessLabel,
    freshnessReasons: freshness?.reasons ?? [],
    lastCollectedAt: date(freshness?.lastCollectedAt ?? null),
    processingLabel:
      summary?.processingMs == null
        ? 'Processing time not recorded'
        : `Generation and checking since start ${Math.ceil(summary.processingMs / 1000)}s (including waiting and retries during execution); waiting before start ${queue == null ? 'Not recorded' : `${queue}s`}`,
    effortLabel: summary?.analysis
      ? `Summary ${summary.analysis.summaryEffort} · Check ${summary.analysis.checkEffort}`
      : 'Previous reasoning effort not recorded',
    workId: snapshot.work.id,
    title: snapshot.work.title,
    revision: snapshot.work.revision,
    summaryId: summary?.id ?? null,
    priorAttemptError: applied?.error ?? null,
    viewedEvidenceCount: snapshot.visit?.evidenceIds.length ?? 0,
    viewedSummaryId: snapshot.visit?.summaryId ?? null,
    viewedAt: date(snapshot.visit?.at ?? null),
    serverDraft: { revision: snapshot.draft?.revision ?? 0, text: snapshot.draft?.text ?? '' },
    scope: {
      records: snapshot.scopeRecords?.map((record) => ({
        ...record,
        actor: userActorLabel(record.actor),
      })),
      recordRanges: {
        ...snapshot.connection.discoveryScope?.recordRanges,
        ...snapshot.connection.recordRanges,
      },
      connectionId: snapshot.connection.id,
      cwd: snapshot.connection.cwd,
      threadIds: snapshot.links.filter((l) => l.status === 'linked').map((l) => l.threadId),
      startTurnIds: {
        ...snapshot.connection.discoveryScope?.startTurnIds,
        ...snapshot.connection.startTurnIds,
      },
      discover: snapshot.connection.discover,
      discoveryLabel: snapshot.connection.discover
        ? snapshot.connection.discovery
          ? `${{ checked: 'Conversation discovery complete', partial: 'Some conversations checked', failed: 'Conversation discovery failed' }[snapshot.connection.discovery.status]} · ${date(snapshot.connection.discovery.attemptedAt)} · ${snapshot.connection.discovery.limitations.join(' · ')}`
          : 'Waiting to discover conversations'
        : 'Automatically collect new records from selected conversations',
    },
    sourceIndex: (snapshot.sourceIndex ?? []).map((s) => ({
      id: s.id,
      label: `${s.actor === 'user' ? 'User' : 'Agent'} · ${s.preview}`,
      summarized: !!summary?.sourceRevisionIds.includes(s.id),
    })),
    hasNewSummary:
      !!summary && !!options.baselineSummaryId && options.baselineSummaryId !== summary.id,
    stale:
      !!summary &&
      (freshness?.summary === 'outdated' || summary.inputVersion !== snapshot.work.inputVersion),
    purpose: select('purpose'),
    milestones: select('milestone').slice(
      -Math.max(1, options.milestoneLimit ?? Number.MAX_SAFE_INTEGER),
    ),
    current: select('current'),
    next: select('next'),
    reason: select('reason'),
    other: [...select('direction'), ...select('review'), ...select('completion')],
    sourceCount: snapshot.sourceRevisionIds.length,
    recentEvidenceIds: snapshot.sourceRevisionIds.slice(-12),
    inputCount: summary?.sourceRevisionIds.length ?? 0,
    summarizedAt: date(summary?.generatedAt ?? null),
    model: summary?.model ?? 'Not summarized yet',
    jobLabel: job
      ? job.status === 'queued' && job.attempts
        ? 'Waiting to retry this scope'
        : jobNames[job.status]
      : refresh?.pending
        ? 'Waiting for a follow-up summary'
        : summary
          ? 'Summary applied'
          : 'Waiting for summary',
    error: job?.status === 'applied' ? null : (job?.error ?? null),
    retryJobId: job?.retryable && job.attempts < 2 && job.status === 'failed' ? job.id : null,
    checkpoints: snapshot.checkpoints.map((c) => ({
      id: c.id,
      title: snapshot.links.find((l) => l.threadId === c.threadId)?.title ?? c.threadId,
      label: collectionNames[c.status],
      at: date(c.lastSuccessfulAt),
      count: c.revisionIds.length,
      limitations: c.limitations,
    })),
    links: snapshot.links.map((l) => ({
      rationale: l.rationale,
      relation: userRelationLabel(l.relation),
      id: l.id,
      threadId: l.threadId,
      title: l.title,
      status: l.status,
      statusLabel: {
        linked: 'Connected',
        proposed: 'Suggested connection',
        deferred: 'Review later',
        separate: 'Keep separate',
      }[l.status],
      revision: l.revision,
      role: userRoleLabel(l.role),
      canUndo: l.history.length > 0,
      evidenceIds: l.evidence,
    })),
    execution: snapshot.execution
      .slice(-8)
      .map((e) => ({
        id: `${e.threadId}:${e.turnId}`,
        text: `${e.role === 'controlled-verification' ? 'Verification · ' : ''}${userExecutionLabel(e.status)}`,
        evidenceId: e.evidenceId,
        at: date(e.eventAt),
      })),
    limitations: [
      ...new Set([
        ...(summary?.limitations ?? []),
        ...snapshot.checkpoints.flatMap((c) => c.limitations),
      ]),
    ],
    navigationDetail: snapshot.capabilities.navigation.detail,
    navigationLabel: 'Codex conversation',
    navigationEnabled: snapshot.capabilities.navigation.precision === 'thread',
    reviewLabel:
      'Reading, selecting a proposal or a turn ending does not establish review or completion',
  };
}
export type EvidenceViewModel = {
  id: string;
  source: string;
  aliases: string[];
  actor: string;
  text: string;
  locator: string;
  recordedAt: string;
  observedAt: string;
  limitations: string[];
};
export function presentEvidence(s: SourceRevision): EvidenceViewModel {
  return {
    id: s.id,
    aliases: s.locator.aliases,
    source: `${s.threadId} / ${s.turnId} / ${s.itemId}`,
    actor: userActorLabel(s.actor),
    text: s.text,
    locator: s.locator.path
      ? `${s.locator.path}${s.locator.line ? `:${s.locator.line}` : ''}`
      : 'Local location unknown',
    recordedAt: s.eventAt ?? 'Send time unknown',
    observedAt: s.observedAt,
    limitations: s.limitations,
  };
}
export type { HandoffTarget, ProjectListItem };
