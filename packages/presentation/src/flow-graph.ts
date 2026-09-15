import type { FlowView } from './conversation-flow';

export type FlowGraphNode = { id: string; label: string; itemIds: string[]; revisionId?: string };
export type FlowGraph = { source: string; nodes: FlowGraphNode[]; connected: boolean; limitation: string | null };
const cache = new WeakMap<FlowView, FlowGraph>();
const short = (text: string) => {
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  return chars.length > 48 ? chars.slice(0, 48).join('') + '…' : chars.join('');
};
// Mermaid decimal entities keep every input character inside a fixed quoted label.
export const graphLabel = (text: string) => text.replace(/[&"#<>`\\\[\]{}()\r\n]/gu, c => `#${c.codePointAt(0)};`);

export function presentFlowGraph(flow: FlowView): FlowGraph {
  const previous = cache.get(flow);
  if (previous) return previous;
  const nodes: FlowGraphNode[] = flow.items.map((item, i) => ({ id: `n${i}`, itemIds: [item.id],
    label: `${item.claimId === flow.claimId ? 'This judgment · ' : ''}${short(item.summary) || 'Content unknown'}` }));
  const input = new Set(flow.sourceRevisionIds);
  const shared = new Map<string, Set<number>>();
  for (const [i, item] of flow.items.entries()) {
    if (item.status !== 'supported') continue;
    for (const ref of item.sources) {
      if (!input.has(ref.revisionId) || !ref.available || !ref.quote || !ref.quoteStarts?.length) continue;
      const members = shared.get(ref.revisionId) ?? new Set<number>();
      members.add(i); shared.set(ref.revisionId, members);
    }
  }
  const edges: string[] = [];
  for (const [revisionId, members] of [...shared].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (members.size < 2) continue;
    const id = `s${nodes.length - flow.items.length}`;
    const number = nodes.length - flow.items.length + 1;
    nodes.push({ id, label: `Shared source ${number}`, revisionId, itemIds: [...members].map(i => flow.items[i].id) });
    for (const member of members) edges.push(`n${member} --- ${id}`);
  }
  const result: FlowGraph = { nodes, connected: edges.length > 0,
    limitation: edges.length ? null : 'No shared sources can be linked. Items and coverage are available as text.',
    source: ['flowchart TB', ...nodes.map(n => `${n.id}["${graphLabel(n.label)}"]`), ...edges].join('\n') };
  cache.set(flow, result);
  return result;
}
