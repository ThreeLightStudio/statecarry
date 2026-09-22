import { parseProjectRoute } from '@statecarry/presentation';
import { describe, it, expect } from 'vitest';
import { harness, source } from './helpers';
import { StateCarry } from '@statecarry/core';
import type { AnalysisCandidate } from '@statecarry/contracts';
const candidate = (status: AnalysisCandidate['status'] = 'active'): AnalysisCandidate => ({
  key: 'goal-a',
  goal: 'Fix export',
  currentState: 'The export implementation exists; the regression check is still open.',
  status,
  reason: 'The export check remains open.',
  nextAction: 'Run the export regression check',
  actionSource: 'recorded',
  doneWhen: 'The regression result is recorded',
  threadId: 'thread-a',
  prerequisites: ['Use the connected project'],
  evidence: [{ revisionId: source().id, quote: source().text }],
});
function ready() {
  const h = harness(),
    id = h.connect();
  h.summary.generateAnalysis = async () => ({ candidates: [candidate()] });
  return { ...h, id };
}
describe('resume safety and persistence', () => {
  it('creates a cited active candidate without the narrative pipeline', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    expect(h.core.analyses.view(h.id).candidates[0].doneWhen).toBeTruthy();
    expect(h.counts().generationCalls).toBe(0);
  });
  it.each(['waiting', 'paused', 'unclear', 'done'] as const)(
    'does not expose an action for %s',
    async (status) => {
      const h = ready();
      h.summary.generateAnalysis = async () => ({ candidates: [candidate(status)] });
      await h.core.analyses.refresh(h.id);
      expect(h.core.analyses.view(h.id).candidates[0]).toMatchObject({
        status: status === 'done' ? 'unclear' : status,
        nextAction: null,
        doneWhen: null,
        actionSource: null,
      });
    },
  );
  it('rejects active without completion condition and invented evidence or location', async () => {
    for (const patch of [
      { doneWhen: null },
      { evidence: [{ revisionId: source().id, quote: 'invented' }] },
      { threadId: 'outside' },
    ]) {
      const h = ready();
      h.summary.generateAnalysis = async () => ({ candidates: [{ ...candidate(), ...patch }] });
      await h.core.analyses.refresh(h.id);
      expect(h.core.analyses.view(h.id).candidates).toEqual([]);
      expect(h.core.analyses.view(h.id).error).toBeTruthy();
    }
  });
  it('keeps the last brief visible while blocking actions when collection fails', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    h.reader.read = async () => {
      throw new Error('offline');
    };
    await h.core.collect(h.id);
    expect(h.core.analyses.view(h.id)).toMatchObject({
      state: 'limited',
      stale: true,
      candidates: [expect.objectContaining({ key: 'goal-a' })],
    });
    const other = ready();
    await other.core.analyses.refresh(other.id);
    other.records([source('changed', 'thread-a', 'different-record')]);
    await other.core.collect(other.id);
    expect(other.core.analyses.view(other.id).candidates).toEqual([
      expect.objectContaining({ key: 'goal-a' }),
    ]);
  });
  it('persists correction across service restart and supplies it to later analysis', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    const view = h.core.analyses.view(h.id);
    h.core.analyses.correct(h.id, {
      candidateKey: 'goal-a',
      version: view.version,
      kind: 'wrong-action',
      nextAction: 'Check the saved export',
      doneWhen: 'The saved output is inspected',
    });
    const restarted = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
    );
    expect(restarted.analyses.view(h.id).candidates[0].nextAction).toBe('Check the saved export');
    let input: any;
    h.summary.generateAnalysis = async (value) => {
      input = value;
      return { candidates: [candidate()] };
    };
    await restarted.analyses.refresh(h.id);
    expect(input.corrections[0].nextAction).toBe('Check the saved export');
  });
  it('allows dismiss/restore and rejects stale correction versions', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    const view = h.core.analyses.view(h.id),
      correction = { candidateKey: 'goal-a', version: view.version, kind: 'wrong-work' };
    h.core.analyses.correct(h.id, correction);
    expect(h.core.analyses.view(h.id).dismissedKeys).toEqual(['goal-a']);
    h.core.analyses.correct(h.id, { ...correction, kind: 'restore' });
    expect(h.core.analyses.view(h.id).dismissedKeys).toEqual([]);
    expect(() => h.core.analyses.correct(h.id, { ...correction, version: 'old' })).toThrow(
      'changed',
    );
  });
  it('answers task discussion from the current task evidence without changing task state', async () => {
    const h = ready();
    h.summary.answerQuestion = async (context) => {
      const excerpt = context.excerpts.find((item) => item.revisionId === source().id)!;
      return {
        items: [
          {
            id: 'task-reason',
            kind: 'record',
            nature: 'user-request',
            text: 'The connected record still establishes the task basis.',
            uncertainty: '',
            evidence: [
              { revisionId: excerpt.revisionId, start: excerpt.start, quote: excerpt.text },
            ],
          },
        ],
        unknowns: ['The records do not decide whether the user should continue.'],
      };
    };
    h.summary.checkQuestion = async (_, answer) => ({
      checks: answer.items.map((item) => ({
        itemId: item.id,
        verdict: 'supported' as const,
        reason: 'The answer cites the current task evidence.',
      })),
      unknownsSafe: true,
    });
    await h.core.analyses.refresh(h.id);
    h.core.projectModel.createWork(h.id, { title: 'Export validation' }, 'discussion-work');
    const workItemId = h.core.projectModel.view(h.id).workItems[0].id;
    const before = h.core.analyses.view(h.id);
    const workBeforeDiscussion = h.core.projectModel.view(h.id).workItems[0];
    const response = await h.core.analyses.discuss(h.id, {
      workItemId,
      version: before.version,
      question: 'Why does this task still matter?',
      history: [],
    });
    expect(response.answer.items[0]).toMatchObject({
      kind: 'record',
      text: 'The connected record still establishes the task basis.',
    });
    expect(response.answer.unknowns).toContain(
      'The records do not decide whether the user should continue.',
    );
    expect(h.core.analyses.view(h.id).candidates[0]).toMatchObject({
      key: 'goal-a',
      status: 'active',
      nextAction: 'Run the export regression check',
    });
    expect(h.core.projectModel.view(h.id).discussions[0].workItemId).toBe(workItemId);
    expect(h.core.projectModel.view(h.id).workItems[0]).toEqual(workBeforeDiscussion);
    h.core.analyses.correct(h.id, {
      candidateKey: 'goal-a',
      version: before.version,
      kind: 'wrong-work',
    });
    const stopped = h.core.analyses.view(h.id);
    await h.core.analyses.discuss(h.id, {
      workItemId,
      version: stopped.version,
      question: 'Should I reconsider stopping?',
      history: [],
    });
    expect(h.core.analyses.view(h.id).dismissedKeys).toContain('goal-a');
  });
  it('waits for an in-progress collection before analyzing', async () => {
    const h = ready();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const read = h.reader.read;
    h.reader.read = async (...args) => {
      await gate;
      return read(...args);
    };
    const collecting = h.core.collect(h.id);
    const analysis = h.core.analyses.refresh(h.id);
    release();
    await collecting;
    await analysis;
    expect(h.core.analyses.view(h.id).error).toBeNull();
    expect(h.core.analyses.view(h.id).candidates).toHaveLength(1);
  });
  it('rejects analysis that races a user correction', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.summary.generateAnalysis = async () => {
      await gate;
      return { candidates: [candidate()] };
    };
    const run = h.core.analyses.refresh(h.id);
    await new Promise((r) => setTimeout(r, 0));
    h.core.analyses.correct(h.id, {
      candidateKey: 'goal-a',
      version: h.core.analyses.view(h.id).version,
      kind: 'paused',
    });
    release();
    await run;
    expect(h.core.analyses.view(h.id).candidates[0].status).toBe('paused');
    expect(h.core.analyses.view(h.id).error).toContain('changed');
  });
});

