import {
  workDecisionKinds,
  type WorkItem,
  type WorkProposal,
  type WorkProposalMatch,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

type ProposalIdentity = Pick<WorkProposal, 'key' | 'source' | 'evidenceBasis'>;

function sameIdentity(left: ProposalIdentity, right: ProposalIdentity) {
  return (
    left.key === right.key &&
    left.source === right.source &&
    left.evidenceBasis === right.evidenceBasis
  );
}

function sameHistoryEntry(
  left: {
    key: string;
    source: WorkProposal['source'];
    evidenceBasis: string | null;
    proposal?: WorkProposal;
  },
  right: {
    key: string;
    source: WorkProposal['source'];
    evidenceBasis: string | null;
    proposal?: WorkProposal;
  },
) {
  return (
    sameIdentity(left, right) &&
    JSON.stringify(left.proposal ?? null) === JSON.stringify(right.proposal ?? null)
  );
}

type ProposalEvidenceContext = Pick<
  WorkProposal,
  'title' | 'currentState' | 'uncertainty' | 'nextAction' | 'doneWhen' | 'evidenceQuotes'
>;

function normalizedClaim(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.!?。！？]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function proposalClaims(proposal: ProposalEvidenceContext): string[] {
  return [proposal.title, proposal.currentState, proposal.uncertainty ?? '']
    .map(normalizedClaim)
    .filter(Boolean);
}

function proposalsShareExactClaim(left: ProposalEvidenceContext, right: ProposalEvidenceContext) {
  const rightClaims = new Set(proposalClaims(right));
  return proposalClaims(left).some((claim) => rightClaims.has(claim));
}

export function proposalsShareVerifiedQuote(
  left: Pick<WorkProposal, 'evidenceQuotes'>,
  right: Pick<WorkProposal, 'evidenceQuotes'>,
): boolean {
  const leftQuotes = left.evidenceQuotes ?? [];
  const rightQuotes = right.evidenceQuotes ?? [];
  return leftQuotes.some((leftQuote) =>
    rightQuotes.some(
      (rightQuote) =>
        leftQuote.revisionId === rightQuote.revisionId && leftQuote.quote === rightQuote.quote,
    ),
  );
}

function linkedEvidenceQuotes(decision: {
  value: Record<string, unknown>;
}): Array<{ revisionId: string; quote: string }> {
  const value = decision.value.proposalEvidenceQuotes;
  return Array.isArray(value)
    ? value.filter(
        (item): item is { revisionId: string; quote: string } =>
          !!item &&
          typeof item === 'object' &&
          typeof item.revisionId === 'string' &&
          typeof item.quote === 'string',
      )
    : [];
}

function savedProposalContext(decision: {
  value: Record<string, unknown>;
}): ProposalEvidenceContext | null {
  const quotes = linkedEvidenceQuotes(decision);
  const saved = decision.value.proposalEvidenceContext;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const context = saved as Record<string, unknown>;
  if (typeof context.title !== 'string' || typeof context.currentState !== 'string') return null;
  return {
    title: context.title,
    currentState: context.currentState,
    uncertainty: typeof context.uncertainty === 'string' ? context.uncertainty : null,
    nextAction: typeof context.nextAction === 'string' ? context.nextAction : null,
    doneWhen: typeof context.doneWhen === 'string' ? context.doneWhen : null,
    evidenceQuotes: quotes,
  };
}

function sharesLinkedEvidence(
  proposal: WorkProposal,
  decision: { value: Record<string, unknown> },
): boolean {
  const savedProposal = savedProposalContext(decision);
  return (
    !!savedProposal &&
    proposalsShareVerifiedQuote(proposal, savedProposal) &&
    proposalsShareExactClaim(proposal, savedProposal)
  );
}

function sharesValidatedTreeIdentity(
  proposal: WorkProposal,
  decision: { value: Record<string, unknown> },
): boolean {
  const savedProposal = savedProposalContext(decision);
  return (
    proposal.source === 'working-tree-group' &&
    decision.value.proposalSource === proposal.source &&
    decision.value.proposalKey === proposal.key &&
    proposal.key.startsWith('working-tree:') &&
    proposal.key !== 'working-tree:all' &&
    !!savedProposal &&
    proposalsShareVerifiedQuote(proposal, savedProposal)
  );
}

function savedRelatedTreeEvidence(decision: {
  value: Record<string, unknown>;
}): Array<{ key: string; evidenceQuotes: Array<{ revisionId: string; quote: string }> }> {
  const value = decision.value.proposalRelatedProposals;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      (item as Record<string, unknown>).source !== 'working-tree-group' ||
      typeof (item as Record<string, unknown>).key !== 'string'
    )
      return [];
    const evidenceQuotes = (item as Record<string, unknown>).evidenceQuotes;
    return [
      {
        key: (item as Record<string, unknown>).key as string,
        evidenceQuotes: Array.isArray(evidenceQuotes)
          ? evidenceQuotes.filter(
              (quote): quote is { revisionId: string; quote: string } =>
                !!quote &&
                typeof quote === 'object' &&
                typeof quote.revisionId === 'string' &&
                typeof quote.quote === 'string',
            )
          : [],
      },
    ];
  });
}

