import { vi } from 'vitest';
import type {
  ProjectGateway,
  ProjectNowBundle,
  ProjectWorkspace,
  ProjectWorkspaceEntry,
} from '@statecarry/presentation';
const now = '2026-09-21T00:00:00Z';
export function projectNowBundle(entry: ProjectWorkspaceEntry): ProjectNowBundle {
  const explicitDirection =
    !!entry.analysis?.goalText && entry.analysis.goalOrigin === 'user-input'
      ? {
          id: `direction-${entry.projectId}`,
          projectId: entry.projectId,
          text: entry.analysis.goalText,
          state: 'active' as const,
          primary: true,
          origin: 'user' as const,
          confirmed: true,
          createdAt: now,
        }
      : null;
  const model: ProjectNowBundle['model'] = {
    project: {
      id: entry.projectId,
      connectionId: entry.connectionId,
      title: entry.title,
      cwd: entry.cwd,
      purposes: entry.purpose
        ? [
            {
              id: `purpose-${entry.projectId}`,
              text: entry.purpose,
              origin: 'user',
              confirmed: true,
            },
          ]
        : [],
      focused: entry.focused,
      iconAsset: entry.iconAsset ?? null,
      bannerAsset: entry.bannerAsset ?? null,
      lifecycle: entry.disconnectedAt ? 'disconnected' : 'active',
      revision: entry.revision,
      createdAt: now,
    },
    directions: explicitDirection ? [explicitDirection] : [],
    workItems: [],
    relations: [],
    decisions: [],
    returnPoints: [],
    discussions: [],
    latestObservation: null,
  };
  const projectNow: ProjectNowBundle['now'] = entry.disconnectedAt
    ? {
        projectId: entry.projectId,
        primaryDirectionId: explicitDirection?.id ?? null,
        currentWorkId: null,
        currentWorkSelection: null,
        state: 'disconnected',
        currentState: 'The project is disconnected, so its current state cannot be checked.',
        uncertainty: 'Only the last saved StateCarry context is available.',
        next: { kind: 'reconnect-project', text: 'Reconnect this project.' },
        secondaryActions: [],
        notice: null,
        otherWorkCount: 0,
        otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
        otherWorkCandidates: [],
        freshness: 'unknown',
        proposalMatches: [],
      }
    : explicitDirection
      ? {
          projectId: entry.projectId,
          primaryDirectionId: explicitDirection.id,
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'complete',
          currentState: 'The current direction is active, but no durable work is selected.',
          uncertainty: null,
          next: { kind: 'choose-next-work', text: 'Decide the next work for this direction.' },
          secondaryActions: [],
          notice: null,
          otherWorkCount: 0,
          otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [],
          freshness: 'unknown',
          proposalMatches: [],
        }
      : {
          projectId: entry.projectId,
          primaryDirectionId: null,
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'needs-direction',
          currentState: 'No confirmed current direction is available.',
          uncertainty: null,
          next: { kind: 'define-direction', text: 'Confirm or define the current direction.' },
          secondaryActions: [],
          notice: null,
          otherWorkCount: 0,
          otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [],
          freshness: 'unknown',
          proposalMatches: [],
        };
  return { initialized: true, model, now: projectNow };
}

export function requiredProjectGateway(
  read: () => ProjectWorkspace,
): Pick<
  ProjectGateway,
  | 'registrations'
  | 'now'
  | 'initialize'
  | 'execution'
  | 'selectProposal'
  | 'selectWork'
  | 'createWork'
  | 'pauseWork'
  | 'resumeWork'
  | 'completeWork'
  | 'stopWork'
  | 'syncDiscussion'
  | 'workspace'
  | 'observe'
  | 'analyzeWorkspace'
> {
  const bundle = (id: string) => {
    const entry = read().projects.find((project) => project.projectId === id);
    if (!entry) throw new Error('Project not found');
    return structuredClone(projectNowBundle(entry));
  };
  const unavailable = async () => {
    throw new Error('This test has not configured that project action.');
  };
  const workspace = async (id: string) =>
    read().projects.find((entry) => entry.projectId === id)?.analysis?.workspace ?? {
      cwd: '/synthetic',
      branch: null,
      commit: null,
      dirty: null,
      status: 'unknown' as const,
      checkedAt: now,
      limitations: [],
    };
  return {
    registrations: vi.fn(async () => ({
      projects: read().projects.map(
        ({
          analysis: _analysis,
          acceptedKeys: _accepted,
          pausedKeys: _paused,
          collecting: _collecting,
          ...entry
        }) => structuredClone(entry),
      ),
    })),
    now: vi.fn(async (id) => bundle(id)),
    initialize: vi.fn(async (id) => bundle(id)),
    execution: vi.fn(unavailable),
    selectProposal: vi.fn(unavailable),
    selectWork: vi.fn(unavailable),
    createWork: vi.fn(unavailable),
    pauseWork: vi.fn(unavailable),
    resumeWork: vi.fn(unavailable),
    completeWork: vi.fn(unavailable),
    stopWork: vi.fn(unavailable),
    syncDiscussion: vi.fn(unavailable),
    workspace: vi.fn(workspace),
    observe: vi.fn(workspace),
    analyzeWorkspace: vi.fn(workspace),
  };
}
