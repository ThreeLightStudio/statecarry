import { describe, it, expect } from 'vitest';
import {
  QuestionCandidateError,
  type QuestionAnswer,
  type QuestionContext,
} from '@statecarry/contracts';
import {
  selectQuestionContext,
  validateQuestionAnswer,
} from '../packages/core/src/question-context';
import {
  questionHarness,
  questionRecords,
  fixtureAnswer,
  transitionRecords,
  transitionQuestion,
} from './question-fixtures';

function wrongSpeaker(context: QuestionContext): QuestionAnswer {
  const answer = fixtureAnswer(context),
    agent = context.excerpts.find((e) => e.actor === 'agent')!;
  answer.items[0].evidence = [
    { revisionId: agent.revisionId, start: agent.start, quote: agent.text },
  ];
  return answer;
}

describe('background attribution and bounded repair', () => {
  it('retains the originating request and scoped change despite many highly ranked agent turns', async () => {
    const { h, id, create } = await questionHarness(transitionRecords);
    const context = selectQuestionContext(
      create(),
      transitionQuestion,
      h.core.snapshot(id).summary!.claims[0],
      transitionRecords,
    );
    expect(context.excerpts.some((e) => e.revisionId === transitionRecords[0].id)).toBe(true);
    expect(context.excerpts.some((e) => e.text.includes('완료 목표를 바꿉니다'))).toBe(true);
    expect(new Set(context.excerpts.map((e) => e.turnId)).size).toBeLessThanOrEqual(12);
    expect(context.excerpts.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(24000);
  });

  it('rejects user+agent mixed citations and returns only structured attribution feedback', async () => {
    const { h, id, create } = await questionHarness();
    const context = selectQuestionContext(
      create(),
      '배경은?',
      h.core.snapshot(id).summary!.claims[0],
      questionRecords,
    );
    const answer = fixtureAnswer(context);
    answer.items[0].evidence.push(...wrongSpeaker(context).items[0].evidence);
    try {
      validateQuestionAnswer(answer, context, questionRecords);
      throw new Error('accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(QuestionCandidateError);
      expect((e as QuestionCandidateError).diagnostic).toMatchObject({
        stage: 'candidate',
        violation: 'speaker',
        actor: 'agent',
        nature: 'user-request',
      });
    }
  });

  it('repairs once, checks the replacement, and never persists candidate text', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let generates = 0,
      repairs = 0,
      checks = 0;
    const phases: string[] = [];
    h.core.events.changed = () => {
      phases.push(h.core.questions.get(id, s.id).turns[0]?.status ?? '');
    };
    h.summary.answerQuestion = async (context, _, validate, repair) => {
      validate();
      if (!repair) {
        generates++;
        return wrongSpeaker(context);
      }
      repairs++;
      expect(repair.diagnostic.violation).toBe('speaker');
      expect(repair.candidate).toEqual(wrongSpeaker(context));
      return fixtureAnswer(context);
    };
    h.summary.checkQuestion = async (_, answer) => {
      checks++;
      return {
        checks: answer.items.map((i) => ({
          itemId: i.id,
          verdict: 'supported',
          reason: 'test double',
        })),
        unknownsSafe: true,
      };
    };
    h.core.questions.submit(id, s.id, { requestId: 'repair', text: '배경은?' });
    await h.core.questions.settled();
    const t = h.core.questions.get(id, s.id).turns[0];
    expect(t.status).toBe('completed');
    expect(t.answer!.items[0].nature).toBe('user-request');
    expect([generates, repairs, checks]).toEqual([1, 1, 1]);
    expect(phases).toContain('repairing');
    const stored = h.repo.get('questionExecution', 'repair')!;
    expect(stored.repairs).toBe(1);
    expect(stored.diagnostics![0].violation).toBe('speaker');
    expect(stored.diagnostics![0].itemId).not.toBe('background');
    expect(JSON.stringify(stored)).not.toContain('30초');
    expect(
      h.core.questions.evidence(id, s.id, t.id, t.answer!.items[0].evidence[0].revisionId).actor,
    ).toBe('user');
  });

  it('shares one repair across manual retry and never checks invalid candidates', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0,
      repairs = 0,
      checks = 0;
    h.summary.answerQuestion = async (c, _, __, repair) => {
      calls++;
      if (repair) repairs++;
      return wrongSpeaker(c);
    };
    h.summary.checkQuestion = async () => {
      checks++;
      throw new Error('must not check');
    };
    h.core.questions.submit(id, s.id, { requestId: 'bad', text: '배경은?' });
    await h.core.questions.settled();
    const t = h.core.questions.get(id, s.id).turns[0];
    expect(t.retryable).toBe(true);
    h.core.questions.retry(id, s.id, t.id, { requestId: 'manual' });
    await h.core.questions.settled();
    expect([calls, repairs, checks]).toEqual([3, 1, 0]);
    expect(h.repo.get('questionExecution', 'manual')!.repairs).toBe(1);
    expect(h.core.questions.get(id, s.id).turns[0]).toMatchObject({
      status: 'failed',
      answer: null,
      retryable: false,
    });
  });

  it.each(['structure', 'citation'] as const)(
    'repairs a completed %s failure and revalidates its replacement',
    async (violation) => {
      const { h, id, create } = await questionHarness(),
        s = create();
      let repairs = 0;
      h.summary.answerQuestion = async (c, _, __, repair) => {
        if (repair) {
          repairs++;
          expect(repair.diagnostic.violation).toBe(violation);
          expect(repair.reason).toBeTruthy();
          return fixtureAnswer(c);
        }
        if (violation === 'structure') return { items: 'invalid' };
        const answer = fixtureAnswer(c);
        answer.items[0].evidence[0].start++;
        return answer;
      };
      h.core.questions.submit(id, s.id, { requestId: violation, text: '배경은?' });
      await h.core.questions.settled();
      expect(repairs).toBe(1);
      expect(h.core.questions.get(id, s.id).turns[0].status).toBe('completed');
    },
  );

  it('caps generation, repair and checks at five calls even after a meaning-check failure', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0,
      generates = 0;
    h.summary.answerQuestion = async (c, _, __, repair) => {
      calls++;
      if (!repair && ++generates === 1) return wrongSpeaker(c);
      return fixtureAnswer(c);
    };
    h.summary.checkQuestion = async () => {
      calls++;
      throw new Error('checker failed');
    };
    h.core.questions.submit(id, s.id, { requestId: 'five', text: '배경은?' });
    await h.core.questions.settled();
    const t = h.core.questions.get(id, s.id).turns[0];
    h.core.questions.retry(id, s.id, t.id, { requestId: 'five-retry' });
    await h.core.questions.settled();
    expect(calls).toBe(5);
    expect(h.core.questions.get(id, s.id).turns[0].retryable).toBe(false);
  });

  it('does not promote a relabeled but unsupported statement after repair', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0;
    h.summary.answerQuestion = async (c, _, __, repair) => {
      calls++;
      const answer = wrongSpeaker(c);
      if (repair) answer.items[0].nature = 'agent-report';
      return answer;
    };
    h.summary.checkQuestion = async (_, answer) => ({
      checks: answer.items.map((i) => ({
        itemId: i.id,
        verdict: 'unsupported',
        reason: 'The text still asserts a direct user request.',
      })),
      unknownsSafe: false,
    });
    h.core.questions.submit(id, s.id, { requestId: 'relabel', text: '배경은?' });
    await h.core.questions.settled();
    const t = h.core.questions.get(id, s.id).turns[0];
    expect(calls).toBe(2);
    expect(t.answer!.items).toEqual([]);
    expect(t.assessment!.checks).toEqual([]);
    expect(
      h.repo
        .get('questionExecution', 'relabel')!
        .diagnostics!.some((d) => d.stage === 'meaning' && d.violation === 'unsupported'),
    ).toBe(true);
  });

  it('does not repair a candidate when termination is unknown', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0;
    h.summary.answerQuestion = async (c) => {
      calls++;
      return wrongSpeaker(c);
    };
    h.summary.resolve = async () => 'unknown';
    h.core.questions.submit(id, s.id, { requestId: 'unknown-speaker', text: '배경은?' });
    await h.core.questions.settled();
    expect(calls).toBe(1);
    expect(h.core.questions.get(id, s.id).turns[0]).toMatchObject({
      status: 'result-unknown',
      retryable: false,
      answer: null,
    });
  });

  it('rechecks scope after termination resolution before starting repair', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0;
    h.summary.answerQuestion = async (c) => {
      calls++;
      return wrongSpeaker(c);
    };
    h.summary.resolve = async () => {
      h.core.questions.end(id, s.id);
      return 'terminated';
    };
    h.core.questions.submit(id, s.id, { requestId: 'scope-before-repair', text: '배경은?' });
    await h.core.questions.settled();
    expect(calls).toBe(1);
    expect(h.repo.get('questionExecution', 'scope-before-repair')!.status).toBe('invalidated');
  });

  it.each(['end', 'disconnect'] as const)(
    'discards a late repair after %s and blocks duplicate submissions during repair',
    async (action) => {
      const { h, id, create } = await questionHarness(),
        s = create();
      let release!: () => void,
        started!: () => void,
        checks = 0;
      const repairing = new Promise<void>((r) => {
        started = r;
      });
      h.summary.answerQuestion = async (c, _, __, repair) => {
        if (!repair) return wrongSpeaker(c);
        started();
        await new Promise<void>((r) => {
          release = r;
        });
        return fixtureAnswer(c);
      };
      h.summary.checkQuestion = async () => {
        checks++;
        throw new Error('must not check');
      };
      const input = { requestId: 'late-repair', text: '배경은?' };
      h.core.questions.submit(id, s.id, input);
      await repairing;
      expect(h.core.questions.submit(id, s.id, input).turns).toHaveLength(1);
      expect(() => h.core.questions.submit(id, s.id, { ...input, requestId: 'duplicate' })).toThrow(
        'previous question',
      );
      if (action === 'end') h.core.questions.end(id, s.id);
      else {
        const link = h.core.links(id)[0];
        h.core.mutate(
          id,
          'link',
          h.command(id, { status: 'separate', linkRevision: link.revision }),
          link.id,
        );
      }
      release();
      await h.core.questions.settled();
      expect(checks).toBe(0);
      expect(h.repo.get('questionExecution', input.requestId)!.status).toBe('invalidated');
    },
  );

  it('distinguishes user records absent from the allowed set from selection omissions', async () => {
    const records = transitionRecords.filter((r) => r.actor === 'agent');
    const { h, id, create } = await questionHarness(records);
    const context = selectQuestionContext(
      create(),
      transitionQuestion,
      h.core.snapshot(id).summary!.claims[0],
      records,
    );
    expect(context.limitations.join('')).toContain('No user statement');
    expect(context.excerpts.every((e) => e.actor === 'agent')).toBe(true);
  });
});
