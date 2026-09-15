import { it, expect } from 'vitest';
import type { QuestionSession, SourceRevision } from '@statecarry/contracts';
import { explanationRepairCatalog } from '../apps/server/src/adapters/explanation-prompts';
import { selectQuestionContext } from '../packages/core/src/question-context';
import { explanationHarness, contextFromInput, fixtureExplanation, fixtureAssessment } from './explanation-fixtures';

it('repairs unsafe unknowns without permitting supported assertions or evidence to be rewritten', async () => {
  const run = await explanationHarness();
  try {
    run.prepare(); const view = await run.settled();
    const context = contextFromInput(view.revision!.input), candidate = fixtureExplanation(context);
    candidate.nodes[0].unknowns = [{ text: 'No analysis ever happened', impact: 'Start new analysis', cause: 'not-selected' }];
    const assessment = { ...fixtureAssessment(candidate), unknownsSafe: false };
    const catalog = explanationRepairCatalog(context, candidate, assessment);
    const patch = { nodes: {}, links: {}, additions: [], unknowns: [], nodeUnknowns: Object.fromEntries(candidate.nodes.map(n => [n.id, []])) };
    const repaired = catalog.decode(patch);
    expect(repaired.nodes).toEqual(candidate.nodes.map(n => ({ ...n, unknowns: [] })));
    expect(repaired.links).toEqual(candidate.links);
    expect(catalog.schema.safeParse({ ...patch, nodes: { [candidate.nodes[0].id]: candidate.nodes[0] } }).success).toBe(false);
    expect(catalog.schema.safeParse({ ...patch, nodeUnknowns: {} }).success).toBe(false);
    // A safe assessment does not grant edits to unknowns either.
    expect(explanationRepairCatalog(context, candidate, fixtureAssessment(candidate)).schema.safeParse(patch).success).toBe(false);
  } finally { await run.h.core.close(); }
});

it('keeps the historical anchor and later completion/blocker reports distinguishable within the same fixed context', () => {
  const sources = [
    ['user', 'Build an evaluation corpus and replay runner; validate consumption before comparing results.'],
    ['tool', 'Unrelated build output '.repeat(3000)],
    ['agent', 'The corpus and replay runner are now implemented. Consumption remains unverified; comparisons are blocked.'],
  ].map(([actor, text], i) => ({ id: `r${i}`, actor, text, threadId: 't', turnId: `turn${i}`, itemId: `${i}`, kind: 'message', eventAt: null, limitations: [] })) as unknown as SourceRevision[];
  const context = selectQuestionContext({ turns: [] } as unknown as QuestionSession, 'Why is this action necessary?', { text: sources[0].text, evidence: [{ revisionId: 'r0', quote: sources[0].text }] }, sources);
  expect(context.anchorSourceRevisionIds).toEqual(['r0']);
  expect(context.recordOrder).toEqual(['r0', 'r1', 'r2']);
  expect(context.excerpts.find(e => e.revisionId === 'r2')?.text).toContain('now implemented');
  expect(context.excerpts.find(e => e.revisionId === 'r2')?.text).toContain('remains unverified');
  expect(context.excerpts.reduce((n,e) => n + e.text.length, 0)).toBeLessThanOrEqual(24000);
});