describe('resume coordination role', () => {
  it('does not treat an ordinary completion-criteria question as coordination', async () => {
    const h = harness(),
      id = h.connect();
    h.records([source('What are the completion criteria?', 'thread-a', 'question')]);
    await h.core.collect(id);
    expect(h.core.analyses.view(id).coordination?.state).toBe('unconfirmed');
  });

  it('recommends a conversation only when the user assigns it coordination', async () => {
    const h = harness(),
      id = h.connect();
    h.records([
      source(
        'Use this conversation as the source of truth for overall progress.',
        'thread-a',
        'coordination',
      ),
    ]);
    await h.core.collect(id);
    expect(h.core.analyses.view(id).coordination).toMatchObject({
      state: 'recommended',
      threadId: 'thread-a',
    });
  });

  it.each([
    'Do not use this conversation as the source of truth for overall progress.',
    'Should we use this conversation as the source of truth for overall progress?',
    'The agent said use this conversation as the source of truth for overall progress.',
    '"Use this conversation as the source of truth for overall progress."',
  ])('does not infer coordination from %s', async (text) => {
    const h = harness(),
      id = h.connect();
    h.records([source(text, 'thread-a', 'not-coordination')]);
    await h.core.collect(id);
    expect(h.core.analyses.view(id).coordination?.state).toBe('unconfirmed');
  });
});

