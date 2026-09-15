import { Resumes } from './resumes';
import { selectedRecords, goalCandidates, dedicatedRelationship, relationshipKind } from './goals';
import {
  DomainError,
  connectionInputSchema,
  correctionInputSchema,
  draftInputSchema,
  linkInputSchema,
  visitInputSchema,
  workspaceSnapshotSchema,
  type Capabilities,
  type Command,
  type Connection,
  type HandoffTarget,
  type Job,
  type Link,
  type ProjectListItem,
  type Receipt,
  type ReturnContextSnapshot,
  type SourceRead,
  type SourceRevision,
  type SummaryRevision,
  type Work,
  type WorkspaceSnapshot,
  type WorkspaceFileObservation,
  type WorkspaceInspectionHints,
} from '@statecarry/contracts';
import type {
  StateRepository,
  SourceReader,
  SummaryProvider,
  Navigator,
  Clock,
  Identity,
  Events,
  AttemptMeta,
  SessionExecutor,
  ProjectInspector,
} from './ports';
import { checkAssessment, checkCandidate, relationshipEvidence } from './checks';
import { assessFreshness } from './freshness';
import { summaryCoverage } from './coverage';
import { conversationFlows } from './conversation-flow';
import { ContextQuestions } from './questions';
import { Explanations } from './explanations';
import { Continuations } from './continuations';

