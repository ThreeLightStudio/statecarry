import type { Checkpoint, Connection, Freshness, Link, SummaryRevision, Work } from '@statecarry/contracts';

export function assessFreshness(work: Work, connection: Connection, links: Link[], checkpoints: Checkpoint[], summary: SummaryRevision | null, now: string, configurationMatches: boolean): Freshness {
  const active = links.filter(l => l.status === 'linked');
  const scopes = active.map(l => checkpoints.find(c => c.threadId === l.threadId));
  const reasons: string[] = [];
  const elapsed = (at: string | null | undefined, limit: number) => !at || !Number.isFinite(Date.parse(at)) || Date.parse(now) - Date.parse(at) > limit;
  let collection: Freshness['collection'] = 'checked';
  if (!active.length || scopes.some(c => !c || c.status === 'failed' || elapsed(c.lastSuccessfulAt, 30000))) {
    collection = 'unknown'; reasons.push('New records since the last check have not been checked yet.');
  } else if (scopes.some(c => c?.status === 'reading')) {
    collection = 'checking'; reasons.push('Checking new records in selected conversations.');
  } else if (scopes.some(c => c?.status === 'partial')) {
    collection = 'partial'; reasons.push('Some collected records are missing or unchecked.');
  }
  if (connection.discover && (connection.discovery?.status !== 'checked' || elapsed(connection.discovery.successfulAt, 120000))) {
    if (collection === 'checked') collection = 'partial';
    reasons.push('Freshness of new conversations in the allowed folder is unknown.');
  }
  const summaryState = !summary ? 'missing' : summary.inputVersion !== work.inputVersion || !configurationMatches ? 'outdated' : 'current';
  const unresolved = links.filter(l => l.status === 'proposed' || l.status === 'deferred').length;
  if (unresolved) {
    if (collection === 'checked') collection = 'partial';
    reasons.push(`Conversations with unconfirmed relationships: ${unresolved} conversations were excluded from the summary. Check their relationship before treating this as the latest state of all the work.`);
  }
  if (!connection.discover) reasons.push('Only new records in selected conversations are checked. Continuations in other conversations are not discovered automatically.');
  if (summaryState === 'outdated') reasons.push('The displayed summary predates the current collected scope or analysis settings. Check the next action conditions again.');
  if (summaryState === 'missing') reasons.push('No evidence-checked summary is available yet.');
  const dates = scopes.flatMap(c => c?.lastSuccessfulAt ? [c.lastSuccessfulAt] : []).sort();
  return { collection, summary: summaryState, lastCollectedAt: dates.length === active.length && active.length ? dates[0] : null, reasons };
}
