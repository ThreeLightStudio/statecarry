import type {
  ProjectGateway,
  ProjectWorkspace,
  ProjectRegistrations,
  ProjectCreateInput,
  ProjectProfile,
  ProjectSourcesInput,
  ProjectDeletionPreview,
  AppUpdateState,
  ProjectNowBundle,
} from '@statecarry/presentation';
import type {
  Capabilities,
  Connection,
  Receipt,
  SourceRevision,
  WorkspaceSnapshot,
  ProjectModelView,
  WorkDiscussionSync,
  WorkItemCreate,
  ReleaseProjectView,
  ReleasePolicyInput,
  ReleaseCreateInput,
  DeliveryTargetUpdate,
  ReleaseCheckUpdate,
  ReleasePolicyExceptionInput,
} from '@statecarry/contracts';

export class ProjectRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class HttpProjectGateway implements ProjectGateway {
  private async request<T>(path: string, data?: unknown, timeoutMs?: number): Promise<T> {
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;
    try {
      const response = await fetch(`/api/v1${path}`, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
        ...(data === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new ProjectRequestError(
          value.error?.code ?? 'UNAVAILABLE',
          value.error?.message ?? 'Request unavailable',
        );
      return value as T;
    } catch (error) {
      if (controller?.signal.aborted)
        throw new ProjectRequestError('REQUEST_TIMEOUT', 'Project read timed out');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private command<T = Receipt>(path: string, revision: number, payload: object) {
    return this.request<T>(path, {
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      payload,
    });
  }
  execution(
    id: string,
    command?: import('@statecarry/contracts').ProjectExecutionCommand,
    version = 0,
    language: 'en' | 'ko' = 'en',
  ) {
    return this.request<import('@statecarry/contracts').ProjectExecutionWorkspace>(
      `/projects/${encodeURIComponent(id)}/execution?outputLanguage=${language}`,
      command ? { expectedVersion: version, command } : undefined,
    );
  }
  list() {
    return this.request<ProjectWorkspace>('/projects');
  }
  now(id: string) {
    return this.request<ProjectNowBundle>(
      `/projects/${encodeURIComponent(id)}/now`,
      undefined,
      5000,
    );
  }
  initialize(id: string, outputLanguage: 'en' | 'ko' = 'en') {
    return this.request<ProjectNowBundle>(`/projects/${encodeURIComponent(id)}/initialize`, {
      outputLanguage,
    });
  }
  selectProposal(id: string, revision: number, proposalKey: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/select-proposal`,
      revision,
      { proposalKey },
    );
  }
  selectWork(id: string, revision: number, workItemId: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/select-work`,
      revision,
      { workItemId },
    );
  }
  createWork(id: string, revision: number, input: WorkItemCreate) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/create-work`,
      revision,
      input,
    );
  }
  pauseWork(id: string, revision: number, workItemId: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/pause-work`,
      revision,
      { workItemId },
    );
  }
  resumeWork(id: string, revision: number, workItemId: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/resume-work`,
      revision,
      { workItemId },
    );
  }
  completeWork(id: string, revision: number, workItemId: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/complete-work`,
      revision,
      { workItemId },
    );
  }
  stopWork(id: string, revision: number, workItemId: string) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/stop-work`,
      revision,
      { workItemId },
    );
  }
  registrations() {
    return this.request<ProjectRegistrations>('/projects/registrations');
  }
  workspace(id: string) {
    return this.request<WorkspaceSnapshot>(`/projects/${encodeURIComponent(id)}/workspace`);
  }
  observe(id: string, outputLanguage: 'en' | 'ko' = 'en') {
    return this.request<WorkspaceSnapshot>(`/projects/${encodeURIComponent(id)}/observe`, {
      outputLanguage,
    });
  }
  continueDirectionConflict(id: string, revision: number) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/continue-direction-conflict`,
      revision,
      {},
    );
  }
  syncDiscussion(id: string, revision: number, input: WorkDiscussionSync) {
    return this.command<ProjectModelView>(
      `/projects/${encodeURIComponent(id)}/sync-discussion`,
      revision,
      input,
    );
  }
  release(id: string) {
    return this.request<ReleaseProjectView>(`/projects/${encodeURIComponent(id)}/release`);
  }
  setReleasePolicy(id: string, revision: number, input: ReleasePolicyInput) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/release-policy`,
      revision,
      input,
    );
  }
  createRelease(id: string, revision: number, input: ReleaseCreateInput) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/create-release`,
      revision,
      input,
    );
  }
  updateDelivery(id: string, revision: number, releaseId: string, input: DeliveryTargetUpdate) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/update-delivery`,
      revision,
      { releaseId, ...input },
    );
  }
  updateReleaseCheck(id: string, revision: number, releaseId: string, input: ReleaseCheckUpdate) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/update-release-check`,
      revision,
      { releaseId, ...input },
    );
  }
  confirmRelease(id: string, revision: number, releaseId: string) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/confirm-release`,
      revision,
      { releaseId },
    );
  }
  createReleaseException(id: string, revision: number, input: ReleasePolicyExceptionInput) {
    return this.command<ReleaseProjectView>(
      `/projects/${encodeURIComponent(id)}/release-exception`,
      revision,
      input,
    );
  }
  analyzeWorkspace(id: string, outputLanguage: 'en' | 'ko' = 'en') {
    return this.request<WorkspaceSnapshot>(`/projects/${encodeURIComponent(id)}/analysis`, {
      outputLanguage,
    });
  }
  capabilities() {
    return this.request<Capabilities>('/capabilities');
  }
  chooseFolder() {
    return this.request<{ path: string | null }>('/local/folder-picker', {});
  }
  chooseProjectAsset(id: string, kind: 'icon' | 'banner') {
    return this.request<{ assetRef: string | null }>('/local/project-assets/select', {
      projectId: id,
      kind,
    });
  }
  appUpdate() {
    return this.request<AppUpdateState>('/local/updater');
  }
  checkAppUpdate() {
    return this.request<AppUpdateState>('/local/updater/check', {});
  }
  downloadAppUpdate() {
    return this.request<AppUpdateState>('/local/updater/download', {});
  }
  restartAppUpdate() {
    return this.request<AppUpdateState>('/local/updater/restart', {});
  }
  create(input: ProjectCreateInput) {
    return this.command('/projects', 0, input);
  }
  settings(id: string, revision: number, input: ProjectProfile) {
    return this.command(`/projects/${encodeURIComponent(id)}/settings`, revision, input);
  }
  sources(id: string, revision: number, input: ProjectSourcesInput) {
    return this.command(`/projects/${encodeURIComponent(id)}/sources`, revision, input);
  }
  disconnect(id: string, revision: number) {
    return this.command(`/projects/${encodeURIComponent(id)}/disconnect`, revision, {});
  }
  restore(id: string, revision: number) {
    return this.command(`/projects/${encodeURIComponent(id)}/restore`, revision, {});
  }
  deletionPreview(id: string) {
    return this.request<ProjectDeletionPreview>(`/projects/${encodeURIComponent(id)}/deletion`);
  }
  delete(id: string, revision: number, token: string) {
    return this.command(`/projects/${encodeURIComponent(id)}/deletion`, revision, { token });
  }
  connections() {
    return this.request<Connection[]>('/projects/connections');
  }
  discover(cwd: string) {
    return this.request<{
      threads: { id: string; title: string; cwd: string }[];
      complete: boolean;
      limitations: string[];
    }>(`/discover?cwd=${encodeURIComponent(cwd)}`);
  }
  turns(id: string) {
    return this.request<{ turns: { id: string; at: string | null }[] }>(
      `/turns/${encodeURIComponent(id)}`,
    );
  }
  evidence(projectId: string, sourceId: string) {
    return this.request<SourceRevision>(
      `/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(sourceId)}`,
    );
  }
}
