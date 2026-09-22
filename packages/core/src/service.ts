import { ProjectExecutions } from './project-executions';
import { ProjectAnalyses } from './analyses';
import { Projects } from './projects';
import { ProjectModel } from './project-model';
import { WorkMatcher } from './work-matching';
import { ProjectNowResolver } from './project-now';
import { Releases } from './releases';
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
  type ProjectRecord,
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
  ErrorReporter,
} from './ports';
import { checkAssessment, checkCandidate, relationshipEvidence } from './checks';
import { assessFreshness } from './freshness';
import { summaryCoverage } from './coverage';
import { conversationFlows } from './conversation-flow';
import { ContextQuestions } from './questions';
import { Explanations } from './explanations';
import { Continuations } from './continuations';
import { collectionResult, discoveryResult } from './collection-change';
import { normalizeProjectFolder } from './project-folder';

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
  readonly projects = new Projects(this);
  readonly executions = new ProjectExecutions(this);
  readonly projectModel = new ProjectModel(this);
  readonly workMatcher = new WorkMatcher(this);
  readonly now = new ProjectNowResolver(this);
  readonly releases = new Releases(this);
  readonly analyses = new ProjectAnalyses(this);
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
    private readonly errorReporter?: ErrorReporter,
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

  reportError(error: unknown, operation: string, projectId: string): void {
    try {
      this.errorReporter?.(error, { operation, projectId });
    } catch {
      // Logging cannot interrupt failure handling or leave an analysis running.
    }
  }
  directionIntent(id: string): import('@statecarry/contracts').GoalIntent | undefined {
    const direction = this.repo
      .list('direction')
      .find(
        (item) =>
          item.projectId === id && item.state === 'active' && item.primary && item.confirmed,
      );
    return direction
      ? { text: direction.text, origin: 'user-input', confirmedAt: direction.createdAt }
      : undefined;
  }
  analysisCorrections(id: string) {
    return this.repo.get('projectAnalysisControl', id)?.corrections ?? [];
  }
  storeAnalysis(record: import('@statecarry/contracts').ProjectAnalysisRecord) {
    this.repo.transaction(() => {
      this.repo.put('projectAnalysis', record);
      this.workMatcher.replaceProposals(
        record.projectId,
        'analysis-candidate',
        record.result.candidates
          .filter(
            (candidate) =>
              !this.analysisCorrections(record.projectId).some(
                (correction) =>
                  correction.scope === record.result.scope &&
                  correction.candidateKey === candidate.key &&
                  correction.kind === 'wrong-work',
              ),
          )
          .map((original) => {
            const correction = this.analysisCorrections(record.projectId).find(
              (item) => item.scope === record.result.scope && item.candidateKey === original.key,
            );
            const candidate =
              correction?.kind === 'wrong-action'
                ? {
                    ...original,
                    status: 'active' as const,
                    nextAction: correction.nextAction ?? null,
                    doneWhen: correction.doneWhen ?? null,
                  }
                : correction && ['done', 'paused'].includes(correction.kind)
                  ? {
                      ...original,
                      status: correction.kind as 'done' | 'paused',
                      nextAction: null,
                      doneWhen: null,
                    }
                  : original;
            return {
              key: `analysis:${candidate.key}`,
              source: 'analysis-candidate',
              title: candidate.goal,
              state: candidate.status,
              currentState: candidate.currentState,
              uncertainty: candidate.prerequisites[0] ?? candidate.reason ?? null,
              nextAction: candidate.nextAction,
              doneWhen: candidate.doneWhen,
              evidenceBasis: record.result.scope,
            };
          }),
        record.result.outputLanguage ?? 'en',
      );
    });
  }
  analysisRecord(id: string) {
    return this.repo.get('projectAnalysis', id);
  }
  project(id: string): ProjectRecord {
    const w = this.repo.get('project', id);
    if (!w) throw new DomainError('NOT_FOUND', 'Project not found', 404);
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
  listRemovedConnections(): { connection: Connection; workRevision: number }[] {
    return this.repo
      .list('connection')
      .filter((connection) => !!connection.removedAt)
      .map((connection) => ({
        connection,
        workRevision: this.project(connection.projectId).revision,
      }));
  }
  connection(connectionId: string, allowRemoved = false): Connection {
    const value = this.repo.get('connection', connectionId);
    if (!value || (!allowRemoved && value.removedAt))
      throw new DomainError('NOT_FOUND', 'Connection not found', 404);
    return value;
  }
  private activeConnectionForWork(projectId: string): Connection {
    const work = this.project(projectId);
    return this.connection(work.connectionId);
  }
  isCollecting(projectId: string): boolean {
    return this.collecting.has(projectId);
  }
  /** Includes work still unwinding after its durable status has changed. */
  hasProjectActivity(projectId: string): boolean {
    const work = this.repo.get('project', projectId);
    return (
      this.collectionPromises.has(projectId) ||
      this.collecting.has(projectId) ||
      this.processing.has(projectId) ||
      (!!work && this.discovering.has(work.connectionId)) ||
      this.analyses.isRunning(projectId) ||
      this.questions.hasPendingWork(projectId) ||
      this.explanations.hasPendingWork(projectId)
    );
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
  links(projectId: string) {
    return this.repo.list('link').filter((l) => l.projectId === projectId);
  }
  sources(projectId: string): SourceRevision[] {
    const linked = new Set(
      this.links(projectId)
        .filter((l) => l.status === 'linked')
        .map((l) => l.threadId),
    );
    return this.repo
      .list('checkpoint')
      .filter((c) => c.projectId === projectId && linked.has(c.threadId))
      .flatMap((c) =>
        c.revisionIds
          .map((id) => this.repo.get('source', id))
          .filter((s): s is SourceRevision => !!s),
      );
  }
  private workspaceFileSource(projectId: string, id: string): SourceRevision | null {
    const work = this.project(projectId);
    const snapshots = [
      this.analysisRecord(work.id)?.result?.workspaceBefore,
      this.analysisRecord(work.id)?.result?.workspaceAfter,
    ];
    const file = snapshots
      .flatMap((snapshot) => (snapshot?.files?.length ? snapshot.files : (snapshot?.files ?? [])))
      .find(
        (item) =>
          (item.revisionId ??
            `workspace-file:${this.ids.hash([item.path, item.hash, item.size ?? null])}`) === id,
      );
    if (!file) return null;
    const connection = this.repo.get('connection', work.connectionId);
    if (!this.isConnectionActive(connection)) return null;
    const linkedThread = connection
      ? this.links(projectId).find(
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
          (snapshot?.files?.length ? snapshot.files : (snapshot?.files ?? [])).some(
            (item) =>
              (item.revisionId ??
                `workspace-file:${this.ids.hash([item.path, item.hash, item.size ?? null])}`) ===
              id,
          ),
        )?.checkedAt ?? null,
      observedAt:
        snapshots.find((snapshot) =>
          (snapshot?.files?.length ? snapshot.files : (snapshot?.files ?? [])).some(
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

  accessibleSource(
    projectId: string,
    id: string,
    availableSources?: readonly SourceRevision[],
  ): SourceRevision | null {
    const source = this.repo.get('source', id);
    if (!source) return this.workspaceFileSource(projectId, id);
    const work = this.project(projectId),
      connection = this.repo.get('connection', work.connectionId);
    if (!this.isConnectionActive(connection)) return null;
    const link = this.links(projectId).find((l) => l.threadId === source.threadId);
    if (link?.status === 'proposed' && link.evidence.includes(id)) return source;
    if (link?.status !== 'linked') return null;
    if ((availableSources ?? this.sources(projectId)).some((s) => s.key === source.key))
      return source;
    if (this.analyses.retainsEvidence(projectId, source)) return source;
    const summary = work.latestSummaryId ? this.repo.get('summary', work.latestSummaryId) : null;
    // Missing collection is not permission withdrawal. Preserve a known historical
    // input only while the original access version still matches.
    return !connection.recordRanges?.[source.threadId] &&
      summary?.linkVersion === work.linkVersion &&
      summary.sourceRevisionIds.includes(id)
      ? source
      : null;
  }
  goalCandidates(projectId: string) {
    return goalCandidates(this, projectId);
  }
  private jobId(projectId: string, inputVersion: string, configurationHash: string) {
    return this.ids.hash([
      projectId,
      inputVersion,
      EXTRACTOR_VERSION,
      configurationHash,
      'fixed-input-v1',
    ]);
  }
  private configurationHash() {
    return this.ids.hash(this.summary.configuration());
  }
  private refreshState(work: ProjectRecord): NonNullable<ReturnContextSnapshot['refresh']> {
    const jobs = this.repo.list('job').filter((j) => j.projectId === work.id);
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
  freshness(projectId: string) {
    const work = this.project(projectId),
      connection = this.activeConnectionForWork(projectId),
      summary = work.latestSummaryId ? this.repo.get('summary', work.latestSummaryId) : null;
    return assessFreshness(
      work,
      connection,
      this.links(projectId),
      this.repo.list('checkpoint').filter((c) => c.projectId === projectId),
      summary,
      this.clock.now(),
      summary?.extractorVersion === EXTRACTOR_VERSION &&
        !!summary?.analysis &&
        this.ids.hash(summary.analysis) === this.configurationHash(),
    );
  }
  listProjects(): ProjectListItem[] {
    return this.listConnections().map((c) => {
      const w = this.project(c.projectId),
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
        projectId: w.id,
        revision: w.revision,
        summaryId: s?.id ?? null,
        freshness: this.freshness(w.id),
        current:
          explanations.find((e) => e.id === view.revision?.id)?.current ||
          (this.directionIntent(w.id)
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
      const folder = normalizeProjectFolder(input.cwd);
      if (folder === null)
        throw new DomainError('VALIDATION', 'Use an absolute project folder path.');
      if (
        this.repo
          .list('project')
          .some(
            (work) =>
              normalizeProjectFolder(this.repo.get('connection', work.connectionId)?.cwd ?? '') ===
              folder,
          )
      )
        throw new DomainError(
          'VALIDATION',
          'This folder is already a project. Connect conversations through that project’s source settings.',
          409,
        );
      const id = this.ids.next(),
        projectId = this.ids.next(),
        at = this.clock.now();
      const c: Connection = {
        ...input,
        id,
        projectId,
        threadIds: [...new Set(input.threadIds)],
        revision: 1,
        createdAt: at,
      };
      this.repo.put('project', {
        id: projectId,
        connectionId: id,
        cwd: input.cwd,
        purposes: [],
        focused: false,
        iconAsset: null,
        bannerAsset: null,
        lifecycle: 'active',
        title: input.title,
        revision: 1,
        linkVersion: 1,
        inputVersion: '',
        latestSummaryId: null,
        createdAt: at,
      });
      this.repo.put('connection', c);
      for (const threadId of c.threadIds)
        this.repo.put('link', {
          id: this.ids.hash([projectId, threadId]),
          projectId,
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
        projectId,
        committedRevision: 1,
        resultId: id,
        createdAt: at,
      };
      this.repo.put('receipt', r);
      return r;
    });
    this.events.changed(receipt.projectId);
    return receipt;
  }
  describeGoal(projectId: string, command: Command): Receipt {
    const bodyHash = this.ids.hash({
      action: 'describe-goal',
      projectId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const existing = this.receipt(command.requestId, bodyHash);
    if (existing) return existing;
    const work = this.project(projectId);
    if (work.revision !== command.expectedRevision)
      throw new DomainError('REVISION_CONFLICT', 'Goal changed; review your input.', 409);
    const text = typeof command.payload.text === 'string' ? command.payload.text.trim() : '';
    if (!text || text.length > 1200)
      throw new DomainError('VALIDATION', 'Describe a goal in 1–1200 characters.');
    // Goal edits never grant record access. Keep this connection and every range unchanged.
    const receipt = this.repo.transaction(() => {
      this.projectModel.setDirection(projectId, text, false, false);
      this.repo.put('project', {
        ...work,
        title: work.title,
        revision: work.revision + 1,
        linkVersion: work.linkVersion + 1,
        latestSummaryId: null,
      });
      const connection = this.repo.get('connection', work.connectionId)!;
      this.repo.put('connection', { ...connection, title: work.title });
      this.refreshInput(projectId);
      const receipt: Receipt = {
        id: command.requestId,
        command: 'describe-goal',
        bodyHash,
        projectId,
        committedRevision: this.project(projectId).revision,
        resultId: projectId,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', receipt);
      return receipt;
    });
    this.questions.invalidateGoal(projectId);
    this.events.changed(projectId);
    return receipt;
  }
  updateConnection(connectionId: string, command: Command): Receipt {
    const input = connectionInputSchema.parse(command.payload);
    return this.updateConnectionScope(connectionId, command, input);
  }
  /** Shared by validated legacy connection and project source commands. */
  updateConnectionScope(
    connectionId: string,
    command: Command,
    input: ReturnType<typeof connectionInputSchema.parse>,
    projectWorkId?: string,
  ): Receipt {
    const bodyHash = this.ids.hash(
      projectWorkId
        ? {
            action: 'project-sources',
            projectId: projectWorkId,
            expectedRevision: command.expectedRevision,
            payload: command.payload,
          }
        : { action: 'connection-scope', connectionId, ...command, requestId: undefined },
    );
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const c = this.connection(connectionId);
      const w = this.project(c.projectId);
      if (projectWorkId && w.id !== projectWorkId)
        throw new DomainError('NOT_FOUND', 'Project connection not found', 404);
      if (w.revision !== command.expectedRevision)
        throw new DomainError('REVISION_CONFLICT', 'Connection scope changed', 409);
      const folder = normalizeProjectFolder(input.cwd);
      if (folder === null)
        throw new DomainError('VALIDATION', 'Use an absolute project folder path.');
      if (
        this.repo
          .list('project')
          .some(
            (other) =>
              other.id !== w.id &&
              normalizeProjectFolder(this.repo.get('connection', other.connectionId)?.cwd ?? '') ===
                folder,
          )
      )
        throw new DomainError(
          'VALIDATION',
          'That folder already belongs to another project registration.',
          409,
        );
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
          projectId: w.id,
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
      for (const cp of this.repo.list('checkpoint').filter((cp) => cp.projectId === w.id)) {
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
      this.repo.put('project', {
        ...w,
        title: input.title,
        cwd: input.cwd,
        revision: w.revision + 1,
        linkVersion: w.linkVersion + 1,
      });
      this.refreshInput(w.id);
      const r: Receipt = {
        id: command.requestId,
        command: projectWorkId ? 'project-sources' : 'connection-scope',
        bodyHash,
        projectId: w.id,
        committedRevision: this.project(w.id).revision,
        resultId: c.id,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', r);
      return r;
    });
    if (projectWorkId) this.events.changed(receipt.projectId, 'sources');
    else this.events.changed(receipt.projectId);
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
      const w = this.project(c.projectId);
      if (w.revision !== command.expectedRevision)
        throw new DomainError(
          'REVISION_CONFLICT',
          'Connection changed; review it before removing it',
          409,
        );
      const at = this.clock.now();
      this.repo.put('connection', { ...c, removedAt: at, revision: c.revision + 1 });
      this.repo.put('project', {
        ...w,
        focused: false,
        lifecycle: 'disconnected',
        revision: w.revision + 1,
      });
      const result: Receipt = {
        id: command.requestId,
        command: 'connection-remove',
        bodyHash,
        projectId: w.id,
        committedRevision: this.project(w.id).revision,
        resultId: c.id,
        createdAt: at,
      };
      this.repo.put('receipt', result);
      return result;
    });
    this.events.changed(receipt.projectId);
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
      const w = this.project(c.projectId);
      if (!c.removedAt) throw new DomainError('VALIDATION', 'Connection is already active');
      if (w.revision !== command.expectedRevision)
        throw new DomainError(
          'REVISION_CONFLICT',
          'Connection changed; review it before restoring it',
          409,
        );
      const at = this.clock.now();
      this.repo.put('connection', { ...c, removedAt: null, revision: c.revision + 1 });
      this.repo.put('project', {
        ...w,
        focused: false,
        lifecycle: 'active',
        revision: w.revision + 1,
      });
      const result: Receipt = {
        id: command.requestId,
        command: 'connection-restore',
        bodyHash,
        projectId: w.id,
        committedRevision: this.project(w.id).revision,
        resultId: c.id,
        createdAt: at,
      };
      this.repo.put('receipt', result);
      return result;
    });
    this.events.changed(receipt.projectId);
    return receipt;
  }
  private receipt(id: string, hash: string): Receipt | null {
    const r = this.repo.get('receipt', id);
    if (r && r.bodyHash !== hash)
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Request id was used with another body', 409);
    return r;
  }
  private refreshInput(projectId: string) {
    const w = this.project(projectId),
      sources = this.sources(projectId),
      configurationHash = this.configurationHash();
    const inputVersion = this.ids.hash({ sources: sources.map((s) => s.id), links: w.linkVersion });
    const changed = inputVersion !== w.inputVersion;
    if (changed) {
      w.inputVersion = inputVersion;
      w.revision++;
    }
    const id = this.jobId(projectId, inputVersion, configurationHash);
    const existing =
      this.repo.get('job', id) ??
      this.repo
        .list('job')
        .find(
          (j) =>
            j.projectId === projectId &&
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
      this.repo.put('project', { ...w, pendingRefresh });
  }
  // Legacy candidates may only resume when their entire original input can be proven.
  private restoreInput(job: Job): Job {
    if (job.inputSnapshot) return job;
    const w = this.project(job.projectId),
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
        connectionRevision: this.repo.get('connection', w.connectionId)!.revision,
        capturedAt: null,
        baseSummaryId: w.latestSummaryId,
      },
    };
  }
  private invalidReason(job: Job): string | null {
    const w = this.project(job.projectId),
      connection = this.repo.get('connection', w.connectionId),
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
  private analysisJob(original: Job, terminated: boolean) {
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
      .find((s) => s.projectId === original.projectId && s.attemptToken === original.attemptToken);
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
  needsProcessing(projectId: string): boolean {
    const work = this.repo.get('project', projectId);
    if (!work) return false;
    if (work.pendingRefresh) return true;
    return this.repo
      .list('job')
      .some(
        (job) =>
          job.projectId === projectId &&
          (job.status === 'queued' || job.status === 'result-unknown'),
      );
  }
  private applyRead(projectId: string, connection: Connection, read: SourceRead) {
    const currentConnection = this.repo.get('connection', connection.id);
    if (
      !this.isConnectionActive(currentConnection) ||
      currentConnection.revision !== connection.revision
    )
      throw new DomainError('REVISION_CONFLICT', 'Collection scope changed', 409);
    if (!this.links(projectId).some((l) => l.threadId === read.threadId && l.status === 'linked'))
      throw new DomainError('REVISION_CONFLICT', 'Source is no longer linked', 409);
    if (read.revisions.some((s) => s.threadId !== read.threadId))
      throw new DomainError('SOURCE_UNAVAILABLE', 'Source item belongs to another thread');
    const id = this.ids.hash([projectId, read.threadId]);
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
        projectId,
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
      this.refreshInput(projectId);
    });
  }
  collect(projectId: string): Promise<void> {
    const current = this.collectionPromises.get(projectId);
    if (current) return current;
    const pending = this.collectOnce(projectId).finally(() => {
      this.collectionPromises.delete(projectId);
    });
    this.collectionPromises.set(projectId, pending);
    return pending;
  }
  private async collectOnce(projectId: string): Promise<void> {
    if (this.collecting.has(projectId) || this.closing) return;
    this.collecting.add(projectId);
    let changed = false;
    let invalidated = false;
    let scope: Connection | null = null;
    try {
      const connection = this.activeConnectionForWork(projectId);
      scope = connection;
      for (const link of this.links(projectId).filter((l) => l.status === 'linked')) {
        const currentConnection = this.repo.get('connection', connection.id);
        if (
          !this.isConnectionActive(currentConnection) ||
          currentConnection.revision !== connection.revision
        )
          return;
        const id = this.ids.hash([projectId, link.threadId]),
          prior = this.repo.get('checkpoint', id),
          now = this.clock.now();
        const before = this.ids.hash(collectionResult(prior, this.repo.get('link', id)));
        this.repo.put(
          'checkpoint',
          prior
            ? { ...prior, status: 'reading', lastAttemptAt: now }
            : {
                id,
                projectId,
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
        try {
          const read = await this.reader.read(
            link.threadId,
            connection.startTurnIds[link.threadId] ??
              connection.discoveryScope?.startTurnIds[link.threadId],
          );
          if (read.threadId !== link.threadId)
            throw new DomainError('SOURCE_UNAVAILABLE', 'Reader returned another thread');
          this.applyRead(projectId, connection, read);
        } catch (error) {
          const currentConnection = this.repo.get('connection', connection.id);
          if (
            !this.isConnectionActive(currentConnection) ||
            currentConnection.revision !== connection.revision
          )
            return;
          if (this.repo.get('link', id)?.status !== 'linked') {
            invalidated = true;
            return;
          }
          const current = this.repo.get('checkpoint', id)!;
          this.repo.put('checkpoint', {
            ...current,
            status: 'failed',
            limitations: [String(error instanceof Error ? error.message : error)],
            ...(connection.recordRanges?.[link.threadId] ? { revisionIds: [] } : {}),
            lastAttemptAt: now,
          });
        }
        changed ||=
          before !==
          this.ids.hash(
            collectionResult(this.repo.get('checkpoint', id), this.repo.get('link', id)),
          );
      }
    } finally {
      this.collecting.delete(projectId);
      const current = scope && this.repo.get('connection', scope.id);
      // A scope mutation publishes its own change. An obsolete read must not
      // announce completion under that new scope or revive removed work.
      if (
        changed &&
        !invalidated &&
        this.isConnectionActive(current) &&
        current.revision === scope?.revision
      )
        this.events.changed(projectId);
      // An independent read can have observed `reading` even when the final
      // content is identical. This terminal signal is not a content change.
      this.events.collectionSettled?.(projectId);
    }
  }
  async discover(connection: Connection): Promise<void> {
    if (
      !connection.discover ||
      !connection.threadIds.length ||
      this.discovering.has(connection.id) ||
      this.closing
    )
      return;
    const initial = this.repo.get('connection', connection.id);
    if (!this.isConnectionActive(initial) || initial.revision !== connection.revision) return;
    const before = this.ids.hash(discoveryResult(initial.discovery));
    let changed = false;
    let invalidated = false;
    // Discovery may itself attach a proven continuation. Track only revisions
    // committed here so an unrelated scope edit still rejects late results.
    let scopeRevision = connection.revision;
    this.discovering.add(connection.id);
    try {
      const result = await this.reader.discover(connection.cwd);
      const discoveredConnection = this.repo.get('connection', connection.id);
      if (
        !this.isConnectionActive(discoveredConnection) ||
        discoveredConnection.revision !== scopeRevision
      )
        return;
      this.repo.put('connection', {
        ...discoveredConnection,
        discovery: {
          status: result.complete ? 'checked' : 'partial',
          attemptedAt: this.clock.now(),
          successfulAt: result.complete
            ? this.clock.now()
            : (discoveredConnection.discovery?.successfulAt ?? null),
          threadIds: result.threads.map((t) => t.id),
          manifest: result.manifest,
          limitations: result.limitations,
        },
      });
      const failures: string[] = [];
      for (const thread of result.threads) {
        const beforeRead = this.repo.get('connection', connection.id);
        if (!this.isConnectionActive(beforeRead) || beforeRead.revision !== scopeRevision) return;
        const existing = this.links(connection.projectId).find((l) => l.threadId === thread.id);
        if (existing && existing.status !== 'proposed') continue;
        // Visible metadata is retained even when reading a new session fails.
        const id = this.ids.hash([connection.projectId, thread.id]);
        if (!existing) {
          this.repo.put('link', {
            id,
            projectId: connection.projectId,
            threadId: thread.id,
            title: thread.title,
            status: 'proposed',
            revision: 1,
            evidence: [],
            rationale: 'Discovered within allowed folder; relationship unconfirmed',
            role: 'work',
            history: [],
          });
          changed = true;
        } else if (existing.title !== thread.title) {
          this.repo.put('link', { ...existing, title: thread.title });
          changed = true;
        }
        if (!result.complete) continue;
        let expectedLink = this.repo.get('link', id)!;
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
            currentBeforeApply.revision !== scopeRevision
          )
            return;
          const currentLink = this.repo.get('link', id);
          if (
            currentLink?.revision !== expectedLink.revision ||
            currentLink.status !== 'proposed'
          ) {
            invalidated = true;
            return;
          }
          if (existing?.sourceFingerprint === read.manifest.fingerprint) continue;
          const linkedIds = this.links(connection.projectId)
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
            const w = this.project(connection.projectId);
            this.repo.put('project', {
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
          changed = true;
          expectedLink = this.repo.get('link', id)!;
          if (evidence.length) {
            scopeRevision = this.repo.get('connection', connection.id)!.revision;
            this.applyRead(connection.projectId, this.repo.get('connection', connection.id)!, read);
          }
        } catch (error) {
          const current = this.repo.get('connection', connection.id);
          if (!this.isConnectionActive(current) || current.revision !== scopeRevision) return;
          const currentLink = this.repo.get('link', id);
          // A rejected older read is not a new failure of a user's revised selection.
          if (
            currentLink?.revision !== expectedLink.revision ||
            currentLink.status !== expectedLink.status
          ) {
            invalidated = true;
            return;
          }
          failures.push(`${thread.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failures.length) {
        const c = this.repo.get('connection', connection.id);
        if (this.isConnectionActive(c) && c.revision === scopeRevision)
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
      if (this.isConnectionActive(current) && current.revision === scopeRevision)
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
      const current = this.repo.get('connection', connection.id);
      if (
        !invalidated &&
        this.isConnectionActive(current) &&
        current.revision === scopeRevision &&
        (changed || before !== this.ids.hash(discoveryResult(current.discovery)))
      )
        this.events.changed(connection.projectId);
    }
  }
  async process(projectId: string): Promise<void> {
    if (
      this.processing.has(projectId) ||
      this.closing ||
      this.questions.hasUnresolvedExecution() ||
      this.explanations.hasUnresolvedExecution()
    )
      return;
    const processWork = this.project(projectId);
    if (!this.isConnectionActive(this.repo.get('connection', processWork.connectionId))) return;
    this.processing.add(projectId);
    try {
      this.refreshInput(projectId);
      for (const pending of this.repo
        .list('job')
        .filter((j) => j.projectId === projectId && j.status === 'result-unknown')) {
        if ((await this.summary.resolve(pending.remote)) === 'unknown') return;
        this.analysisJob(pending, true);
      }
      if (this.closing) return;
      let job: Job | undefined;
      for (const queued of this.repo
        .list('job')
        .filter((j) => j.projectId === projectId && j.status === 'queued')) {
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
      this.refreshInput(projectId);
      if (!job) {
        const w = this.project(projectId),
          pending = w.pendingRefresh;
        if (!pending) return;
        const id = this.jobId(projectId, w.inputVersion, this.configurationHash());
        if (this.repo.get('job', id)) return;
        job = {
          id,
          projectId,
          inputVersion: w.inputVersion,
          extractorVersion: EXTRACTOR_VERSION,
          configurationHash: this.configurationHash(),
          analysis: this.summary.configuration(),
          inputSnapshot: {
            sourceRevisionIds: this.sources(projectId).map((s) => s.id),
            linkVersion: w.linkVersion,
            connectionRevision: this.repo.get('connection', w.connectionId)!.revision,
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
        this.refreshInput(projectId);
      });
      this.events.changed(projectId);
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
        this.events.changed(projectId);
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
            this.directionIntent(this.project(projectId).id)?.evidenceId &&
            !sources.some(
              (s) => s.id === this.directionIntent(this.project(projectId).id)!.evidenceId,
            )
          )
            throw new DomainError(
              'SOURCE_UNAVAILABLE',
              'Confirmed goal source is outside the selected input; review scope',
            );
          const result = await phase('generate', () =>
            this.summary.generate(
              sources,
              remote,
              this.directionIntent(this.project(projectId).id),
              this.project(projectId).responseLanguage ?? 'en',
            ),
          );
          ensureCurrent();
          candidate = checkCandidate(result.candidate, sources);
          if (
            this.directionIntent(this.project(projectId).id) &&
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
          this.summary.check(
            fixedCandidate,
            sources,
            remote,
            this.directionIntent(this.project(projectId).id),
            this.project(projectId).responseLanguage ?? 'en',
          ),
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
          const latest = this.project(projectId),
            current = this.repo.get('job', id)!;
          if (current.attemptToken !== token)
            throw new DomainError('RESULT_UNKNOWN', 'Late attempt rejected');
          const summary: SummaryRevision = {
            id: this.ids.next(),
            projectId,
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
          this.repo.put('project', {
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
          this.explanations.preparePublished(projectId);
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
      this.refreshInput(projectId);
      this.events.changed(projectId);
    } finally {
      this.processing.delete(projectId);
    }
  }
  async recover(): Promise<void> {
    await this.explanations.recover();
    await this.questions.recover();
    this.continuations.recover();
    for (const job of this.repo
      .list('job')
      .filter((j) => ['summarizing', 'checking', 'result-unknown'].includes(j.status))) {
      this.analysisJob(job, (await this.summary.resolve(job.remote)) === 'terminated');
    }
    for (const h of this.repo.list('handoff').filter((h) => h.state === 'dispatching'))
      this.repo.put('handoff', {
        ...h,
        state: 'result-unknown',
        error: 'App dispatch outcome is unknown; no automatic retry',
      });
  }
  snapshot(projectId: string): ReturnContextSnapshot {
    const work = this.project(projectId);
    this.activeConnectionForWork(projectId);
    const sources = this.sources(projectId),
      links = this.links(projectId).map((l) =>
        l.evidence.every((id) => this.accessibleSource(projectId, id))
          ? l
          : {
              ...l,
              evidence: l.evidence.filter((id) => this.accessibleSource(projectId, id)),
              relation: 'unclear' as const,
              rationale: 'The connection evidence is outside the selected records. Review scope.',
            },
      );
    const storedSummary = work.latestSummaryId
      ? this.repo.get('summary', work.latestSummaryId)
      : null;
    const summary = storedSummary?.sourceRevisionIds.every((id) =>
      this.accessibleSource(projectId, id),
    )
      ? storedSummary
      : null;
    const accessibleThreads = new Set(
      links.filter((l) => l.status === 'linked').map((l) => l.threadId),
    );
    const currentKeys = new Set(sources.map((s) => s.key)),
      linkByThread = new Map(links.map((l) => [l.threadId, l]));
    const connection = this.repo.get('connection', work.connectionId)!;
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
      explanation: this.explanations.view(projectId),
      conversationFlows: conversationFlows(summary, (id) => {
        const source = this.repo.get('source', id);
        return source && this.accessibleSource(projectId, source.id) ? source : null;
      }),
      freshness: this.freshness(projectId),
      workspace: this.projects.latestSnapshot(projectId),
      continuation:
        this.repo
          .list('continuation')
          .filter((c) => c.projectId === projectId)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
          .at(-1) ?? null,
      refresh: this.refreshState(work),
      coverage: summaryCoverage(
        sources,
        summary,
        (id) => this.repo.get('source', id),
        accessibleThreads,
      ),
      work,
      connection: this.repo.get('connection', work.connectionId)!,
      links,
      checkpoints: this.repo.list('checkpoint').filter((c) => c.projectId === projectId),
      summary:
        summary && summary.sourceRevisionIds.every((id) => this.accessibleSource(projectId, id))
          ? summary
          : null,
      overlays: this.repo.list('overlay').filter((o) => o.projectId === projectId),
      draft: this.repo.get('draft', projectId),
      visit: this.repo.get('visit', projectId),
      jobs: this.repo
        .list('job')
        .filter((j) => j.projectId === projectId)
        .map((j) =>
          j.inputSnapshot?.sourceRevisionIds.every((id) => this.accessibleSource(projectId, id))
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
  evidence(id: string, projectId?: string): SourceRevision {
    if (projectId) {
      const source = this.accessibleSource(projectId, id);
      if (!source) throw new DomainError('NOT_FOUND', 'Evidence outside this goal scope', 404);
      return source;
    }
    if (this.repo.list('project').some((w) => this.directionIntent(w.id)))
      throw new DomainError('VALIDATION', 'Choose a goal when requesting source evidence', 400);
    const s = this.repo.get('source', id);
    const allowed = s && this.repo.list('project').some((w) => this.accessibleSource(w.id, id));
    if (!s || !allowed)
      throw new DomainError('NOT_FOUND', 'Evidence is outside the active scope', 404);
    return s;
  }
  mutate(
    projectId: string,
    action: 'corrections' | 'drafts' | 'visits' | 'link' | 'retry',
    command: Command,
    targetId?: string,
  ): Receipt {
    const bodyHash = this.ids.hash({
      action,
      projectId,
      targetId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const receipt = this.repo.transaction(() => {
      const existing = this.receipt(command.requestId, bodyHash);
      if (existing) return existing;
      const w = this.project(projectId);
      this.activeConnectionForWork(projectId);
      if (w.revision !== command.expectedRevision)
        throw new DomainError('REVISION_CONFLICT', 'Displayed work revision changed', 409);
      let resultId = projectId,
        changed = false;
      if (action === 'corrections') {
        const p = correctionInputSchema.parse(command.payload),
          base = this.repo.get('summary', p.baseSummaryId);
        if (!base || base.projectId !== projectId || base.id !== w.latestSummaryId)
          throw new DomainError('REVISION_CONFLICT', 'Correction base changed', 409);
        const id = this.ids.hash([projectId, p.slot]),
          old = this.repo.get('overlay', id);
        if ((old?.revision ?? 0) !== p.overlayRevision)
          throw new DomainError('REVISION_CONFLICT', 'Correction was edited elsewhere', 409);
        this.repo.put('overlay', {
          id,
          projectId,
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
        this.validateTarget(projectId, p.threadId, p.summaryId, p.evidenceIds);
        const old = this.repo.get('draft', projectId);
        if ((old?.revision ?? 0) !== p.draftRevision)
          throw new DomainError('REVISION_CONFLICT', 'Draft was edited elsewhere', 409);
        this.repo.put('draft', {
          id: projectId,
          projectId,
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
          summary.projectId !== projectId ||
          p.evidenceIds.some((id) => !summary.sourceRevisionIds.includes(id))
        )
          throw new DomainError('VALIDATION', 'Displayed scope does not match summary');
        const previous = this.repo.get('visit', projectId);
        const evidenceIds = [
          ...new Set([
            ...(previous?.summaryId === p.summaryId ? previous.evidenceIds : []),
            ...p.evidenceIds,
          ]),
        ];
        this.repo.put('visit', {
          id: projectId,
          projectId,
          summaryId: p.summaryId,
          evidenceIds,
          at: this.clock.now(),
        });
      } else if (action === 'link') {
        const p = linkInputSchema.parse(command.payload),
          l = this.repo.get('link', targetId ?? '');
        if (!l || l.projectId !== projectId)
          throw new DomainError('NOT_FOUND', 'Link not found', 404);
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
        this.repo.put('project', w);
        this.refreshInput(projectId);
        resultId = l.id;
      } else {
        const j = this.repo.get('job', targetId ?? '');
        if (!j || j.projectId !== projectId)
          throw new DomainError('NOT_FOUND', 'Job not found', 404);
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
      if (changed) this.repo.put('project', { ...w, revision: w.revision + 1 });
      const r: Receipt = {
        id: command.requestId,
        command: action,
        bodyHash,
        projectId,
        committedRevision: this.project(projectId).revision,
        resultId,
        createdAt: this.clock.now(),
      };
      this.repo.put('receipt', r);
      return r;
    });
    if (action !== 'visits') this.events.changed(projectId);
    return receipt;
  }
  private validateTarget(
    projectId: string,
    threadId: string,
    summaryId: string,
    evidenceIds: string[],
  ) {
    const w = this.project(projectId),
      summary = this.repo.get('summary', summaryId);
    if (!this.links(projectId).some((l) => l.threadId === threadId && l.status === 'linked'))
      throw new DomainError('HANDOFF_TARGET_UNLINKED', 'Handoff thread is not linked');
    if (!summary || summary.projectId !== projectId || w.latestSummaryId !== summaryId)
      throw new DomainError('HANDOFF_SUMMARY_CHANGED', 'Handoff summary changed', 409);
    if (!evidenceIds.length || evidenceIds.some((id) => !summary.sourceRevisionIds.includes(id)))
      throw new DomainError(
        'HANDOFF_EVIDENCE_INACCESSIBLE',
        'Handoff evidence is outside the displayed input or current access',
      );
  }
  prepareHandoff(projectId: string, expectedRevision: number, input: unknown): HandoffTarget {
    const p = draftInputSchema.parse(input),
      w = this.project(projectId);
    this.activeConnectionForWork(projectId);
    this.validateTarget(projectId, p.threadId, p.summaryId, p.evidenceIds);
    if (
      this.collecting.has(projectId) ||
      this.repo.list('checkpoint').some((c) => c.projectId === projectId && c.status === 'reading')
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
    const accessible = new Set(this.sources(projectId).map((source) => source.id));
    if (p.evidenceIds.some((id) => !accessible.has(id)))
      throw new DomainError(
        'HANDOFF_EVIDENCE_INACCESSIBLE',
        'Handoff evidence is outside current access',
      );
    if (w.revision !== expectedRevision)
      throw new DomainError('REVISION_CONFLICT', 'Handoff target revision changed', 409);
    const precision = this.navigator.capability().precision;
    const link = this.links(projectId).find(
      (l) => l.threadId === p.threadId && l.status === 'linked',
    )!;
    return {
      title: link.title,
      role: link.role,
      projectId,
      expectedRevision,
      threadId: p.threadId,
      summaryId: p.summaryId,
      evidenceIds: p.evidenceIds,
      draft: p.text,
      precision,
      url: precision === 'thread' ? `codex://threads/${encodeURIComponent(p.threadId)}` : null,
    };
  }
  async openHandoff(projectId: string, command: Command): Promise<Receipt> {
    const bodyHash = this.ids.hash({
      action: 'open',
      projectId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
    const existing = this.receipt(command.requestId, bodyHash);
    if (existing) return existing;
    const target = this.prepareHandoff(projectId, command.expectedRevision, command.payload);
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
        projectId,
        bodyHash,
        committedRevision: this.project(projectId).revision,
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
      this.events.changed(projectId);
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
