import {
  ExplanationController,
  emptyExplanationView,
  type ExplanationAction,
  type ExplanationPanelView,
} from './explanations';
import type {
  Observation,
  Command,
  Connection,
  HandoffTarget,
  ProjectListItem,
  Receipt,
  ReturnContextSnapshot,
  SourceRevision,
  ClaimSlot,
} from '@statecarry/contracts';
import {
  presentReturnContext,
  presentEvidence,
  type ReturnContextViewModel,
  type EvidenceViewModel,
  type FlowView,
} from './presenter';
import {
  QuestionController,
  emptyQuestionView,
  type QuestionView,
  type QuestionAction,
} from './questions';
export interface Gateway {
  listTurns?(threadId: string): Promise<{ turns: { id: string; at: string | null }[] }>;
  explanation?<T>(path: string, payload?: unknown): Promise<T>;
  question?<T>(path: string, payload?: unknown): Promise<T>;
  projects(): Promise<ProjectListItem[]>;
  connections(): Promise<Connection[]>;
  removedConnections?(): Promise<RestorableConnection[]>;
  snapshot(workId: string): Promise<ReturnContextSnapshot>;
  evidence(revisionId: string, workId?: string): Promise<SourceRevision>;
  discover(
    cwd: string,
  ): Promise<{
    threads: { id: string; title: string; cwd: string }[];
    complete: boolean;
    limitations: string[];
  }>;
  command(path: string, input: Command): Promise<Receipt | HandoffTarget>;
  receipt(
    id: string,
  ): Promise<Receipt & { handoff?: { state: string; error: string | null } | null }>;
  subscribe(
    listener: (workId: string | null) => void,
    onConnection?: (state: 'connected' | 'disconnected') => void,
  ): () => void;
  observe?(event: Observation): Promise<void>;
}
export type RestorableConnection = { connection: Connection; workRevision: number };
export type OpenRequest = {
  requestId: string;
  threadId: string;
  title: string;
  state: 'dispatching' | 'dispatched' | 'failed' | 'result-unknown';
  error: string | null;
};
export type LocalWorkState = {
  questions?: import('./questions').SavedQuestion[];
  readingExplanationId?: string;
  openRequest?: OpenRequest | null;
  basisSummaryId: string | null;
  draftRevision: number;
  draft: string;
  targetThreadId: string;
  evidenceIds: string[];
  expandedIds: string[];
  correction: string;
  correctionSlot: ClaimSlot;
  scroll: number;
  editVersion: number;
  dirty: boolean;
};
export interface BrowserMemory {
  read(workId: string): LocalWorkState | null;
  write(workId: string, state: LocalWorkState): void;
}
export type UIAction =
  | { type: 'describeGoal'; text: string }
  | { type: 'goalChoice'; candidateId: string; action: 'confirm' | 'dismiss' }
  | QuestionAction
  | ExplanationAction
  | { type: 'openFlow'; id: string }
  | { type: 'closeFlow' }
  | { type: 'adoptSummary' }
  | { type: 'adoptDraftVersion' }
  | {
      type: 'scope';
      recordRanges?: import('@statecarry/contracts').Connection['recordRanges'];
      threadIds: string[];
      startTurnIds: Record<string, string>;
      discover: boolean;
    }
  | { type: 'route'; route: string }
  | { type: 'evidence'; id: string; withinFlow?: boolean }
  | { type: 'selectEvidence'; id: string; selected: boolean }
  | { type: 'draft'; value: string }
  | { type: 'target'; threadId: string }
  | { type: 'saveDraft' }
  | { type: 'prepareHandoff' }
  | { type: 'openHandoff' }
  | { type: 'checkHandoff' }
  | { type: 'retryHandoff' }
  | { type: 'newHandoff' }
  | { type: 'correction'; value: string; slot: ClaimSlot }
  | { type: 'saveCorrection'; undo?: boolean }
  | { type: 'removeConnection' }
  | { type: 'restoreConnection'; connectionId: string; workId: string; workRevision: number }
  | { type: 'link'; id: string; status: 'linked' | 'deferred' | 'separate'; undo?: boolean }
  | { type: 'displayed'; summaryId: string }
  | { type: 'scroll'; value: number; workId?: string }
  | { type: 'retry'; jobId: string };