function sharesSavedTreeBridge(
  proposal: WorkProposal,
  decision: { value: Record<string, unknown> },
  currentProposals: WorkProposal[],
): boolean {
  if (proposal.source !== 'analysis-candidate') return false;
  const savedProposal = savedProposalContext(decision);
  if (!savedProposal || !proposalsShareVerifiedQuote(proposal, savedProposal)) return false;
  return savedRelatedTreeEvidence(decision).some((savedTree) => {
    const currentTree = currentProposals.find(
      (candidate) => candidate.source === 'working-tree-group' && candidate.key === savedTree.key,
    );
    return (
      !!currentTree &&
      currentTree.relatedProposalKeys?.includes(proposal.key) === true &&
      proposalsShareVerifiedQuote(savedTree, currentTree) &&
      proposalsShareVerifiedQuote(savedProposal, savedTree) &&
      proposalsShareVerifiedQuote(proposal, currentTree)
    );
  });
}

function proposalIdentity(proposal: WorkProposal): ProposalIdentity {
  return { key: proposal.key, source: proposal.source, evidenceBasis: proposal.evidenceBasis };
}

type ProposalMatchState = { proposal: WorkProposal; linkedWorkIds: Set<string> };

function sameExplicitWork(left: ProposalMatchState, right: ProposalMatchState): boolean {
  return (
    left.linkedWorkIds.size === 1 &&
    right.linkedWorkIds.size === 1 &&
    [...left.linkedWorkIds][0] === [...right.linkedWorkIds][0]
  );
}

function connectedProposals(left: ProposalMatchState, right: ProposalMatchState): boolean {
  return (
    sameExplicitWork(left, right) ||
    (left.proposal.source !== right.proposal.source &&
      (left.proposal.relatedProposalKeys?.includes(right.proposal.key) === true ||
        right.proposal.relatedProposalKeys?.includes(left.proposal.key) === true) &&
      proposalsShareVerifiedQuote(left.proposal, right.proposal))
  );
}

export class WorkMatcher {
  constructor(private core: StateCarry) {}

  private currentWorkingTreeBasis(projectId: string): string | null {
    const observation = this.core.projects.latestObservation(projectId);
    return observation?.snapshot.status === 'checked' && observation.snapshot.dirty === true
      ? observation.semanticKey
      : null;
  }

  private currentAnalysisBasis(projectId: string): string | null {
    try {
      return this.core.analyses.currentProposalBasis(projectId);
    } catch {
      // A failed or unavailable brief must not become a current work proposal.
      return null;
    }
  }

  proposalOutputLanguage(projectId: string, proposal: WorkProposal): 'en' | 'ko' | null {
    return (
      this.core.repo
        .list('workProposal')
        .find(
          (record) =>
            record.projectId === projectId &&
            sameIdentity(record.proposal, proposalIdentity(proposal)),
        )?.outputLanguage ?? null
    );
  }

