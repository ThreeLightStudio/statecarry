import { expect, it, vi } from 'vitest';
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

it.each(['en', 'ko'] as const)(
  'uses the %s project language and accepts language confirmation through the existing schema',
  async (responseLanguage) => {
    const provider = new CodexSummary('/unused');
    (provider as any).preflight = async () => {};
    const confirmation = {
      items: [],
      unknowns: [
        '프로젝트 기본 언어인 영어로 답변할까요? 기본 언어는 프로젝트 설정에서 바꿀 수 있습니다.',
      ],
    };
    const run = vi.fn(async (_prompt, schema, _remote, phase, instructions) => {
      expect(instructions).toContain(
        `default response language is ${responseLanguage === 'ko' ? 'Korean' : 'English'}`,
      );
      expect(instructions).toContain('For every new question whose language differs');
      expect(instructions).toContain('Project settings');
      expect(instructions).toContain('answer the original pending question');
      const value =
        phase === 'check-question'
          ? {
              checks: {},
              unknownsSafe: true,
              addressesQuestion: true,
              coversAvailableContext: true,
            }
          : confirmation;
      return { value: schema.parse(value) };
    });
    (provider as any).run = run;
    const context = {
      responseLanguage,
      anchor: '',
      question: '왜 필요한가요?',
      history: [],
      excerpts: [],
      limitations: [],
    };
    const answer = await provider.answerQuestion(
      context,
      () => {},
      () => {},
    );
    expect(answer).toEqual(confirmation);
    const assessment = await provider.checkQuestion(
      context,
      answer,
      () => {},
      () => {},
    );
    expect(assessQuestionAnswer(answer, assessment).answer).toEqual(confirmation);
    expect(run).toHaveBeenCalledTimes(2);
  },
);
