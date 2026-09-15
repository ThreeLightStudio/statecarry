import type { Claim, ConversationFlow, ConversationFlowItem } from '@statecarry/contracts';

const names: Record<Claim['nature'], string> = {
  'user-request': 'User request',
  'user-decision': 'User decision',
  'agent-proposal': 'AI Proposal',
  'agent-report': 'AI Report',
  'agent-interpretation': 'AI Interpretation',
  'tool-result': 'Execution result',
  'file-observation': 'File observation',
};
export type FlowView = Omit<ConversationFlow, 'items'> & {
  title: string;
  preview: string;
  edited: boolean;
  items: (ConversationFlowItem & { typeLabel: string; statusLabel: string })[];
};
export function presentFlow(flow: ConversationFlow, edited: boolean): FlowView {
  const anchor = flow.items.find((item) => item.claimId === flow.claimId)!;
  const sentences = anchor.summary
    .trim()
    .split(/(?<=[.!?。])\s+|\n+/)
    .filter(Boolean);
  const subject = sentences[0] ?? '';
  const title =
    !subject || /^(?:[A-Z]+[-_]?\d+[\s,·/]*)+$/.test(subject)
      ? 'Topic unknown · related records'
      : subject.length > 90
        ? `${subject.slice(0, 90)}…`
        : subject;
  return {
    ...flow,
    title,
    edited,
    preview: `${edited ? 'Evidence for the original summary · ' : ''}${names[anchor.type]} · ${anchor.status === 'supported' ? 'Claim meaning check' : 'Unknown'}${flow.limitations.length || anchor.limitations.length ? ' · Some coverage is limited' : ''}\n${sentences.slice(0, 2).join(' ')}${anchor.condition ? `\nCondition · ${anchor.condition}` : ''}`,
    items: flow.items.map((item) => ({
      ...item,
      typeLabel: names[item.type],
      statusLabel:
        item.status === 'supported'
          ? `Claim meaning check${item.limitations.length ? ' · Some source information is limited' : ''}`
          : 'Unknown · limited view',
    })),
  };
}
