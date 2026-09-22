import {
  selectedCurrentWorkId,
  workDecisionKinds,
  type WorkItem,
  type WorkProposal,
  type WorkProposalMatch,
} from '@statecarry/contracts';
import type { StateCarry } from './service';

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function selectedWorkId(core: StateCarry, projectId: string): string | null {
  const decisions = core.repo
    .list('workDecision')
    .filter(
      (decision) =>
        decision.projectId === projectId &&
        decision.state === 'valid' &&
        decision.kind === workDecisionKinds.selectCurrentWork,
    )
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  for (const decision of decisions) {
    const workItemId = selectedCurrentWorkId(decision);
    if (workItemId) return workItemId;
  }
  return null;
}

export class WorkMatcher {
  constructor(private core: StateCarry) {}

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
      .map((proposal) => ({ id: this.core.ids.hash([projectId, proposal.key]), proposal }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (
      previous.length === next.length &&
      previous.every(
        (record, index) =>
          record.outputLanguage === outputLanguage &&
          record.id === next[index].id &&
          JSON.stringify(record.proposal) === JSON.stringify(next[index].proposal),
      )
    )
      return false;
    this.core.repo.transaction(() => {
      for (const record of this.core.repo.list('workProposal'))
        if (record.projectId === projectId && record.proposal.source === source)
          this.core.repo.remove('workProposal', record.id);
      for (const { id, proposal } of next)
        this.core.repo.put('workProposal', {
          id,
          projectId,
          proposal,
          outputLanguage,
          generatedAt: this.core.clock.now(),
        });
    });
    return true;
  }
  proposals(projectId: string): WorkProposal[] {
    this.core.project(projectId);
    return this.core.repo
      .list('workProposal')
      .filter((record) => record.projectId === projectId)
      .map((record) => record.proposal);
  }
  match(projectId: string): WorkProposalMatch[] {
    const model = this.core.projectModel.view(projectId);
    const proposals = this.proposals(projectId);
    const workById = new Map(model.workItems.map((item) => [item.id, item]));
    const explicit = new Map<string, string>();
    for (const decision of model.decisions) {
      if (
        decision.state !== 'valid' ||
        decision.kind !== workDecisionKinds.linkWorkProposal ||
        !decision.workItemId ||
        !workById.has(decision.workItemId)
      )
        continue;
      const proposalKey = decision.value.proposalKey;
      if (typeof proposalKey === 'string') explicit.set(proposalKey, decision.workItemId);
    }

    const selected = selectedWorkId(this.core, projectId);
    const openWork = model.workItems.filter(
      (item) => item.state !== 'completed' && item.state !== 'stopped',
    );

    return proposals.map((proposal) => {
      const explicitWork = explicit.get(proposal.key);
      if (explicitWork)
        return {
          proposal,
          workItemId: explicitWork,
          confidence: 'explicit' as const,
          reason: 'The user explicitly linked this interpretation to the work.',
        };

      const titleMatches = openWork.filter(
        (item) => normalized(item.title) === normalized(proposal.title),
      );
      if (titleMatches.length === 1)
        return {
          proposal,
          workItemId: titleMatches[0].id,
          confidence: 'possible' as const,
          reason: 'The interpretation has the same title as one open work item.',
        };

      if (proposals.length === 1 && openWork.length === 1)
        return {
          proposal,
          workItemId: openWork[0].id,
          confidence: 'possible' as const,
          reason: 'There is one current interpretation and one open work item.',
        };

      if (selected) {
        const selectedWork = workById.get(selected);
        if (
          selectedWork &&
          proposals.length === 1 &&
          selectedWork.state !== 'completed' &&
          selectedWork.state !== 'stopped'
        )
          return {
            proposal,
            workItemId: selectedWork.id,
            confidence: 'possible' as const,
            reason:
              'The user has one selected work item and only one current interpretation exists.',
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
