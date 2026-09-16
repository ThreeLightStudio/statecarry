import type { ResumeMemory, SavedResumeEdits } from '@statecarry/presentation';

const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length <= limit;

const prefix = 'statecarry.resume.v1.';
const draftPrefixes = [prefix, 'statecarry.work.v1.'];
type ResumeStorage = Pick<Storage, 'getItem' | 'setItem'> &
  Partial<Pick<Storage, 'length' | 'key' | 'removeItem'>> & { keys?: () => Iterable<string> };

/** A separate namespace keeps Resume drafts independent of legacy detail edits. */
export class LocalResumeMemory implements ResumeMemory {
  constructor(private storage: () => ResumeStorage) {}

  private key(id: string) {
    return `${prefix}${id}`;
  }

  prune(activeIds: readonly string[]) {
    const storage = this.storage();
    // Minimal read/write storage adapters remain usable without cleanup support.
    if (!storage.removeItem) return;
    let keys: string[];
    if (storage.keys) keys = [...storage.keys()];
    else if (storage.key && typeof storage.length === 'number') {
      keys = [];
      const length = storage.length;
      for (let index = 0; index < length; index++) {
        const key = storage.key(index);
        if (key !== null) keys.push(key);
      }
    } else return;

    // Snapshot enumeration before removing anything; indexed Storage keys shift
    // on removal. Enumeration/removal errors reach the caller's persistence UI.
    const active = new Set(activeIds);
    for (const key of keys) {
      const namespace = draftPrefixes.find((candidate) => key.startsWith(candidate));
      if (!namespace) continue;
      const id = key.slice(namespace.length);
      if (id && !active.has(id)) storage.removeItem(key);
    }
  }

  read(id: string): SavedResumeEdits | null {
    // Storage access failures reach the UI; malformed/obsolete values are ignored.
    const raw = this.storage().getItem(this.key(id));
    if (!raw || raw.length > 256 * 1024) return null;
    try {
      const envelope = JSON.parse(raw);
      const value = envelope?.state;
      if (
        envelope?.schema !== 1 ||
        envelope.workId !== id ||
        !value ||
        (value.selectedKey !== undefined && !text(value.selectedKey, 160)) ||
        !Array.isArray(value.actionDrafts) ||
        value.actionDrafts.length > 50 ||
        !Array.isArray(value.expanded) ||
        value.expanded.length > 30 ||
        !value.expanded.every((key: unknown) => text(key, 100)) ||
        !Number.isFinite(value.scroll) ||
        value.scroll < 0
      )
        return null;
      if (
        value.goalDraft !== null &&
        (!value.goalDraft ||
          !text(value.goalDraft.text, 400) ||
          !text(value.goalDraft.version, 512))
      )
        return null;
      if (
        !value.actionDrafts.every(
          (entry: unknown) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            text(entry[0], 160) &&
            entry[1] &&
            text(entry[1].action, 1200) &&
            text(entry[1].done, 1200) &&
            text(entry[1].version, 512),
        )
      )
        return null;
      // Copy an allowlist, not arbitrary parsed server/state fields.
      return {
        ...(value.selectedKey !== undefined ? { selectedKey: value.selectedKey } : {}),
        goalDraft: value.goalDraft && {
          text: value.goalDraft.text,
          version: value.goalDraft.version,
        },
        actionDrafts: value.actionDrafts.map(
          ([key, draft]: SavedResumeEdits['actionDrafts'][number]) => [
            key,
            { action: draft.action, done: draft.done, version: draft.version },
          ],
        ),
        expanded: [...value.expanded],
        scroll: value.scroll,
      };
    } catch {
      return null;
    }
  }

  write(id: string, value: SavedResumeEdits) {
    const state: SavedResumeEdits = {
      ...(value.selectedKey !== undefined ? { selectedKey: value.selectedKey } : {}),
      goalDraft: value.goalDraft && {
        text: value.goalDraft.text,
        version: value.goalDraft.version,
      },
      actionDrafts: value.actionDrafts
        .slice(-50)
        .map(([key, draft]) => [
          key,
          { action: draft.action, done: draft.done, version: draft.version },
        ]),
      expanded: value.expanded.slice(-30),
      scroll: Math.max(0, value.scroll),
    };
    this.storage().setItem(this.key(id), JSON.stringify({ schema: 1, workId: id, state }));
  }
}
