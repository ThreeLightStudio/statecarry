import type { AnalysisMemory, ProjectDrafts } from '@statecarry/presentation';

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
      return this.inputs(envelope.state);
    } catch {
      return null;
    }
  }
  private inputs(value: ProjectDrafts): ProjectDrafts {
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
      expanded: value.expanded.slice(-30).filter((key) => text(key, 100)),
      scroll: Math.max(0, value.scroll),
    };
  }
  write(id: string, value: ProjectDrafts) {
    const storage = this.storage();
    this.cutover(storage);
    const inputs = this.inputs(value);
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
