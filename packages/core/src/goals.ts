import { DomainError, type Connection, type GoalCandidate, type SourceRevision } from '@statecarry/contracts';
import { relationshipEvidence } from './checks';
import type { StateCarry } from './service';

export function selectedRecords(connection: Connection, threadId: string, input: SourceRevision[]) {
  let records = input;
  const turn = connection.startTurnIds[threadId] ?? connection.discoveryScope?.startTurnIds[threadId];
  if (turn) {
    const at = records.findIndex(s => s.turnId === turn);
    if (at < 0) throw new DomainError('SOURCE_UNAVAILABLE', 'Selected start turn is missing; review scope.');
    const earlierTurns = new Set(records.slice(0, at).map(s => s.turnId));
    records = records.slice(at).filter(s => !earlierTurns.has(s.turnId));
  }
  const range = connection.recordRanges?.[threadId] ?? connection.discoveryScope?.recordRanges[threadId];
  if (!range) return records;
  const matches = (p: typeof range.start) => records.flatMap((s, i) => s.turnId === p.turnId && s.itemId === p.itemId ? [i] : []);
  const starts = matches(range.start), ends = range.end ? matches(range.end) : [records.length - 1];
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) throw new DomainError('SOURCE_UNAVAILABLE', 'Selected record boundary is missing or ambiguous; review scope. Selection was not expanded.');
  return records.slice(starts[0], ends[0] + 1);
}

const goalExpression = /목표|확인해|정리해|만들어|구현해|goal|please (?:check|build|implement)|check .*export/i;
const separateExpression = /별개|다른 목표|돌아가|복귀|separate|another goal|return to|back to/i;
const point = (s: SourceRevision) => ({ turnId: s.turnId, itemId: s.itemId });
export function goalCandidates(core: StateCarry, workId: string): GoalCandidate[] {
  const work = core.work(workId), sources = core.sources(workId), previous = work.goalCandidates ?? [];
  if (work.goal) return [];
  const result: GoalCandidate[] = [];
  for (const threadId of new Set(sources.map(s => s.threadId))) {
    const records = sources.filter(s => s.threadId === threadId);
    const anchors = records.flatMap((s, i) => s.actor === 'user' && (goalExpression.test(s.text) || separateExpression.test(s.text)) ? [i] : []);
    for (const [index, at] of anchors.entries()) {
      const source = records[at];
      if (/복귀|돌아가|return to|back to/i.test(source.text)) continue;
      if (result.some(c => c.quote.replace(/\s+/g, ' ').trim() === source.text.slice(0, 1200).replace(/\s+/g, ' ').trim())) continue;
      if (relationshipEvidence([source], [...new Set(sources.map(s => s.threadId))]).length) continue;
      const id = core.ids.hash(['goal-candidate', workId, source.key]);
      const old = previous.find(c => c.id === id);
      const end = anchors[index + 1];
      result.push(old?.evidenceId === source.id ? old : { id, title: source.text.split(/(?<=[.!?。])\s/)[0].slice(0, 120), quote: source.text.slice(0, 1200), evidenceId: source.id, threadId,
        range: { start: point(source), ...(end === undefined ? {} : { end: point(records[end - 1]) }) }, status: /실험|experiment/i.test(source.text) && /중단|stop|abandon/i.test(source.text) ? 'dismissed' : 'proposed' });
    }
  }
  // Decisions survive re-analysis; inaccessible candidates are never returned.
  return result;
}

export function dedicatedRelationship(records: SourceRevision[], knownIds: string[]) {
  const evidence = relationshipEvidence(records, knownIds);
  if (!evidence.length) return [];
  const first = records.find(s => s.actor === 'user');
  if (!first || !evidence.some(s => s.id === first.id)) return [];
  if (/별개|다른 목표|별도로|추가로|another goal|and also|separately/i.test(first.text)) return [];
  // A later explicit switch requires a bounded selection, never a whole-session merge.
  if (records.some(s => s.actor === 'user' && s.id !== first.id && (separateExpression.test(s.text) || goalExpression.test(s.text) && !/이 목표|같은 목표|same goal|same task/i.test(s.text) && !relationshipEvidence([s], knownIds).length))) return [];
  return evidence;
}

export function relationshipKind(records: SourceRevision[]): import('@statecarry/contracts').GoalRelation['kind'] {
  const text = records.filter(s => s.actor === 'user').map(s => s.text).join(' ');
  if (/보류|하기로 결정|defer|decided|put on hold/i.test(text)) return 'decision-change';
  if (/병렬|parallel/i.test(text)) return 'parallel';
  if (/재검증|recheck|retest/i.test(text)) return 'recheck';
  return records.length ? 'followup' : 'unclear';
}
