import type {
  ProjectWorkspace,
  ProjectWorkspaceEntry,
  ProjectProfile,
  ProjectCreateInput,
  ProjectSourcesInput,
  ProjectDeletionPreview,
  Connection,
  SourceRevision,
  Receipt,
  Capabilities,
  WorkspaceSnapshot,
} from '@statecarry/contracts';
import { presentResumeWork, resumeWorkStatus } from './resume';

export type {
  ProjectWorkspace,
  ProjectWorkspaceEntry,
  ProjectProfile,
  ProjectCreateInput,
  ProjectSourcesInput,
  ProjectDeletionPreview,
} from '@statecarry/contracts';
export type { RecordRange } from '@statecarry/contracts';

export type AppUpdateState = {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'restarting' | 'error';
  progress: number | null;
  error: string | null;
};

export interface ProjectGateway {
  capabilities?(): Promise<Capabilities>;
  chooseFolder?(): Promise<{ path: string | null }>;
  appUpdate?(): Promise<AppUpdateState>;
  checkAppUpdate?(): Promise<AppUpdateState>;
  downloadAppUpdate?(): Promise<AppUpdateState>;
  restartAppUpdate?(): Promise<AppUpdateState>;
  list(): Promise<ProjectWorkspace>;
  workspace?(id: string, outputLanguage?: 'en' | 'ko'): Promise<WorkspaceSnapshot>;
  create(input: ProjectCreateInput): Promise<Receipt>;
  settings(id: string, revision: number, input: ProjectProfile): Promise<Receipt>;
  sources(id: string, revision: number, input: ProjectSourcesInput): Promise<Receipt>;
  disconnect(id: string, revision: number): Promise<Receipt>;
  restore(id: string, revision: number): Promise<Receipt>;
  deletionPreview(id: string): Promise<ProjectDeletionPreview>;
  delete(id: string, revision: number, token: string): Promise<Receipt>;
  connections(): Promise<Connection[]>;
  discover(
    cwd: string,
  ): Promise<{
    threads: { id: string; title: string; cwd: string }[];
    complete: boolean;
    limitations: string[];
  }>;
  turns(id: string): Promise<{ turns: { id: string; at: string | null }[] }>;
  evidence(workId: string, sourceId: string): Promise<SourceRevision>;
}

export type WorkingTreeView = {
  kind: 'no-git' | 'clean' | 'normal' | 'mixed' | 'large';
  fileCount: number;
  additions: number;
  deletions: number;
  untrackedCount: number;
  branch: string | null;
  head: string | null;
  lastCommit: string | null;
  files: string[];
  groups: Array<{
    title: string;
    summary: string;
    currentState: string;
    openItems: string[];
    suggestedNextStep: string;
    reason: string;
    doneWhen: string;
    files: string[];
  }>;
  summary: string;
};

export function presentWorkingTree(snapshot: WorkspaceSnapshot): WorkingTreeView {
  const fileCount = snapshot.changedFileCount ?? snapshot.changedPaths?.length ?? 0;
  const additions = snapshot.additions ?? 0;
  const deletions = snapshot.deletions ?? 0;
  const untrackedCount = snapshot.untrackedCount ?? 0;
  const files = (
    snapshot.changedFiles?.map((file) => file.path) ??
    snapshot.changedPaths ??
    []
  ).slice(0, 120);
  const groups = snapshot.workingTreeAnalysis?.groups ?? [];
  const common = {
    fileCount,
    additions,
    deletions,
    untrackedCount,
    branch: snapshot.branch ?? null,
    head: snapshot.commit ?? null,
    lastCommit: snapshot.recentCommits?.[0]?.subject ?? null,
    files,
    groups,
  };
  if (snapshot.status !== 'checked' || snapshot.dirty === null)
    return {
      ...common,
      kind: 'no-git',
      summary:
        'Git is not available for this project, so StateCarry cannot reliably carry uncommitted work.',
    };
  if (!snapshot.dirty)
    return { ...common, kind: 'clean', summary: 'This project has no uncommitted changes.' };
  if (fileCount >= 50 || additions + deletions >= 10_000)
    return {
      ...common,
      kind: 'large',
      summary:
        snapshot.workingTreeAnalysis?.summary ??
        'This is a large uncommitted change set. StateCarry could not reconstruct its work groups yet.',
    };
  if (groups.length >= 2)
    return {
      ...common,
      kind: 'mixed',
      summary:
        snapshot.workingTreeAnalysis?.summary ?? 'The working tree contains multiple work groups.',
    };
  return {
    ...common,
    kind: 'normal',
    summary:
      snapshot.workingTreeAnalysis?.summary ??
      'The current working tree contains uncommitted changes. Semantic reconstruction is unavailable.',
  };
}

