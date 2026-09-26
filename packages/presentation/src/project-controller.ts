import {
  workDecisionKinds,
  workingTreeGroupKey,
  type ProjectModelView,
  type ProjectNow,
  type WorkDiscussionSync,
  type AnalysisCorrection,
  type ReleaseProjectView,
  type ReleasePolicyInput,
  type ReleaseCreateInput,
  type DeliveryTargetUpdate,
  type ReleaseCheckUpdate,
  type ReleasePolicyExceptionInput,
} from '@statecarry/contracts';
import type { AnalysisGateway } from './analysis';
import { presentProjectAnalysis, analysisHandoffText } from './analysis';
import type { AnalysisMemory, ProjectDrafts } from './project-drafts';
import {
  presentProjectCompact,
  presentProjectNow,
  type ProjectCompactView,
  type ProjectNowView,
} from './project-now';
import {
  presentProjects,
  presentRegistrations,
  presentWorkingTree,
  goalDiscussionText,
  projectError,
  type ProjectGateway,
  type ProjectRoute,
  type ProjectView,
  type ProjectWorkspace,
  type ProjectProfile,
  type ProjectCreateInput,
  type ProjectSourcesInput,
  type ProjectDeletionPreview,
  type AppUpdateState,
  type WorkingTreeView,
} from './projects';

export type ProjectControllerState = {
  decisions: Record<string, import('@statecarry/contracts').ProjectExecutionWorkspace | undefined>;
  route: ProjectRoute;
  projects: ProjectView[];
  loading: boolean;
  loadingDetails: boolean;
  online: boolean;
  checkingCurrent: boolean;
  error: string | null;
  /** What set the current error. Background reads may only clear their own
   * kind, so an action failure (like a failed first project check) stays
   * visible until the user acts or that action succeeds. */
  errorSource: 'read' | 'action' | null;
  notice: string | null;
  memoryError: string | null;
  appUpdate: AppUpdateState | null;
  busyWorkId: string | null;
  edits: Record<string, ProjectDrafts>;
  inspection: {
    projectId: string;
    title: string;
    actor: string;
    at: string | null;
    text: string;
  } | null;
  inspectionLoading: boolean;
  deletion: ProjectDeletionPreview | null;
  workingTrees: Record<string, WorkingTreeView | undefined>;
  workingTreeLoading: Record<string, boolean>;
  workingTreeAnalysisLoading: Record<string, boolean>;
  projectNow: Record<string, ProjectNowView | undefined>;
  projectNowLoading: Record<string, boolean>;
  projectNowInitializing: Record<string, boolean>;
  projectCompacts: Record<string, ProjectCompactView | undefined>;
  releases: Record<string, ReleaseProjectView | undefined>;
  releaseLoading: Record<string, boolean>;
};
const appUpdateCheckIntervalMs = 6 * 60 * 60 * 1000;
const emptyEdits = (): ProjectDrafts => ({
  goalDraft: null,
  actionDrafts: [],
  expanded: [],
  scroll: 0,
});

/** One read model is shared by Home, project and management. The only raw
 * source output is an explicit, transient original-inspection state. */
