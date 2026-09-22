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
          (record) =>
            proposal.evidenceBasis !== null &&
            record.proposal.evidenceBasis === proposal.evidenceBasis,
        );
        const history = previousForProposal.flatMap((record) => [
          ...(record.history ?? []),
          {
            key: record.proposal.key,
            source: record.proposal.source,
            evidenceBasis: record.proposal.evidenceBasis,
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
              !sameIdentity(identity, current) &&
              history.findIndex((other) => sameIdentity(other, identity)) === index,
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
    const records = this.core.repo
      .list('workProposal')
      .filter((record) => record.projectId === projectId);
    const matches = proposals.map((proposal) => {
      const record = records.find(
        (item) =>
          item.proposal.source === proposal.source &&
          item.proposal.key === proposal.key &&
          item.proposal.evidenceBasis === proposal.evidenceBasis,
      );
      const identities: ProposalIdentity[] = [
        { key: proposal.key, source: proposal.source, evidenceBasis: proposal.evidenceBasis },
        ...(record?.history ?? []),
      ];
      const linkedWorkIds = new Set(
        links.flatMap((decision) => {
          const key = decision.value.proposalKey;
          if (typeof key !== 'string') return [];
          const source = decision.value.proposalSource;
          const basis = decision.value.proposalEvidenceBasis;
          const legacyIdentity: ProposalIdentity = {
            key,
            source: proposal.source,
            evidenceBasis: decision.basis[0] ?? null,
          };
          const identity: ProposalIdentity =
            typeof source === 'string' &&
            (source === 'analysis-candidate' || source === 'working-tree-group')
              ? {
                  key,
                  source,
                  evidenceBasis: typeof basis === 'string' || basis === null ? basis : null,
                }
              : legacyIdentity;
          return identities.some((candidate) => sameIdentity(candidate, identity))
            ? [decision.workItemId!]
            : [];
        }),
      );
      if (linkedWorkIds.size === 1) {
        const workItemId = [...linkedWorkIds][0];
        return {
          proposal,
          workItemId,
          confidence: 'explicit' as const,
          reason:
            'The user explicitly linked this interpretation or its retained evidence history to the work.',
        };
      }

      return {
        proposal,
        workItemId: null,
        confidence: 'unmatched' as const,
        reason:
          'The available evidence is not enough to attach this interpretation to durable work.',
      };
    });
    // A work can have current evidence from both sources. Core exposes its
    // strongest evidence once so consumers cannot count it as two candidates.
    return matches.filter(
      (match, index) =>
        !match.workItemId ||
        matches
          .map((other, otherIndex) => ({ other, otherIndex }))
          .filter(({ other }) => other.workItemId === match.workItemId)
          .sort(
            ({ other: left }, { other: right }) =>
              Number(left.proposal.source === 'analysis-candidate') -
              Number(right.proposal.source === 'analysis-candidate'),
          )[0]?.otherIndex === index,
    );
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
