import type {
  ProjectGateway,
  ProjectWorkspace,
  ProjectRegistrations,
  ProjectCreateInput,
  ProjectProfile,
  ProjectSourcesInput,
  ProjectDeletionPreview,
  AppUpdateState,
} from '@statecarry/presentation';
import type {
  Capabilities,
  Connection,
  Receipt,
  SourceRevision,
  WorkspaceSnapshot,
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
  private async request<T>(path: string, data?: unknown): Promise<T> {
    const response = await fetch(`/api/v1${path}`, {
      cache: 'no-store',
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
  }
  private command(path: string, revision: number, payload: object) {
    return this.request<Receipt>(path, {
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      payload,
    });
  }
  list() {
    return this.request<ProjectWorkspace>('/project-workspace');
  }
  registrations() {
    return this.request<ProjectRegistrations>('/project-workspace/registrations');
  }
  workspace(id: string, outputLanguage: 'en' | 'ko' = 'en') {
    return this.request<WorkspaceSnapshot>(
      `/project-workspace/${encodeURIComponent(id)}/workspace?outputLanguage=${outputLanguage}`,
    );
  }
  capabilities() {
    return this.request<Capabilities>('/capabilities');
  }
  chooseFolder() {
    return this.request<{ path: string | null }>('/local/folder-picker', {});
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
    return this.command('/project-workspace', 0, input);
  }
  settings(id: string, revision: number, input: ProjectProfile) {
    return this.command(`/project-workspace/${encodeURIComponent(id)}/settings`, revision, input);
  }
  sources(id: string, revision: number, input: ProjectSourcesInput) {
    return this.command(`/project-workspace/${encodeURIComponent(id)}/sources`, revision, input);
  }
  disconnect(id: string, revision: number) {
    return this.command(`/project-workspace/${encodeURIComponent(id)}/disconnect`, revision, {});
  }
  restore(id: string, revision: number) {
    return this.command(`/project-workspace/${encodeURIComponent(id)}/restore`, revision, {});
  }
  deletionPreview(id: string) {
    return this.request<ProjectDeletionPreview>(
      `/project-workspace/${encodeURIComponent(id)}/deletion`,
    );
  }
  delete(id: string, revision: number, token: string) {
    return this.command(`/project-workspace/${encodeURIComponent(id)}/deletion`, revision, {
      token,
    });
  }
  connections() {
    return this.request<Connection[]>('/connections');
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
  evidence(workId: string, sourceId: string) {
    return this.request<SourceRevision>(
      `/work-contexts/${encodeURIComponent(workId)}/evidence/${encodeURIComponent(sourceId)}`,
    );
  }
}