  replaceProposals(
    projectId: string,
    source: WorkProposal['source'],
    proposals: WorkProposal[],
    outputLanguage: 'en' | 'ko',
  ): boolean {
    const previous = this.core.repo
      .list('workProposal')
      .filter((record) => record.projectId === projectId && record.proposal.source === source)
      .sort((a, b) => a.id.localeCompare(b.id));
    const next = [...proposals]
      .map((proposal) => {
        const previousForProposal = previous.filter(
          (record) => record.proposal.key === proposal.key,
        );
        const history = previousForProposal.flatMap((record) => [
          ...(record.history ?? []),
          {
            key: record.proposal.key,
            source: record.proposal.source,
            evidenceBasis: record.proposal.evidenceBasis,
            proposal: record.proposal,
          },
        ]);
        const current = {
          key: proposal.key,
          source: proposal.source,
          evidenceBasis: proposal.evidenceBasis,
        };
        return {
          id: this.core.ids.hash([projectId, proposal.key]),
          proposal,
          history: history.filter(
            (identity, index) =>
              !sameHistoryEntry(identity, { ...current, proposal }) &&
              history.findIndex((other) => sameHistoryEntry(other, identity)) === index,
          ),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    if (
      previous.length === next.length &&
      previous.every(
        (record, index) =>
          record.outputLanguage === outputLanguage &&
          record.id === next[index].id &&
          JSON.stringify(record.proposal) === JSON.stringify(next[index].proposal) &&
          JSON.stringify(record.history ?? []) === JSON.stringify(next[index].history),
      )
    )
      return false;
    this.core.repo.transaction(() => {
      for (const record of this.core.repo.list('workProposal'))
        if (record.projectId === projectId && record.proposal.source === source)
          this.core.repo.remove('workProposal', record.id);
      for (const { id, proposal, history } of next)
        this.core.repo.put('workProposal', {
          id,
          projectId,
          proposal,
          outputLanguage,
          generatedAt: this.core.clock.now(),
          ...(history.length > 0 ? { history } : {}),
        });
    });
    return true;
  }
  proposals(projectId: string): WorkProposal[] {
    this.core.project(projectId);
    const workingTreeBasis = this.currentWorkingTreeBasis(projectId);
    const analysisBasis = this.currentAnalysisBasis(projectId);
    return this.core.repo
      .list('workProposal')
      .filter(
        (record) =>
          record.projectId === projectId &&
          (record.proposal.source === 'working-tree-group'
            ? workingTreeBasis !== null && record.proposal.evidenceBasis === workingTreeBasis
            : analysisBasis !== null && record.proposal.evidenceBasis === analysisBasis),
      )
      .map((record) => record.proposal);
  }

  /** Migration proposals may be explicitly confirmed, but never auto-selected
   * or presented as current without a validated analysis basis. */
  proposalForSelection(projectId: string, key: string): WorkProposal | null {
    const current = this.proposals(projectId).find((proposal) => proposal.key === key);
    if (current) return current;
    const analysis = this.core.analysisRecord(projectId);
    if (!analysis || /^[a-f0-9]{64}$/i.test(analysis.result.scope)) return null;
    const record = this.core.repo
      .list('workProposal')
      .find(
        (item) =>
          item.projectId === projectId &&
          item.proposal.key === key &&
          item.proposal.source === 'analysis-candidate' &&
          item.proposal.evidenceBasis === analysis.result.scope,
      );
    return record ? record.proposal : null;
  }

  hasStaleProposals(projectId: string): boolean {
    this.core.project(projectId);
    const workingTreeBasis = this.currentWorkingTreeBasis(projectId);
    const analysisBasis = this.currentAnalysisBasis(projectId);
    return this.core.repo
      .list('workProposal')
      .some(
        (record) =>
          record.projectId === projectId &&
          (record.proposal.source === 'working-tree-group'
            ? workingTreeBasis === null || record.proposal.evidenceBasis !== workingTreeBasis
            : analysisBasis === null || record.proposal.evidenceBasis !== analysisBasis),
      );
  }

  /**
   * A link can survive a changed proposal basis only through source revisions
   * explicitly retained with the decision. Similar titles, scopes, or files
   * are deliberately not identity evidence.
   */
  private linkedWorkIds(
    proposal: WorkProposal,
    links: ReturnType<StateCarry['projectModel']['view']>['decisions'],
    currentProposals: WorkProposal[],
  ): Set<string> {
    const identity = proposalIdentity(proposal);
    return new Set(
      links.flatMap((decision) => {
        const key = decision.value.proposalKey;
        if (typeof key !== 'string') return [];
        const source = decision.value.proposalSource;
        const basis = decision.value.proposalEvidenceBasis;
        const linkedIdentity: ProposalIdentity =
          typeof source === 'string' &&
          (source === 'analysis-candidate' || source === 'working-tree-group')
            ? {
                key,
                source,
                evidenceBasis: typeof basis === 'string' || basis === null ? basis : null,
              }
            : { key, source: proposal.source, evidenceBasis: decision.basis[0] ?? null };
        const evidenceContinuity =
          sharesLinkedEvidence(proposal, decision) ||
          sharesValidatedTreeIdentity(proposal, decision) ||
          sharesSavedTreeBridge(proposal, decision, currentProposals);
        const exact = sameIdentity(identity, linkedIdentity) && evidenceContinuity;
        const continuous =
          linkedIdentity.key === proposal.key &&
          linkedIdentity.source === proposal.source &&
          evidenceContinuity;
        return exact || continuous ? [decision.workItemId!] : [];
      }),
    );
  }

  /** Work ids that would be conflated by selecting this evidence expression. */
  linkedWorkIdsForProposal(projectId: string, proposal: WorkProposal): Set<string> {
    const model = this.core.projectModel.view(projectId);
    const workById = new Map(model.workItems.map((item) => [item.id, item]));
    const links = model.decisions.filter(
      (decision) =>
        decision.state === 'valid' &&
        decision.kind === workDecisionKinds.linkWorkProposal &&
        !!decision.workItemId &&
        workById.has(decision.workItemId),
    );
    const currentProposals = this.proposals(projectId);
    const states = currentProposals.map((candidate) => ({
      proposal: candidate,
      linkedWorkIds: this.linkedWorkIds(candidate, links, currentProposals),
    }));
    const start = states.find((state) => sameIdentity(state.proposal, proposalIdentity(proposal)));
    if (!start) return new Set();
    const connected = new Set<ProposalMatchState>([start]);
    const pending = [start];
    while (pending.length) {
      const current = pending.pop()!;
      for (const other of states) {
        if (!connected.has(other) && connectedProposals(current, other)) {
          connected.add(other);
          pending.push(other);
        }
      }
    }
    return new Set([...connected].flatMap((state) => [...state.linkedWorkIds]));
  }

  match(projectId: string): WorkProposalMatch[] {
    const model = this.core.projectModel.view(projectId);
    const proposals = this.proposals(projectId);
    const workById = new Map(model.workItems.map((item) => [item.id, item]));
    const links = model.decisions.filter(
      (decision) =>
        decision.state === 'valid' &&
        decision.kind === workDecisionKinds.linkWorkProposal &&
        !!decision.workItemId &&
        workById.has(decision.workItemId),
    );
    const states: ProposalMatchState[] = proposals.map((proposal) => ({
      proposal,
      linkedWorkIds: this.linkedWorkIds(proposal, links, proposals),
    }));
    const unseen = new Set(states);
    const result: WorkProposalMatch[] = [];
    while (unseen.size) {
      const first = unseen.values().next().value as ProposalMatchState;
      const component = new Set<ProposalMatchState>([first]);
      const pending = [first];
      unseen.delete(first);
      // Preserve transitive provenance only when a producer declared the
      // cross-source relation and both proposals cite the same exact source.
      while (pending.length) {
        const current = pending.pop()!;
        for (const other of unseen) {
          if (connectedProposals(current, other)) {
            unseen.delete(other);
            component.add(other);
            pending.push(other);
          }
        }
      }
      const members = [...component];
      const workIds = new Set(members.flatMap((member) => [...member.linkedWorkIds]));
      if (workIds.size > 1) {
        // Do not hide a continuity conflict by picking a convenient alias.
        for (const member of members)
          result.push({
            proposal: member.proposal,
            workItemId: null,
            confidence: 'unmatched',
            reason: 'Connected source evidence is linked to different work and needs review.',
          });
        continue;
      }
      const representative = [...members].sort(
        (left, right) =>
          Number(left.proposal.source === 'analysis-candidate') -
            Number(right.proposal.source === 'analysis-candidate') ||
          left.proposal.key.localeCompare(right.proposal.key),
      )[0];
      const workItemId = [...workIds][0] ?? null;
      result.push({
        proposal: representative.proposal,
        ...(members.length > 1
          ? {
              aliases: members
                .filter((member) => member !== representative)
                .map((member) => member.proposal),
            }
          : {}),
        workItemId,
        confidence: workItemId ? 'explicit' : members.length > 1 ? 'possible' : 'unmatched',
        reason: workItemId
          ? 'The user explicitly linked this interpretation or its retained evidence history to the work.'
          : members.length > 1
            ? 'Independent current sources share direct revision evidence.'
            : 'The available evidence is not enough to attach this interpretation to durable work.',
      });
    }
    return result;
  }

  bestForWork(projectId: string, workItem: WorkItem): WorkProposalMatch | null {
    const candidates = this.match(projectId).filter((match) => match.workItemId === workItem.id);
    return (
      candidates.sort((a, b) => {
        const confidence = { explicit: 0, possible: 1, unmatched: 2 } as const;
        const source = { 'working-tree-group': 0, 'analysis-candidate': 1 } as const;
        return (
          confidence[a.confidence] - confidence[b.confidence] ||
          source[a.proposal.source] - source[b.proposal.source]
        );
      })[0] ?? null
    );
  }
}