describe('same-work resume entry and goal editing', () => {
  it('saves an explicit goal in place, preserving record scope and invalidating the old action', async () => {
    const h = ready();
    await h.core.analyses.refresh(h.id);
    const before = h.repo.list('connection'),
      view = h.core.analyses.view(h.id);
    h.core.analyses.setGoal(h.id, {
      text: 'Ship the minimal Resume experience',
      version: view.version,
    });
    expect(h.repo.list('project')).toHaveLength(1);
    expect(h.repo.list('connection')).toHaveLength(1);
    expect(h.repo.list('connection')[0].threadIds).toEqual(before[0].threadIds);
    expect(h.core.analyses.view(h.id)).toMatchObject({
      goalText: 'Ship the minimal Resume experience',
      goalOrigin: 'user-input',
      stale: true,
      candidates: [],
    });
    expect(() =>
      h.core.analyses.setGoal(h.id, { text: 'stale change', version: view.version }),
    ).toThrow('changed');
  });
  it('never displays transport headers as the connected work label', async () => {
    const h = ready(),
      c = h.repo.list('connection')[0];
    h.repo.put('connection', {
      ...c,
      title: '## Referenced chats with Codex: These are live references',
    });
    expect(h.core.analyses.view(h.id).title).toBe('example');
  });
});

it('publishes a fixed input snapshot when newer records arrive without scope changes', async () => {
  const h = ready();
  await h.core.collect(h.id);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  h.summary.generateAnalysis = async () => {
    await gate;
    return { candidates: [candidate()] };
  };
  const task = h.core.analyses.refresh(h.id);
  await new Promise((r) => setTimeout(r, 0));
  h.records([source(), source('New progress arrived', 'thread-a', 'new-item')]);
  await h.core.collect(h.id);
  release();
  await task;
  expect(h.core.analyses.view(h.id)).toMatchObject({
    stale: false,
    updatesAvailable: true,
    error: null,
  });
  expect(h.core.analyses.view(h.id).candidates).toHaveLength(1);
});

it('rechecks incompatible saved briefs instead of showing clipped progress text', async () => {
  const h = ready();
  await h.core.analyses.refresh(h.id);
  const work = h.core.project(h.id);
  const analysis = h.core.analysisRecord(work.id)!;
  analysis.result.candidates[0].currentState = 'Clipped fragment';
  h.repo.put('projectAnalysis', analysis);
  expect(h.core.analyses.view(h.id)).toMatchObject({ stale: true, candidates: [] });
});

it('retains actual requests despite verbose tool logs and excludes prior resume predictions', async () => {
  const h = ready(),
    request = source('Fix the same-work Resume entry.');
  const tools = Array.from({ length: 30 }, (_, i) => ({
    ...source('tool detail '.repeat(1000), 'thread-a', `tool-${i}`),
    actor: 'tool' as const,
  }));
  const echo = {
    ...source(
      '{"currentState":"An old prediction","nextAction":"Repeat old work"}',
      'thread-a',
      'echo',
    ),
    actor: 'tool' as const,
  };
  h.records([request, ...tools, echo]);
  let input: any;
  h.summary.generateAnalysis = async (value) => {
    input = value;
    return {
      candidates: [{ ...candidate(), evidence: [{ revisionId: request.id, quote: request.text }] }],
    };
  };
  await h.core.analyses.refresh(h.id);
  expect(input.records.some((r: any) => r.revisionId === request.id)).toBe(true);
  expect(input.records.some((r: any) => r.revisionId === echo.id)).toBe(false);
  expect(input.records.reduce((n: number, r: any) => n + r.text.length, 0)).toBeLessThanOrEqual(
    72000,
  );
});
