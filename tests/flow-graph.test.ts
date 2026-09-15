import { expect, it } from 'vitest';
import { presentFlowGraph, presentReturnContext } from '@statecarry/presentation';
import { flowHarness } from './conversation-flow-fixtures';

async function fixture() { const { h, id } = await flowHarness(); return presentReturnContext(h.core.snapshot(id)).current[0].flow; }
it('projects shared revisions with undirected edges and independent generated IDs', async () => {
  const flow = await fixture(), graph = presentFlowGraph(flow);
  expect(graph.connected).toBe(true);
  expect(graph.nodes.filter(n => n.revisionId)).toHaveLength(3);
  expect(graph.source).not.toMatch(/-->|click|https?:/);
  expect(graph.source.match(/ --- /g)).toHaveLength(6);
  for (const item of flow.items) expect(graph.nodes.find(n => n.itemIds[0] === item.id)?.label).toContain(item.summary);
  expect(graph.nodes.every(n => /^[ns]\d+$/.test(n.id))).toBe(true);
  expect(presentFlowGraph(flow)).toBe(graph);
  expect(presentFlowGraph(structuredClone(flow))).toEqual(graph);
  for (const node of graph.nodes.filter(n => n.revisionId)) {
    expect(node.itemIds.every(id => flow.items.find(i => i.id === id)!.sources.some(s => s.revisionId === node.revisionId))).toBe(true);
  }
});
it.each(['single', 'outside-input', 'missing', 'bad-quote', 'limited', 'unrelated'])('falls back without inventing relations: %s', async mode => {
  const flow = await fixture();
  if (mode === 'single') flow.items = [flow.items.at(-1)!];
  if (mode === 'outside-input') flow.sourceRevisionIds = [];
  if (mode === 'missing') flow.items.forEach(i => i.sources.forEach(s => s.available = false));
  if (mode === 'bad-quote') flow.items.forEach(i => i.sources.forEach(s => s.quoteStarts = []));
  if (mode === 'limited') flow.items.forEach(i => i.status = 'limited');
  if (mode === 'unrelated') flow.items.at(-1)!.sources = [];
  expect(presentFlowGraph(flow).connected).toBe(false);
  expect(presentFlowGraph(flow).limitation).toContain('shared source');
});
it('keeps long text intact in details, encodes hostile labels, and includes execution results', async () => {
  const flow = await fixture();
  const item = flow.items[0];
  item.summary = '" ] --> evil[<script>alert(1)</script>]\n%%{init: {}}%% ' + '긴한글'.repeat(1000);
  item.type = 'tool-result'; item.typeLabel = 'Execution result';
  const before = item.summary, graph = presentFlowGraph(flow);
  expect(graph.source).not.toContain('<script>');
  expect(graph.source).not.toContain('%%{');
  expect(graph.source).not.toContain('-->');
  expect(graph.nodes[0].label).not.toContain(item.typeLabel);
  expect(graph.nodes[0].label).not.toContain(item.statusLabel);
  expect(item.typeLabel).toBe('Execution result');
  expect(graph.nodes[0].label).toContain('…');
  expect(item.summary).toBe(before);
});
it('prioritizes summaries, marks truncation at 48 code points and retains detail metadata', async () => {
  const flow = await fixture();
  const item = flow.items.find(item => item.claimId === flow.claimId)!;
  item.summary = '한'.repeat(47) + '😀' + ' 전체 문장 끝';
  item.condition = '검사 결과를 확인한 경우';
  const before = structuredClone(flow);
  const graph = presentFlowGraph(flow);
  expect(graph.nodes.find(node => node.itemIds.includes(item.id))!.label).toBe('This judgment · ' + '한'.repeat(47) + '😀…');
  expect(graph.nodes.filter(node => node.revisionId).every(node => /^Shared source \d+$/.test(node.label))).toBe(true);
  expect(flow).toEqual(before);
  const exact = structuredClone(flow);
  exact.items.find(i => i.id === item.id)!.summary = '한'.repeat(48);
  expect(presentFlowGraph(exact).nodes.find(node => node.itemIds.includes(item.id))!.label).not.toContain('…');
});
it('does not truncate large collections or turn adjacency into relations', async () => {
  const flow = await fixture();
  flow.items = Array.from({ length: 25 }, (_, i) => ({ ...structuredClone(flow.items[0]), id: `item${i}`, claimId: `claim${i}` }));
  const graph = presentFlowGraph(flow);
  expect(graph.nodes).toHaveLength(26);
  expect(graph.source.match(/ --- /g)).toHaveLength(25);
});
