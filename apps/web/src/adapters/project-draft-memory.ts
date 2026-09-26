import type {
  AnalysisMemory,
  ProjectDrafts,
  ProjectNowUiActionEntry,
  ProjectNowUiMemory,
} from '@statecarry/presentation';

const prefix = 'statecarry.project-drafts.v3.';
const retiredPrefixes = [
  'statecarry.resume.v1.',
  'statecarry.resume.v2.',
  'statecarry.work.v1.',
  'statecarry.project-action.v1.',
];
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'length' | 'key' | 'removeItem'>> & { keys?: () => Iterable<string> };
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit;
const projectNowActionKinds = new Set<ProjectNowUiActionEntry['kind']>([
  'reconnect-project',
  'review-direction',
  'review-result',
  'review-completion',
  'review-work',
  'discuss-work',
  'review-remaining-changes',
  'continue-work',
  'resume-work',
  'start-work',
  'review-work-plan',
  'review-project-policy',
  'choose-current-work',
  'choose-next-work',
  'define-direction',
  'review-release',
  'stop-work',
  'check-execution',
  'open-request',
  'respond-to-request',
  'continue-despite-direction-conflict',
]);
const projectNowModes = new Set<ProjectNowUiActionEntry['mode']>([
  'continue',
  'remaining',
  'verify',
  'policy',
  'review',
  'direction',
  'result',
  'new-work',
  'release',
]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function projectNowUi(value: unknown, id: string): ProjectNowUiMemory | undefined {
  if (!object(value) || value.projectId !== id) return undefined;
  if (
    !Number.isFinite(value.lastViewedAt) ||
    !['base', 'action'].includes(String(value.screen)) ||
    !['base', 'details', 'action', 'discussion'].includes(String(value.activity)) ||
    typeof value.resumePending !== 'boolean' ||
    !Number.isFinite(value.scroll) ||
    !text(value.basis, 2048) ||
    (value.policyConflictBasis !== null && !text(value.policyConflictBasis, 512)) ||
    typeof value.otherWorkOpen !== 'boolean' ||
    typeof value.projectContextOpen !== 'boolean' ||
    (value.selectedWorkId !== null && !text(value.selectedWorkId, 250))
  )
    return undefined;

  let actionEntry: ProjectNowUiActionEntry | null = null;
  if (value.actionEntry !== null) {
    if (!object(value.actionEntry)) return undefined;
    const entry = value.actionEntry;
    if (
      !projectNowActionKinds.has(entry.kind as ProjectNowUiActionEntry['kind']) ||
      !projectNowModes.has(entry.mode as ProjectNowUiActionEntry['mode']) ||
      ![entry.selectionKey, entry.requestId, entry.releaseId].every(
        (item) => item === null || text(item, 512),
      )
    )
      return undefined;
    actionEntry = {
      kind: entry.kind as ProjectNowUiActionEntry['kind'],
      mode: entry.mode as ProjectNowUiActionEntry['mode'],
      selectionKey: entry.selectionKey as string | null,
      requestId: entry.requestId as string | null,
      releaseId: entry.releaseId as string | null,
    };
  }

  const activity = value.activity as ProjectNowUiMemory['activity'];
  if (
    (activity === 'action' && (!actionEntry || actionEntry.kind === 'discuss-work')) ||
    (activity === 'discussion' && actionEntry?.kind !== 'discuss-work') ||
    (value.screen === 'action' && (value.resumePending || !actionEntry)) ||
    (value.screen === 'base' &&
      ((value.resumePending &&
        (!actionEntry || (activity !== 'action' && activity !== 'discussion'))) ||
        (!value.resumePending &&
          (actionEntry !== null || (activity !== 'base' && activity !== 'details')))))
  )
    return undefined;

  return {
    projectId: id,
    lastViewedAt: value.lastViewedAt as number,
    screen: value.screen as ProjectNowUiMemory['screen'],
    activity,
    resumePending: value.resumePending,
    actionEntry,
    selectedWorkId: value.selectedWorkId as string | null,
    basis: value.basis,
    policyConflictBasis: value.policyConflictBasis as string | null,
    otherWorkOpen: value.otherWorkOpen,
    projectContextOpen: value.projectContextOpen,
    scroll: Math.min(10_000_000, Math.max(0, value.scroll as number)),
  };
}

function draft(value: unknown, limit: number) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'object' ||
    !('text' in value) ||
    !('version' in value) ||
    !text(value.text, limit) ||
    !text(value.version, 512)
  )
    throw new Error('Invalid input draft');
  return { text: value.text, version: value.version };
}