export type ProjectRoute = {
  page: 'home' | 'project' | 'new' | 'global-settings' | 'settings' | 'original';
  workId?: string;
  candidateKey?: string;
  sourceId?: string;
};
export function projectHref(id: string, task?: string): string {
  return `#/project/${encodeURIComponent(id)}${task ? `?task=${encodeURIComponent(task)}` : ''}`;
}
export function parseProjectRoute(hash: string): ProjectRoute {
  try {
    const [path, search = ''] = hash.replace(/^#/, '').split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'new' || parts[0] === 'connect') return { page: 'new' };
    if (parts[0] === 'settings' && parts.length === 1) return { page: 'global-settings' };
    if (['project', 'resume', 'work', 'details'].includes(parts[0]) && parts[1]) {
      return {
        page:
          parts[2] === 'settings'
            ? 'settings'
            : parts[2] === 'original' && parts[3]
              ? 'original'
              : 'project',
        workId: parts[1],
        candidateKey: new URLSearchParams(search).get('task') || undefined,
        sourceId: parts[2] === 'original' ? parts[3] : undefined,
      };
    }
  } catch {
    /* An obsolete or malformed bookmark returns to the project list. */
  }
  return { page: 'home' };
}
export function projectRouteHref(route: ProjectRoute): string {
  if (route.page === 'home') return '#/home';
  if (route.page === 'new') return '#/new';
  if (route.page === 'global-settings') return '#/settings';
  const base = `#/project/${encodeURIComponent(route.workId ?? '')}`;
  const suffix =
    route.page === 'settings'
      ? '/settings'
      : route.page === 'original'
        ? `/original/${encodeURIComponent(route.sourceId ?? '')}`
        : '';
  return `${base}${suffix}${route.candidateKey ? `?task=${encodeURIComponent(route.candidateKey)}` : ''}`;
}

export type ProjectTaskView = {
  key: string;
  title: string;
  status: 'continue' | 'review' | 'waiting' | 'paused' | 'accepted' | 'unclear';
  statusLabel: string;
  currentState: string;
  reason: string;
  nextAction: string | null;
  doneWhen: string | null;
  prerequisites: string[];
  canAct: boolean;
  /** The saved action remains readable while its changed sources are checked. */
  rechecking?: boolean;
  sourceLabel: string;
  evidenceExplanation: string[];
  evidenceSources: ProjectSourceSummary[];
  originals: { id: string; label: string }[];
  destinationUrl: string | null;
};
export type ProjectSourceSummary = {
  kind: 'codebase' | 'git' | 'codex';
  label: string;
  detail: string;
};
export type ProjectView = {
  id: string;
  title: string;
  cwd: string;
  purpose: string;
  focused: boolean;
  disconnected: boolean;
  revision: number;
  version: string;
  goal: string;
  goalConfirmed: boolean;
  stateLabel: string;
  stateDescription: string;
  canEdit: boolean;
  canDecide: boolean;
  canRefresh: boolean;
  updating?: boolean;
  generatedAt: string | null;
  outputLanguage: 'en' | 'ko';
  sourceCount: number;
  sourceSummary: ProjectSourceSummary[];
  projectState: { currentState: string; recentWork: string; openOrUncertain: string; next: string };
  tasks: ProjectTaskView[];
  dismissed: ProjectTaskView[];
};

export function projectError(value: unknown): string {
  const code = value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
  if (code === 'REVISION_CONFLICT')
    return 'The project changed while you were editing. Your draft is still here. Review the latest version before saving.';
  if (code === 'PROJECT_BUSY')
    return 'StateCarry is still checking this project. Try deleting its saved data again after the check finishes.';
  if (code === 'PROJECT_DELETION_CHANGED')
    return 'The saved data changed after you reviewed it. Review what will be deleted again before confirming.';
  if (code === 'NOT_FOUND')
    return 'This project or source is no longer available. Return Home to see your current projects.';
  if (code === 'SOURCE_UNAVAILABLE')
    return 'This source is no longer available to this project. Return to the project and review its sources.';
  if (code === 'VALIDATION')
    return 'StateCarry could not save this. Check the required fields and any selected conversation range.';
  if (code === 'CAPABILITY_UNSUPPORTED')
    return 'This action is not available on this Mac. Your current work is unchanged.';
  return 'StateCarry could not complete that action. Your input is still here. Try again.';
}

/** Select only explanatory fields. Raw evidence, errors and transport details
 * never become an alternative display body in the project experience. */
export function presentProject(entry: ProjectWorkspaceEntry, online = true): ProjectView {
  const work = entry.resume;
  const ready = work ? resumeWorkStatus(work) : null;
  const current = work ? presentResumeWork(work) : null;
  const disconnected = !!entry.disconnectedAt;
  const workspace = work?.workspace ?? null;
  const files = workspace?.files ?? workspace?.fileObservations ?? [];
  const branch = workspace?.branch?.trim();
  const commit = workspace?.commit?.trim();
  const gitAvailable =
    workspace?.status === 'checked' &&
    (Boolean(branch) || Boolean(commit) || workspace.dirty !== null);
  const sourceSummary: ProjectSourceSummary[] = [
    {
      kind: 'codebase',
      label: 'Project files',
      detail:
        workspace?.status === 'checked'
          ? files.length
            ? `StateCarry inspected ${files.length} selected project file${files.length === 1 ? '' : 's'} for this overview.`
            : 'Project files were checked for this overview.'
          : workspace?.status === 'unknown'
            ? 'StateCarry could not read the project files during the latest check.'
            : 'Project files will be checked when you update the overview.',
    },
    {
      kind: 'git',
      label: 'Git',
      detail: gitAvailable
        ? `${branch ? `Branch ${branch}` : 'Branch unavailable'}${commit ? ` · commit ${commit.slice(0, 10)}` : ''}${
            workspace.dirty === true
              ? ' · local changes present'
              : workspace.dirty === false
                ? ' · working tree clean'
                : ' · change status unavailable'
          }.`
        : workspace?.status === 'checked'
          ? 'Git is unavailable for this folder. Project files can still be checked.'
          : workspace?.status === 'unknown'
            ? 'Git could not be checked because the project folder was unavailable.'
            : 'Git will be checked when you update the overview.',
    },
    {
      kind: 'codex',
      label: 'Codex',
      detail: work?.sessionCount
        ? `${work.sessionCount} Codex conversation${work.sessionCount === 1 ? '' : 's'} included in this overview.`
        : 'No Codex conversations added. You can create an overview from project files and Git alone.',
    },
  ];
  const task = (candidate: NonNullable<typeof current>['candidates'][number]): ProjectTaskView => {
    const accepted = entry.acceptedKeys.includes(candidate.key);
    const reportedResult =
      !!candidate.completion?.reported?.length ||
      !!candidate.completion?.verified?.length ||
      candidate.status === 'done';
    const correctedAction =
      !!work?.correctedKeys.includes(candidate.key) && candidate.status === 'active';
    const status: ProjectTaskView['status'] = accepted
      ? 'accepted'
      : candidate.status === 'paused'
        ? 'paused'
        : candidate.status === 'waiting'
          ? 'waiting'
          : correctedAction
            ? 'continue'
            : reportedResult
              ? 'review'
              : candidate.status === 'active'
                ? 'continue'
                : 'unclear';
    const statusLabel = {
      continue: 'Ready to continue',
      review: 'Result to review',
      waiting: 'Waiting for input',
      paused: 'Paused',
      accepted: 'Accepted',
      unclear: 'Needs a decision',
    }[status];
    const references = [
      ...candidate.evidence,
      ...Object.values(candidate.progress ?? {}).flatMap((items) => items ?? []),
      ...Object.values(candidate.completion ?? {}).flatMap((items) => items ?? []),
    ];
    const ids = [...new Set(references.map((item) => item.revisionId))];
    const inspectableIds = ids.filter((id) => !id.startsWith('workspace-git:'));
    const evidenceKinds = new Set<ProjectSourceSummary['kind']>();
    for (const id of ids) {
      if (id.startsWith('workspace-file:')) evidenceKinds.add('codebase');
      else if (id.startsWith('workspace-git:')) evidenceKinds.add('git');
      else evidenceKinds.add('codex');
    }
    const evidenceSources = ids.length
      ? sourceSummary.filter((source) => evidenceKinds.has(source.kind))
      : sourceSummary;
    const explanation = [
      accepted
        ? 'You marked this result complete. This acceptance applies to this task, not the whole project.'
        : correctedAction && reportedResult
          ? 'An earlier result is still recorded. You corrected the next step; those earlier checks do not establish that the new step is finished.'
          : reportedResult
            ? 'A result is recorded, but your acceptance has not been recorded. Compare it with the requested outcome.'
            : 'The available project sources support this overview. The suggested next step still needs your judgment.',
      candidate.progress?.verified?.length || candidate.completion?.verified?.length
        ? 'A tool result records a check. It establishes only what that check covered; it does not establish user acceptance.'
        : 'An independent check is not recorded for this result.',
    ];
    return {
      key: candidate.key,
      title: candidate.goal,
      status,
      statusLabel,
      currentState: candidate.currentState,
      reason: candidate.reason,
      nextAction:
        accepted || status === 'paused' || status === 'waiting' ? null : candidate.nextAction,
      doneWhen: accepted
        ? 'You have accepted this task. A next objective has not been chosen here.'
        : candidate.doneWhen,
      prerequisites: [...candidate.prerequisites],
      canAct: online && !disconnected && status === 'continue' && candidate.actionAvailable,
      sourceLabel: entry.acceptedKeys.includes(candidate.key)
        ? 'Accepted by you'
        : work?.correctedKeys.includes(candidate.key)
          ? 'Corrected by you'
          : candidate.actionSource === 'suggested'
            ? 'Suggested by StateCarry'
            : 'Found in project sources',
      evidenceExplanation: explanation,
      evidenceSources,
      originals: inspectableIds.map((id, index) => ({
        id,
        label: `Open original record ${index + 1}`,
      })),
      destinationUrl: candidate.target.existing.available
        ? (candidate.target.existing.url ?? null)
        : null,
    };
  };
  const stateDescription = disconnected
    ? 'This project is disconnected. Reconnect it to check for new information.'
    : !online
      ? 'StateCarry is offline. You can read the saved overview, but actions are paused until it reconnects.'
      : work?.busy
        ? 'Updating the overview. You can keep reading the previous version.'
        : work?.error
          ? 'StateCarry could not prepare the latest overview. Your saved project information and input are still here. Try again.'
          : work?.workspaceChanged
            ? 'The project changed since this overview was updated. Update it before continuing.'
            : work?.updatesAvailable
              ? 'New project information is available. Update the overview before continuing.'
              : work?.stale || ready?.state === 'limited' || ready?.state === 'unavailable'
                ? 'Some project information could not be confirmed. Review the limits before continuing.'
                : !current?.candidates.length
                  ? 'No next step is available yet. Confirm the goal or update the overview.'
                  : 'Read the current situation and choose what to do next.';
  const firstCandidate = current?.candidates[0];
  const firstCandidateReferences = firstCandidate
    ? [
        ...firstCandidate.evidence,
        ...Object.values(firstCandidate.progress ?? {}).flatMap((items) => items ?? []),
        ...Object.values(firstCandidate.completion ?? {}).flatMap((items) => items ?? []),
      ]
    : [];
  const firstCandidateHasCodebase = firstCandidateReferences.some((reference) =>
    reference.revisionId.startsWith('workspace-file:'),
  );
  const firstCandidateHasCodex = firstCandidateReferences.some(
    (reference) =>
      !reference.revisionId.startsWith('workspace-file:') &&
      !reference.revisionId.startsWith('workspace-git:'),
  );
  const recentCommit = workspace?.recentCommits?.[0];
  const outputLanguage = work?.outputLanguage ?? 'en';
  const korean = outputLanguage === 'ko';
  const generatedRecentWork = firstCandidate?.recentWork;
  const projectState = {
    currentState: work?.busy
      ? korean
        ? 'StateCarry가 현재 프로젝트를 확인하고 있습니다.'
        : 'StateCarry is checking the project now.'
      : (firstCandidate?.currentState ??
        (work?.generatedAt
          ? korean
            ? '저장된 Overview에는 현재 이어서 진행할 작업이 없습니다.'
            : 'The saved overview has no current task to continue.'
          : korean
            ? '아직 프로젝트 Overview가 준비되지 않았습니다.'
            : 'No project overview has been created yet.')),
    recentWork:
      generatedRecentWork !== undefined
        ? (generatedRecentWork ??
          (korean
            ? '최근 의미 있는 작업 변화는 현재 Overview 근거에서 확인되지 않았습니다.'
            : 'No recent work was confirmed from the sources in this overview.'))
        : workspace?.status === 'checked'
          ? recentCommit
            ? korean
              ? `최신 커밋: ${recentCommit.subject || recentCommit.hash.slice(0, 10)}${workspace.dirty === true ? ' · 로컬 작업 트리 변경도 있습니다.' : '.'}`
              : `Latest commit: ${recentCommit.subject || recentCommit.hash.slice(0, 10)}${workspace.dirty === true ? ' · local working-tree changes are also present.' : '.'}`
            : workspace.dirty === true
              ? korean
                ? `로컬 변경사항이 있습니다${branch ? ` (${branch} 브랜치)` : ''}.`
                : `Local changes are present${branch ? ` on ${branch}` : ''}.`
              : commit
                ? korean
                  ? `Git은 ${commit.slice(0, 10)}${branch ? ` (${branch} 브랜치)` : ''}${workspace.dirty === false ? '이며 작업 트리는 깨끗합니다' : ''}.`
                  : `Git is at ${commit.slice(0, 10)}${branch ? ` on ${branch}` : ''}${workspace.dirty === false ? ' with a clean working tree' : ''}.`
                : korean
                  ? '프로젝트 폴더와 Git 상태를 확인했습니다.'
                  : 'Project files and Git were checked.'
          : korean
            ? '최근 프로젝트 파일과 Git 상태는 아직 확인되지 않았습니다.'
            : 'Recent project files and Git state have not been confirmed yet.',
    openOrUncertain: firstCandidate?.prerequisites[0]
      ? firstCandidate.prerequisites[0]
      : firstCandidate?.actionSource === 'suggested' &&
          firstCandidateHasCodex &&
          !firstCandidateHasCodebase
        ? korean
          ? '제안된 다음 단계는 Codex 대화에는 근거가 있지만, 인용된 프로젝트 파일로 확인되지는 않았습니다.'
          : 'The suggested next step is supported by Codex conversations but is not confirmed by the project files cited in this overview.'
        : work?.workspaceChanged
          ? korean
            ? '저장된 Overview가 준비된 뒤 프로젝트가 변경되었습니다.'
            : 'The project changed after the saved overview was updated.'
          : work?.stale || ready?.state === 'limited' || ready?.state === 'unavailable'
            ? korean
              ? '일부 현재 프로젝트 정보는 다시 확인해야 합니다.'
              : 'Some current project information still needs a fresh check.'
            : firstCandidate
              ? korean
                ? '선택한 프로젝트 상태에 추가로 기록된 차단 요소는 없습니다.'
                : 'No additional blockers are recorded.'
              : korean
                ? '첫 Overview에서 아직 열려 있는 항목을 확인해야 합니다.'
                : 'Create the first overview to see what remains open.',
    next:
      firstCandidate?.nextAction ??
      (work?.generatedAt
        ? korean
          ? 'StateCarry가 프로젝트를 다시 확인해야 할 때 업데이트된 Overview를 준비하세요.'
          : 'Update the overview when you want StateCarry to check the project again.'
        : korean
          ? '프로젝트 파일과 Git 상태를 바탕으로 첫 Overview를 준비하세요. 필요하면 Codex 대화를 추가할 수 있습니다.'
          : 'Create the first overview from project files and Git. Add Codex conversations if they help.'),
  };
  return {
    id: entry.workId,
    title: entry.title,
    cwd: entry.cwd,
    purpose: entry.purpose,
    focused: entry.focused,
    disconnected,
    revision: entry.revision,
    version: work?.version ?? '',
    goal: work?.goalText ?? '',
    goalConfirmed: work?.goalOrigin === 'user-input',
    stateLabel: disconnected
      ? 'Disconnected'
      : !online
        ? 'Offline'
        : work?.busy
          ? 'Updating overview'
          : ready?.canAct
            ? 'Up to date'
            : 'Needs review',
    stateDescription,
    canEdit: online && !disconnected && !work?.busy,
    canDecide: online && !disconnected && !!ready?.canAct,
    canRefresh: online && !disconnected && !work?.busy,
    generatedAt: work?.generatedAt ?? null,
    outputLanguage,
    sourceCount: work?.sessionCount ?? 0,
    sourceSummary,
    projectState,
    tasks: current?.candidates.map(task) ?? [],
    dismissed: current?.dismissed.map(task) ?? [],
  };
}
export function presentProjects(workspace: ProjectWorkspace, online = true): ProjectView[] {
  return workspace.projects
    .map((entry) => presentProject(entry, online))
    .sort(
      (a, b) =>
        Number(a.disconnected) - Number(b.disconnected) ||
        Number(b.focused) - Number(a.focused) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}