export class ProjectController {
  private workspace: ProjectWorkspace = { projects: [] };
  private value: ProjectControllerState = {
    decisions: {},
    route: { page: 'home' },
    projects: [],
    loading: true,
    loadingDetails: true,
    online: false,
    checkingCurrent: true,
    error: null,
    errorSource: null,
    notice: null,
    memoryError: null,
    appUpdate: null,
    busyWorkId: null,
    edits: {},
    inspection: null,
    inspectionLoading: false,
    deletion: null,
    workingTrees: {},
    workingTreeLoading: {},
    workingTreeAnalysisLoading: {},
    projectNow: {},
    projectNowLoading: {},
    projectNowInitializing: {},
    projectCompacts: {},
    releases: {},
    releaseLoading: {},
  };
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private readEpoch = 0;
  private inspectionGeneration = 0;
  private pending: Promise<void> | null = null;
  private workingTreeReads = new Map<string, Promise<WorkingTreeView | null>>();
  private observationReads = new Map<string, Promise<WorkingTreeView | null>>();
  private workingTreeAnalysisReads = new Map<string, Promise<WorkingTreeView | null>>();
  private projectNowReads = new Map<string, Promise<ProjectNowView | null>>();
  private projectNowModels = new Map<string, ProjectModelView>();
  private compactFailed = new Set<string>();
  private durableDiscussionKeys = new Map<string, Set<string>>();
  private readAgain = false;
  private hasLoaded = false;
  private hasRegistrations = false;
  private hydratingWorkIds = new Set<string>();
  private connectionLost = false;
  private streamConnected = false;
  private startupReadyForStreamRefresh = false;
  private streamConnectedDuringStartup = false;
  private allChanged = true;
  private changedWorkIds = new Set<string>();
  private settledDuringRead = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private updateCheckTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe?: () => void;
  constructor(
    private gateway: ProjectGateway,
    private analysis: AnalysisGateway,
    private memory?: AnalysisMemory,
  ) {}
  private decisionQueue = new Map<string, Promise<unknown>>();
  projectDecision(
    id: string,
    command?: import('@statecarry/contracts').ProjectExecutionCommand,
  ): Promise<import('@statecarry/contracts').ProjectExecutionWorkspace> {
    const pending = (this.decisionQueue.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const generation = this.generation;
        const data = await this.gateway.execution(
          id,
          command,
          this.value.decisions[id]?.record.version ?? 0,
          this.responseLanguage(id),
        );
        if (!this.active || generation !== this.generation) return data;
        this.set({
          decisions: { ...this.value.decisions, [id]: data },
          ...(data.workspace
            ? {
                workingTrees: {
                  ...this.value.workingTrees,
                  [id]: presentWorkingTree(data.workspace),
                },
              }
            : {}),
        });
        return data;
      });
    this.decisionQueue.set(id, pending);
    return pending;
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<ProjectControllerState>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }
  private present(patch: Partial<ProjectControllerState> = {}) {
    const online = patch.online ?? this.value.online;
    const checking = patch.checkingCurrent ?? this.value.checkingCurrent;
    const projects = presentProjects(this.workspace, online).map((project) => {
      if (this.hydratingWorkIds.has(project.id) && !project.disconnected)
        return {
          ...project,
          detailsLoading: true,
          canEdit: false,
          canDecide: false,
          canRefresh: false,
          stateLabel: 'Loading project…',
          stateDescription: 'StateCarry found this project and is loading its saved state.',
        };
      return online && checking && this.needsCurrent(project.id) && !project.disconnected
        ? {
            ...project,
            canEdit: false,
            canDecide: false,
            canRefresh: false,
            updating: true,
            stateLabel: 'Checking current state',
            tasks: project.tasks.map((task) => ({
              ...task,
              canAct: false,
              rechecking: task.canAct,
            })),
            dismissed: project.dismissed.map((task) => ({ ...task, canAct: false })),
          }
        : project;
    });
    this.set({ ...patch, projects });
  }
  private needsCurrent(id: string) {
    return this.allChanged || this.changedWorkIds.has(id);
  }
  private cancelScheduledRead() {
    if (this.changeTimer !== null) clearTimeout(this.changeTimer);
    this.changeTimer = null;
  }
  private scheduleRead() {
    if (this.pending) {
      this.readAgain = true;
      return;
    }
    if (this.changeTimer !== null) return;
    // A fixed window coalesces bursts without postponing reads indefinitely.
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      void this.refresh(true);
    }, 150);
  }
  private invalidateRead(disconnected = false, projectId: string | null = null) {
    this.readEpoch++;
    if (projectId === null) {
      this.allChanged = true;
      this.compactFailed.clear();
    } else {
      this.changedWorkIds.add(projectId);
      this.compactFailed.delete(projectId);
    }
    const affectsOriginal = projectId === null || projectId === this.value.route.projectId;
    if (affectsOriginal) this.inspectionGeneration++;
    this.present({
      ...(disconnected ? { online: false, loading: false } : {}),
      checkingCurrent: true,
      ...(affectsOriginal ? { inspection: null, inspectionLoading: false } : {}),
      deletion: null,
    });
  }
  async start(route: ProjectRoute) {
    this.active = true;
    this.generation++;
    this.startupReadyForStreamRefresh = false;
    this.streamConnectedDuringStartup = false;
    this.connectionLost = false;
    this.streamConnected = false;
    this.invalidateRead();
    this.navigate(route);
    this.unsubscribe = this.analysis.subscribe?.(
      (change) => {
        if (!this.active) return;
        if (change?.kind === 'collection-settled') {
          if (!change.projectId) return;
          if (this.pending) this.settledDuringRead.add(change.projectId);
          // A settled observation is not a data change. It only completes a
          // transient collecting snapshot observed by a concurrent GET.
          if (
            !this.workspace.projects.some(
              (entry) => entry.projectId === change.projectId && entry.collecting,
            )
          )
            return;
        }
        if (change?.projectId && this.value.projectNowInitializing[change.projectId]) return;
        if (
          change?.projectId === this.value.route.projectId &&
          change?.projectId &&
          this.value.decisions[change.projectId]
        )
          void this.projectDecision(change.projectId).catch(() => {});
        if (
          this.value.route.page === 'project' &&
          change?.projectId === this.value.route.projectId &&
          change?.projectId
        )
          void this.readProjectNow(change.projectId);
        if (change?.topic) {
          if (change.topic === 'observation' || change.topic === 'working-tree-analysis') {
            if (change.projectId && change.projectId === this.value.route.projectId)
              void this.inspectWorkingTree(change.projectId);
            return;
          }
          if (
            change.topic === 'overview' &&
            change.projectId &&
            this.value.route.page === 'project' &&
            change.projectId === this.value.route.projectId
          )
            return;
          this.scheduleRead();
          return;
        }
        this.invalidateRead(false, change?.projectId ?? null);
        this.scheduleRead();
      },
      (state) => {
        if (!this.active) return;
        if (state === 'disconnected') {
          this.connectionLost = true;
          this.cancelScheduledRead();
          this.readAgain = false;
          this.invalidateRead(true);
        } else {
          const needsRead =
            !this.streamConnected || this.connectionLost || (!this.pending && !this.value.online);
          this.streamConnected = true;
          this.connectionLost = false;
          if (!this.startupReadyForStreamRefresh) {
            this.streamConnectedDuringStartup = true;
            return;
          }
          // The first GET may precede the server's stream subscription. Recheck
          // once after connection so changes in that gap cannot be missed.
          if (!needsRead) return;
          this.invalidateRead();
          void this.refresh(true);
        }
      },
    );
    void this.checkAppUpdate();
    if (this.updateCheckTimer !== null) clearInterval(this.updateCheckTimer);
    this.updateCheckTimer = setInterval(() => {
      if (
        this.value.appUpdate?.phase === 'downloading' ||
        this.value.appUpdate?.phase === 'restarting'
      )
        return;
      void this.checkAppUpdate();
    }, appUpdateCheckIntervalMs);
    try {
      const registrations = await this.gateway.registrations();
      if (!this.active) return;
      this.hasRegistrations = true;
      this.hydratingWorkIds = new Set(
        registrations.projects
          .filter((project) => !project.disconnectedAt)
          .map((project) => project.projectId),
      );
      this.workspace = {
        projects: registrations.projects.map((project) => ({
          ...project,
          acceptedKeys: [],
          pausedKeys: [],
          collecting: false,
          analysis: null,
        })),
      };
      for (const entry of registrations.projects) this.readEdits(entry.projectId);
      this.set({
        projects: presentRegistrations(registrations, true),
        online: true,
        loading: false,
        loadingDetails: this.hydratingWorkIds.size > 0,
        error: null,
        errorSource: null,
      });
      if (route.page === 'project' && route.projectId) await this.enterProject(route.projectId);
      await this.refresh(true);
      this.startupReadyForStreamRefresh = true;
      if (this.streamConnectedDuringStartup) {
        this.streamConnectedDuringStartup = false;
        this.invalidateRead();
        await this.refresh(true);
      }
      return;
    } catch (error) {
      if (this.active)
        this.set({
          loading: false,
          loadingDetails: false,
          online: false,
          error: projectError(error),
          errorSource: 'read',
        });
      this.startupReadyForStreamRefresh = true;
    }
  }

  private async enterProject(id: string) {
    const view = await this.readProjectNow(id);
    if (
      !view ||
      !this.active ||
      this.value.route.page !== 'project' ||
      this.value.route.projectId !== id
    )
      return;
    void this.observeWorkingTree(id);
  }
  stop() {
    this.active = false;
    this.generation++;
    this.inspectionGeneration++;
    this.cancelScheduledRead();
    if (this.updateTimer !== null) clearInterval(this.updateTimer);
    this.updateTimer = null;
    if (this.updateCheckTimer !== null) clearInterval(this.updateCheckTimer);
    this.updateCheckTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async readAppUpdate() {
    if (!this.active || !this.gateway.appUpdate) return;
    try {
      const appUpdate = await this.gateway.appUpdate();
      if (this.active) this.set({ appUpdate: appUpdate.supported ? appUpdate : null });
    } catch {
      /* Source-run and browser-only environments do not expose desktop updates. */
    }
  }

  async checkAppUpdate() {
    if (!this.active || !this.gateway.checkAppUpdate) return;
    const previous = this.value.appUpdate;
    if (previous) this.set({ appUpdate: { ...previous, phase: 'checking', error: null } });
    try {
      const appUpdate = await this.gateway.checkAppUpdate();
      if (this.active) this.set({ appUpdate: appUpdate.supported ? appUpdate : null });
    } catch {
      if (this.active && previous)
        this.set({
          appUpdate: {
            ...previous,
            phase: 'error',
            error: "StateCarry couldn't check for updates. Try again.",
          },
        });
      /* Initial checks stay quiet when the desktop bridge is unavailable. */
    }
  }

  async downloadAppUpdate() {
    if (!this.active || !this.gateway.downloadAppUpdate) return;
    const previous = this.value.appUpdate;
    if (previous)
      this.set({ appUpdate: { ...previous, phase: 'downloading', progress: null, error: null } });
    if (this.gateway.appUpdate) {
      if (this.updateTimer !== null) clearInterval(this.updateTimer);
      this.updateTimer = setInterval(() => void this.readAppUpdate(), 500);
    }
    try {
      const appUpdate = await this.gateway.downloadAppUpdate();
      if (this.active) this.set({ appUpdate: appUpdate.supported ? appUpdate : null });
    } catch {
      if (this.active && previous)
        this.set({
          appUpdate: {
            ...previous,
            phase: 'error',
            progress: null,
            error: "StateCarry couldn't download the update. Try again.",
          },
        });
    } finally {
      if (this.updateTimer !== null) clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  async restartForAppUpdate() {
    if (!this.active || !this.gateway.restartAppUpdate) return;
    const previous = this.value.appUpdate;
    if (previous) this.set({ appUpdate: { ...previous, phase: 'restarting', error: null } });
    try {
      const appUpdate = await this.gateway.restartAppUpdate();
      if (this.active) this.set({ appUpdate: appUpdate.supported ? appUpdate : null });
    } catch {
      if (this.active && previous)
        this.set({
          appUpdate: {
            ...previous,
            phase: 'error',
            error: "StateCarry couldn't restart for the update. Try again.",
          },
        });
    }
  }
  private markProjectNowChecking(id: string) {
    const current = this.value.projectNow[id];
    if (!current) return;
    this.set({
      projectNow: {
        ...this.value.projectNow,
        [id]: { ...current, checking: true, freshness: 'checking' },
      },
    });
  }
  private workItemForDiscussion(id: string, key: string): string | null {
    return this.projectNowModels.get(id)?.workItems.some((item) => item.id === key) ? key : null;
  }
  private browserPersistedEdits(value: ProjectDrafts): ProjectDrafts {
    const {
      selectedKey: _selectedKey,
      selectedExplicit: _selectedExplicit,
      selectedTaskSnapshot: _selectedTaskSnapshot,
      ...drafts
    } = value;
    return {
      ...drafts,
      taskDiscussions: drafts.taskDiscussions?.map(([key, discussion]) => [
        key,
        { ...discussion, turns: [] },
      ]),
    };
  }
  private persistEdits(id: string, value: ProjectDrafts) {
    try {
      this.memory?.write(id, this.browserPersistedEdits(value));
    } catch {
      this.set({
        memoryError:
          'This browser could not save your draft. Keep this tab open or copy your unfinished text.',
      });
    }
  }
  private hydrateDurableDiscussions(
    id: string,
    model: ProjectModelView,
    skipKeys: ReadonlySet<string> = new Set(),
  ) {
    if (!model.discussions.length) return;
    const old = this.readEdits(id);
    const durable = new Set(this.durableDiscussionKeys.get(id) ?? []);
    const next = new Map(old.taskDiscussions ?? []);
    for (const record of model.discussions) {
      const key = record.workItemId;
      if (!key || skipKeys.has(key)) continue;
      durable.add(key);
      const local = next.get(key);
      next.set(key, {
        version: record.basis,
        input: local?.input ?? '',
        turns: record.turns.map((turn) => ({
          question: turn.question,
          answer: turn.answer,
          version: turn.basis,
        })),
      });
    }
    this.durableDiscussionKeys.set(id, durable);
    const edits = { ...old, taskDiscussions: [...next] };
    this.set({ edits: { ...this.value.edits, [id]: edits } });
    this.persistEdits(id, edits);
  }
  private discussionSync(
    id: string,
    key: string,
    discussion: NonNullable<ProjectDrafts['taskDiscussions']>[number][1],
  ): WorkDiscussionSync | null {
    const workItemId = this.workItemForDiscussion(id, key);
    if (!workItemId) return null;
    return {
      workItemId,
      basis: discussion.version,
      turns: discussion.turns.map((turn) => ({
        question: turn.question,
        answer: turn.answer,
        basis: turn.version ?? discussion.version,
      })),
    };
  }
  private markDiscussionPending(id: string, key: string) {
    const durable = new Set(this.durableDiscussionKeys.get(id) ?? []);
    if (!durable.delete(key)) return;
    if (durable.size) this.durableDiscussionKeys.set(id, durable);
    else this.durableDiscussionKeys.delete(id);
  }
  private async syncDiscussionToCore(id: string, key: string) {
    const project = this.value.projects.find((item) => item.id === id);
    const discussion = this.readEdits(id).taskDiscussions?.find(
      ([candidate]) => candidate === key,
    )?.[1];
    if (!project || !discussion) return;
    const input = this.discussionSync(id, key, discussion);
    if (!input) return;
    const model = await this.gateway.syncDiscussion(id, project.revision, input);
    this.projectNowModels.set(id, model);
    const durable = new Set(this.durableDiscussionKeys.get(id) ?? []);
    durable.add(key);
    this.durableDiscussionKeys.set(id, durable);
    this.persistEdits(id, this.readEdits(id));
  }
  private setProjectNowView(id: string, model: ProjectModelView, now: ProjectNow) {
    this.set({
      projectNow: { ...this.value.projectNow, [id]: presentProjectNow(model, now) },
      projectCompacts: { ...this.value.projectCompacts, [id]: presentProjectCompact(model, now) },
    });
  }
  /** Background hydration for Home/Projects cards. Quiet: a failed read never
   * raises a global error, and a missing first-run analysis is never started —
   * only entering the project initializes it. */
  private hydrateCompacts(changed: ReadonlySet<string> | null) {
    if (!this.active || !this.value.online) return;
    for (const entry of this.workspace.projects) {
      if (entry.disconnectedAt) continue;
      const id = entry.projectId;
      if (this.projectNowReads.has(id) || this.compactFailed.has(id)) continue;
      if (this.value.projectCompacts[id] && !(changed?.has(id) ?? false)) continue;
      void this.readProjectNow(id, { quiet: true, initialize: false });
    }
  }
  async readProjectNow(
    id: string,
    options: { quiet?: boolean; initialize?: boolean } = {},
  ): Promise<ProjectNowView | null> {
    if (!this.active) return null;
    const { quiet = false, initialize = true } = options;
    const existing = this.projectNowReads.get(id);
    if (existing) return existing;
    const generation = this.generation;
    this.set({ projectNowLoading: { ...this.value.projectNowLoading, [id]: true } });
    // Register the pending read before invoking a gateway that may throw synchronously.
    // Otherwise its cleanup runs first and leaves a failed promise cached forever.
    const read = Promise.resolve().then(async () => {
      try {
        let bundle = await this.gateway.now(id);
        if (!this.active || generation !== this.generation) return null;
        this.projectNowModels.set(id, bundle.model);
        this.hydrateDurableDiscussions(id, bundle.model);
        this.setProjectNowView(id, bundle.model, bundle.now);
        this.compactFailed.delete(id);
        if (!bundle.initialized) {
          if (!initialize) {
            this.set({ projectNowLoading: { ...this.value.projectNowLoading, [id]: false } });
            return presentProjectNow(bundle.model, bundle.now);
          }
          this.set({
            projectNowInitializing: { ...this.value.projectNowInitializing, [id]: true },
          });
          bundle = await this.gateway.initialize(id, this.responseLanguage(id));
          if (!this.active || generation !== this.generation) return null;
        }
        this.projectNowModels.set(id, bundle.model);
        this.hydrateDurableDiscussions(id, bundle.model);
        this.persistEdits(id, this.readEdits(id));
        const view = presentProjectNow(bundle.model, bundle.now);
        this.set({
          projectNow: { ...this.value.projectNow, [id]: view },
          projectCompacts: {
            ...this.value.projectCompacts,
            [id]: presentProjectCompact(bundle.model, bundle.now),
          },
          projectNowLoading: { ...this.value.projectNowLoading, [id]: false },
          projectNowInitializing: { ...this.value.projectNowInitializing, [id]: false },
          // A background card read succeeding is not the failed action
          // succeeding; only non-quiet reads resolve a global error.
          ...(quiet ? {} : { error: null, errorSource: null }),
        });
        return view;
      } catch (error) {
        if (this.active && generation === this.generation) {
          this.set({
            projectNowLoading: { ...this.value.projectNowLoading, [id]: false },
            projectNowInitializing: { ...this.value.projectNowInitializing, [id]: false },
            ...(quiet ? {} : { error: projectError(error), errorSource: 'action' as const }),
          });
          if (quiet) this.compactFailed.add(id);
        }
        return null;
      } finally {
        this.projectNowReads.delete(id);
      }
    });
    this.projectNowReads.set(id, read);
    return read;
  }
  async readRelease(id: string): Promise<ReleaseProjectView | null> {
    if (!this.gateway.release) return null;
    this.set({ releaseLoading: { ...this.value.releaseLoading, [id]: true } });
    try {
      const value = await this.gateway.release(id);
      if (!this.active) return value;
      this.set({
        releases: { ...this.value.releases, [id]: value },
        releaseLoading: { ...this.value.releaseLoading, [id]: false },
      });
      return value;
    } catch (error) {
      if (this.active)
        this.set({
          releaseLoading: { ...this.value.releaseLoading, [id]: false },
          error: projectError(error),
          errorSource: 'action',
        });
      return null;
    }
  }
  private async releaseMutation(
    id: string,
    run: (project: ProjectView) => Promise<ReleaseProjectView>,
  ): Promise<ReleaseProjectView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      const value = await run(project);
      if (this.active) this.set({ releases: { ...this.value.releases, [id]: value } });
      await this.readProjectNow(id);
      return value;
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  setReleasePolicy(id: string, input: ReleasePolicyInput) {
    if (!this.gateway.setReleasePolicy) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.setReleasePolicy!(id, project.revision, input),
    );
  }
  createRelease(id: string, input: ReleaseCreateInput) {
    if (!this.gateway.createRelease) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.createRelease!(id, project.revision, input),
    );
  }
  updateDelivery(id: string, releaseId: string, input: DeliveryTargetUpdate) {
    if (!this.gateway.updateDelivery) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.updateDelivery!(id, project.revision, releaseId, input),
    );
  }
  updateReleaseCheck(id: string, releaseId: string, input: ReleaseCheckUpdate) {
    if (!this.gateway.updateReleaseCheck) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.updateReleaseCheck!(id, project.revision, releaseId, input),
    );
  }
  confirmRelease(id: string, releaseId: string) {
    if (!this.gateway.confirmRelease) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.confirmRelease!(id, project.revision, releaseId),
    );
  }
  createReleaseException(id: string, input: ReleasePolicyExceptionInput) {
    if (!this.gateway.createReleaseException) return Promise.resolve(null);
    return this.releaseMutation(id, (project) =>
      this.gateway.createReleaseException!(id, project.revision, input),
    );
  }
  async selectWorkItem(id: string, workItemId: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.selectWork(id, project.revision, workItemId);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async createWorkItem(
    id: string,
    title: string,
    completionCondition: string | null,
  ): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    const cleanTitle = title.trim();
    if (!project || !cleanTitle) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.createWork(id, project.revision, {
        title: cleanTitle,
        completionCondition: completionCondition?.trim() || null,
      });
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async stopWorkItem(id: string, workItemId: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.stopWork(id, project.revision, workItemId);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async pauseWorkItem(id: string, workItemId: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.pauseWork(id, project.revision, workItemId);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async resumeWorkItem(id: string, workItemId: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.resumeWork(id, project.revision, workItemId);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async completeWorkItem(id: string, workItemId: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.completeWork(id, project.revision, workItemId);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async selectProposal(id: string, proposalKey: string): Promise<ProjectNowView | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.selectProposal(id, project.revision, proposalKey);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  async continueDirectionConflict(id: string): Promise<ProjectNowView | null> {
    if (!this.gateway.continueDirectionConflict) return null;
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return null;
    this.set({ busyWorkId: id, error: null, errorSource: null });
    try {
      await this.gateway.continueDirectionConflict(id, project.revision);
      return await this.readProjectNow(id);
    } catch (error) {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
      return null;
    } finally {
      if (this.active) this.set({ busyWorkId: null });
    }
  }
  navigate(route: ProjectRoute) {
    this.inspectionGeneration++;
    this.set({
      route,
      inspection: null,
      inspectionLoading: false,
      deletion: null,
      error: null,
      errorSource: null,
      notice: null,
    });
    if (route.page === 'project' && route.projectId && (this.hasRegistrations || this.hasLoaded))
      void this.enterProject(route.projectId);
    if (route.page === 'original' && route.projectId && this.hasLoaded) void this.readOriginal();
  }
  /** Returning to the app checks files/current access without preparing AI output. */
  async checkForChanges() {
    if (!this.active) return Promise.resolve();
    const route = this.value.route;
    if (route.page === 'project' && route.projectId) this.markProjectNowChecking(route.projectId);
    await this.observeCurrentProject();
    if (route.page === 'project' && route.projectId) await this.readProjectNow(route.projectId);
    void this.refresh(true);
  }
  async refresh(background = false): Promise<void> {
    if (!this.active) return;
    this.cancelScheduledRead();
    if (this.pending) {
      this.readAgain = true;
      return this.pending;
    }
    const generation = this.generation;
    this.pending = (async () => {
      do {
        this.readAgain = false;
        this.settledDuringRead.clear();
        const readEpoch = this.readEpoch;
        if (!background) this.inspectionGeneration++;
        this.set({
          loading: !this.hasLoaded && !this.hasRegistrations,
          loadingDetails: !this.hasLoaded && this.hasRegistrations,
          ...(!background ? { inspection: null, inspectionLoading: false } : {}),
        });
        try {
          const workspace = await this.gateway.list();
          if (!this.active || generation !== this.generation) return;
          if (readEpoch !== this.readEpoch) continue;
          if (
            workspace.projects.some(
              (entry) => entry.collecting && this.settledDuringRead.has(entry.projectId),
            )
          ) {
            this.readAgain = true;
            continue;
          }
          const removed = this.workspace.projects.filter(
            (old) => !workspace.projects.some((entry) => entry.projectId === old.projectId),
          );
          const originalId = this.value.route.projectId;
          const previousOriginal = this.workspace.projects.find(
            (entry) => entry.projectId === originalId,
          );
          const nextOriginal = workspace.projects.find((entry) => entry.projectId === originalId);
          if (
            previousOriginal?.revision !== nextOriginal?.revision ||
            previousOriginal?.analysis?.version !== nextOriginal?.analysis?.version ||
            previousOriginal?.disconnectedAt !== nextOriginal?.disconnectedAt
          ) {
            this.inspectionGeneration++;
            this.set({ inspection: null, inspectionLoading: false });
          }
          this.workspace = workspace;
          this.hasLoaded = true;
          this.hasRegistrations = true;
          const changedIds = this.allChanged ? null : new Set(this.changedWorkIds);
          this.hydratingWorkIds.clear();
          this.allChanged = false;
          this.changedWorkIds.clear();
          for (const entry of workspace.projects) this.readEdits(entry.projectId);
          for (const entry of removed) this.clearEdits(entry.projectId);
          const route = this.value.route;
          try {
            this.memory?.prune?.(workspace.projects.map((entry) => entry.projectId));
          } catch {
            this.set({
              memoryError:
                'Old browser drafts could not be cleared. They will not be used for the current projects.',
            });
          }
          this.present({
            online: true,
            checkingCurrent: false,
            // A successful read resolves read failures only. Action failures
            // (like a failed first project check) stay until the user retries
            // or the action itself succeeds.
            ...(this.value.errorSource === 'read' ? { error: null, errorSource: null } : {}),
            loading: false,
            loadingDetails: false,
          });
          if (route.page === 'project' && route.projectId) {
            if (!background) {
              await this.readProjectNow(route.projectId);
              changedIds?.delete(route.projectId);
              void this.inspectWorkingTree(route.projectId);
            }
          }
          this.hydrateCompacts(changedIds);
          if (
            this.value.route.page === 'original' &&
            !this.value.inspection &&
            !this.value.inspectionLoading
          )
            void this.readOriginal();
        } catch (error) {
          if (!this.active || generation !== this.generation) return;
          if (readEpoch !== this.readEpoch) continue;
          this.inspectionGeneration++;
          this.allChanged = true;
          this.hydratingWorkIds.clear();
          this.present({
            online: false,
            checkingCurrent: true,
            loading: false,
            loadingDetails: false,
            error: projectError(error),
            errorSource: 'read',
            inspection: null,
            inspectionLoading: false,
          });
        }
      } while (this.readAgain && this.active && generation === this.generation);
    })().finally(() => {
      this.pending = null;
      if (this.active && generation !== this.generation) void this.refresh();
    });
    return this.pending;
  }
  async inspectWorkingTree(id: string): Promise<WorkingTreeView | null> {
    if (!this.active) return null;
    const readKey = id;
    const existing = this.workingTreeReads.get(readKey);
    if (existing) return existing;
    this.set({ workingTreeLoading: { ...this.value.workingTreeLoading, [id]: true } });
    const read = (async () => {
      try {
        const snapshot = await this.gateway.workspace!(id);
        if (!this.active) return null;
        const view = presentWorkingTree(snapshot);
        this.set({
          workingTrees: { ...this.value.workingTrees, [id]: view },
          workingTreeLoading: { ...this.value.workingTreeLoading, [id]: false },
        });
        return view;
      } catch (error) {
        if (this.active)
          this.set({ workingTreeLoading: { ...this.value.workingTreeLoading, [id]: false } });
        return null;
      } finally {
        this.workingTreeReads.delete(readKey);
      }
    })();
    this.workingTreeReads.set(readKey, read);
    return read;
  }
  private async observeWorkingTree(id: string): Promise<WorkingTreeView | null> {
    if (!this.active) return null;
    const language = this.responseLanguage(id);
    const readKey = [id, language].join(':');
    const existing = this.observationReads.get(readKey);
    if (existing) return existing;
    const read = (async () => {
      try {
        const snapshot = await this.gateway.observe!(id, language);
        if (!this.active || language !== this.responseLanguage(id)) return null;
        const view = presentWorkingTree(snapshot);
        this.set({ workingTrees: { ...this.value.workingTrees, [id]: view } });
        void this.readProjectNow(id);
        if (snapshot.dirty && !snapshot.workingTreeAnalysis) void this.analyzeWorkingTree(id);
        return view;
      } catch (error) {
        void error;
        return null;
      } finally {
        this.observationReads.delete(readKey);
      }
    })();
    this.observationReads.set(readKey, read);
    return read;
  }
  private async analyzeWorkingTree(id: string): Promise<WorkingTreeView | null> {
    if (!this.active) return null;
    const language = this.responseLanguage(id);
    const readKey = [id, language].join(':');
    const existing = this.workingTreeAnalysisReads.get(readKey);
    if (existing) return existing;
    this.set({
      workingTreeAnalysisLoading: { ...this.value.workingTreeAnalysisLoading, [id]: true },
    });
    const read = (async () => {
      try {
        const snapshot = await this.gateway.analyzeWorkspace!(id, language);
        if (!this.active || language !== this.responseLanguage(id)) return null;
        const view = presentWorkingTree(snapshot);
        this.set({
          workingTrees: { ...this.value.workingTrees, [id]: view },
          workingTreeAnalysisLoading: { ...this.value.workingTreeAnalysisLoading, [id]: false },
        });
        return view;
      } catch (error) {
        void error;
        if (this.active && language === this.responseLanguage(id))
          this.set({
            workingTreeAnalysisLoading: { ...this.value.workingTreeAnalysisLoading, [id]: false },
          });
        return null;
      } finally {
        this.workingTreeAnalysisReads.delete(readKey);
      }
    })();
    this.workingTreeAnalysisReads.set(readKey, read);
    return read;
  }
  private observeCurrentProject(): Promise<WorkingTreeView | null> {
    const route = this.value.route;
    if (route.page !== 'project' || !route.projectId) return Promise.resolve(null);
    if (!this.workspace.projects.some((entry) => entry.projectId === route.projectId))
      return Promise.resolve(null);
    return this.observeWorkingTree(route.projectId);
  }
  async workingTreeHandoff(id: string, groupIndexes?: number[]): Promise<string | null> {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project || project.disconnected) return null;
    const tree = this.value.workingTrees[id] ?? (await this.inspectWorkingTree(id));
    if (!tree || tree.kind === 'clean' || tree.kind === 'no-git') return null;
    const selectedIndexes =
      groupIndexes && groupIndexes.length > 0
        ? new Set(groupIndexes.filter((index) => Number.isInteger(index) && index >= 0))
        : null;
    const selectedGroups = selectedIndexes
      ? tree.groups
          .map((group, index) => ({ group, index }))
          .filter(({ index }) => selectedIndexes.has(index))
      : tree.groups.map((group, index) => ({ group, index }));
    if (tree.groups.length > 0 && selectedGroups.length === 0) return null;
    const groups = selectedGroups
      .map(({ group, index }) => {
        const openItems = group.openItems.length
          ? group.openItems.map((item) => `  - ${item}`).join('\n')
          : '  - No specific open item was established from the current diff.';
        const suggested = group.suggestedNextStep
          ? [
              `Suggested next step: ${group.suggestedNextStep}`,
              ...(group.reason ? [`Why: ${group.reason}`] : []),
              ...(group.doneWhen ? [`Done when: ${group.doneWhen}`] : []),
            ]
          : [];
        const files = group.files.length
          ? group.files.map((path) => `  - ${path}`).join('\n')
          : '  - No file subset was assigned.';
        return [
          `${index + 1}. ${group.title}`,
          `Summary: ${group.summary}`,
          `Current state: ${group.currentState}`,
          ...suggested,
          'Open or review next:',
          openItems,
          'Relevant changed files:',
          files,
        ].join('\n');
      })
      .join('\n\n');
    const analyzed = tree.groups.length > 0;
    const scoped = analyzed && selectedGroups.length < tree.groups.length;
    const hasSuggestedNextStep = selectedGroups.some(({ group }) => !!group.suggestedNextStep);
    const selectedFiles = [...new Set(selectedGroups.flatMap(({ group }) => group.files))];
    return [
      analyzed
        ? 'You are continuing work from a repository state already analyzed by StateCarry.'
        : 'You are continuing work in an existing repository from its current working-tree state.',
      '',
      `Project: ${project.title}`,
      `Project folder: ${project.cwd}`,
      `Branch: ${tree.branch ?? 'unknown'}`,
      `HEAD: ${tree.head ?? 'unknown'}`,
      `Last commit: ${tree.lastCommit ?? 'unknown'}`,
      `Changed files: ${tree.fileCount}`,
      `Tracked diff: +${tree.additions} / -${tree.deletions}${tree.untrackedCount ? ` · ${tree.untrackedCount} untracked` : ''}`,
      ...(scoped
        ? [
            `Selected work groups: ${selectedGroups.length} of ${tree.groups.length}`,
            `Selected changed files: ${selectedFiles.length}`,
          ]
        : []),
      '',
      analyzed ? `StateCarry summary: ${tree.summary}` : tree.summary,
      ...(analyzed ? ['', 'Reconstructed work:', groups] : []),
      '',
      analyzed
        ? hasSuggestedNextStep
          ? scoped
            ? 'Continue only the selected work groups below. Preserve every other uncommitted change and do not expand the requested scope unless the selected files make that impossible. Start with the suggested next step for the selected work unless the current files contradict this handoff.'
            : 'Continue from this analyzed state. Preserve unrelated uncommitted changes and keep the reconstructed work groups separate. Start with the suggested next step for the relevant work group unless the current files contradict this handoff. Do not redo broad repository reconstruction first.'
          : scoped
            ? 'Work only within the selected work groups below. Preserve every other uncommitted change. StateCarry did not establish a useful first action, so wait for the user’s direction rather than inventing work.'
            : 'Continue from this analyzed state. Preserve unrelated uncommitted changes and keep the reconstructed work groups separate. StateCarry did not establish a useful first action from the diff, so wait for the user’s direction rather than inventing work. Do not redo broad repository reconstruction unless the current files contradict this handoff.'
        : 'StateCarry could not reconstruct semantic work groups. Inspect the current diff before changing files, preserve unrelated changes, and establish the work in progress before continuing.',
      'Do not assume prior conversation context.',
    ].join('\n');
  }
  private readEdits(id: string): ProjectDrafts {
    if (this.value.edits[id]) return this.value.edits[id];
    let saved = emptyEdits();
    try {
      saved = this.memory?.read(id) ?? saved;
    } catch {
      this.set({
        memoryError: 'This browser could not read saved drafts. Keep this tab open while working.',
      });
    }
    this.set({ edits: { ...this.value.edits, [id]: saved } });
    return saved;
  }
  private edit(id: string, update: (old: ProjectDrafts) => ProjectDrafts) {
    // A removed screen can finish its scroll cleanup after a reset response.
    // Browser input never registers work or recreates its retired storage key.
    if (!this.workspace.projects.some((entry) => entry.projectId === id)) return;
    const next = update(this.readEdits(id));
    this.set({ edits: { ...this.value.edits, [id]: next } });
    this.persistEdits(id, next);
  }
  private clearEdits(id: string) {
    try {
      this.memory?.write(id, emptyEdits());
    } catch {
      this.set({
        memoryError:
          'Old browser input could not be cleared. It will not recreate the removed project.',
      });
    }
    const edits = { ...this.value.edits };
    delete edits[id];
    this.durableDiscussionKeys.delete(id);
    this.set({ edits });
  }
  private entry(id: string) {
    const entry = this.workspace.projects.find((item) => item.projectId === id);
    if (!entry) throw Object.assign(new Error('Project unavailable'), { code: 'NOT_FOUND' });
    return entry;
  }
  select(id: string, key: string) {
    const project = this.value.projects.find((item) => item.id === id);
    const task = [...(project?.tasks ?? []), ...(project?.dismissed ?? [])].find(
      (item) => item.key === key,
    );
    this.edit(id, (old) => ({
      ...old,
      selectedKey: key,
      selectedExplicit: true,
      ...(task
        ? {
            selectedTaskSnapshot: {
              key: task.key,
              title: task.title,
              statusLabel: task.statusLabel,
              currentState: task.currentState,
              reason: task.reason,
              nextAction: task.nextAction,
              doneWhen: task.doneWhen,
            },
          }
        : {}),
    }));
  }
  selectWorkingTree(id: string) {
    this.edit(id, (old) => {
      const next = { ...old };
      delete next.selectedKey;
      delete next.selectedExplicit;
      delete next.keptWorkingTreeKey;
      return next;
    });
  }
  clearSelection(id: string) {
    this.edit(id, (old) => {
      const next = { ...old };
      delete next.selectedKey;
      delete next.selectedExplicit;
      return next;
    });
  }
  clearLegacyKeptDecision(id: string) {
    this.edit(id, (old) => {
      const { keptWorkingTreeKey: _previous, ...next } = old;
      return next;
    });
  }
  keepWorkingTree(id: string, key: string) {
    this.edit(id, (old) => {
      const next = { ...old, keptWorkingTreeKey: key };
      delete next.selectedKey;
      delete next.selectedExplicit;
      return next;
    });
  }
  recordScroll(id: string, scroll: number) {
    this.edit(id, (old) => ({ ...old, scroll: Math.max(0, scroll) }));
  }
  expand(id: string, key: string, open: boolean) {
    this.edit(id, (old) => ({
      ...old,
      expanded: open
        ? [...new Set([...old.expanded, key])]
        : old.expanded.filter((item) => item !== key),
    }));
  }
  editGoal(id: string, text?: string) {
    const work = this.entry(id).analysis;
    if (!work) return;
    this.edit(id, (old) => ({
      ...old,
      goalDraft: {
        text:
          text ??
          old.goalDraft?.text ??
          work.goalText ??
          work.candidates.find((c) => c.key === old.selectedKey)?.goal ??
          work.candidates[0]?.goal ??
          '',
        version: old.goalDraft?.version ?? work.version,
      },
    }));
  }
  prepareGoalDiscussion(id: string) {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return;
    const version = project.version;
    this.edit(id, (old) => ({
      ...old,
      goalDiscussionDraft:
        old.goalDiscussionDraft?.version === version
          ? old.goalDiscussionDraft
          : { text: goalDiscussionText(project, this.value.workingTrees[id]), version },
    }));
  }
  editGoalDiscussion(id: string, text: string) {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return;
    this.edit(id, (old) => ({ ...old, goalDiscussionDraft: { text, version: project.version } }));
  }
  discardGoalDiscussion(id: string) {
    this.edit(id, (old) => ({ ...old, goalDiscussionDraft: null }));
  }
  focusWorkingTree(
    id: string,
    key: string,
    mode: NonNullable<ProjectDrafts['workingTreeFocus']>['mode'],
  ) {
    const tree = this.value.workingTrees[id];
    if (!tree) return;
    this.edit(id, (old) => ({
      ...old,
      workingTreeFocus: {
        key,
        basis: tree.discussionBasis ?? '',
        mode,
        stopped:
          mode === 'stopped' ||
          (old.workingTreeFocus?.key === key &&
            old.workingTreeFocus.stopped === true &&
            mode !== 'continue'),
      },
    }));
    if (mode === 'discuss') this.openTaskDiscussion(id, key);
  }
  clearWorkingTreeFocus(id: string) {
    this.edit(id, (old) => {
      const next = { ...old };
      delete next.workingTreeFocus;
      return next;
    });
  }
  private discussionVersion(id: string, key: string): string {
    const project = this.value.projects.find((item) => item.id === id);
    const tree = this.value.workingTrees[id];
    return key.startsWith('working-tree:')
      ? `${project?.version ?? ''}:${tree?.discussionBasis ?? ''}`
      : (project?.version ?? '');
  }
  openTaskDiscussion(id: string, key: string) {
    const project = this.value.projects.find((item) => item.id === id);
    const task = [...(project?.tasks ?? []), ...(project?.dismissed ?? [])].find(
      (item) => item.key === key,
    );
    const tree = this.value.workingTrees[id];
    const isWorkingTree =
      key === workingTreeGroupKey() ||
      tree?.groups.some((group) => workingTreeGroupKey(group) === key);
    if (!project || (!task && !isWorkingTree && !this.workItemForDiscussion(id, key))) return;
    if (task) this.select(id, key);
    this.edit(id, (old) => ({
      ...old,
      taskDiscussions: old.taskDiscussions?.some(([candidate]) => candidate === key)
        ? old.taskDiscussions
        : [
            ...(old.taskDiscussions ?? []),
            [key, { version: this.discussionVersion(id, key), input: '', turns: [] }],
          ],
    }));
  }
  linkTaskDiscussion(id: string, from: string, to: string) {
    if (from === to) return;
    this.openTaskDiscussion(id, to);
    this.markDiscussionPending(id, to);
    this.edit(id, (old) => {
      const source = old.taskDiscussions?.find(([key]) => key === from)?.[1];
      const target = old.taskDiscussions?.find(([key]) => key === to)?.[1];
      if (!source || !target) return old;
      return {
        ...old,
        taskDiscussions: old.taskDiscussions?.map(([key, discussion]) =>
          key !== to
            ? [key, discussion]
            : [
                key,
                {
                  ...target,
                  input: target.input || source.input,
                  turns: [
                    ...source.turns.map((turn) => ({
                      ...turn,
                      version: turn.version ?? source.version,
                    })),
                    ...target.turns,
                  ].slice(-10),
                },
              ],
        ),
      };
    });
    void this.syncDiscussionToCore(id, to).catch((error) => {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
    });
  }
  editTaskDiscussionInput(id: string, key: string, input: string) {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return;
    this.edit(id, (old) => {
      const previous = old.taskDiscussions?.find(([candidate]) => candidate === key)?.[1] ?? {
        version: this.discussionVersion(id, key),
        input: '',
        turns: [],
      };
      return {
        ...old,
        taskDiscussions: [
          ...(old.taskDiscussions ?? []).filter(([candidate]) => candidate !== key),
          [key, { ...previous, input }],
        ],
      };
    });
  }
  rebaseTaskDiscussion(id: string, key: string) {
    const project = this.value.projects.find((item) => item.id === id);
    if (!project) return;
    this.markDiscussionPending(id, key);
    this.edit(id, (old) => ({
      ...old,
      taskDiscussions: (old.taskDiscussions ?? []).map(([candidate, discussion]) =>
        candidate === key
          ? [
              candidate,
              {
                ...discussion,
                turns: discussion.turns.map((turn) => ({
                  ...turn,
                  version: turn.version ?? discussion.version,
                })),
                version: this.discussionVersion(id, key),
              },
            ]
          : [candidate, discussion],
      ),
    }));
    void this.syncDiscussionToCore(id, key).catch((error) => {
      if (this.active) this.set({ error: projectError(error), errorSource: 'action' });
    });
  }
  async askTaskDiscussion(id: string, key: string, questionOverride?: string) {
    const project = this.value.projects.find((item) => item.id === id);
    const discussion = this.value.edits[id]?.taskDiscussions?.find(
      ([candidate]) => candidate === key,
    )?.[1];
    const question = questionOverride?.trim() || discussion?.input.trim();
    if (
      !project ||
      !discussion ||
      !question ||
      discussion.version !== this.discussionVersion(id, key)
    )
      return;
    if (!this.analysis.discussTask) throw new Error('Task discussion is unavailable.');
    const history = discussion.turns
      .slice(-9)
      .map((turn) => ({
        question: turn.question,
        answer: [
          ...turn.answer.items.map((item) => item.text),
          ...turn.answer.unknowns.map((item) => `Unknown: ${item}`),
        ].join('\n'),
      }));
    const response = await this.analysis.discussTask(id, {
      workItemId: key,
      version: project.version || 'working-tree',
      question,
      history,
    });
    this.markDiscussionPending(id, key);
    this.edit(id, (old) => {
      const current = old.taskDiscussions?.find(([candidate]) => candidate === key)?.[1];
      if (!current) return old;
      const answer = {
        items: response.answer.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          nature: item.nature,
          text: item.text,
          uncertainty: item.uncertainty,
          evidence: item.evidence.map((reference) => reference.revisionId),
        })),
        unknowns: response.answer.unknowns,
        limitations: response.limitations,
      };
      return {
        ...old,
        taskDiscussions: [
          ...(old.taskDiscussions ?? []).filter(([candidate]) => candidate !== key),
          [
            key,
            {
              ...current,
              input: !questionOverride && current.input.trim() === question ? '' : current.input,
              turns: [...current.turns, { question, answer, version: discussion.version }].slice(
                -10,
              ),
            },
          ],
        ],
      };
    });
    if (this.workItemForDiscussion(id, key)) await this.readProjectNow(id);
  }
  editAction(id: string, key: string, action?: string, done?: string) {
    const work = this.entry(id).analysis;
    const task = work?.candidates.find((item) => item.key === key);
    if (!task || !work) return;
    this.edit(id, (old) => {
      const prior = old.actionDrafts.find(([candidate]) => candidate === key)?.[1];
      return {
        ...old,
        actionDrafts: [
          ...old.actionDrafts.filter(([candidate]) => candidate !== key),
          [
            key,
            {
              action: action ?? prior?.action ?? task.nextAction ?? '',
              done: done ?? prior?.done ?? task.doneWhen ?? '',
              version: prior?.version ?? work.version,
            },
          ],
        ],
      };
    });
  }
  discardGoal(id: string) {
    this.edit(id, (old) => ({ ...old, goalDraft: null }));
  }
  discardAction(id: string, key: string) {
    this.edit(id, (old) => ({
      ...old,
      actionDrafts: old.actionDrafts.filter(([candidate]) => candidate !== key),
    }));
  }
  rebaseGoal(id: string) {
    const version = this.entry(id).analysis?.version;
    if (version)
      this.edit(id, (old) => ({
        ...old,
        goalDraft: old.goalDraft ? { ...old.goalDraft, version } : null,
      }));
  }
  rebaseAction(id: string, key: string) {
    const version = this.entry(id).analysis?.version;
    if (version)
      this.edit(id, (old) => ({
        ...old,
        actionDrafts: old.actionDrafts.map(([candidate, draft]) => [
          candidate,
          candidate === key ? { ...draft, version } : draft,
        ]),
      }));
  }
  private async mutate(
    id: string,
    action: () => Promise<unknown>,
    notice: string,
  ): Promise<boolean> {
    if (!this.value.online || this.needsCurrent(id) || this.value.busyWorkId) return false;
    const generation = this.generation;
    this.set({ busyWorkId: id, error: null, errorSource: null, notice: null });
    try {
      await action();
      if (!this.active || generation !== this.generation) return false;
      await this.refresh();
      if (this.value.route.projectId === id || id === 'new') this.set({ notice });
      return true;
    } catch (error) {
      if (this.active && generation === this.generation) {
        await this.refresh();
        this.set({ error: projectError(error), errorSource: 'action' });
      }
      return false;
    } finally {
      if (this.active && generation === this.generation) this.set({ busyWorkId: null });
    }
  }
  async saveGoal(id: string) {
    const draft = this.readEdits(id).goalDraft;
    const work = this.entry(id).analysis;
    const generation = this.generation;
    if (!draft?.text.trim()) return;
    if (
      work &&
      draft.version === work.version &&
      work.goalOrigin === 'user-input' &&
      draft.text.trim() === (work.goalText ?? '').trim()
    ) {
      this.discardGoal(id);
      if (this.value.route.projectId === id) this.set({ notice: 'No changes to save.' });
      return;
    }
    await this.mutate(
      id,
      async () => {
        await this.analysis.setGoal(id, draft.text.trim(), draft.version);
        if (
          this.active &&
          generation === this.generation &&
          this.value.edits[id]?.goalDraft === draft
        ) {
          this.discardGoal(id);
          this.discardGoalDiscussion(id);
        }
      },
      'Goal saved. Update the overview when you want StateCarry to check the project again.',
    );
  }
  async saveAction(id: string, key: string) {
    const draft = this.readEdits(id).actionDrafts.find(([candidate]) => candidate === key)?.[1];
    const generation = this.generation;
    if (!draft?.action.trim() || !draft.done.trim()) return;
    await this.mutate(
      id,
      async () => {
        await this.analysis.correct(id, {
          candidateKey: key,
          version: draft.version,
          kind: 'wrong-action',
          nextAction: draft.action.trim(),
          doneWhen: draft.done.trim(),
        });
        if (
          this.active &&
          generation === this.generation &&
          this.value.edits[id]?.actionDrafts.find(([candidate]) => candidate === key)?.[1] === draft
        )
          this.discardAction(id, key);
      },
      'Next step saved.',
    );
  }
  async correct(id: string, key: string, kind: AnalysisCorrection['kind']) {
    const work = this.entry(id).analysis;
    if (!work) return;
    const candidate = work.candidates.find((item) => item.key === key);
    const acceptingResult =
      !!candidate &&
      (candidate.status === 'done' ||
        !!candidate.completion?.reported?.length ||
        !!candidate.completion?.verified?.length);
    await this.mutate(
      id,
      () => this.analysis.correct(id, { candidateKey: key, version: work.version, kind }),
      kind === 'done'
        ? acceptingResult
          ? "Result accepted. StateCarry won't create a new task automatically."
          : "Task marked complete. StateCarry won't create a new task automatically."
        : kind === 'paused'
          ? 'This task is paused.'
          : 'Choice saved.',
    );
  }
  async prepare(id: string) {
    await this.mutate(
      id,
      () => this.refreshOverview(id),
      'Overview update started. You can keep reading while StateCarry checks the project.',
    );
  }
  async create(input: ProjectCreateInput): Promise<{ projectId: string; reused: boolean } | null> {
    const outcome: { value: { projectId: string; reused: boolean } | null } = { value: null };
    const saved = await this.mutate(
      'new',
      async () => {
        let createInput = input;
        if (!input.threadIds.length) {
          try {
            const discovered = await this.gateway.discover(input.cwd);
            const threadIds = [...new Set(discovered.threads.map((thread) => thread.id))].slice(
              0,
              30,
            );
            if (threadIds.length) createInput = { ...input, threadIds, discover: true };
          } catch {
            // Conversation discovery is optional project context. A local project
            // can still be registered and inspected when Codex discovery fails.
          }
        }
        const receipt = await this.gateway.create(createInput);
        outcome.value = {
          projectId: receipt.projectId,
          reused: receipt.command === 'project-reuse',
        };
      },
      '',
    );
    const result = outcome.value;
    if (!saved || !result) return null;
    if (!result.reused) {
      try {
        await this.refreshOverview(result.projectId);
      } catch {
        // Registration is already durable. A failed first overview request must
        // not turn project creation into a failed create or send the user back
        // through onboarding; they can retry from the project page.
      }
    }
    return result;
  }
  settings(id: string, input: ProjectProfile, revision = this.entry(id).revision) {
    return this.mutate(
      id,
      () => this.gateway.settings(id, revision, input),
      'Project settings were saved.',
    );
  }
  setFocused(id: string, focused: boolean) {
    const project = this.entry(id);
    const profile = {
      title: project.title,
      purpose: project.purpose,
      responseLanguage: project.responseLanguage ?? 'en',
      focused: project.focused,
      iconAsset: project.iconAsset,
      bannerAsset: project.bannerAsset,
    };
    return this.mutate(
      id,
      () => this.gateway.settings(id, project.revision, { ...profile, focused }),
      focused
        ? 'This project is now your Home focus.'
        : 'This project was removed from your Home focus.',
    );
  }
  async chooseProjectAsset(id: string, kind: 'icon' | 'banner') {
    if (!this.gateway.chooseProjectAsset)
      throw new Error('The local image picker is unavailable in this environment.');
    return (await this.gateway.chooseProjectAsset(id, kind)).assetRef;
  }
  sources(id: string, input: ProjectSourcesInput, revision = this.entry(id).revision) {
    return this.mutate(
      id,
      () => this.gateway.sources(id, revision, input),
      'Codex conversations saved. Update the overview when you want them included.',
    );
  }
  disconnect(id: string) {
    const revision = this.entry(id).revision;
    return this.mutate(
      id,
      () => this.gateway.disconnect(id, revision),
      'Project disconnected. Your saved work is still available.',
    );
  }
  restore(id: string) {
    const revision = this.entry(id).revision;
    return this.mutate(
      id,
      () => this.gateway.restore(id, revision),
      "Project reconnected. The overview wasn't updated.",
    );
  }
  async previewDeletion(id: string): Promise<boolean> {
    if (!this.value.online || this.needsCurrent(id) || this.value.busyWorkId) return false;
    const readEpoch = this.readEpoch;
    try {
      const preview = await this.gateway.deletionPreview(id);
      if (this.value.route.projectId !== id || readEpoch !== this.readEpoch) return false;
      this.set({ deletion: preview, error: null, errorSource: null });
      return true;
    } catch (error) {
      this.set({ error: projectError(error), errorSource: 'action' });
      return false;
    }
  }
  async remove(id: string): Promise<boolean> {
    const preview = this.value.deletion;
    if (preview?.projectId !== id || preview.blocked) return false;
    return this.mutate(
      id,
      async () => {
        await this.gateway.delete(id, preview.revision, preview.token);
        this.clearEdits(id);
        this.inspectionGeneration++;
        this.set({ deletion: null, inspection: null, inspectionLoading: false });
      },
      'Project data deleted from StateCarry. Original files and Codex conversations were kept.',
    );
  }
  async handoff(id: string, key: string): Promise<string | null> {
    if (!this.value.online || this.needsCurrent(id) || this.value.busyWorkId) return null;
    const before = this.entry(id).analysis;
    await this.refresh();
    const work = this.workspace.projects.find((entry) => entry.projectId === id)?.analysis;
    const candidate = work ? presentProjectAnalysis(work, key).selected : null;
    if (
      !this.value.online ||
      !work ||
      !candidate?.actionAvailable ||
      before?.version !== work.version
    ) {
      this.set({
        error: 'This task changed and needs another review before its context can be copied.',
        errorSource: 'action',
      });
      return null;
    }
    return analysisHandoffText(candidate, work);
  }
  private async readOriginal() {
    const route = this.value.route;
    const generation = ++this.inspectionGeneration;
    if (route.page !== 'original' || !route.projectId || !route.sourceId) return;
    const project = this.value.projects.find((item) => item.id === route.projectId);
    const allowed = project?.tasks.some((task) =>
      task.originals.some((source) => source.id === route.sourceId),
    );
    if (!allowed || !this.value.online) {
      this.set({
        inspection: null,
        inspectionLoading: false,
        error: 'This original is no longer available from the current overview.',
        errorSource: 'action',
      });
      return;
    }
    this.set({ inspection: null, inspectionLoading: true });
    try {
      const source = await this.gateway.evidence(route.projectId, route.sourceId);
      if (!this.active || generation !== this.inspectionGeneration) return;
      const actor = {
        user: 'Your message',
        agent: 'Agent report',
        tool: 'Tool result',
        system: 'System record',
      }[source.actor];
      this.set({
        inspection: {
          projectId: route.projectId,
          title: 'Original record',
          actor,
          at: source.eventAt,
          text: source.text,
        },
        inspectionLoading: false,
      });
    } catch (error) {
      if (this.active && generation === this.inspectionGeneration)
        this.set({
          inspection: null,
          inspectionLoading: false,
          error: projectError(error),
          errorSource: 'action',
        });
    }
  }
  connections() {
    return this.gateway.connections();
  }
  capabilities() {
    if (!this.gateway.capabilities)
      return Promise.reject(new Error('Integration capabilities are unavailable.'));
    return this.gateway.capabilities();
  }
  agentSettings() {
    if (!this.gateway.agentSettings)
      return Promise.reject(new Error('Analysis agent settings are unavailable.'));
    return this.gateway.agentSettings();
  }
  async saveAgentSettings(
    input: import('@statecarry/contracts').AgentSettingsInput,
  ): Promise<boolean> {
    if (!this.gateway.saveAgentSettings) return false;
    if (!this.value.online || this.value.busyWorkId) return false;
    const generation = this.generation;
    this.set({ busyWorkId: 'agent-settings', error: null, errorSource: null, notice: null });
    try {
      await this.gateway.saveAgentSettings(input);
      if (!this.active || generation !== this.generation) return false;
      this.set({ notice: 'Analysis agent settings were saved.' });
      return true;
    } catch (error) {
      if (this.active && generation === this.generation)
        this.set({ error: projectError(error), errorSource: 'action' });
      return false;
    } finally {
      if (this.active && generation === this.generation) this.set({ busyWorkId: null });
    }
  }
  chooseProjectFolder() {
    if (!this.gateway.chooseFolder)
      return Promise.reject(new Error('The local folder picker is unavailable.'));
    return this.gateway.chooseFolder().then((result) => result.path);
  }
  private responseLanguage(id: string): 'en' | 'ko' {
    return (
      this.workspace.projects.find((project) => project.projectId === id)?.responseLanguage ?? 'en'
    );
  }
  private refreshOverview(id: string) {
    return this.responseLanguage(id) === 'ko'
      ? this.analysis.refresh(id, 'ko')
      : this.analysis.refresh(id);
  }
  discover(cwd: string) {
    return this.gateway.discover(cwd);
  }
  turns(id: string) {
    return this.gateway.turns(id);
  }
  clearNotice() {
    this.set({ notice: null, error: null, errorSource: null, deletion: null });
  }
}
