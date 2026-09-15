import { it, expect } from 'vitest';
import type { QuestionSession, SourceRevision, QuestionAnswer } from '@statecarry/contracts';
import { selectQuestionContext, assessQuestionAnswer } from '../packages/core/src/question-context';
import {
  questionCheckCatalog,
  QUESTION_INSTRUCTIONS,
} from '../apps/server/src/adapters/question-prompts';
import {
  explanationGenerationSchema,
  explanationEvidenceCatalog,
  explanationRepairCatalog,
} from '../apps/server/src/adapters/explanation-prompts';
import {
  explanationHarness,
  contextFromInput,
  fixtureExplanation,
  fixtureAssessment,
} from './explanation-fixtures';

it('semantic repair preserves supported nodes and citations and refuses edits to their IDs', async () => {
  const run = await explanationHarness();
  try {
    run.prepare();
    const view = await run.settled();
    const context = contextFromInput(view.revision!.input),
      candidate = fixtureExplanation(context),
      assessment = fixtureAssessment(candidate);
    const rejected = candidate.nodes[0],
      kept = candidate.nodes[1];
    assessment.nodes[0].verdict = 'unsupported';
    const catalog = explanationRepairCatalog(context, candidate, assessment);
    const { id, evidence, ...fields } = rejected;
    const replacement = {
      ...fields,
      text: 'Corrected report',
      evidenceIds: [explanationEvidenceCatalog(context).input.excerpts[0].fragments[0].evidenceId!],
    };
    const patch = { nodes: { [id]: replacement }, links: {}, additions: [] };
    expect(catalog.decode(patch).nodes.find((n) => n.id === kept.id)).toEqual(kept);
    expect(
      catalog.schema.safeParse({ ...patch, nodes: { ...patch.nodes, [kept.id]: replacement } })
        .success,
    ).toBe(false);
    expect(catalog.decode(patch).nodes.find((n) => n.id === rejected.id)?.text).toBe(
      'Corrected report',
    );
  } finally {
    await run.h.core.close();
  }
});

it('prevents complete-record absence claims at every generated depth for partial input', () => {
  const schema = explanationGenerationSchema(
    [{ actor: 'user', fragments: [{ evidenceId: 'u' }] }],
    false,
  );
  const gap = { text: 'Gap', impact: 'Check coverage', cause: 'not-in-record' };
  const leaf = {
    role: 'state',
    kind: 'record',
    nature: 'user-report',
    text: 'A report',
    uncertainty: '',
    condition: '',
    unknowns: [gap],
    evidenceIds: ['u'],
  };
  const input = { sections: [{ title: 'State', body: [{ ...leaf, reasons: [] }] }], unknowns: [] };
  expect(schema.safeParse(input).success).toBe(false);
  gap.cause = 'not-selected';
  expect(schema.safeParse(input).success).toBe(true);
  gap.cause = 'conflicting';
  expect(schema.safeParse(input).success).toBe(true);
});

it('keeps the selected prerequisite and subsequent reports within the question budget', () => {
  const sources = Array.from({ length: 15 }, (_, i) => ({
    id: `r${i}`,
    threadId: 't',
    turnId: `turn${i}`,
    itemId: `item${i}`,
    actor: i === 0 ? 'tool' : 'agent',
    text:
      i === 14
        ? 'Later report: the build ran but independent verification is still missing.'
        : 'product purpose initial request '.repeat(300),
    eventAt: null,
    kind: 'message',
    limitations: [],
  })) as unknown as SourceRevision[];
  const session = { turns: [] } as unknown as QuestionSession;
  const context = selectQuestionContext(
    session,
    '현재 다음 할 일은?',
    {
      text: 'Run the complete workflow',
      condition: 'Only after invalidation is fixed',
      evidence: [{ revisionId: 'r0', quote: 'product purpose' }],
    },
    sources,
  );
  expect(context.anchorCondition).toBe('Only after invalidation is fixed');
  expect(
    context.excerpts.some(
      (e) => e.revisionId === 'r14' && e.text.includes('independent verification'),
    ),
  ).toBe(true);
  expect(context.excerpts.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(24000);
  for (const e of context.excerpts)
    expect(
      sources.find((s) => s.id === e.revisionId)!.text.slice(e.start, e.start + e.text.length),
    ).toBe(e.text);
});

it('does not accept a cited answer that fails target relevance or available context coverage', () => {
  const answer: QuestionAnswer = { items: [], unknowns: ['선택된 기록에서 확인되지 않았습니다.'] };
  const catalog = questionCheckCatalog(answer);
  for (const flags of [
    { addressesQuestion: false, coversAvailableContext: true },
    { addressesQuestion: true, coversAvailableContext: false },
  ]) {
    expect(() => catalog.decode({ checks: {}, unknownsSafe: true, ...flags })).toThrow(
      'adequately address',
    );
  }
});

it('uses Korean server notices for Korean questions and English for English questions', () => {
  const answer: QuestionAnswer = { items: [], unknowns: [] };
  const assessment = { checks: [], unknownsSafe: false };
  expect(assessQuestionAnswer(answer, assessment, '왜 필요한가요?').answer.unknowns).toEqual([
    '선택된 기록에서 근거를 확인할 수 있는 답변을 찾지 못했습니다.',
  ]);
  expect(assessQuestionAnswer(answer, assessment, 'Why?').answer.unknowns[0]).toMatch(
    /^No verifiable/,
  );
  expect(QUESTION_INSTRUCTIONS).toContain('never append a fixed English phrase');
});
