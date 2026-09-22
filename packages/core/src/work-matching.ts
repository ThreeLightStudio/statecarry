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

function sharesRevisionEvidence(left: WorkProposal, right: WorkProposal): boolean {
  const leftQuotes = left.evidenceQuotes ?? [];
  const rightQuotes = right.evidenceQuotes ?? [];
  // Current producers retain an exact quote. A shared revision alone can
  // contain unrelated settings, diagnostics, or adjacent work.
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

function sharesLinkedEvidence(
  proposal: WorkProposal,
  decision: { value: Record<string, unknown> },
): boolean {
  const quotes = linkedEvidenceQuotes(decision);
  return (proposal.evidenceQuotes ?? []).some((proposalQuote) =>
    quotes.some(
      (decisionQuote) =>
        proposalQuote.revisionId === decisionQuote.revisionId &&
        proposalQuote.quote === decisionQuote.quote,
    ),
  );
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
      sharesRevisionEvidence(left.proposal, right.proposal))
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
        const exact = sameIdentity(identity, linkedIdentity);
        const continuous =
          linkedIdentity.key === proposal.key &&
          linkedIdentity.source === proposal.source &&
          sharesLinkedEvidence(proposal, decision);
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
    const states = this.proposals(projectId).map((candidate) => ({
      proposal: candidate,
      linkedWorkIds: this.linkedWorkIds(candidate, links),
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
      linkedWorkIds: this.linkedWorkIds(proposal, links),
    }));
    const unseen = new Set(states);
    const result: WorkProposalMatch[] = [];
    while (unseen.size) {
      const first = unseen.values().next().value as ProposalMatchState;
      const component = new Set<ProposalMatchState>([first]);
      const pending = [first];
      unseen.delete(first);
      // Preserve transitive A–B–C provenance. Edges require a shared source
      // revision across independent producers, never a title or file overlap.
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
