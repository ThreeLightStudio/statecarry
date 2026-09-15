import { describe, it, expect } from 'vitest';
import { questionHarness, questionRecords, fixtureAnswer } from './question-fixtures';
import {
  selectQuestionContext,
  validateQuestionAnswer,
  assessQuestionAnswer,
} from '../packages/core/src/question-context';
import { source, harness } from './helpers';
import type { QuestionContext } from '@statecarry/contracts';
import {
  questionEvidenceCatalog,
  prepareQuestionContext,
} from '../apps/server/src/adapters/question-prompts';

describe('fixed-record context questions', () => {
  it('resolves evidence IDs to exact offsets without model arithmetic and redacts credentials', async () => {
    const { h, id, create } = await questionHarness();
    const c = selectQuestionContext(
      create(),
      '왜?',
      h.core.snapshot(id).summary!.claims[0],
      questionRecords,
    );
    const catalog = questionEvidenceCatalog(c),
      excerpt = catalog.input.excerpts[0],
      fragment = excerpt.fragments[0];
    const decoded = catalog.decode({
      items: [
        {
          id: 'one',
          kind: 'record',
          nature: 'user-request',
          text: 'User request',
          uncertainty: '',
          evidenceIds: [fragment.evidenceId],
        },
      ],
      unknowns: [],
    });
    expect(decoded.items[0].evidence[0]).toEqual({
      revisionId: excerpt.revisionId,
      start: excerpt.start,
      quote: fragment.text,
    });
    expect(() =>
      catalog.decode({
        items: [{ ...decoded.items[0], evidence: undefined, evidenceIds: ['invented'] }],
        unknowns: [],
      }),
    ).toThrow();
    const secret = 'sk-' + 'a'.repeat(24),
      hostile = { ...c, excerpts: [{ ...c.excerpts[0], text: `앞 ${secret} 뒤` }] };
    const prepared = prepareQuestionContext(hostile);
    expect(prepared.excerpts[0].text).not.toContain(secret);
    expect(prepared.excerpts[0].text.length).toBe(hostile.excerpts[0].text.length);
    expect(questionEvidenceCatalog(hostile).input.excerpts[0].fragments[0].evidenceId).toBeNull();
  });
  it('enforces input, history, turn count and idle-session limits', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    expect(() =>
      h.core.questions.submit(id, s.id, { requestId: 'long', text: '가'.repeat(2001) }),
    ).toThrow();
    for (let i = 0; i < 10; i++) {
      h.core.questions.submit(id, s.id, { requestId: `q${i}`, text: '왜?' });
      await h.core.questions.settled();
    }
    expect(() => h.core.questions.submit(id, s.id, { requestId: 'eleven', text: '왜?' })).toThrow(
      'exchange limit',
    );
    const long = create();
    let accepted = 0;
    for (let i = 0; i < 10; i++) {
      try {
        h.core.questions.submit(id, long.id, { requestId: `large${i}`, text: '왜'.repeat(1999) });
      } catch (e) {
        expect(String(e)).toContain('exchange limit');
        break;
      }
      accepted++;
      await h.core.questions.settled();
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(10);
    h.core.clock.now = () => '2026-09-09T00:00:00Z';
    h.core.questions.sweep();
    expect(() => h.core.questions.get(id, s.id)).toThrow('session');
  });
  it('limits concurrent question admission and revalidates after waiting for a provider slot', async () => {
    const { h, id, create } = await questionHarness();
    const releases: (() => void)[] = [];
    h.summary.answerQuestion = async (c, _, validate) => {
      await new Promise<void>((r) => releases.push(r));
      validate();
      return fixtureAnswer(c);
    };
    const sessions = Array.from({ length: 9 }, create);
    for (let i = 0; i < 8; i++)
      h.core.questions.submit(id, sessions[i].id, { requestId: `pending${i}`, text: '왜?' });
    expect(() =>
      h.core.questions.submit(id, sessions[8].id, { requestId: 'overflow', text: '왜?' }),
    ).toThrow('queue');
    const l = h.core.links(id)[0];
    h.core.mutate(
      id,
      'link',
      h.command(id, { status: 'separate', linkRevision: l.revision }),
      l.id,
    );
    releases.forEach((r) => r());
    await h.core.questions.settled();
    expect(h.core.questions.get(id, sessions[0].id).turns[0].answer).toBeNull();
  });
  it('rejects stale collection scope at session creation', async () => {
    const { h, id, create } = await questionHarness(),
      c = h.repo.get('connection', h.core.work(id).projectId)!;
    h.core.updateConnection(
      c.id,
      h.command(id, {
        title: c.title,
        cwd: c.cwd,
        threadIds: c.threadIds,
        startTurnIds: { 'thread-a': 'turn-5' },
        discover: false,
      }),
    );
    expect(create).toThrow('connection scope');
  });
  it('retrieves omitted background and preserves follow-up reference without changing product entities', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    const before = ['work', 'source', 'summary', 'draft', 'overlay', 'link'].map((k) =>
      JSON.stringify(h.repo.list(k as 'work')),
    );
    let context!: QuestionContext;
    h.summary.answerQuestion = async (c) => {
      context = c;
      return fixtureAnswer(c);
    };
    h.core.questions.submit(id, s.id, { requestId: 'first', text: '왜 이 행동이 필요했나요?' });
    await h.core.questions.settled();
    expect(context.excerpts.some((e) => e.text.includes('30초'))).toBe(true);
    expect(h.core.questions.get(id, s.id).turns[0].answer!.items[0].text).toContain('30초');
    h.core.questions.submit(id, s.id, { requestId: 'follow', text: '그 제안은 왜 나왔나요?' });
    await h.core.questions.settled();
    expect(context.history[0].question).toBe('왜 이 행동이 필요했나요?');
    expect(context.history[0].answer.items[0].text).toContain('30초');
    expect(
      ['work', 'source', 'summary', 'draft', 'overlay', 'link'].map((k) =>
        JSON.stringify(h.repo.list(k as 'work')),
      ),
    ).toEqual(before);
    expect(JSON.stringify(h.repo.list('questionExecution'))).not.toContain('30초');
    expect(JSON.stringify(h.repo.list('questionExecution'))).not.toContain('왜 이 행동');
  });
  it('checks offsets, actor, coverage, missing citations and semantic support; never relabels failures', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    const c = selectQuestionContext(
        s,
        '왜?',
        h.core.snapshot(id).summary!.claims[0],
        questionRecords,
      ),
      a = fixtureAnswer(c);
    expect(validateQuestionAnswer(a, c, questionRecords)).toEqual(a);
    const badOffset = structuredClone(a);
    badOffset.items[0].evidence[0].start++;
    expect(() => validateQuestionAnswer(badOffset, c, questionRecords)).toThrow();
    const missing = structuredClone(a);
    missing.items[0].evidence = [];
    expect(() => validateQuestionAnswer(missing, c, questionRecords)).toThrow();
    const actor = structuredClone(a);
    actor.items[0].evidence = [
      { revisionId: questionRecords[1].id, start: 0, quote: questionRecords[1].text },
    ];
    expect(() => validateQuestionAnswer(actor, c, questionRecords)).toThrow();
    expect(() => validateQuestionAnswer(a, { ...c, excerpts: [] }, questionRecords)).toThrow();
    const result = assessQuestionAnswer(a, {
      checks: [
        {
          itemId: 'background',
          verdict: 'unsupported',
          reason: '실존 인용이 답변을 뒷받침하지 않음',
        },
      ],
      unknownsSafe: false,
    });
    expect(result.answer.items).toEqual([]);
    expect(result.answer.unknowns.join('')).toContain('No verifiable answer');
    expect(() => assessQuestionAnswer(a, { checks: [], unknownsSafe: true })).toThrow();
  });
  it('deduplicates submissions, rejects ID reuse and blocks concurrent turns', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    let calls = 0,
      release!: () => void;
    h.summary.answerQuestion = async (c) => {
      calls++;
      await new Promise<void>((r) => {
        release = r;
      });
      return fixtureAnswer(c);
    };
    const input = { requestId: 'same', text: '왜 필요한가요?' };
    h.core.questions.submit(id, s.id, input);
    h.core.questions.submit(id, s.id, input);
    expect(calls).toBe(1);
    expect(() => h.core.questions.submit(id, s.id, { ...input, text: '다른 질문' })).toThrow(
      'This request ID',
    );
    expect(() => h.core.questions.submit(id, s.id, { ...input, requestId: 'other' })).toThrow(
      'previous question',
    );
    release();
    await h.core.questions.settled();
    expect(h.core.questions.get(id, s.id).turns).toHaveLength(1);
  });
  it('keeps old summary/revision but revokes disconnected scope even when another work links it', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    h.core.questions.submit(id, s.id, { requestId: 'one', text: '왜?' });
    await h.core.questions.settled();
    const ref = h.core.questions.get(id, s.id).turns[0];
    const changed = {
      ...questionRecords[0],
      ...source('원문 수정', 'thread-a', 'item-0'),
      turnId: 'turn-0',
    };
    h.records([changed, ...questionRecords.slice(1)]);
    await h.core.collect(id);
    await h.core.process(id);
    expect(h.core.questions.get(id, s.id).stale).toBe(true);
    expect(h.core.questions.evidence(id, s.id, ref.id, questionRecords[0].id).text).toContain(
      '30초',
    );
    const other = h.connect();
    expect(() => h.core.questions.get(other, s.id)).toThrow();
    const link = h.core.links(id)[0];
    h.core.mutate(
      id,
      'link',
      h.command(id, { status: 'separate', linkRevision: link.revision }),
      link.id,
    );
    expect(() => h.core.questions.evidence(id, s.id, ref.id, questionRecords[0].id)).toThrow();
    expect(h.core.questions.get(id, s.id).invalidated).toBe(true);
  });
  it('discards a late result after disconnect or session end', async () => {
    for (const end of [false, true]) {
      const { h, id, create } = await questionHarness(),
        s = create();
      let release!: () => void;
      h.summary.answerQuestion = async (c) => {
        await new Promise<void>((r) => {
          release = r;
        });
        return fixtureAnswer(c);
      };
      h.core.questions.submit(id, s.id, { requestId: 'late', text: '왜?' });
      if (end) h.core.questions.end(id, s.id);
      else {
        const l = h.core.links(id)[0];
        h.core.mutate(
          id,
          'link',
          h.command(id, { status: 'separate', linkRevision: l.revision }),
          l.id,
        );
      }
      release();
      await h.core.questions.settled();
      expect(h.repo.get('questionExecution', 'late')!.status).toBe('invalidated');
      if (!end) expect(h.core.questions.get(id, s.id).turns[0].answer).toBeNull();
    }
  });
  it('allows one explicit retry only after confirmed failure; unknown termination blocks new sessions too', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    h.summary.answerQuestion = async () => {
      throw new Error('injected');
    };
    h.core.questions.submit(id, s.id, { requestId: 'fail', text: '왜?' });
    await h.core.questions.settled();
    const t = h.core.questions.get(id, s.id).turns[0];
    expect(t.retryable).toBe(true);
    h.core.questions.retry(id, s.id, t.id, { requestId: 'retry' });
    await h.core.questions.settled();
    expect(h.core.questions.get(id, s.id).turns[0].retryable).toBe(false);
    expect(() => h.core.questions.retry(id, s.id, t.id, { requestId: 'retry-again' })).toThrow();
    const next = create();
    h.summary.resolve = async () => 'unknown';
    h.core.questions.submit(id, next.id, { requestId: 'unknown', text: '왜?' });
    await h.core.questions.settled();
    expect(h.repo.get('questionExecution', 'unknown')!.status).toBe('result-unknown');
    expect(() =>
      h.core.questions.submit(id, create().id, { requestId: 'new', text: '왜?' }),
    ).toThrow('ended');
    const counts = h.counts();
    h.records([source('새로 수집한 기록')]);
    await h.core.collect(id);
    await h.core.process(id);
    expect(h.counts()).toEqual(counts);
  });
  it('recovers only execution metadata without resurrecting text or replaying a lost request', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    h.core.questions.submit(id, s.id, { requestId: 'persisted', text: '왜?' });
    await h.core.questions.settled();
    const prior = h.repo.get('questionExecution', 'persisted')!;
    h.repo.put('questionExecution', {
      ...prior,
      status: 'generating',
      remote: { pid: 123, threadId: null, turnId: null, phase: 'question-generate' },
    });
    const restarted = harness(h.repo);
    await restarted.core.questions.recover();
    expect(h.repo.get('questionExecution', 'persisted')!.status).toBe('invalidated');
    expect(() =>
      restarted.core.questions.submit(id, s.id, { requestId: 'persisted', text: '왜?' }),
    ).toThrow('session');
    h.repo.put('questionExecution', { ...prior, status: 'queued', remote: null });
    await restarted.core.questions.recover();
    expect(h.repo.get('questionExecution', 'persisted')!.status).toBe('result-unknown');
  });
  it('bounds context while preserving offsets and original order, and reports omitted coverage', async () => {
    const { h, id, create } = await questionHarness(),
      s = create();
    const records = Array.from({ length: 30 }, (_, i) => ({
      ...source('배경 원인 '.repeat(2000), 'thread-a', `long-${i}`),
      turnId: `turn-${i}`,
    }));
    const c = selectQuestionContext(
      s,
      '배경 원인',
      h.core.snapshot(id).summary!.claims[0],
      records,
    );
    expect(new Set(c.excerpts.map((e) => e.turnId)).size).toBeLessThanOrEqual(12);
    expect(c.excerpts.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(24000);
    for (const e of c.excerpts)
      expect(
        records.find((s) => s.id === e.revisionId)!.text.slice(e.start, e.start + e.text.length),
      ).toBe(e.text);
    expect(c.limitations.join('')).toContain('Only excerpts');
  });
});
