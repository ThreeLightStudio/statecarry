import type { ProjectDeletionPreview } from '@statecarry/contracts';
import type { Entities } from './ports';
import type { StateCarry } from './service';

// Receipts contain no project content and remain as the minimal request ledger.
// Enumerating every content kind makes additions to repository storage explicit.
const contentKinds = {
  work: true,
  connection: true,
  link: true,
  checkpoint: true,
  summary: true,
  overlay: true,
  draft: true,
  visit: true,
  job: true,
  handoff: true,
  continuation: true,
  explanation: true,
  explanationJob: true,
  questionExecution: true,
} satisfies Record<Exclude<keyof Entities, 'source' | 'receipt'>, true>;
type ContentKind = keyof typeof contentKinds;
type ContentRow = { kind: ContentKind; entity: Entities[ContentKind]; owner: string };

function contentRows(core: StateCarry): ContentRow[] {
  return (Object.keys(contentKinds) as ContentKind[]).flatMap((kind) =>
    core.repo
      .list(kind)
      .map((entity) => ({
        kind,
        entity,
        owner:
          kind === 'work'
            ? entity.id
            : 'workId' in entity
              ? entity.workId
              : (entity as Entities['handoff']).target.workId,
      })),
  );
}

function references(value: unknown, sourceIds: Set<string>, found: Set<string>): void {
  if (typeof value === 'string') {
    if (sourceIds.has(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) references(item, sourceIds, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) references(item, sourceIds, found);
  }
}

/** A read-only deletion footprint. Commit recomputes it inside the transaction. */
export function projectDeletionPlan(core: StateCarry, workId: string) {
  const work = core.work(workId);
  const rows = contentRows(core);
  const owned = rows.filter((row) => row.owner === workId);
  const sources = core.repo.list('source');
  const sourceIds = new Set(sources.map((source) => source.id));
  const owners = new Map<string, Set<string>>();
  const threads = new Map<string, Set<string>>();
  const claim = (map: Map<string, Set<string>>, key: string, owner: string) => {
    const existing = map.get(key) ?? new Set<string>();
    existing.add(owner);
    map.set(key, existing);
  };
  for (const row of rows) {
    const found = new Set<string>();
    references(row.entity, sourceIds, found);
    for (const id of found) claim(owners, id, row.owner);
    // Historical revisions may have fallen out of the latest checkpoint.
    // A registration of the same conversation conservatively protects them,
    // including disconnected projects and retained links outside current scope.
    if (row.kind === 'connection') {
      for (const id of (row.entity as Entities['connection']).threadIds)
        claim(threads, id, row.owner);
    } else if (row.kind === 'link' || row.kind === 'checkpoint') {
      claim(threads, (row.entity as Entities['link']).threadId, row.owner);
    }
  }
  for (const source of sources)
    for (const owner of threads.get(source.threadId) ?? []) claim(owners, source.id, owner);
  const associated = sources.filter((source) => owners.get(source.id)?.has(workId));
  const exclusive = associated.filter((source) => owners.get(source.id)!.size === 1);
  const shared = associated.filter((source) => owners.get(source.id)!.size > 1);
  const unknown =
    owned.some(({ entity }) => 'status' in entity && entity.status === 'result-unknown') ||
    owned.some(({ entity }) => 'state' in entity && entity.state === 'result-unknown');
  const busy =
    core.hasProjectActivity(workId) ||
    owned.some(
      ({ kind, entity }) =>
        (kind === 'checkpoint' && 'status' in entity && entity.status === 'reading') ||
        (kind === 'job' &&
          'status' in entity &&
          ['queued', 'summarizing', 'checking', 'result-unknown'].includes(entity.status)) ||
        ((kind === 'handoff' || kind === 'continuation') &&
          'state' in entity &&
          ['dispatching', 'opening', 'result-unknown'].includes(entity.state)),
    );
  const blocked = busy || unknown;
  const preview: ProjectDeletionPreview = {
    workId,
    title: work.projectProfile?.title ?? work.title,
    revision: work.revision,
    token: core.ids.hash({
      policy: 'project-deletion-v1',
      workId,
      revision: work.revision,
      rows: owned
        .map(({ kind, entity }) => [kind, entity.id, core.ids.hash(entity)])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      sources: associated
        .map((source) => [source.id, [...owners.get(source.id)!].sort(), core.ids.hash(source)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      blocked,
    }),
    ownedRecords: owned.length,
    exclusiveSources: exclusive.length,
    sharedSources: shared.length,
    blocked,
    explanation: unknown
      ? 'A previous action has not been confirmed to have finished. Check its status before deleting this project.'
      : busy
        ? 'A record check, answer, or action is still pending. Review deletion again after it finishes; nothing has been deleted.'
        : 'This permanently removes this project’s database records and exclusive source copies. It cannot be restored. Original files and conversations, and source copies used by other projects, stay unchanged. Minimal request receipts remain to prevent repeated actions. Separate activity logs (observations.jsonl), analysis diagnostic files, and backups are not removed.',
  };
  return { preview, rows: owned, exclusive };
}
