import type { ResumeCorrection } from '@statecarry/contracts';
import type { ResumeGateway } from './resume';
import { presentResumeWork, resumeHandoffText } from './resume';
import type { ResumeMemory, SavedResumeEdits } from './resume-memory';
import {
  presentProjects,
  projectError,
  type ProjectGateway,
  type ProjectRoute,
  type ProjectView,
  type ProjectWorkspace,
  type ProjectProfile,
  type ProjectCreateInput,
  type ProjectSourcesInput,
  type ProjectDeletionPreview,
} from './projects';

export type ProjectControllerState = {
  route: ProjectRoute;
  projects: ProjectView[];
  loading: boolean;
  online: boolean;
  checkingCurrent: boolean;
  error: string | null;
  notice: string | null;
  memoryError: string | null;
  busyWorkId: string | null;
  edits: Record<string, SavedResumeEdits>;
  inspection: {
    workId: string;
    title: string;
    actor: string;
    at: string | null;
    text: string;
  } | null;
  inspectionLoading: boolean;
  deletion: ProjectDeletionPreview | null;
};
const emptyEdits = (): SavedResumeEdits => ({
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
    route: { page: 'home' },
    projects: [],
    loading: true,
    online: false,
    checkingCurrent: true,
    error: null,
    notice: null,
    memoryError: null,
    busyWorkId: null,
    edits: {},
    inspection: null,
    inspectionLoading: false,
    deletion: null,
  };
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private readEpoch = 0;
  private inspectionGeneration = 0;
  private pending: Promise<void> | null = null;
  private readAgain = false;
  private hasLoaded = false;
  private connectionLost = false;
  private streamConnected = false;
  private allChanged = true;
  private changedWorkIds = new Set<string>();
  private settledDuringRead = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe?: () => void;
  private outputLanguage: 'en' | 'ko' = 'en';
  constructor(
    private gateway: ProjectGateway,
    private resume: ResumeGateway,
    private memory?: ResumeMemory,
  ) {}
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
    const projects = presentProjects(this.workspace, online).map((project) =>
      online && checking && this.needsCurrent(project.id) && !project.disconnected
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
        : project,
    );
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
  private invalidateRead(disconnected = false, workId: string | null = null) {
    this.readEpoch++;
    if (workId === null) this.allChanged = true;
    else this.changedWorkIds.add(workId);
    const affectsOriginal = workId === null || workId === this.value.route.workId;
    if (affectsOriginal) this.inspectionGeneration++;
    this.present({
      ...(disconnected ? { online: false, loading: false } : {}),
      checkingCurrent: true,
      ...(affectsOriginal ? { inspection: null, inspectionLoading: false } : {}),
      deletion: null,
    });
  }
  start(route: ProjectRoute) {
    this.active = true;
    this.generation++;
    this.connectionLost = false;
    this.streamConnected = false;
    this.invalidateRead();
    this.navigate(route);
    this.unsubscribe = this.resume.subscribe?.(
      (change) => {
        if (!this.active) return;
        if (change?.kind === 'collection-settled') {
          if (!change.workId) return;
          if (this.pending) this.settledDuringRead.add(change.workId);
          // A settled observation is not a data change. It only completes a
          // transient collecting snapshot observed by a concurrent GET.
          if (
            !this.workspace.projects.some(
              (entry) => entry.workId === change.workId && entry.collecting,
            )
          )
            return;
        }
        this.invalidateRead(false, change?.workId ?? null);
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
          // The first GET may precede the server's stream subscription. Recheck
          // once after connection so changes in that gap cannot be missed.
          if (!needsRead) return;
          this.invalidateRead();
          void this.refresh(true);
        }
      },
    );
    return this.refresh();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.inspectionGeneration++;
    this.cancelScheduledRead();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
  navigate(route: ProjectRoute) {
    this.inspectionGeneration++;
    this.set({
      route,
      inspection: null,
      inspectionLoading: false,
      deletion: null,
      error: null,
      notice: null,
    });
    if (route.workId && route.candidateKey) this.select(route.workId, route.candidateKey);
  }
  /** Returning to the app checks files/current access without preparing AI output. */
  checkForChanges() {
    if (!this.active) return Promise.resolve();
    this.invalidateRead();
    return this.refresh(true);
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
          loading: !this.hasLoaded,
          ...(!background ? { inspection: null, inspectionLoading: false } : {}),
        });
        try {
          const workspace = await this.gateway.list();
          if (!this.active || generation !== this.generation) return;
          if (readEpoch !== this.readEpoch) continue;
          if (
            workspace.projects.some(
              (entry) => entry.collecting && this.settledDuringRead.has(entry.workId),
            )
          ) {
            this.readAgain = true;
            continue;
          }
          const removed = this.workspace.projects.filter(
            (old) => !workspace.projects.some((entry) => entry.workId === old.workId),
          );
          const originalId = this.value.route.workId;
          const previousOriginal = this.workspace.projects.find(
            (entry) => entry.workId === originalId,
          );
          const nextOriginal = workspace.projects.find((entry) => entry.workId === originalId);
          if (
            previousOriginal?.revision !== nextOriginal?.revision ||
            previousOriginal?.resume?.version !== nextOriginal?.resume?.version ||
            previousOriginal?.disconnectedAt !== nextOriginal?.disconnectedAt
          ) {
            this.inspectionGeneration++;
            this.set({ inspection: null, inspectionLoading: false });
          }
          this.workspace = workspace;
          this.hasLoaded = true;
          this.allChanged = false;
          this.changedWorkIds.clear();
          for (const entry of workspace.projects) this.readEdits(entry.workId);
          for (const entry of removed) this.clearEdits(entry.workId);
          const route = this.value.route;
          if (route.workId && route.candidateKey) this.select(route.workId, route.candidateKey);
          try {
            this.memory?.prune?.(workspace.projects.map((entry) => entry.workId));
          } catch {
            this.set({
              memoryError:
                'Old browser drafts could not be cleared. They will not be used for the current projects.',
            });
          }
          this.present({ online: true, checkingCurrent: false, error: null, loading: false });
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
          this.present({
            online: false,
            checkingCurrent: true,
            loading: false,
            error: projectError(error),
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
  private readEdits(id: string): SavedResumeEdits {
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
  private edit(id: string, update: (old: SavedResumeEdits) => SavedResumeEdits) {
    // A removed screen can finish its scroll cleanup after a reset response.
    // Browser input never registers work or recreates its retired storage key.
    if (!this.workspace.projects.some((entry) => entry.workId === id)) return;
    const next = update(this.readEdits(id));
    this.set({ edits: { ...this.value.edits, [id]: next } });
    try {
      this.memory?.write(id, next);
    } catch {
      this.set({
        memoryError:
          'This browser could not save your draft. Keep this tab open or copy your unfinished text.',
      });
    }
  }
  private clearEdits(id: string) {
    try {
      this.memory?.write(id, emptyEdits());
    } catch {
      this.set({
        memoryError:
          'Saved browser input could not be cleared. The removed project will not be restored by that input.',
      });
    }
    const edits = { ...this.value.edits };
    delete edits[id];
    this.set({ edits });
  }
  private entry(id: string) {
    const entry = this.workspace.projects.find((item) => item.workId === id);
    if (!entry) throw Object.assign(new Error('Project unavailable'), { code: 'NOT_FOUND' });
    return entry;
  }
  select(id: string, key: string) {
    this.edit(id, (old) => ({ ...old, selectedKey: key }));
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
    const work = this.entry(id).resume;
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
  editAction(id: string, key: string, action?: string, done?: string) {
    const work = this.entry(id).resume;
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
    const version = this.entry(id).resume?.version;
    if (version)
      this.edit(id, (old) => ({
        ...old,
        goalDraft: old.goalDraft ? { ...old.goalDraft, version } : null,
      }));
  }
  rebaseAction(id: string, key: string) {
    const version = this.entry(id).resume?.version;
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
    this.set({ busyWorkId: id, error: null, notice: null });
    try {
      await action();
      if (!this.active || generation !== this.generation) return false;
      await this.refresh();
      if (this.value.route.workId === id || id === 'new') this.set({ notice });
      return true;
    } catch (error) {
      if (this.active && generation === this.generation) {
        await this.refresh();
        this.set({ error: projectError(error) });
      }
      return false;
    } finally {
      if (this.active && generation === this.generation) this.set({ busyWorkId: null });
    }
  }
  async saveGoal(id: string) {
    const draft = this.readEdits(id).goalDraft;
    const generation = this.generation;
    if (!draft?.text.trim()) return;
    await this.mutate(
      id,
      async () => {
        await this.resume.setGoal(id, draft.text.trim(), draft.version);
        if (
          this.active &&
          generation === this.generation &&
          this.value.edits[id]?.goalDraft === draft
        )
          this.discardGoal(id);
      },
      'The goal was saved. Prepare an updated overview when you are ready.',
    );
  }
  async saveAction(id: string, key: string) {
    const draft = this.readEdits(id).actionDrafts.find(([candidate]) => candidate === key)?.[1];
    const generation = this.generation;
    if (!draft?.action.trim() || !draft.done.trim()) return;
    await this.mutate(
      id,
      async () => {
        await this.resume.correct(id, {
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
      'The next action and finish condition were saved.',
    );
  }
  async correct(id: string, key: string, kind: ResumeCorrection['kind']) {
    const work = this.entry(id).resume;
    if (!work) return;
    await this.mutate(
      id,
      () => this.resume.correct(id, { candidateKey: key, version: work.version, kind }),
      kind === 'done'
        ? 'You accepted this task. No successor task was created.'
        : kind === 'paused'
          ? 'This task is paused.'
          : 'Your choice was saved.',
    );
  }
  async prepare(id: string) {
    await this.mutate(
      id,
      () => this.refreshOverview(id),
      'Overview preparation started. This page will update when the project check finishes.',
    );
  }
  async create(input: ProjectCreateInput): Promise<{ workId: string; reused: boolean } | null> {
    const outcome: { value: { workId: string; reused: boolean } | null } = { value: null };
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
        outcome.value = { workId: receipt.workId, reused: receipt.command === 'project-reuse' };
      },
      '',
    );
    const result = outcome.value;
    if (!saved || !result) return null;
    if (!result.reused) {
      try {
        await this.refreshOverview(result.workId);
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
  sources(id: string, input: ProjectSourcesInput, revision = this.entry(id).revision) {
    return this.mutate(
      id,
      () => this.gateway.sources(id, revision, input),
      'The source scope was saved. Prepare an overview when you are ready.',
    );
  }
  disconnect(id: string) {
    const revision = this.entry(id).revision;
    return this.mutate(
      id,
      () => this.gateway.disconnect(id, revision),
      'Collection was stopped. Your saved work remains available to reconnect.',
    );
  }
  restore(id: string) {
    const revision = this.entry(id).revision;
    return this.mutate(
      id,
      () => this.gateway.restore(id, revision),
      'The same project was reconnected. No new analysis was started.',
    );
  }
  async previewDeletion(id: string): Promise<boolean> {
    if (!this.value.online || this.needsCurrent(id) || this.value.busyWorkId) return false;
    const readEpoch = this.readEpoch;
    try {
      const preview = await this.gateway.deletionPreview(id);
      if (this.value.route.workId !== id || readEpoch !== this.readEpoch) return false;
      this.set({ deletion: preview, error: null });
      return true;
    } catch (error) {
      this.set({ error: projectError(error) });
      return false;
    }
  }
  async remove(id: string): Promise<boolean> {
    const preview = this.value.deletion;
    if (preview?.workId !== id || preview.blocked) return false;
    return this.mutate(
      id,
      async () => {
        await this.gateway.delete(id, preview.revision, preview.token);
        this.clearEdits(id);
        this.inspectionGeneration++;
        this.set({ deletion: null, inspection: null, inspectionLoading: false });
      },
      'The selected saved project data was removed. Original files and conversations were kept.',
    );
  }
  async handoff(id: string, key: string): Promise<string | null> {
    if (!this.value.online || this.needsCurrent(id) || this.value.busyWorkId) return null;
    const before = this.entry(id).resume;
    await this.refresh();
    const work = this.workspace.projects.find((entry) => entry.workId === id)?.resume;
    const candidate = work ? presentResumeWork(work, key).selected : null;
    if (
      !this.value.online ||
      !work ||
      !candidate?.actionAvailable ||
      before?.version !== work.version
    ) {
      this.set({
        error:
          'The current work needs another review before continuation instructions can be copied.',
      });
      return null;
    }
    return resumeHandoffText(candidate, work);
  }
  private async readOriginal() {
    const route = this.value.route;
    const generation = ++this.inspectionGeneration;
    if (route.page !== 'original' || !route.workId || !route.sourceId) return;
    const project = this.value.projects.find((item) => item.id === route.workId);
    const allowed = project?.tasks.some((task) =>
      task.originals.some((source) => source.id === route.sourceId),
    );
    if (!allowed || !this.value.online) {
      this.set({
        inspection: null,
        inspectionLoading: false,
        error: 'This original is no longer part of the available project overview.',
      });
      return;
    }
    this.set({ inspection: null, inspectionLoading: true });
    try {
      const source = await this.gateway.evidence(route.workId, route.sourceId);
      if (!this.active || generation !== this.inspectionGeneration) return;
      const actor = {
        user: 'Your message',
        agent: 'Agent report',
        tool: 'Tool result',
        system: 'System record',
      }[source.actor];
      this.set({
        inspection: {
          workId: route.workId,
          title: 'Original record',
          actor,
          at: source.eventAt,
          text: source.text,
        },
        inspectionLoading: false,
      });
    } catch (error) {
      if (this.active && generation === this.inspectionGeneration)
        this.set({ inspection: null, inspectionLoading: false, error: projectError(error) });
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
  setOutputLanguage(language: 'en' | 'ko') {
    this.outputLanguage = language;
  }
  async localizeGeneratedOverviews(language: 'en' | 'ko'): Promise<boolean> {
    this.outputLanguage = language;
    if (!this.value.online || this.value.checkingCurrent || this.value.busyWorkId) return false;
    const targets = this.workspace.projects.filter(
      (entry) =>
        !entry.disconnectedAt &&
        !!entry.resume?.generatedAt &&
        (entry.resume.outputLanguage ?? 'en') !== language,
    );
    if (!targets.length) return true;
    if (!this.resume.localize) {
      this.set({ error: 'Existing overview language cannot be updated in this environment.' });
      return false;
    }
    const generation = this.generation;
    this.set({ busyWorkId: 'response-language', error: null, notice: null });
    try {
      for (const target of targets) await this.resume.localize(target.workId, language);
      if (!this.active || generation !== this.generation) return false;
      await this.refresh();
      if (!this.active || generation !== this.generation) return false;
      this.set({
        notice:
          language === 'ko'
            ? 'Existing project overviews were updated to Korean.'
            : 'Existing project overviews were updated to English.',
      });
      return true;
    } catch (error) {
      if (this.active && generation === this.generation) {
        await this.refresh();
        this.set({ error: projectError(error) });
      }
      return false;
    } finally {
      if (this.active && generation === this.generation) this.set({ busyWorkId: null });
    }
  }
  private refreshOverview(id: string) {
    return this.outputLanguage === 'ko' ? this.resume.refresh(id, 'ko') : this.resume.refresh(id);
  }
  discover(cwd: string) {
    return this.gateway.discover(cwd);
  }
  turns(id: string) {
    return this.gateway.turns(id);
  }
  clearNotice() {
    this.set({ notice: null, error: null, deletion: null });
  }
}