export const EXTRACTOR_VERSION = 'statecarry-06.1';
class UnsupportedSessionExecutor implements SessionExecutor {
  capability() {
    return {
      create: 'unsupported' as const,
      send: 'unsupported' as const,
      verifiedAt: null,
      detail:
        'Automatic continuation is unavailable here. Copy the handoff instructions or open the recorded conversation manually.',
    };
  }
  async create(_input: Parameters<SessionExecutor['create']>[0]): Promise<never> {
    throw new DomainError(
      'CAPABILITY_UNSUPPORTED',
      'Creating a new Codex session is not supported',
    );
  }
  async send(_input: Parameters<SessionExecutor['send']>[0]): Promise<never> {
    throw new DomainError('CAPABILITY_UNSUPPORTED', 'Sending a continuation is not supported');
  }
}
export function isControlledVerification(s: SourceRevision): boolean {
  if (s.actor === 'user') return s.text.includes('STATECARRY_CONTROLLED_VERIFICATION');
  // Codex-created tasks retain their initial request as a delegation tool record.
  // Recognize this envelope without promoting it to a direct user decision.
  if (s.actor !== 'tool' || s.kind !== 'functionCallOutput') return false;
  try {
    const p = JSON.parse(s.text);
    return (
      p.tool === 'create_thread' &&
      typeof p.result === 'string' &&
      /^<codex_delegation>\s*<source_thread_id>[A-Za-z0-9_-]+<\/source_thread_id>\s*<input>STATECARRY_CONTROLLED_VERIFICATION\b/.test(
        p.result,
      )
    );
  } catch {
    return false;
  }
}
export class StateCarry {
  readonly resumes = new Resumes(this);
  readonly questions = new ContextQuestions(this);
  readonly explanations = new Explanations(this);
  readonly continuations: Continuations;
  private collectionPromises = new Map<string, Promise<void>>();
  private collecting = new Set<string>();
  private processing = new Set<string>();
  private discovering = new Set<string>();
  private closing = false;
  readonly sessionExecutor: SessionExecutor;
  readonly projectInspector?: ProjectInspector;
  constructor(
    readonly repo: StateRepository,
    readonly reader: SourceReader,
    readonly summary: SummaryProvider,
    readonly navigator: Navigator,
    readonly clock: Clock,
    readonly ids: Identity,
    readonly events: Events,
    sessionExecutorOrProject: SessionExecutor | ProjectInspector = new UnsupportedSessionExecutor(),
    projectInspector?: ProjectInspector,
  ) {
    // Keep the pre-continuation constructor shape working for local callers
    // that passed a ProjectInspector as the eighth argument.
    const isProject =
      typeof (sessionExecutorOrProject as ProjectInspector).inspect === 'function' &&
      typeof (sessionExecutorOrProject as SessionExecutor).capability !== 'function';
    this.sessionExecutor = isProject
      ? new UnsupportedSessionExecutor()
      : (sessionExecutorOrProject as SessionExecutor);
    this.projectInspector = isProject
      ? (sessionExecutorOrProject as ProjectInspector)
      : projectInspector;
    this.continuations = new Continuations(this, this.sessionExecutor);
  }
  capabilities(): Capabilities {
    return {
      apiVersion: 1,
      source: 'codex-local',
      summary: this.summary.capability(),
      navigation: this.navigator.capability(),
      session: this.sessionExecutor.capability(),
      collectionIntervalMs: 15000,
      discoveryIntervalMs: 60000,
    };
  }
  work(id: string): Work {
    const w = this.repo.get('work', id);
    if (!w) throw new DomainError('NOT_FOUND', 'Work not found', 404);
    return w;
  }
  /** Connections are soft-deleted so their source records and project files
   * remain available for an explicit restore. All user-facing enumeration and
   * background work must use the active view. */
  isConnectionActive(connection: Connection | null | undefined): connection is Connection {
    return !!connection && !connection.removedAt;
  }
  listConnections(): Connection[] {
    return this.repo.list('connection').filter((connection) => this.isConnectionActive(connection));
  }
  connection(connectionId: string, allowRemoved = false): Connection {
    const value = this.repo.get('connection', connectionId);
    if (!value || (!allowRemoved && value.removedAt))
      throw new DomainError('NOT_FOUND', 'Connection not found', 404);
    return value;
  }
  private activeConnectionForWork(workId: string): Connection {
    const work = this.work(workId);
    return this.connection(work.projectId);
  }
  /** Capture workspace state at the boundary between the core and its local
   * project provider. Unknown state is explicit and never borrowed from an
   * earlier observation. */
  inspectWorkspace(cwd: string, hints?: WorkspaceInspectionHints): WorkspaceSnapshot | null {
    if (!this.projectInspector) return null;
    try {
      return workspaceSnapshotSchema.parse(this.projectInspector.inspect(cwd, hints));
    } catch (error) {
      return {
        cwd,
        branch: null,
        commit: null,
        dirty: null,
        status: 'unknown',
        checkedAt: this.clock.now(),
        limitations: [
          `Workspace state could not be checked: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
  links(workId: string) {
    return this.repo.list('link').filter((l) => l.workId === workId);
  }
  sources(workId: string): SourceRevision[] {
    const linked = new Set(
      this.links(workId)
        .filter((l) => l.status === 'linked')
        .map((l) => l.threadId),
    );
    return this.repo
      .list('checkpoint')
      .filter((c) => c.workId === workId && linked.has(c.threadId))
      .flatMap((c) =>
        c.revisionIds
          .map((id) => this.repo.get('source', id))
          .filter((s): s is SourceRevision => !!s),
      );
  }
  private workspaceFileSource(workId: string, id: string): SourceRevision | null {
    const work = this.work(workId);
    const snapshots = [work.resume?.workspaceBefore, work.resume?.workspaceAfter];
    const file = snapshots
      .flatMap((snapshot) =>
        snapshot?.files?.length
          ? snapshot.files
          : (snapshot?.fileObservations ?? snapshot?.files ?? []),
      )
      .find(
        (item) =>
          (item.revisionId ??
            `workspace-file:${this.ids.hash([item.path, item.hash, item.size ?? null])}`) === id,
      );
    if (!file) return null;
    const connection = this.repo.get('connection', work.projectId);
    if (!this.isConnectionActive(connection)) return null;
    const linkedThread = connection
      ? this.links(workId).find(
          (link) => link.status === 'linked' && link.role !== 'controlled-verification',
        )?.threadId
      : undefined;
    const text = `File observation: ${file.path}${file.preview ? `\nContent preview:\n${file.preview}` : ''}`;
    return {
      id,
      key: id,
      provider: 'codex',
      host: 'local',
      threadId: linkedThread ?? 'workspace',
      turnId: `workspace:${file.revisionId ?? file.hash}`,
      itemId: file.path,
      kind: 'fileObservation',
      actor: 'tool',
      text,
      contentHash: file.hash,
      eventAt:
        snapshots.find((snapshot) =>
          (snapshot?.files?.length
            ? snapshot.files
            : (snapshot?.fileObservations ?? snapshot?.files ?? [])
          ).some(
            (item) =>
              (item.revisionId ??
                `workspace-file:${this.ids.hash([item.path, item.hash, item.size ?? null])}`) ===
              id,
          ),
        )?.checkedAt ?? null,
      observedAt:
        snapshots.find((snapshot) =>
          (snapshot?.files?.length
            ? snapshot.files
            : (snapshot?.fileObservations ?? snapshot?.files ?? [])
          ).some(
            (item) =>
              (item.revisionId ??
                `workspace-file:${this.ids.hash([item.path, item.hash, item.size ?? null])}`) ===
              id,
          ),
        )?.checkedAt ?? this.clock.now(),
      locator: { path: file.path, line: null, aliases: [] },
      turnStatus: 'checked',
      sourceStatus: 'checked',
      pathKind: 'api',
      limitations: file.limitation ? [file.limitation] : [],
    };
  }

  accessibleSource(workId: string, id: string): SourceRevision | null {
    const source = this.repo.get('source', id);
    if (!source) return this.workspaceFileSource(workId, id);
    const work = this.work(workId),
      connection = this.repo.get('connection', work.projectId);
    if (!this.isConnectionActive(connection)) return null;
    const link = this.links(workId).find((l) => l.threadId === source.threadId);
    if (link?.status === 'proposed' && link.evidence.includes(id)) return source;
    if (link?.status !== 'linked') return null;
    if (this.sources(workId).some((s) => s.key === source.key)) return source;
    if (this.resumes.retainsEvidence(workId, source)) return source;
    const summary = work.latestSummaryId ? this.repo.get('summary', work.latestSummaryId) : null;
    // Missing collection is not permission withdrawal. Preserve a known historical
    // input only while the original access version still matches.
    return !connection.recordRanges?.[source.threadId] &&
      summary?.linkVersion === work.linkVersion &&
      summary.sourceRevisionIds.includes(id)
      ? source
      : null;
  }
  goalCandidates(workId: string) {
    return goalCandidates(this, workId);
  }
  private jobId(workId: string, inputVersion: string, configurationHash: string) {
    return this.ids.hash([
      workId,
      inputVersion,
      EXTRACTOR_VERSION,
      configurationHash,
      'fixed-input-v1',
    ]);
  }
  private configurationHash() {
    return this.ids.hash(this.summary.configuration());
  }
  private refreshState(work: Work): NonNullable<ReturnContextSnapshot['refresh']> {
    const jobs = this.repo.list('job').filter((j) => j.workId === work.id);
    const active =
      jobs.find((j) => j.status === 'result-unknown') ??
      jobs.find((j) => ['summarizing', 'checking', 'queued'].includes(j.status));
    return {
      observedAt: this.clock.now(),
      appliedJobId:
        jobs.find((j) => j.resultId === work.latestSummaryId && j.status === 'applied')?.id ?? null,
      activeJobId: active?.id ?? null,
      latestJobId:
        jobs
          .filter(
            (j) =>
              j.inputVersion === work.inputVersion &&
              j.configurationHash === this.configurationHash() &&
              j.extractorVersion === EXTRACTOR_VERSION,
          )
          .at(-1)?.id ?? null,
      pending: work.pendingRefresh ?? null,
    };
  }
  freshness(workId: string) {
    const work = this.work(workId),
      connection = this.activeConnectionForWork(workId),
      summary = work.latestSummaryId ? this.repo.get('summary', work.latestSummaryId) : null;
    return assessFreshness(
      work,
      connection,
      this.links(workId),
      this.repo.list('checkpoint').filter((c) => c.workId === workId),
      summary,
      this.clock.now(),
      summary?.extractorVersion === EXTRACTOR_VERSION &&
        !!summary?.analysis &&
        this.ids.hash(summary.analysis) === this.configurationHash(),
    );
  }
  listProjects(): ProjectListItem[] {
    return this.listConnections().map((c) => {
      const w = this.work(c.workId),
        stored = w.latestSummaryId ? this.repo.get('summary', w.latestSummaryId) : null;
      const s = stored?.sourceRevisionIds.every((id) => this.accessibleSource(w.id, id))
        ? stored
        : null;
      const view = this.explanations.view(w.id);
      const explanations = view.accessibleIds
        .map((id) => this.repo.get('explanation', id)!)
        .map((r) => ({
          id: r.id,
          summaryId: r.summaryId,
          current: r.candidate.nodes
            .filter(
              (n) =>
                n.role === 'state' &&
                r.candidate.sections.some((section) => section.bodyIds.includes(n.id)),
            )
            .map((n) => n.text)
            .join(' '),
        }));
      return {
        explanations,
        id: c.id,
        title: c.title,
        cwd: c.cwd,
        workId: w.id,
        revision: w.revision,
        summaryId: s?.id ?? null,
        freshness: this.freshness(w.id),
        current:
          explanations.find((e) => e.id === view.revision?.id)?.current ||
          (w.goal
            ? null
            : (s?.claims.find((x) => x.slot === 'current' && x.verdict === 'supported')?.text ??
              null)),
        state: (() => {
          const r = this.refreshState(w);
          return r.activeJobId
            ? this.repo.get('job', r.activeJobId)!.status
            : r.pending
              ? 'queued'
              : r.latestJobId
                ? this.repo.get('job', r.latestJobId)!.status
                : 'collecting';
        })(),
      };
    });
  }
  connect(command: Command): Receipt {
    const input = connectionInputSchema.parse(command.payload);
    if (
      [...Object.keys(input.startTurnIds), ...Object.keys(input.recordRanges ?? {})].some(
        (id) => !input.threadIds.includes(id),
      )
    )
      throw new DomainError('VALIDATION', 'Start turn outside selected threads');
    const bodyHash = this.ids.hash({
      command: 'connect',
      input,
      expectedRevision: command.expectedRevision,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      if (command.expectedRevision !== 0)
        throw new DomainError(
          'REVISION_CONFLICT',
          'New connection must start at revision zero',
          409,
        );
      const id = this.ids.next(),
        workId = this.ids.next(),
        at = this.clock.now();
      const c: Connection = {
        ...input,
        id,
        workId,
        threadIds: [...new Set(input.threadIds)],
        revision: 1,
        createdAt: at,
      };
      this.repo.put('connection', c);
      this.repo.put('work', {
        id: workId,
        projectId: id,
        title: input.title,
        revision: 1,
        linkVersion: 1,
        inputVersion: '',
        latestSummaryId: null,
        createdAt: at,
      });
      for (const threadId of c.threadIds)
        this.repo.put('link', {
          id: this.ids.hash([workId, threadId]),
          workId,
          threadId,
          title: threadId,
          status: 'linked',
          revision: 1,
          evidence: [],
          rationale: 'Explicit connection scope',
          role: 'work',
          history: [],
        });
      const r = {
        id: command.requestId,
        command: 'connect',
        bodyHash,
        workId,
        committedRevision: 1,
        resultId: id,
        createdAt: at,
      };
      this.repo.put('receipt', r);
      return r;
    });
    this.events.changed(receipt.workId);
    return receipt;
  }
  chooseGoal(workId: string, command: Command): Receipt {
    const bodyHash = this.ids.hash({
      action: 'goal-choice',
      workId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const prior = this.receipt(command.requestId, bodyHash);
    if (prior) return prior;
    const work = this.work(workId);
    if (work.revision !== command.expectedRevision)
      throw new DomainError('REVISION_CONFLICT', 'Goal candidates changed', 409);
    const candidates = this.goalCandidates(workId),
      candidate = candidates.find((c) => c.id === command.payload.candidateId);
    if (!candidate || !['confirm', 'dismiss'].includes(String(command.payload.action)))
      throw new DomainError('VALIDATION', 'Choose an accessible goal candidate');
    const connection = this.repo.get('connection', work.projectId)!;
    return this.repo.transaction(() => {
      let resultWorkId = candidate.workId ?? workId;
      if (command.payload.action === 'confirm' && !candidate.workId) {
        const sources = this.sources(workId),
          threadIds = [candidate.threadId];
        const recordRanges = {
          [candidate.threadId]: {
            ...candidate.range,
            end: candidate.range.end ?? connection.recordRanges?.[candidate.threadId]?.end,
          },
        };
        const relations = new Map<string, SourceRevision[]>();
        for (let pass = 0; pass < 30; pass++) {
          let added = false;
          for (const threadId of new Set(sources.map((s) => s.threadId))) {
            if (threadIds.includes(threadId)) continue;
            const evidence = dedicatedRelationship(
              sources.filter((s) => s.threadId === threadId),
              threadIds,
            );
            if (evidence.length) {
              threadIds.push(threadId);
              relations.set(threadId, evidence);
              added = true;
            }
          }
          if (!added) break;
        }
        for (const id of threadIds)
          if (id !== candidate.threadId && connection.recordRanges?.[id])
            recordRanges[id] = connection.recordRanges[id] as (typeof recordRanges)[string];
        const receipt = this.connect({
          requestId: this.ids.hash([command.requestId, 'connection']),
          expectedRevision: 0,
          payload: {
            title: candidate.title,
            cwd: connection.cwd,
            threadIds,
            discover: connection.discover,
            startTurnIds: Object.fromEntries(
              threadIds
                .filter((id) => connection.startTurnIds[id])
                .map((id) => [id, connection.startTurnIds[id]]),
            ),
            recordRanges,
          },
        });
        resultWorkId = receipt.workId;
        const goal = this.work(resultWorkId);
        const goalConnection = this.repo.get('connection', goal.projectId)!;
        this.repo.put('connection', {
          ...goalConnection,
          discoveryScope: {
            startTurnIds: {
              ...connection.discoveryScope?.startTurnIds,
              ...connection.startTurnIds,
            },
            recordRanges: {
              ...connection.discoveryScope?.recordRanges,
              ...connection.recordRanges,
            },
          },
        });
        this.repo.put('work', {
          ...goal,
          goal: {
            text: candidate.quote,
            evidenceId: candidate.evidenceId,
            confirmedAt: this.clock.now(),
          },
        });
        for (const dismissed of candidates.filter(
          (c) => c.status === 'dismissed' && !threadIds.includes(c.threadId),
        ))
          this.repo.put('link', {
            id: this.ids.hash([resultWorkId, dismissed.threadId]),
            workId: resultWorkId,
            threadId: dismissed.threadId,
            title:
              this.links(workId).find((l) => l.threadId === dismissed.threadId)?.title ??
              dismissed.threadId,
            status: 'separate',
            revision: 1,
            evidence: [],
            rationale: 'Kept separate by the user during goal selection',
            role: 'work',
            history: [],
          });
        for (const link of this.links(resultWorkId).filter((l) => l.status === 'linked')) {
          const evidence = relations.get(link.threadId);
          this.repo.put('link', {
            ...link,
            title:
              this.links(workId).find((l) => l.threadId === link.threadId)?.title ?? link.title,
            relation: relationshipKind(evidence ?? []),
            evidence: evidence?.map((s) => s.id) ?? [candidate.evidenceId],
            rationale:
              evidence?.map((s) => s.text).join(' · ') ??
              'User confirmed this goal and its selected records',
          });
        }
      }
      this.repo.put('work', {
        ...work,
        revision: work.revision + 1,
        goalCandidates: candidates.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                status: command.payload.action === 'confirm' ? 'confirmed' : 'dismissed',
                ...(command.payload.action === 'confirm' ? { workId: resultWorkId } : {}),
              }
            : c,
        ),
      });
      const receipt: Receipt = {
        id: command.requestId,
        command: 'goal-choice',
        bodyHash,
        workId: resultWorkId,
        committedRevision: this.work(resultWorkId).revision,
        resultId: candidate.id,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', receipt);
      this.events.changed(resultWorkId);
      return receipt;
    });
  }
  describeGoal(workId: string, command: Command): Receipt {
    const bodyHash = this.ids.hash({
      action: 'describe-goal',
      workId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const existing = this.receipt(command.requestId, bodyHash);
    if (existing) return existing;
    const work = this.work(workId);
    if (work.revision !== command.expectedRevision)
      throw new DomainError('REVISION_CONFLICT', 'Goal changed; review your input.', 409);
    const text = typeof command.payload.text === 'string' ? command.payload.text.trim() : '';
    if (!text || text.length > 1200)
      throw new DomainError('VALIDATION', 'Describe a goal in 1–1200 characters.');
    // Goal edits never grant record access. Keep this connection and every range unchanged.
    const receipt = this.repo.transaction(() => {
      const goal = { text, origin: 'user-input' as const, confirmedAt: this.clock.now() };
      this.repo.put('work', {
        ...work,
        goal,
        title: text.slice(0, 120),
        revision: work.revision + 1,
        linkVersion: work.linkVersion + 1,
        latestSummaryId: null,
      });
      const connection = this.repo.get('connection', work.projectId)!;
      this.repo.put('connection', { ...connection, title: text.slice(0, 120) });
      this.refreshInput(workId);
      const receipt: Receipt = {
        id: command.requestId,
        command: 'describe-goal',
        bodyHash,
        workId,
        committedRevision: this.work(workId).revision,
        resultId: workId,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', receipt);
      return receipt;
    });
    this.questions.invalidateGoal(workId);
    this.events.changed(workId);
    return receipt;
  }
  updateConnection(connectionId: string, command: Command): Receipt {
    const input = connectionInputSchema.parse(command.payload);
    const bodyHash = this.ids.hash({
      action: 'connection-scope',
      connectionId,
      ...command,
      requestId: undefined,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const c = this.connection(connectionId);
      const w = this.work(c.workId);
      if (w.revision !== command.expectedRevision)
        throw new DomainError('REVISION_CONFLICT', 'Connection scope changed', 409);
      if (
        [...Object.keys(input.startTurnIds), ...Object.keys(input.recordRanges ?? {})].some(
          (id) => !input.threadIds.includes(id),
        )
      )
        throw new DomainError('VALIDATION', 'Start turn is outside selected threads');
      const selected = new Set(input.threadIds);
      for (const l of this.links(w.id)) {
        const status = selected.has(l.threadId) ? 'linked' : 'separate';
        if (l.status !== status)
          this.repo.put('link', {
            ...l,
            status,
            revision: l.revision + 1,
            history: [...l.history, { status: l.status, at: this.clock.now() }],
          });
        selected.delete(l.threadId);
      }
      for (const threadId of selected)
        this.repo.put('link', {
          id: this.ids.hash([w.id, threadId]),
          workId: w.id,
          threadId,
          title: threadId,
          status: 'linked',
          revision: 1,
          evidence: [],
          rationale: 'Explicit connection scope update',
          role: 'work',
          history: [],
        });
      // Old source objects remain immutable; a changed range must be recollected before it can be used.
      for (const cp of this.repo.list('checkpoint').filter((cp) => cp.workId === w.id)) {
        if (
          input.cwd !== c.cwd ||
          input.startTurnIds[cp.threadId] !== c.startTurnIds[cp.threadId] ||
          JSON.stringify(input.recordRanges?.[cp.threadId]) !==
            JSON.stringify(c.recordRanges?.[cp.threadId])
        )
          this.repo.put('checkpoint', {
            ...cp,
            revisionIds: [],
            status: 'partial',
            limitations: ['Collection range changed; awaiting automatic collection'],
          });
      }
      const discoveryScope = c.discoveryScope
        ? {
            startTurnIds: Object.fromEntries(
              Object.entries(c.discoveryScope.startTurnIds).filter(
                ([id]) => !input.threadIds.includes(id),
              ),
            ),
            recordRanges: Object.fromEntries(
              Object.entries(c.discoveryScope.recordRanges).filter(
                ([id]) => !input.threadIds.includes(id),
              ),
            ),
          }
        : undefined;
      this.repo.put('connection', {
        ...c,
        ...input,
        discoveryScope,
        threadIds: [...new Set(input.threadIds)],
        revision: c.revision + 1,
      });
      this.repo.put('work', {
        ...w,
        title: input.title,
        revision: w.revision + 1,
        linkVersion: w.linkVersion + 1,
      });
      this.refreshInput(w.id);
      const r: Receipt = {
        id: command.requestId,
        command: 'connection-scope',
        bodyHash,
        workId: w.id,
        committedRevision: this.work(w.id).revision,
        resultId: c.id,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', r);
      return r;
    });
    this.events.changed(receipt.workId);
    return receipt;
  }
  /** Remove a connection from StateCarry's active project list. This is a
   * reversible soft removal: immutable source records, summaries, and the
   * original Codex/project files are deliberately left untouched. */
  removeConnection(connectionId: string, command: Command): Receipt {
    const bodyHash = this.ids.hash({
      action: 'connection-remove',
      connectionId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const c = this.connection(connectionId);
      const w = this.work(c.workId);
      if (w.revision !== command.expectedRevision)
        throw new DomainError(
          'REVISION_CONFLICT',
          'Connection changed; review it before removing it',
          409,
        );
      const at = this.clock.now();
      this.repo.put('connection', { ...c, removedAt: at, revision: c.revision + 1 });
      this.repo.put('work', { ...w, revision: w.revision + 1 });
      const result: Receipt = {
        id: command.requestId,
        command: 'connection-remove',
        bodyHash,
        workId: w.id,
        committedRevision: this.work(w.id).revision,
        resultId: c.id,
        createdAt: at,
      };
      this.repo.put('receipt', result);
      return result;
    });
    this.events.changed(receipt.workId);
    return receipt;
  }
  /** Restore a previously removed connection without re-reading or mutating
   * the original Codex records. A new collection can be requested explicitly
   * after restoration. */
  restoreConnection(connectionId: string, command: Command): Receipt {
    const bodyHash = this.ids.hash({
      action: 'connection-restore',
      connectionId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const c = this.connection(connectionId, true);
      const w = this.work(c.workId);
      if (!c.removedAt) throw new DomainError('VALIDATION', 'Connection is already active');
      if (w.revision !== command.expectedRevision)
        throw new DomainError(
          'REVISION_CONFLICT',
          'Connection changed; review it before restoring it',
          409,
        );
      const at = this.clock.now();
      this.repo.put('connection', { ...c, removedAt: null, revision: c.revision + 1 });
      this.repo.put('work', { ...w, revision: w.revision + 1 });
      const result: Receipt = {
        id: command.requestId,
        command: 'connection-restore',
        bodyHash,
        workId: w.id,
        committedRevision: this.work(w.id).revision,
        resultId: c.id,
        createdAt: at,
      };
      this.repo.put('receipt', result);
      return result;
    });
    this.events.changed(receipt.workId);
    return receipt;
  }
  private receipt(id: string, hash: string): Receipt | null {
    const r = this.repo.get('receipt', id);
    if (r && r.bodyHash !== hash)
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Request id was used with another body', 409);
    return r;
  }
  private refreshInput(workId: string) {
    const w = this.work(workId),
      sources = this.sources(workId),
      configurationHash = this.configurationHash();
    const inputVersion = this.ids.hash({ sources: sources.map((s) => s.id), links: w.linkVersion });
    const changed = inputVersion !== w.inputVersion;
    if (changed) {
      w.inputVersion = inputVersion;
      w.revision++;
    }
    const id = this.jobId(workId, inputVersion, configurationHash);
    const existing =
      this.repo.get('job', id) ??
      this.repo
        .list('job')
        .find(
          (j) =>
            j.workId === workId &&
            j.inputVersion === inputVersion &&
            j.configurationHash === configurationHash &&
            j.extractorVersion === EXTRACTOR_VERSION &&
            j.status !== 'superseded',
        );
    const pendingRefresh =
      sources.length && !existing
        ? {
            inputVersion,
            configurationHash,
            extractorVersion: EXTRACTOR_VERSION,
            queuedAt: w.pendingRefresh?.queuedAt ?? this.clock.now(),
          }
        : null;
    if (changed || JSON.stringify(w.pendingRefresh ?? null) !== JSON.stringify(pendingRefresh))
      this.repo.put('work', { ...w, pendingRefresh });
  }
  // Legacy candidates may only resume when their entire original input can be proven.
  private restoreInput(job: Job): Job {
    if (job.inputSnapshot) return job;
    const w = this.work(job.workId),
      sources = this.sources(w.id);
    if (
      job.inputVersion !==
      this.ids.hash({ sources: sources.map((s) => s.id), links: w.linkVersion })
    )
      return job;
    return {
      ...job,
      inputSnapshot: {
        sourceRevisionIds: sources.map((s) => s.id),
        linkVersion: w.linkVersion,
        connectionRevision: this.repo.get('connection', w.projectId)!.revision,
        capturedAt: null,
        baseSummaryId: w.latestSummaryId,
      },
    };
  }
  private invalidReason(job: Job): string | null {
    const w = this.work(job.workId),
      connection = this.repo.get('connection', w.projectId),
      input = job.inputSnapshot;
    if (!this.isConnectionActive(connection))
      return 'Connection was removed; restore it before continuing';
    if (!input) return 'Original input boundary is unknown; candidate retained without reuse';
    if (
      job.configurationHash !== this.configurationHash() ||
      !job.analysis ||
      this.ids.hash(job.analysis) !== job.configurationHash ||
      job.extractorVersion !== EXTRACTOR_VERSION
    )
      return 'Analysis configuration changed';
    if (input.linkVersion !== w.linkVersion || input.connectionRevision !== connection.revision)
      return 'Connection or access scope changed';
    if (input.baseSummaryId !== w.latestSummaryId)
      return 'A different summary was already published; late result rejected';
    if (
      job.inputVersion !==
        this.ids.hash({ sources: input.sourceRevisionIds, links: input.linkVersion }) ||
      input.sourceRevisionIds.some((id) => !this.repo.get('source', id))
    )
      return 'Persisted input boundary is unavailable or inconsistent';
    return null;
  }
  private resumeJob(original: Job, terminated: boolean) {
    if (!terminated) {
      this.repo.put('job', {
        ...original,
        status: 'result-unknown',
        retryable: false,
        error: 'Previous process termination is unconfirmed',
        updatedAt: this.clock.now(),
      });
      return;
    }
    const applied = this.repo
      .list('summary')
      .find((s) => s.workId === original.workId && s.attemptToken === original.attemptToken);
    if (applied) {
      this.repo.put('job', {
        ...original,
        status: 'applied',
        resultId: applied.id,
        retryable: false,
      });
      return;
    }
    const job = this.restoreInput(original),
      reason = this.invalidReason(job);
    this.repo.put('job', {
      ...job,
      status: reason ? 'superseded' : job.attempts < 2 ? 'queued' : 'failed',
      retryable: !reason && job.attempts < 2,
      error: reason ?? job.error ?? 'Previous attempt terminated; resume persisted input',
      updatedAt: this.clock.now(),
    });
  }
  private applyRead(workId: string, connection: Connection, read: SourceRead) {
    const currentConnection = this.repo.get('connection', connection.id);
    if (
      !this.isConnectionActive(currentConnection) ||
      currentConnection.revision !== connection.revision
    )
      throw new DomainError('REVISION_CONFLICT', 'Collection scope changed', 409);
    if (!this.links(workId).some((l) => l.threadId === read.threadId && l.status === 'linked'))
      throw new DomainError('REVISION_CONFLICT', 'Source is no longer linked', 409);
    if (read.revisions.some((s) => s.threadId !== read.threadId))
      throw new DomainError('SOURCE_UNAVAILABLE', 'Source item belongs to another thread');
    const id = this.ids.hash([workId, read.threadId]);
    const previous = this.repo.get('checkpoint', id),
      readLimitations = [...read.limitations];
    if (previous?.generation && previous.generation !== read.generation)
      readLimitations.push('Source generation changed; prior immutable revisions retained');
    const startTurnId = connection.startTurnIds[read.threadId];
    const revisions = selectedRecords(connection, read.threadId, read.revisions);
    this.repo.transaction(() => {
      for (const source of revisions) this.repo.put('source', source);
      const currentKeys = new Set(revisions.map((s) => s.key));
      if (
        previous?.scopeVersion === connection.revision &&
        previous.revisionIds.some((id) => {
          const s = this.repo.get('source', id);
          return s && !currentKeys.has(s.key);
        })
      )
        readLimitations.push(
          'Previously collected items are absent from the current source; prior revisions retained',
        );
      this.repo.put('checkpoint', {
        id,
        workId,
        threadId: read.threadId,
        revisionIds: revisions.map((s) => s.id),
        sourceFingerprint: read.manifest.fingerprint,
        scopeVersion: connection.revision,
        generation: read.generation,
        lastAttemptAt: read.observedAt,
        lastSuccessfulAt: read.observedAt,
        status: readLimitations.length ? 'partial' : read.status,
        limitations: readLimitations,
        manifest: {
          ...read.manifest,
          filter: { ...read.manifest.filter, startTurnId: startTurnId ?? null },
          itemCount: revisions.length,
        },
      });
      const link = this.repo.get('link', id);
      if (link) {
        const controlled = revisions.some(isControlledVerification);
        this.repo.put('link', {
          ...link,
          title: read.title,
          role: controlled ? 'controlled-verification' : link.role,
        });
      }
      this.refreshInput(workId);
    });
  }
  collect(workId: string): Promise<void> {
    const current = this.collectionPromises.get(workId);
    if (current) return current;
    const pending = this.collectOnce(workId).finally(() => {
      this.collectionPromises.delete(workId);
    });
    this.collectionPromises.set(workId, pending);
    return pending;
  }
  private async collectOnce(workId: string): Promise<void> {
    if (this.collecting.has(workId) || this.closing) return;
    this.collecting.add(workId);
    try {
      const w = this.work(workId),
        connection = this.activeConnectionForWork(workId);
      for (const link of this.links(workId).filter((l) => l.status === 'linked')) {
        const currentConnection = this.repo.get('connection', connection.id);
        if (
          !this.isConnectionActive(currentConnection) ||
          currentConnection.revision !== connection.revision
        )
          return;
        const id = this.ids.hash([workId, link.threadId]),
          prior = this.repo.get('checkpoint', id),
          now = this.clock.now();
        this.repo.put(
          'checkpoint',
          prior
            ? { ...prior, status: 'reading', lastAttemptAt: now }
            : {
                id,
                workId,
                threadId: link.threadId,
                revisionIds: [],
                sourceFingerprint: '',
                generation: '',
                scopeVersion: connection.revision,
                lastAttemptAt: now,
                lastSuccessfulAt: null,
                status: 'reading',
                limitations: [],
                manifest: null,
              },
        );
        this.events.changed(workId);
        try {
          const read = await this.reader.read(
            link.threadId,
            connection.startTurnIds[link.threadId] ??
              connection.discoveryScope?.startTurnIds[link.threadId],
          );
          if (read.threadId !== link.threadId)
            throw new DomainError('SOURCE_UNAVAILABLE', 'Reader returned another thread');
          this.applyRead(workId, connection, read);
        } catch (error) {
          const currentConnection = this.repo.get('connection', connection.id);
          if (
            !this.isConnectionActive(currentConnection) ||
            currentConnection.revision !== connection.revision
          )
            return;
          const current = this.repo.get('checkpoint', id)!;
          this.repo.put('checkpoint', {
            ...current,
            status: 'failed',
            limitations: [String(error instanceof Error ? error.message : error)],
            ...(connection.recordRanges?.[link.threadId] ? { revisionIds: [] } : {}),
            lastAttemptAt: now,
          });
        }
      }
      this.events.changed(workId);
    } finally {
      this.collecting.delete(workId);
    }
  }
  async discover(connection: Connection): Promise<void> {
    if (!connection.discover || this.discovering.has(connection.id) || this.closing) return;
    if (!this.isConnectionActive(this.repo.get('connection', connection.id))) return;
    this.discovering.add(connection.id);
    try {
      const result = await this.reader.discover(connection.cwd);
      const discoveredConnection = this.repo.get('connection', connection.id);
      if (
        !this.isConnectionActive(discoveredConnection) ||
        discoveredConnection.revision !== connection.revision
      )
        return;
      this.repo.put('connection', {
        ...connection,
        discovery: {
          status: result.complete ? 'checked' : 'partial',
          attemptedAt: this.clock.now(),
          successfulAt: result.complete
            ? this.clock.now()
            : (connection.discovery?.successfulAt ?? null),
          threadIds: result.threads.map((t) => t.id),
          manifest: result.manifest,
          limitations: result.limitations,
        },
      });
      const failures: string[] = [];
      for (const thread of result.threads) {
        const existing = this.links(connection.workId).find((l) => l.threadId === thread.id);
        if (existing && existing.status !== 'proposed') continue;
        const beforeRead = this.repo.get('connection', connection.id)!;
        // Visible metadata is retained even when reading a new session fails.
        const id = this.ids.hash([connection.workId, thread.id]);
        if (!existing)
          this.repo.put('link', {
            id,
            workId: connection.workId,
            threadId: thread.id,
            title: thread.title,
            status: 'proposed',
            revision: 1,
            evidence: [],
            rationale: 'Discovered within allowed folder; relationship unconfirmed',
            role: 'work',
            history: [],
          });
        if (!result.complete) continue;
        try {
          const rawRead = await this.reader.read(
            thread.id,
            beforeRead.startTurnIds[thread.id] ??
              beforeRead.discoveryScope?.startTurnIds[thread.id],
          );
          const read = {
            ...rawRead,
            revisions: selectedRecords(beforeRead, thread.id, rawRead.revisions),
          };
          if (read.threadId !== thread.id || read.revisions.some((s) => s.threadId !== thread.id))
            throw new DomainError('SOURCE_UNAVAILABLE', 'Discovery source target mismatch');
          const currentBeforeApply = this.repo.get('connection', connection.id);
          if (
            !this.isConnectionActive(currentBeforeApply) ||
            currentBeforeApply.revision !== beforeRead.revision
          )
            return;
          if (existing?.sourceFingerprint === read.manifest.fingerprint) continue;
          const linkedIds = this.links(connection.workId)
            .filter((l) => l.status === 'linked')
            .map((l) => l.threadId);
          const evidence = dedicatedRelationship(
            selectedRecords(beforeRead, thread.id, read.revisions),
            linkedIds,
          );
          const preview = evidence.length
            ? evidence
            : read.revisions.filter((s) => s.actor === 'user').slice(-2);
          this.repo.transaction(() => {
            for (const source of preview) this.repo.put('source', source);
            const link = this.repo.get('link', id)!;
            const status = evidence.length ? 'linked' : 'proposed';
            this.repo.put('link', {
              ...link,
              title: thread.title,
              status,
              relation: relationshipKind(evidence),
              sourceFingerprint: read.manifest.fingerprint,
              revision: link.revision + 1,
              evidence: preview.map((e) => e.id),
              rationale: evidence.length
                ? 'Explicit continuation of one linked session within allowed folder'
                : 'Relationship is unconfirmed; this source is excluded from the work summary',
              role: read.revisions.some(isControlledVerification)
                ? 'controlled-verification'
                : 'work',
              history:
                status === link.status
                  ? link.history
                  : [...link.history, { status: link.status, at: this.clock.now() }],
            });
            const w = this.work(connection.workId);
            this.repo.put('work', {
              ...w,
              revision: w.revision + 1,
              linkVersion: w.linkVersion + (evidence.length ? 1 : 0),
            });
            if (evidence.length) {
              const c = this.repo.get('connection', connection.id)!;
              this.repo.put('connection', {
                ...c,
                threadIds: [...new Set([...c.threadIds, thread.id])],
                revision: c.revision + 1,
              });
            }
          });
          if (evidence.length)
            this.applyRead(connection.workId, this.repo.get('connection', connection.id)!, read);
        } catch (error) {
          failures.push(`${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failures.length) {
        const c = this.repo.get('connection', connection.id);
        if (this.isConnectionActive(c) && c.revision === connection.revision)
          this.repo.put('connection', {
            ...c,
            discovery: {
              ...c.discovery!,
              status: 'partial',
              limitations: [...result.limitations, ...failures],
            },
          });
      }
    } catch (error) {
      const current = this.repo.get('connection', connection.id);
      if (this.isConnectionActive(current) && current.revision === connection.revision)
        this.repo.put('connection', {
          ...current,
          discovery: {
            status: 'failed',
            attemptedAt: this.clock.now(),
            successfulAt: current.discovery?.successfulAt ?? null,
            threadIds: current.discovery?.threadIds ?? [],
            manifest: current.discovery?.manifest,
            limitations: [error instanceof Error ? error.message : String(error)],
          },
        });
    } finally {
      this.discovering.delete(connection.id);
      this.events.changed(connection.workId);
    }
  }
  async process(workId: string): Promise<void> {
    if (
      this.processing.has(workId) ||
      this.closing ||
      this.questions.hasUnresolvedExecution() ||
      this.explanations.hasUnresolvedExecution()
    )
      return;
    const processWork = this.work(workId);
    if (!this.isConnectionActive(this.repo.get('connection', processWork.projectId))) return;
    this.processing.add(workId);
    try {
      this.refreshInput(workId);
      for (const pending of this.repo
        .list('job')
        .filter((j) => j.workId === workId && j.status === 'result-unknown')) {
        if ((await this.summary.resolve(pending.remote)) === 'unknown') return;
        this.resumeJob(pending, true);
      }
      if (this.closing) return;
      let job: Job | undefined;
      for (const queued of this.repo
        .list('job')
        .filter((j) => j.workId === workId && j.status === 'queued')) {
        const restored = this.restoreInput(queued),
          reason = this.invalidReason(restored);
        if (reason || queued.attempts >= 2) {
          this.repo.put('job', {
            ...restored,
            status: reason ? 'superseded' : 'failed',
            retryable: false,
            error: reason ?? queued.error,
            updatedAt: this.clock.now(),
          });
        } else if (!job) job = restored;
      }
      this.refreshInput(workId);
      if (!job) {
        const w = this.work(workId),
          pending = w.pendingRefresh;
        if (!pending) return;
        const id = this.jobId(workId, w.inputVersion, this.configurationHash());
        if (this.repo.get('job', id)) return;
        job = {
          id,
          workId,
          inputVersion: w.inputVersion,
          extractorVersion: EXTRACTOR_VERSION,
          configurationHash: this.configurationHash(),
          analysis: this.summary.configuration(),
          inputSnapshot: {
            sourceRevisionIds: this.sources(workId).map((s) => s.id),
            linkVersion: w.linkVersion,
            connectionRevision: this.repo.get('connection', w.projectId)!.revision,
            capturedAt: this.clock.now(),
            baseSummaryId: w.latestSummaryId,
          },
          queuedAt: pending.queuedAt,
          status: 'queued',
          attempts: 0,
          attemptToken: null,
          remote: null,
          candidate: null,
          model: null,
          error: null,
          retryable: true,
          updatedAt: this.clock.now(),
          resultId: null,
        };
      }
      const input = job.inputSnapshot!,
        sources = input.sourceRevisionIds.map((id) => this.repo.get('source', id)!),
        token = this.ids.next();
      job = {
        ...job,
        startedAt: job.startedAt ?? this.clock.now(),
        attempts: job.attempts + 1,
        attemptToken: token,
        status: job.candidate ? 'checking' : 'summarizing',
        remote: null,
        updatedAt: this.clock.now(),
      };
      this.repo.transaction(() => {
        this.repo.put('job', job!);
        this.refreshInput(workId);
      });
      this.events.changed(workId);
      const id = job.id;
      const ensureCurrent = () => {
        const reason = this.invalidReason(job!);
        if (reason) throw new DomainError('REVISION_CONFLICT', reason, 409);
      };
      const update = (patch: Partial<Job>) => {
        const current = this.repo.get('job', id);
        if (!current || current.attemptToken !== token)
          throw new DomainError('RESULT_UNKNOWN', 'Attempt was superseded');
        this.repo.put('job', { ...current, ...patch, updatedAt: this.clock.now() });
      };
      const remote = (meta: AttemptMeta) => {
        update({ remote: meta });
        ensureCurrent();
      };
      const phase = async <T>(name: 'generate' | 'check', run: () => Promise<T>): Promise<T> => {
        const phases = [
          ...(this.repo.get('job', id)!.phases ?? []),
          {
            attemptToken: token,
            phase: name,
            startedAt: this.clock.now(),
            endedAt: null as string | null,
          },
        ];
        update({ phases });
        this.events.changed(workId);
        try {
          return await run();
        } finally {
          phases[phases.length - 1].endedAt = this.clock.now();
          update({ phases });
        }
      };
      try {
        ensureCurrent();
        let candidate = job.candidate,
          model = job.model;
        if (!candidate) {
          if (
            this.work(workId).goal?.evidenceId &&
            !sources.some((s) => s.id === this.work(workId).goal!.evidenceId)
          )
            throw new DomainError(
              'SOURCE_UNAVAILABLE',
              'Confirmed goal source is outside the selected input; review scope',
            );
          const result = await phase('generate', () =>
            this.summary.generate(sources, remote, this.work(workId).goal),
          );
          ensureCurrent();
          candidate = checkCandidate(result.candidate, sources);
          if (
            this.work(workId).goal &&
            candidate.claims.some(
              (c) => c.slot === 'next' && c.nature === 'agent-proposal' && c.text,
            )
          )
            throw new DomainError(
              'SUMMARY_UNAVAILABLE',
              'An unapproved agent proposal cannot become the confirmed goal’s next task.',
            );
          model = result.model;
          update({ candidate, model, status: 'checking', remote: null });
        } else {
          checkCandidate(candidate, sources);
          update({ status: 'checking' });
        }
        const fixedCandidate = candidate;
        const assessment = await phase('check', () =>
          this.summary.check(fixedCandidate, sources, remote, this.work(workId).goal),
        );
        ensureCurrent();
        const checked = checkAssessment(candidate, assessment),
          unsupported = checked.claims.filter((c) => c.verdict === 'unsupported');
        if (unsupported.length) {
          update({ candidate: null });
          await this.summary.rejectCandidate?.(sources, candidate, checked.checks);
          throw new DomainError(
            'SUMMARY_UNAVAILABLE',
            `Meaning check rejected candidate: ${unsupported
              .map((c) => `${c.id}: ${c.checkReason}`)
              .join('; ')
              .slice(0, 2000)}`,
          );
        }
        this.repo.transaction(() => {
          ensureCurrent();
          const latest = this.work(workId),
            current = this.repo.get('job', id)!;
          if (current.attemptToken !== token)
            throw new DomainError('RESULT_UNKNOWN', 'Late attempt rejected');
          const summary: SummaryRevision = {
            id: this.ids.next(),
            workId,
            inputVersion: job!.inputVersion,
            sourceRevisionIds: [...input.sourceRevisionIds],
            linkVersion: input.linkVersion,
            inputCapturedAt: input.capturedAt,
            generatedAt: this.clock.now(),
            model: model ?? 'unknown',
            analysis: job!.analysis,
            extractorVersion: job!.extractorVersion,
            claims: checked.claims,
            checks: checked.checks,
            limitations: [
              ...candidate!.limitations,
              ...new Set(sources.flatMap((s) => s.limitations)),
            ],
            attemptToken: token,
          };
          summary.processingMs = Math.max(
            0,
            Date.parse(summary.generatedAt) - Date.parse(job!.startedAt!),
          );
          this.repo.put('summary', summary);
          this.repo.put('work', {
            ...latest,
            latestSummaryId: summary.id,
            revision: latest.revision + 1,
          });
          update({
            status: 'applied',
            resultId: summary.id,
            processingMs: summary.processingMs,
            retryable: false,
          });
        });
        try {
          this.explanations.preparePublished(workId);
        } catch {
          /* First opening can prepare a missing explanation. */
        }
      } catch (error) {
        const current = this.repo.get('job', id)!;
        // A replaced attempt owns its own status; a late callback must never overwrite it.
        if (current.attemptToken !== token) return;
        const terminated = await this.summary.resolve(current.remote),
          reason = this.invalidReason(job);
        const blocked = error instanceof DomainError && error.code === 'CAPABILITY_UNSUPPORTED';
        update({
          status:
            terminated === 'unknown'
              ? 'result-unknown'
              : reason
                ? 'superseded'
                : current.attempts < 2 && !blocked
                  ? 'queued'
                  : 'failed',
          processingMs: Math.max(0, Date.parse(this.clock.now()) - Date.parse(job.startedAt!)),
          error: reason ?? (error instanceof Error ? error.message : String(error)),
          retryable: terminated !== 'unknown' && !reason && current.attempts < 2 && !blocked,
        });
      }
      this.refreshInput(workId);
      this.events.changed(workId);
    } finally {
      this.processing.delete(workId);
    }
  }
  async recover(): Promise<void> {
    await this.explanations.recover();
    await this.questions.recover();
    this.continuations.recover();
    for (const job of this.repo
      .list('job')
      .filter((j) => ['summarizing', 'checking', 'result-unknown'].includes(j.status))) {
      this.resumeJob(job, (await this.summary.resolve(job.remote)) === 'terminated');
    }
    for (const h of this.repo.list('handoff').filter((h) => h.state === 'dispatching'))
      this.repo.put('handoff', {
        ...h,
        state: 'result-unknown',
        error: 'App dispatch outcome is unknown; no automatic retry',
      });
  }
  snapshot(workId: string): ReturnContextSnapshot {
    const work = this.work(workId);
    this.activeConnectionForWork(workId);
    const sources = this.sources(workId),
      links = this.links(workId).map((l) =>
        l.evidence.every((id) => this.accessibleSource(workId, id))
          ? l
          : {
              ...l,
              evidence: l.evidence.filter((id) => this.accessibleSource(workId, id)),
              relation: 'unclear' as const,
              rationale: 'The connection evidence is outside the selected records. Review scope.',
            },
      );
    const storedSummary = work.latestSummaryId
      ? this.repo.get('summary', work.latestSummaryId)
      : null;
    const summary = storedSummary?.sourceRevisionIds.every((id) =>
      this.accessibleSource(workId, id),
    )
      ? storedSummary
      : null;
    const accessibleThreads = new Set(
      links.filter((l) => l.status === 'linked').map((l) => l.threadId),
    );
    const currentKeys = new Set(sources.map((s) => s.key)),
      linkByThread = new Map(links.map((l) => [l.threadId, l]));
    const connection = this.repo.get('connection', work.projectId)!;
    const historicalIds = new Set(
      storedSummary?.linkVersion === work.linkVersion ? storedSummary.sourceRevisionIds : [],
    );
    const accessibleEvidenceIds = this.repo
      .list('source')
      .filter((s) => {
        const link = linkByThread.get(s.threadId);
        return (
          (link?.status === 'proposed' && link.evidence.includes(s.id)) ||
          (link?.status === 'linked' &&
            (currentKeys.has(s.key) ||
              (!connection.recordRanges?.[s.threadId] && historicalIds.has(s.id))))
        );
      })
      .map((s) => s.id);
    return {
      accessibleEvidenceIds,
      scopeRecords: sources.map((s) => ({
        id: s.id,
        threadId: s.threadId,
        turnId: s.turnId,
        itemId: s.itemId,
        actor: s.actor,
        preview: s.text.slice(0, 180),
      })),
      goalCandidates: this.goalCandidates(workId),
      explanation: this.explanations.view(workId),
      conversationFlows: conversationFlows(summary, (id) => {
        const source = this.repo.get('source', id);
        return source && this.accessibleSource(workId, source.id) ? source : null;
      }),
      freshness: this.freshness(workId),
      workspace: this.inspectWorkspace(this.repo.get('connection', work.projectId)!.cwd),
      continuation:
        this.repo
          .list('continuation')
          .filter((c) => c.workId === workId)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
          .at(-1) ?? null,
      refresh: this.refreshState(work),
      coverage: summaryCoverage(
        sources,
        summary,
        (id) => this.repo.get('source', id),
        accessibleThreads,
      ),
      work: {
        ...work,
        goalCandidates: this.goalCandidates(workId),
        ...(work.goal?.evidenceId && !sources.some((s) => s.id === work.goal!.evidenceId)
          ? { goal: { ...work.goal, text: '' } }
          : {}),
      },
      connection: this.repo.get('connection', work.projectId)!,
      links,
      checkpoints: this.repo.list('checkpoint').filter((c) => c.workId === workId),
      summary:
        summary && summary.sourceRevisionIds.every((id) => this.accessibleSource(workId, id))
          ? summary
          : null,
      overlays: this.repo.list('overlay').filter((o) => o.workId === workId),
      draft: this.repo.get('draft', workId),
      visit: this.repo.get('visit', workId),
      jobs: this.repo
        .list('job')
        .filter((j) => j.workId === workId)
        .map((j) =>
          j.inputSnapshot?.sourceRevisionIds.every((id) => this.accessibleSource(workId, id))
            ? j
            : {
                ...j,
                candidate: null,
                error: j.error
                  ? 'Earlier analysis used records outside the current goal scope.'
                  : null,
              },
        )
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      sourceRevisionIds: sources.map((s) => s.id),
      sourceIndex: sources
        .filter((s) => s.actor === 'user' || s.actor === 'agent')
        .map((s) => ({
          id: s.id,
          threadId: s.threadId,
          actor: s.actor,
          preview: s.text.slice(0, 250),
        })),
      capabilities: this.capabilities(),
      execution: sources
        .filter((s) => s.kind === 'turnStatus')
        .map((s) => ({
          threadId: s.threadId,
          turnId: s.turnId,
          status: s.turnStatus,
          evidenceId: s.id,
          eventAt: s.eventAt,
          role: links.find((l) => l.threadId === s.threadId)?.role ?? 'work',
        })),
    };
  }
  evidence(id: string, workId?: string): SourceRevision {
    if (workId) {
      const source = this.accessibleSource(workId, id);
      if (!source) throw new DomainError('NOT_FOUND', 'Evidence outside this goal scope', 404);
      return source;
    }
    if (this.repo.list('work').some((w) => w.goal))
      throw new DomainError('VALIDATION', 'Choose a goal when requesting source evidence', 400);
    const s = this.repo.get('source', id);
    const allowed = s && this.repo.list('work').some((w) => this.accessibleSource(w.id, id));
    if (!s || !allowed)
      throw new DomainError('NOT_FOUND', 'Evidence is outside the active scope', 404);
    return s;
  }
  mutate(
    workId: string,
    action: 'corrections' | 'drafts' | 'visits' | 'link' | 'retry',
    command: Command,
    targetId?: string,
  ): Receipt {
    const bodyHash = this.ids.hash({
      action,
      workId,
      targetId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const w = this.work(workId);
      this.activeConnectionForWork(workId);
      if (w.revision !== command.expectedRevision)
        throw new DomainError('REVISION_CONFLICT', 'Displayed work revision changed', 409);
      let resultId = workId,
        changed = false;
      if (action === 'corrections') {
        const p = correctionInputSchema.parse(command.payload),
          base = this.repo.get('summary', p.baseSummaryId);
        if (!base || base.workId !== workId || base.id !== w.latestSummaryId)
          throw new DomainError('REVISION_CONFLICT', 'Correction base changed', 409);
        const id = this.ids.hash([workId, p.slot]),
          old = this.repo.get('overlay', id);
        if ((old?.revision ?? 0) !== p.overlayRevision)
          throw new DomainError('REVISION_CONFLICT', 'Correction was edited elsewhere', 409);
        this.repo.put('overlay', {
          id,
          workId,
          slot: p.slot,
          text: p.text,
          baseSummaryId: base.id,
          active: p.active,
          revision: p.overlayRevision + 1,
          updatedAt: this.clock.now(),
          history: [
            ...(old?.history ?? []),
            ...(old ? [{ text: old.text, active: old.active, at: old.updatedAt }] : []),
          ],
        });
        resultId = id;
        changed = true;
      } else if (action === 'drafts') {
        const p = draftInputSchema.parse(command.payload);
        this.validateTarget(workId, p.threadId, p.summaryId, p.evidenceIds);
        const old = this.repo.get('draft', workId);
        if ((old?.revision ?? 0) !== p.draftRevision)
          throw new DomainError('REVISION_CONFLICT', 'Draft was edited elsewhere', 409);
        this.repo.put('draft', {
          id: workId,
          workId,
          threadId: p.threadId,
          evidenceIds: p.evidenceIds,
          summaryId: p.summaryId,
          text: p.text,
          revision: p.draftRevision + 1,
          updatedAt: this.clock.now(),
        });
      } else if (action === 'visits') {
        const p = visitInputSchema.parse(command.payload),
          summary = this.repo.get('summary', p.summaryId);
        if (
          !summary ||
          summary.workId !== workId ||
          p.evidenceIds.some((id) => !summary.sourceRevisionIds.includes(id))
        )
          throw new DomainError('VALIDATION', 'Displayed scope does not match summary');
        const previous = this.repo.get('visit', workId);
        const evidenceIds = [
          ...new Set([
            ...(previous?.summaryId === p.summaryId ? previous.evidenceIds : []),
            ...p.evidenceIds,
          ]),
        ];
        this.repo.put('visit', {
          id: workId,
          workId,
          summaryId: p.summaryId,
          evidenceIds,
          at: this.clock.now(),
        });
      } else if (action === 'link') {
        const p = linkInputSchema.parse(command.payload),
          l = this.repo.get('link', targetId ?? '');
        if (!l || l.workId !== workId) throw new DomainError('NOT_FOUND', 'Link not found', 404);
        if (l.revision !== p.linkRevision)
          throw new DomainError('REVISION_CONFLICT', 'Link changed', 409);
        const next = p.undo ? l.history.at(-1)?.status : p.status;
        if (!next) throw new DomainError('VALIDATION', 'Nothing to undo');
        this.repo.put('link', {
          ...l,
          status: next,
          revision: l.revision + 1,
          history: p.undo
            ? l.history.slice(0, -1)
            : [...l.history, { status: l.status, at: this.clock.now() }],
        });
        w.linkVersion++;
        this.repo.put('work', w);
        this.refreshInput(workId);
        resultId = l.id;
      } else {
        const j = this.repo.get('job', targetId ?? '');
        if (!j || j.workId !== workId) throw new DomainError('NOT_FOUND', 'Job not found', 404);
        if (
          !['failed', 'queued'].includes(j.status) ||
          !j.retryable ||
          j.attempts >= 2 ||
          this.invalidReason(this.restoreInput(j))
        )
          throw new DomainError('VALIDATION', 'Retry is unavailable for this attempt');
        this.repo.put('job', { ...j, status: 'queued', updatedAt: this.clock.now() });
        resultId = j.id;
      }
      if (changed) this.repo.put('work', { ...w, revision: w.revision + 1 });
      const r: Receipt = {
        id: command.requestId,
        command: action,
        bodyHash,
        workId,
        committedRevision: this.work(workId).revision,
        resultId,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', r);
      return r;
    });
    if (action !== 'visits') this.events.changed(workId);
    return receipt;
  }
  private validateTarget(
    workId: string,
    threadId: string,
    summaryId: string,
    evidenceIds: string[],
  ) {
    const w = this.work(workId),
      summary = this.repo.get('summary', summaryId);
    if (!this.links(workId).some((l) => l.threadId === threadId && l.status === 'linked'))
      throw new DomainError('HANDOFF_TARGET_UNLINKED', 'Handoff thread is not linked');
    if (!summary || summary.workId !== workId || w.latestSummaryId !== summaryId)
      throw new DomainError('HANDOFF_SUMMARY_CHANGED', 'Handoff summary changed', 409);
    if (!evidenceIds.length || evidenceIds.some((id) => !summary.sourceRevisionIds.includes(id)))
      throw new DomainError(
        'HANDOFF_EVIDENCE_INACCESSIBLE',
        'Handoff evidence is outside the displayed input or current access',
      );
  }
  prepareHandoff(workId: string, expectedRevision: number, input: unknown): HandoffTarget {
    const p = draftInputSchema.parse(input),
      w = this.work(workId);
    this.activeConnectionForWork(workId);
    this.validateTarget(workId, p.threadId, p.summaryId, p.evidenceIds);
    if (
      this.collecting.has(workId) ||
      this.repo.list('checkpoint').some((c) => c.workId === workId && c.status === 'reading')
    )
      throw new DomainError('HANDOFF_COLLECTING', 'Collection is still checking this target', 409);
    const summary = this.repo.get('summary', p.summaryId)!;
    if (summary.inputVersion !== w.inputVersion)
      throw new DomainError(
        'HANDOFF_INPUT_CHANGED',
        'New input is not reflected in the displayed summary',
        409,
      );
    if (
      summary.extractorVersion !== EXTRACTOR_VERSION ||
      !summary.analysis ||
      this.ids.hash(summary.analysis) !== this.configurationHash()
    )
      throw new DomainError('HANDOFF_CONFIGURATION_CHANGED', 'Analysis configuration changed', 409);
    const accessible = new Set(this.sources(workId).map((source) => source.id));
    if (p.evidenceIds.some((id) => !accessible.has(id)))
      throw new DomainError(
        'HANDOFF_EVIDENCE_INACCESSIBLE',
        'Handoff evidence is outside current access',
      );
    if (w.revision !== expectedRevision)
      throw new DomainError('REVISION_CONFLICT', 'Handoff target revision changed', 409);
    const precision = this.navigator.capability().precision;
    const link = this.links(workId).find(
      (l) => l.threadId === p.threadId && l.status === 'linked',
    )!;
    return {
      title: link.title,
      role: link.role,
      workId,
      expectedRevision,
      threadId: p.threadId,
      summaryId: p.summaryId,
      evidenceIds: p.evidenceIds,
      draft: p.text,
      precision,
      url: precision === 'thread' ? `codex://threads/${encodeURIComponent(p.threadId)}` : null,
    };
  }
  async openHandoff(workId: string, command: Command): Promise<Receipt> {
    const bodyHash = this.ids.hash({
      action: 'open',
      workId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const existing = this.receipt(command.requestId, bodyHash);
    if (existing) return existing;
    const target = this.prepareHandoff(workId, command.expectedRevision, command.payload);
    if (target.precision === 'unsupported')
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'Independent app navigation has not been verified',
      );
    const result = this.repo.transaction(() => {
      const again = this.receipt(command.requestId, bodyHash);
      if (again) return { receipt: again, dispatch: false };
      const id = this.ids.next(),
        now = this.clock.now();
      this.repo.put('handoff', { id, target, state: 'dispatching', error: null, createdAt: now });
      const receipt: Receipt = {
        id: command.requestId,
        command: 'open',
        workId,
        bodyHash,
        committedRevision: this.work(workId).revision,
        resultId: id,
        createdAt: now,
      };
      this.repo.put('receipt', receipt);
      return { receipt, dispatch: true };
    });
    if (result.dispatch) {
      let state: 'dispatched' | 'failed' | 'result-unknown' = 'dispatched',
        error: string | null = null;
      try {
        await this.navigator.open(target.threadId);
      } catch (e) {
        state =
          e instanceof DomainError && e.code === 'RESULT_UNKNOWN' ? 'result-unknown' : 'failed';
        error = String(e);
      }
      // A failed receipt write after OS acceptance must not become a retryable OS failure.
      const h = this.repo.get('handoff', result.receipt.resultId)!;
      this.repo.put('handoff', { ...h, state, error });
      this.events.changed(workId);
    }
    return result.receipt;
  }
  async close() {
    this.questions.beginClose();
    this.explanations.beginClose();
    this.closing = true;
    await Promise.all([
      this.reader.close(),
      this.summary.close(),
      this.sessionExecutor.close?.(),
      this.projectInspector?.close?.(),
    ]);
    await this.questions.settled();
    await this.explanations.settled();
    while (this.collecting.size || this.processing.size || this.discovering.size)
      await new Promise((r) => setTimeout(r, 25));
  }
}
