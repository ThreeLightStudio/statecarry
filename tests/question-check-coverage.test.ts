import { expect, it } from 'vitest';
import type { QuestionAnswer } from '@statecarry/contracts';
import { questionCheckCatalog } from '../apps/server/src/adapters/question-prompts';
import { assessQuestionAnswer } from '../packages/core/src/question-context';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';

const item = (id: string): QuestionAnswer['items'][number] => ({
  id,
  kind: 'record',
  nature: 'agent-report',
  text: 'The agent reported a result.',
  uncertainty: '',
  evidence: [{ revisionId: 'r', start: 0, quote: 'result' }],
});
const answer: QuestionAnswer = { items: [item('first'), item('second')], unknowns: [] };
const supported = { verdict: 'supported', reason: 'Supported by the cited report.' };

it('requires every original ID in the actual model schema and converts keyed verdicts without changing them', async () => {
  const provider = new CodexSummary('/unused');
  let calls = 0;
  (provider as any).run = async (
    _prompt: string,
    schema: ReturnType<typeof questionCheckCatalog>['schema'],
  ) => {
    calls++;
    expect(
      schema.safeParse({
        checks: { first: supported },
        unknownsSafe: true,
        addressesQuestion: true,
        coversAvailableContext: true,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        checks: { first: supported, second: supported, invented: supported },
        unknownsSafe: true,
        addressesQuestion: true,
        coversAvailableContext: true,
      }).success,
    ).toBe(false);
    const json = schema.toJSONSchema() as any;
    expect(json.properties.checks.required).toEqual(['first', 'second']);
    return {
      value: {
        checks: {
          second: { verdict: 'unsupported', reason: 'The citation does not support this claim.' },
          first: supported,
        },
        unknownsSafe: true,
        addressesQuestion: true,
        coversAvailableContext: true,
      },
    };
  };
  const assessment = await provider.checkQuestion(
    { anchor: '', question: 'Why?', history: [], excerpts: [], limitations: [] },
    answer,
    () => {},
    () => {},
  );
  expect(calls).toBe(1);
  expect(assessment.checks.map((c) => [c.itemId, c.verdict])).toEqual([
    ['first', 'supported'],
    ['second', 'unsupported'],
  ]);
  expect(assessQuestionAnswer(answer, assessment).answer.items.map((i) => i.id)).toEqual(['first']);
});

it('rejects incomplete or duplicate legacy assessments instead of filling in support', () => {
  expect(() =>
    assessQuestionAnswer(answer, {
      checks: [{ itemId: 'first', ...supported }],
      unknownsSafe: true,
    }),
  ).toThrow('incomplete');
  expect(() =>
    assessQuestionAnswer(answer, {
      checks: [
        { itemId: 'first', ...supported },
        { itemId: 'first', ...supported },
      ],
      unknownsSafe: true,
    }),
  ).toThrow('incomplete');
});

it('checks unknown-only answers without inventing items', () => {
  const unknown: QuestionAnswer = {
    items: [],
    unknowns: ['Not confirmed in the selected records.'],
  };
  const catalog = questionCheckCatalog(unknown);
  expect(
    assessQuestionAnswer(
      unknown,
      catalog.decode({
        checks: {},
        unknownsSafe: true,
        addressesQuestion: true,
        coversAvailableContext: true,
      }),
    ).answer,
  ).toEqual(unknown);
  expect(
    catalog.schema.safeParse({
      checks: { invented: supported },
      unknownsSafe: true,
      addressesQuestion: true,
      coversAvailableContext: true,
    }).success,
  ).toBe(false);
});

it('preserves uncertain rejection and unsafe unknown rejection', () => {
  const candidate = { ...answer, unknowns: ['An unsupported absence claim.'] };
  const check = { verdict: 'uncertain', reason: 'Not established by these excerpts.' };
  const result = assessQuestionAnswer(
    candidate,
    questionCheckCatalog(candidate).decode({
      checks: { first: check, second: check },
      unknownsSafe: false,
      addressesQuestion: true,
      coversAvailableContext: true,
    }),
  );
  expect(result.answer.items).toEqual([]);
  expect(result.answer.unknowns).not.toContain(candidate.unknowns[0]);
  expect(result.assessment.checks.every((c) => c.verdict === 'uncertain')).toBe(true);
});