/** Only unsent inputs and temporary view state are browser-owned. */
export class LocalProjectDraftMemory implements AnalysisMemory {
  private cleaned = false;
  constructor(private storage: () => DraftStorage) {}
  private keys(storage: DraftStorage): string[] {
    if (storage.keys) return [...storage.keys()];
    if (!storage.key || typeof storage.length !== 'number') return [];
    return Array.from({ length: storage.length }, (_, i) => storage.key!(i)).filter(
      (key): key is string => key !== null,
    );
  }
  private cutover(storage: DraftStorage) {
    if (this.cleaned) return;
    if (storage.removeItem)
      for (const key of this.keys(storage))
        if (retiredPrefixes.some((old) => key.startsWith(old))) storage.removeItem(key);
    this.cleaned = true;
  }
  prune(activeIds: readonly string[]) {
    const storage = this.storage();
    this.cutover(storage);
    if (!storage.removeItem) return;
    const active = new Set(activeIds);
    for (const key of this.keys(storage))
      if (key.startsWith(prefix) && !active.has(key.slice(prefix.length))) storage.removeItem(key);
  }
  read(id: string): ProjectDrafts | null {
    const storage = this.storage();
    this.cutover(storage);
    const raw = storage.getItem(`${prefix}${id}`);
    if (!raw || raw.length > 256 * 1024) return null;
    try {
      const envelope = JSON.parse(raw);
      if (envelope.schema !== 3 || envelope.projectId !== id) return null;
      return this.inputs(envelope.state, id);
    } catch {
      return null;
    }
  }
  private inputs(value: ProjectDrafts, id: string): ProjectDrafts {
    if (
      !value ||
      !Array.isArray(value.actionDrafts) ||
      !Array.isArray(value.expanded) ||
      !Number.isFinite(value.scroll)
    )
      throw new Error('Invalid project input');
    return {
      goalDraft: draft(value.goalDraft, 1200),
      goalDiscussionDraft: draft(value.goalDiscussionDraft, 6000),
      actionDrafts: value.actionDrafts.slice(-50).map(([key, item]) => {
        if (
          !text(key, 250) ||
          !item ||
          !text(item.action, 2000) ||
          !text(item.done, 2000) ||
          !text(item.version, 512)
        )
          throw new Error('Invalid action input');
        return [key, { action: item.action, done: item.done, version: item.version }];
      }),
      taskDiscussions: (value.taskDiscussions ?? []).slice(-50).map(([key, item]) => {
        if (!text(key, 250) || !item || !text(item.input, 2000) || !text(item.version, 512))
          throw new Error('Invalid discussion input');
        return [key, { input: item.input, version: item.version, turns: [] }];
      }),
      ...(projectNowUi(value.projectNowUi, id)
        ? { projectNowUi: projectNowUi(value.projectNowUi, id) }
        : {}),
      expanded: value.expanded.slice(-30).filter((key) => text(key, 100)),
      scroll: Math.max(0, value.scroll),
    };
  }
  write(id: string, value: ProjectDrafts) {
    const storage = this.storage();
    this.cutover(storage);
    const inputs = this.inputs(value, id);
    // Runtime turns are hydrated from Core; they never enter browser storage.
    const state = {
      ...inputs,
      taskDiscussions: inputs.taskDiscussions?.map(([key, item]) => [
        key,
        { input: item.input, version: item.version },
      ]),
    };
    storage.setItem(`${prefix}${id}`, JSON.stringify({ schema: 3, projectId: id, state }));
  }
}
