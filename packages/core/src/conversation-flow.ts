import type {
  ConversationFlow,
  ConversationFlowItem,
  SourceRevision,
  SummaryRevision,
} from '@statecarry/contracts';

// Pure projection of an already checked summary. No generation, writes or current-source substitution.
export function conversationFlows(
  summary: SummaryRevision | null,
  sourceById: (id: string) => SourceRevision | null,
): ConversationFlow[] {
  if (!summary) return [];
  const input = new Set(summary.sourceRevisionIds);
  const sources = new Map(summary.sourceRevisionIds.map((id) => [id, sourceById(id)]));
  const items: ConversationFlowItem[] = summary.claims.map((claim) => {
    const limitations: string[] = [];
    const checks = summary.checks?.checks.filter((check) => check.claimId === claim.id) ?? [];
    if (claim.verdict !== 'supported' || checks.length !== 1 || checks[0].verdict !== 'supported')
      limitations.push('The claim meaning check is incomplete.');
    if (!claim.text || claim.missing) limitations.push('This stage is missing or uncertain.');
    if (!claim.evidence.length) limitations.push('The cited source is missing.');
    const refs = claim.evidence.map((ref) => {
      const source = input.has(ref.revisionId) ? sources.get(ref.revisionId) : null;
      const quoteStarts: number[] = [];
      if (source && ref.quote) {
        let at = source.text.indexOf(ref.quote);
        while (at !== -1) {
          quoteStarts.push(at);
          at = source.text.indexOf(ref.quote, at + 1);
        }
      }
      if (!input.has(ref.revisionId))
        limitations.push('The citation is outside the displayed summary input.');
      else if (!source)
        limitations.push('That source version is missing or outside the current access scope.');
      if (source && !quoteStarts.length)
        limitations.push('The quote was not found in that source version.');
      if (
        source &&
        ['user-decision', 'user-request'].includes(claim.nature) &&
        source.actor !== 'user'
      )
        limitations.push('Not confirmed as a user statement.');
      if (source && claim.nature === 'tool-result' && source.actor !== 'tool')
        limitations.push('Not confirmed by a tool execution result.');
      return {
        ...ref,
        quoteStarts,
        available: !!source,
        threadId: source?.threadId ?? null,
        turnId: source?.turnId ?? null,
        itemId: source?.itemId ?? null,
        actor: source?.actor ?? null,
        eventAt: source?.eventAt ?? null,
        observedAt: source?.observedAt ?? null,
        locator: source?.locator ?? null,
      };
    });
    const supported = limitations.length === 0;
    for (const ref of refs) {
      const source = sources.get(ref.revisionId);
      if (!ref.eventAt) limitations.push('Send time unknown');
      if (!ref.locator?.path) limitations.push('Local location unknown');
      limitations.push(...(source?.limitations ?? []));
    }
    return {
      id: `flow-item:${JSON.stringify([summary.id, claim.id])}`,
      claimId: claim.id,
      type: claim.nature,
      summary: claim.text ?? 'This stage is unconfirmed.',
      condition: claim.condition,
      status: supported ? 'supported' : 'limited',
      checkReason: claim.checkReason,
      limitations: [...new Set(limitations)],
      sources: refs,
    };
  });
  return summary.claims.map((claim, index) => {
    const anchor = items[index];
    const signature = (item: ConversationFlowItem) =>
      JSON.stringify([
        item.type,
        item.summary,
        item.condition,
        item.sources.map((ref) => [ref.revisionId, ref.quote]).sort(),
      ]);
    const seen = new Set([signature(anchor)]);
    const related =
      ['current', 'next', 'reason'].includes(claim.slot) && anchor.status === 'supported'
        ? items.filter((item) => {
            if (
              item === anchor ||
              item.status !== 'supported' ||
              !item.sources.some((ref) =>
                anchor.sources.some((a) => a.revisionId === ref.revisionId),
              )
            )
              return false;
            const key = signature(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
        : [];
    return {
      id: `flow:${JSON.stringify([summary.id, claim.id])}`,
      summaryId: summary.id,
      sourceRevisionIds: [...summary.sourceRevisionIds],
      claimId: claim.id,
      items: [...related, anchor],
      limitations: [...summary.limitations],
    };
  });
}