export type AppViewModel = {
  goalStatus?: 'reading' | 'read-failed' | 'analyzing' | 'ready';
  goal?: import('@statecarry/contracts').GoalIntent;
  goalCandidates?: import('@statecarry/contracts').GoalCandidate[];
  openedFlow: FlowView | null;
  evidenceFocusId: string | null;
  transport: 'connecting' | 'connected' | 'disconnected';
  question?: QuestionView;
  explanation?: ExplanationPanelView;
  route: string;
  projects: ProjectListItem[];
  removedConnections?: RestorableConnection[];
  detail: ReturnContextViewModel | null;
  local: LocalWorkState;
  evidence: Record<string, EvidenceViewModel>;
  handoff: HandoffTarget | null;
  error: string | null;
  message: string | null;
  busy: boolean;
};
const emptyLocal = (): LocalWorkState => ({
  basisSummaryId: null,
  draftRevision: 0,
  draft: '',
  targetThreadId: '',
  evidenceIds: [],
  expandedIds: [],
  correction: '',
  correctionSlot: 'next',
  scroll: 0,
  editVersion: 0,
  dirty: false,
});
const errorText = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    (
      {
        HANDOFF_TARGET_UNLINKED:
          'The selected conversation is no longer connected. Choose a connected conversation, then review the target and evidence.',
        HANDOFF_EVIDENCE_INACCESSIBLE:
          'Selected evidence is outside the summary or accessible scope. Remove it or select accessible evidence, then review the target and evidence.',
        HANDOFF_COLLECTING:
          'Collecting conversation records. Review the target and evidence when collection finishes.',
        HANDOFF_SUMMARY_CHANGED:
          'The summary changed. Keep your evidence and update to the current summary, then review the target and evidence.',
        HANDOFF_INPUT_CHANGED:
          'New records are not yet reflected. After the summary is ready, update its basis while keeping your evidence, then review the target and evidence.',
        HANDOFF_CONFIGURATION_CHANGED:
          'Extraction or analysis settings changed. Once the new summary is ready, keep your evidence and update its basis, then review the target and evidence.',
        REVISION_CONFLICT:
          'Records or another edit have changed. Your input is preserved. Check the latest content, target and evidence before continuing.',
        IDEMPOTENCY_CONFLICT:
          'This request ID already has different input. Check the previous request.',
        CAPABILITY_UNSUPPORTED:
          'Opening is not verified or configured. Follow the setup instructions, then review the target and evidence. Your target and draft are preserved.',
        RESULT_UNKNOWN:
          'The request result is unknown. Checking the existing receipt; nothing is resent automatically.',
      } as Record<string, string>
    )[code] ?? message
  );
};
export class Controller {
  private questions: QuestionController;
  private explanations: ExplanationController;
  private value: AppViewModel = {
    openedFlow: null,
    evidenceFocusId: null,
    transport: 'connecting',
    route: '#/projects',
    projects: [],
    removedConnections: [],
    detail: null,
    local: emptyLocal(),
    evidence: {},
    handoff: null,
    error: null,
    message: null,
    busy: false,
  };
  private checkingOpen = false;
  private listeners = new Set<() => void>();
  private snapshotValue: ReturnContextSnapshot | null = null;
  private sequence = 0;
  private initializedWorkId: string | null = null;
  private inFlight = false;
  private baselineSummaryId: string | null = null;
  private displayed = new Set<string>();
  private readError: string | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(
    private gateway: Gateway,
    private memory: BrowserMemory,
    private newId: () => string,
  ) {
    this.questions = new QuestionController(gateway, newId, (question) => this.set({ question }));
    this.value.question = emptyQuestionView();
    this.explanations = new ExplanationController(
      gateway,
      newId,
      (explanation) => this.set({ explanation }),
      (revisionId, summaryId) => {
        this.observe('evidence', 'observed', revisionId, summaryId);
        const workId = this.snapshotValue?.work.id;
        if (workId)
          void this.send(`/work-contexts/${workId}/visits`, {
            summaryId,
            evidenceIds: [revisionId],
          }).catch(() => {});
      },
    );
    this.value.explanation = emptyExplanationView();
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<AppViewModel>) {
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l();
  }
  private observe(
    kind: Observation['kind'],
    result: Observation['result'] = 'observed',
    targetId: string | null = null,
    summaryId?: string | null,
  ) {
    if (!this.gateway.observe) return;
    const s = this.snapshotValue;
    void this.gateway
      .observe({
        id: this.newId(),
        kind,
        at: new Date().toISOString(),
        workId: s?.work.id ?? null,
        summaryId: summaryId === undefined ? (s?.summary?.id ?? null) : summaryId,
        targetId,
        result,
      })
      .catch(() => {});
  }
  async start(route: string) {
    this.unsubscribe = this.gateway.subscribe(
      (workId) => {
        if (!workId || workId === this.snapshotValue?.work.id)
          void this.refresh().catch((e) => this.set({ error: errorText(e) }));
        else void this.refreshProjects().catch(() => {});
      },
      (transport) => {
        if (transport !== this.value.transport) {
          this.set({
            transport,
            handoff: transport === 'disconnected' ? null : this.value.handoff,
          });
          this.observe(transport === 'connected' ? 'connection-restored' : 'connection-lost');
        }
      },
    );
    await this.navigate(route);
  }
  stop() {
    this.explanations.reset();
    this.questions.reset();
    this.unsubscribe?.();
    this.sequence++;
  }
  private async refreshProjects() {
    const [projects, removedConnections] = await Promise.all([
      this.gateway.projects(),
      this.gateway.removedConnections?.() ?? Promise.resolve([]),
    ]);
    this.set({ projects: this.readingProjects(projects), removedConnections });
  }
  private readingProjects(projects: ProjectListItem[]) {
    return projects.map((p) => {
      const id = this.memory.read(p.workId)?.readingExplanationId;
      const chosen = p.explanations?.find((e) => e.id === id);
      return chosen ? { ...p, current: chosen.current, summaryId: chosen.summaryId } : p;
    });
  }
  async navigate(route: string) {
    this.persist();
    this.explanations.reset();
    this.questions.reset(false);
    this.sequence++;
    this.snapshotValue = null;
    this.baselineSummaryId = null;
    this.initializedWorkId = null;
    this.displayed.clear();
    this.set({
      route,
      openedFlow: null,
      evidenceFocusId: null,
      detail: null,
      evidence: {},
      handoff: null,
      error: null,
      message: null,
      local: emptyLocal(),
    });
    try {
      await this.refresh(true);
    } catch (e) {
      this.set({ error: errorText(e) });
    }
  }
  async refresh(first = false) {
    void this.questions.refresh();
    const route = this.value.route,
      workId = /^#\/(?:work|handoff)\/([^/]+)/.exec(route)?.[1],
      sequence = ++this.sequence;
    let projects: ProjectListItem[],
      snapshot: ReturnContextSnapshot | null,
      removedConnections: RestorableConnection[];
    try {
      [projects, snapshot, removedConnections] = await Promise.all([
        this.gateway.projects(),
        workId ? this.gateway.snapshot(workId) : Promise.resolve(null),
        this.gateway.removedConnections?.() ?? Promise.resolve([]),
      ]);
    } catch (error) {
      if (sequence !== this.sequence || route !== this.value.route) return;
      this.readError = errorText(error);
      this.set({ error: this.readError });
      return;
    }

    if (sequence !== this.sequence || route !== this.value.route) return;
    const scopeChanged =
      this.snapshotValue &&
      snapshot &&
      (this.snapshotValue.connection.revision !== snapshot.connection.revision ||
        this.snapshotValue.work.linkVersion !== snapshot.work.linkVersion);
    if (scopeChanged) {
      this.questions.clearEvidence();
      this.set({ evidence: {}, openedFlow: null, handoff: null });
      const accessible = new Set(snapshot!.accessibleEvidenceIds ?? snapshot!.sourceRevisionIds);
      this.local({
        evidenceIds: this.value.local.evidenceIds.filter((id) => accessible.has(id)),
        expandedIds: this.value.local.expandedIds.filter((id) => accessible.has(id)),
        targetThreadId: snapshot!.links.some(
          (l) => l.status === 'linked' && l.threadId === this.value.local.targetThreadId,
        )
          ? this.value.local.targetThreadId
          : '',
      });
    }
    this.set({
      goalStatus: !snapshot?.checkpoints.length
        ? 'reading'
        : snapshot.checkpoints.some((c) => c.status === 'failed')
          ? 'read-failed'
          : snapshot.jobs.some((j) => ['queued', 'summarizing', 'checking'].includes(j.status))
            ? 'analyzing'
            : 'ready',
      goal: snapshot?.work.goal,
      goalCandidates: snapshot?.goalCandidates ?? [],
    });
    this.snapshotValue = snapshot;
    if (this.readError && this.value.error === this.readError) this.set({ error: null });
    this.readError = null;
    const initialize = !!snapshot && this.initializedWorkId !== snapshot.work.id;
    if (initialize && snapshot) {
      this.initializedWorkId = snapshot.work.id;
      this.observe('return');
      this.baselineSummaryId = snapshot.visit?.summaryId ?? null;
      const saved = this.memory.read(snapshot.work.id),
        draft = snapshot.draft;
      const local = saved ?? {
        ...emptyLocal(),
        draft: draft?.text ?? '',
        targetThreadId:
          draft?.threadId ?? snapshot.links.find((l) => l.status === 'linked')?.threadId ?? '',
        evidenceIds: draft?.evidenceIds ?? [],
      };
      this.set({
        local: {
          ...local,
          basisSummaryId: local.basisSummaryId ?? draft?.summaryId ?? snapshot.summary?.id ?? null,
          draftRevision: saved?.draftRevision ?? draft?.revision ?? 0,
        },
      });
    }
    const serverDraft = snapshot?.draft,
      local = this.value.local;
    // A clean browser cache must not hide a newer saved draft after a revisit.
    // Keep unsaved input, correction text, expanded evidence and scroll untouched.
    if (
      serverDraft &&
      !this.inFlight &&
      local.dirty === false &&
      serverDraft.revision > local.draftRevision
    ) {
      this.set({ handoff: null });
      this.local({
        draft: serverDraft.text,
        draftRevision: serverDraft.revision,
        basisSummaryId: serverDraft.summaryId,
        targetThreadId: serverDraft.threadId,
        evidenceIds: serverDraft.evidenceIds,
        editVersion: local.editVersion + 1,
      });
    }
    if (snapshot) {
      const allowed = new Set(
        snapshot.accessibleEvidenceIds ?? [
          ...snapshot.sourceRevisionIds,
          ...(snapshot.summary?.sourceRevisionIds ?? []),
        ],
      );
      const local = this.value.local;
      const evidenceIds = local.evidenceIds.filter((id) => allowed.has(id)),
        expandedIds = local.expandedIds.filter((id) => allowed.has(id));
      const targetThreadId = snapshot.links.some(
        (l) => l.status === 'linked' && l.threadId === local.targetThreadId,
      )
        ? local.targetThreadId
        : '';
      if (
        evidenceIds.length !== local.evidenceIds.length ||
        expandedIds.length !== local.expandedIds.length ||
        targetThreadId !== local.targetThreadId
      )
        this.local({ evidenceIds, expandedIds, targetThreadId });
    }
    if (initialize && snapshot && this.value.local.questions?.length)
      this.questions.restore(this.value.local.questions);
    if (snapshot) {
      const savedId = this.value.local.readingExplanationId;
      if (
        savedId &&
        savedId !== this.explanations.view.revision?.id &&
        this.gateway.explanation &&
        snapshot.explanation?.accessibleIds.includes(savedId)
      ) {
        try {
          const revision = await this.gateway.explanation<
            import('@statecarry/contracts').ExplanationRevision
          >(`/work-contexts/${snapshot.work.id}/explanations/${savedId}`);
          if (sequence !== this.sequence) return;
          this.explanations.restore(revision);
        } catch {
          /* The current scoped snapshot is the fallback. */
        }
      }
      this.explanations.sync(snapshot, initialize);
      const reading = this.explanations.view.revision;
      if (reading && !savedId) this.local({ readingExplanationId: reading.id });
    }
    this.set({
      projects: this.readingProjects(projects),
      removedConnections,
      detail: snapshot
        ? presentReturnContext(snapshot, { baselineSummaryId: this.baselineSummaryId })
        : null,
    });
    if (
      snapshot &&
      !this.inFlight &&
      this.value.local.openRequest &&
      this.value.local.openRequest.state !== 'failed'
    )
      await this.checkOpenRequest();
    if (initialize && snapshot)
      for (const id of this.value.local.expandedIds) {
        void this.openEvidence(id, true).catch(() => {});
      }
  }
  private persist() {
    if (this.snapshotValue) {
      try {
        this.memory.write(this.snapshotValue.work.id, {
          ...this.value.local,
          questions: this.questions.saved(this.snapshotValue.work.id),
        });
      } catch {
        this.set({
          error: 'Browser storage is unavailable. Drafts saved on the server are preserved.',
        });
      }
    }
  }
  private local(patch: Partial<LocalWorkState>) {
    this.set({ local: { ...this.value.local, ...patch } });
    this.persist();
  }
  private async openEvidence(id: string, restored = false, withinFlow = false) {
    const workId = this.snapshotValue?.work.id;
    const scope = `${this.snapshotValue?.connection.revision}:${this.snapshotValue?.work.linkVersion}`;
    const summaryId = withinFlow
      ? this.value.openedFlow?.summaryId
      : this.snapshotValue?.summary?.id;
    const evidence =
      this.value.evidence[id] ?? presentEvidence(await this.gateway.evidence(id, workId));
    if (
      workId !== this.snapshotValue?.work.id ||
      scope !== `${this.snapshotValue?.connection.revision}:${this.snapshotValue?.work.linkVersion}`
    )
      return;
    this.set({ evidence: { ...this.value.evidence, [id]: evidence } });
    if (!restored) {
      if (!withinFlow) this.set({ evidenceFocusId: id });
      this.observe('evidence', 'observed', id, summaryId);
    }
    if (!this.value.local.expandedIds.includes(id))
      this.local({ expandedIds: [...this.value.local.expandedIds, id] });
  }
  private draftPayload() {
    const s = this.snapshotValue!;
    return {
      threadId: this.value.local.targetThreadId,
      evidenceIds: this.value.local.evidenceIds,
      summaryId: this.value.local.basisSummaryId ?? s.summary?.id ?? '',
      text: this.value.local.draft,
      draftRevision: this.value.local.draftRevision,
    };
  }
  private async send(
    path: string,
    payload: Record<string, unknown>,
    expectedRevision = this.snapshotValue?.work.revision ?? 0,
    recoverReceipt = true,
  ) {
    const command = { requestId: this.newId(), expectedRevision, payload };
    try {
      return await this.gateway.command(path, command);
    } catch (error) {
      // Preparation is read-only and never creates a receipt, even if its response is lost.
      if (!recoverReceipt) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (!code || code === 'RESULT_UNKNOWN')
          throw new Error(
            'The target review response was not received. Your input is preserved. Check the connection and try reviewing again.',
          );
        throw error;
      }
      // A lost acknowledgement is resolved by its exact receipt; it is never a new command.
      try {
        return await this.gateway.receipt(command.requestId);
      } catch {
        throw error;
      }
    }
  }
  private async checkOpenRequest() {
    const workId = this.snapshotValue?.work.id,
      request = this.value.local.openRequest;
    if (!workId || !request || this.checkingOpen) return;
    this.checkingOpen = true;
    try {
      const receipt = await this.gateway.receipt(request.requestId);
      if (
        receipt.id !== request.requestId ||
        receipt.workId !== workId ||
        receipt.command !== 'open' ||
        !receipt.handoff ||
        !['dispatching', 'dispatched', 'failed', 'result-unknown'].includes(receipt.handoff.state)
      )
        throw new Error('Could not check the open request status.');
      if (
        this.snapshotValue?.work.id !== workId ||
        this.value.local.openRequest?.requestId !== request.requestId
      )
        return;
      this.local({
        openRequest: {
          ...request,
          state: receipt.handoff.state as OpenRequest['state'],
          error: receipt.handoff.error,
        },
      });
      if (receipt.handoff.state === 'dispatched')
        this.set({
          message:
            'Open request sent. Check your arrival in Codex. Your selected evidence and draft remain here.',
        });
    } catch {
      if (
        this.snapshotValue?.work.id === workId &&
        this.value.local.openRequest?.requestId === request.requestId &&
        request.state !== 'dispatched' &&
        request.state !== 'failed'
      )
        this.local({
          openRequest: {
            ...request,
            state: 'result-unknown',
            error:
              'The open request result could not be confirmed. Use Check open request. It will not run again automatically.',
          },
        });
    } finally {
      this.checkingOpen = false;
    }
  }
  async connect(input: {
    title: string;
    cwd: string;
    threadIds: string[];
    startTurnIds: Record<string, string>;
    discover: boolean;
  }) {
    if (this.inFlight) return;
    this.inFlight = true;
    this.set({ busy: true, error: null });
    try {
      const result = (await this.send('/connections', input, 0)) as Receipt;
      await this.navigate(`#/work/${result.workId}`);
      return result.workId;
    } catch (e) {
      this.set({ error: errorText(e) });
    } finally {
      this.inFlight = false;
      this.set({ busy: false });
    }
  }
  async listTurns(threadId: string) {
    if (!this.gateway.listTurns) throw new Error('Turn listing unavailable');
    return this.gateway.listTurns(threadId);
  }
  discover(cwd: string) {
    return this.gateway.discover(cwd);
  }
  async listRemovedConnections(): Promise<RestorableConnection[]> {
    return this.gateway.removedConnections?.() ?? [];
  }
  async restoreConnection(input: Omit<Extract<UIAction, { type: 'restoreConnection' }>, 'type'>) {
    if (this.inFlight) return;
    this.inFlight = true;
    this.set({ busy: true, error: null });
    try {
      await this.send(`/connections/${input.connectionId}/restore`, {}, input.workRevision);
      await this.navigate(`#/work/${input.workId}`);
      return input.workId;
    } catch (e) {
      this.set({ error: errorText(e) });
    } finally {
      this.inFlight = false;
      this.set({ busy: false });
    }
  }
  async action(action: UIAction) {
    if (action.type.startsWith('explanation')) {
      if (action.type === 'explanationQuestion') {
        const r = this.explanations.view.revision,
          node = r?.candidate.nodes.find((n) => n.id === action.nodeId);
        if (r && node)
          this.questions.openExplanation(r.workId, r.summaryId, r.id, node.id, node.text);
      } else await this.explanations.action(action as ExplanationAction);
      const reading = this.explanations.view.revision;
      if (reading) {
        this.local({ readingExplanationId: reading.id });
        await this.refreshProjects();
      }
      return;
    }
    if (action.type.startsWith('question')) {
      if (action.type === 'questionOpen' && this.value.openedFlow && this.snapshotValue)
        this.questions.open(
          this.snapshotValue.work.id,
          this.value.openedFlow.summaryId,
          this.value.openedFlow.claimId,
        );
      else await this.questions.action(action as QuestionAction);
      this.persist();
      return;
    }
    if (action.type === 'closeFlow') this.questions.hide();
    if (action.type === 'closeFlow') return this.set({ openedFlow: null });
    if (action.type === 'openFlow') {
      const d = this.value.detail;
      const claim =
        d &&
        [...d.current, ...d.next, ...d.reason, ...d.purpose, ...d.milestones, ...d.other].find(
          (c) => c.flow.id === action.id,
        );
      if (claim) this.set({ openedFlow: structuredClone(claim.flow) });
      return;
    }
    if (action.type === 'route') return this.navigate(action.route);
    if (action.type === 'removeConnection') {
      if (this.inFlight) return;
      const current = this.snapshotValue;
      if (!current) return;
      this.inFlight = true;
      this.set({ busy: true, error: null });
      try {
        await this.send(`/connections/${current.connection.id}/remove`, {}, current.work.revision);
        await this.navigate('#/connections');
      } catch (e) {
        this.set({ error: errorText(e) });
      } finally {
        this.inFlight = false;
        this.set({ busy: false });
      }
      return;
    }
    if (action.type === 'restoreConnection') {
      await this.restoreConnection(action);
      return;
    }
    if (action.type === 'draft') {
      this.set({ handoff: null });
      return this.local({
        draft: action.value,
        dirty: true,
        editVersion: this.value.local.editVersion + 1,
      });
    }
    if (action.type === 'adoptDraftVersion') {
      this.set({ handoff: null });
      return this.local({
        draftRevision: this.snapshotValue?.draft?.revision ?? 0,
        editVersion: this.value.local.editVersion + 1,
        dirty: true,
      });
    }
    if (action.type === 'adoptSummary') {
      this.set({ handoff: null });
      return this.local({
        basisSummaryId: this.snapshotValue?.summary?.id ?? null,
        editVersion: this.value.local.editVersion + 1,
        dirty: true,
      });
    }
    if (action.type === 'target') {
      this.set({ handoff: null });
      return this.local({
        targetThreadId: action.threadId,
        basisSummaryId: this.value.local.basisSummaryId ?? this.snapshotValue?.summary?.id ?? null,
        dirty: true,
        editVersion: this.value.local.editVersion + 1,
      });
    }
    if (action.type === 'selectEvidence') {
      this.set({ handoff: null });
      return this.local({
        basisSummaryId: this.value.local.basisSummaryId ?? this.snapshotValue?.summary?.id ?? null,
        evidenceIds: action.selected
          ? [...new Set([...this.value.local.evidenceIds, action.id])]
          : this.value.local.evidenceIds.filter((id) => id !== action.id),
        editVersion: this.value.local.editVersion + 1,
        dirty: true,
      });
    }
    if (action.type === 'correction')
      return this.local({
        correction: action.value,
        correctionSlot: action.slot,
        editVersion: this.value.local.editVersion + 1,
      });
    if (action.type === 'scroll') {
      if (action.workId && action.workId !== this.snapshotValue?.work.id) {
        try {
          const saved = this.memory.read(action.workId);
          if (saved) this.memory.write(action.workId, { ...saved, scroll: action.value });
        } catch {}
        return;
      }
      return this.local({ scroll: action.value });
    }
    if (action.type === 'evidence') {
      const workId = this.snapshotValue?.work.id;
      try {
        return await this.openEvidence(action.id, false, action.withinFlow);
      } catch (e) {
        if (workId === this.snapshotValue?.work.id) this.set({ error: errorText(e) });
        return;
      }
    }
    const s = this.snapshotValue;
    if (!s) return;
    if (action.type === 'describeGoal') {
      if (this.inFlight) return;
      this.inFlight = true;
      this.set({ busy: true, error: null });
      try {
        await this.send(`/work-contexts/${s.work.id}/goal-intent`, { text: action.text });
        await this.refresh();
      } catch (e) {
        this.set({ error: errorText(e) });
      } finally {
        this.inFlight = false;
        this.set({ busy: false });
      }
      return;
    }
    if (action.type === 'goalChoice') {
      if (this.inFlight) return;
      this.inFlight = true;
      this.set({ busy: true, error: null });
      try {
        const receipt = (await this.send(`/work-contexts/${s.work.id}/goals`, {
          candidateId: action.candidateId,
          action: action.action,
        })) as Receipt;
        if (action.action === 'confirm') await this.navigate(`#/work/${receipt.workId}`);
        else await this.refresh();
      } catch (e) {
        this.set({ error: errorText(e) });
      } finally {
        this.inFlight = false;
        this.set({ busy: false });
      }
      return;
    }
    if (action.type === 'displayed') {
      if (action.summaryId !== s.summary?.id) return;
      const evidenceIds = Object.keys(this.value.evidence)
        .filter((id) => s.summary!.sourceRevisionIds.includes(id))
        .sort();
      const displayKey = JSON.stringify([action.summaryId, evidenceIds]);
      if (this.displayed.has(displayKey)) return;
      this.displayed.add(displayKey);
      this.observe('visible');
      try {
        await this.send(`/work-contexts/${s.work.id}/visits`, {
          summaryId: action.summaryId,
          evidenceIds,
        });
      } catch {
        this.displayed.delete(displayKey);
      }
      return;
    }
    if (this.inFlight) return;
    this.inFlight = true;
    const workId = s.work.id,
      editVersion = this.value.local.editVersion;
    this.set({ busy: true, error: null, message: null });
    try {
      if (
        this.value.transport === 'disconnected' &&
        ['prepareHandoff', 'openHandoff', 'retryHandoff', 'newHandoff'].includes(action.type)
      )
        throw new Error(
          'The server is disconnected. Review the target and evidence once the local connection returns.',
        );
      if (action.type === 'saveDraft') {
        const payload = this.draftPayload();
        await this.send(`/work-contexts/${workId}/drafts`, payload);
        if (this.snapshotValue?.work.id === workId)
          this.local({ draftRevision: payload.draftRevision + 1 });
        if (this.snapshotValue?.work.id === workId && this.value.local.editVersion === editVersion)
          this.local({ dirty: false });
        if (this.snapshotValue?.work.id === workId) {
          this.set({ message: 'Draft saved here. It has not been sent to Codex.' });
          this.observe('draft-saved', 'committed');
        }
      } else if (action.type === 'checkHandoff') {
        await this.checkOpenRequest();
      } else if (
        action.type === 'prepareHandoff' ||
        action.type === 'retryHandoff' ||
        action.type === 'newHandoff'
      ) {
        const prior = this.value.local.openRequest;
        if (
          prior &&
          !(action.type === 'retryHandoff' && prior.state === 'failed') &&
          !(action.type === 'newHandoff' && prior.state === 'dispatched')
        )
          throw new Error(
            'Check the existing open request first. It will not run again automatically.',
          );
        if (this.value.local.basisSummaryId && this.value.local.basisSummaryId !== s.summary?.id) {
          this.set({ handoff: null });
          throw new Error(errorText({ code: 'HANDOFF_SUMMARY_CHANGED' }));
        }
        // Retain the prior receipt until fresh preparation actually succeeds.
        const target = (await this.send(
          `/work-contexts/${workId}/handoff`,
          this.draftPayload(),
          s.work.revision,
          false,
        )) as HandoffTarget;
        if (
          this.snapshotValue?.work.id === workId &&
          this.value.local.editVersion === editVersion
        ) {
          this.local({ openRequest: null });
          this.set({ handoff: target });
          this.observe('handoff-prepared', 'observed', target.threadId);
        }
      } else if (action.type === 'openHandoff') {
        if (this.value.local.openRequest) {
          await this.checkOpenRequest();
          return;
        }
        if (!this.value.handoff) throw new Error('Review the target and evidence first.');
        const h = this.value.handoff;
        const command: Command = {
          requestId: this.newId(),
          expectedRevision: h.expectedRevision,
          payload: {
            workId,
            threadId: h.threadId,
            evidenceIds: h.evidenceIds,
            summaryId: h.summaryId,
            text: h.draft,
            draftRevision: this.value.local.draftRevision,
          },
        };
        const request: OpenRequest = {
          requestId: command.requestId,
          threadId: h.threadId,
          title: h.title,
          state: 'dispatching',
          error: null,
        };
        // Persist BEFORE any external request. Unlike ordinary edit caching, failure must stop dispatch.
        try {
          this.memory.write(workId, { ...this.value.local, openRequest: request });
        } catch {
          throw new Error(
            'The open request was not sent because its ID could not be saved in browser storage. Check storage availability. Your draft and evidence are preserved.',
          );
        }
        this.set({ local: { ...this.value.local, openRequest: request }, handoff: null });
        try {
          await this.gateway.command('/handoffs/open', command);
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          if (
            code.startsWith('HANDOFF_') ||
            ['REVISION_CONFLICT', 'CAPABILITY_UNSUPPORTED', 'VALIDATION'].includes(code)
          ) {
            if (this.snapshotValue?.work.id === workId)
              this.local({ openRequest: { ...request, state: 'failed', error: errorText(error) } });
            throw error;
          }
          // Transport loss is resolved only by the original receipt; never send another command.
        }
        if (this.snapshotValue?.work.id === workId) await this.checkOpenRequest();
      } else if (action.type === 'saveCorrection') {
        const slot = this.value.local.correctionSlot,
          overlay = s.overlays.find((o) => o.slot === slot);
        await this.send(`/work-contexts/${workId}/corrections`, {
          slot,
          text: action.undo ? (overlay?.text ?? '') : this.value.local.correction,
          baseSummaryId: s.summary?.id ?? '',
          active: !action.undo,
          overlayRevision: overlay?.revision ?? 0,
        });
      } else if (action.type === 'link') {
        const l = s.links.find((l) => l.id === action.id);
        if (!l) throw new Error('The connection target was not found.');
        await this.send(`/context-links/${l.id}`, {
          status: action.status,
          linkRevision: l.revision,
          undo: !!action.undo,
        });
      } else if (action.type === 'retry') await this.send(`/jobs/${action.jobId}/retry`, {});
      if (action.type === 'scope') {
        this.set({ handoff: null });
        await this.send(`/connections/${s.connection.id}`, {
          title: s.connection.title,
          cwd: s.connection.cwd,
          threadIds: action.threadIds,
          startTurnIds: action.startTurnIds,
          discover: action.discover,
          recordRanges: action.recordRanges,
        });
      }
      if (this.snapshotValue?.work.id === workId) {
        if (action.type === 'saveCorrection') this.observe('correction-saved', 'committed');
        if (action.type === 'link') this.observe('link-changed', 'committed', action.id);
        await this.refresh();
      }
    } catch (e) {
      if (this.snapshotValue?.work.id === workId) {
        this.set({ error: errorText(e) });
        await this.refresh().catch(() => {});
      }
    } finally {
      this.inFlight = false;
      this.set({ busy: false });
    }
  }
}
