import type { SourceRevision, SummaryCoverage, SummaryRevision } from '@statecarry/contracts';

export function summaryCoverage(
  sources: SourceRevision[],
  summary: SummaryRevision | null,
  get: (id: string) => SourceRevision | null,
  accessibleThreads: Set<string>,
): SummaryCoverage {
  const reflectedIds = summary?.sourceRevisionIds ?? [],
    reflected = new Set(reflectedIds),
    current = new Set(sources.map((s) => s.id));
  const previous = reflectedIds.flatMap((id) => {
    const s = get(id);
    return s ? [s] : [];
  });
  const byKey = new Map(previous.map((s) => [s.key, s]));
  const currentKeys = new Set(sources.map((s) => s.key));
  const entries = new Map([...previous, ...sources].map((s) => [s.id, s]));
  return {
    capturedAt: summary?.inputCapturedAt ?? null,
    reflectedIds,
    pendingIds: sources.filter((s) => !reflected.has(s.id)).map((s) => s.id),
    updated: sources.flatMap((s) => {
      const old = byKey.get(s.key);
      return old && old.id !== s.id ? [{ previousId: old.id, currentId: s.id }] : [];
    }),
    absentIds: reflectedIds.filter(
      (id) => !current.has(id) && (!get(id) || !currentKeys.has(get(id)!.key)),
    ),
    entries: [...entries.values()].map((s) => ({
      id: s.id,
      threadId: s.threadId,
      turnId: s.turnId,
      itemId: s.itemId,
      eventAt: s.eventAt,
      observedAt: s.observedAt,
      accessible: accessibleThreads.has(s.threadId),
    })),
  };
}
