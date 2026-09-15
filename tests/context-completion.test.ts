import { expect, it } from 'vitest';
import { contextHarness, contextRecords as r } from './context-first-fixtures';
import { source } from './helpers';
import { fixtureAssessment } from './explanation-fixtures';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { renderToStaticMarkup } = requireWeb(
  'react-dom/server',
) as typeof import('react-dom/server');
const { createElement } = requireWeb('react') as typeof import('react');
import { GoalChoices } from '../apps/web/src/ui/Goals';
import type { AppViewModel } from '@statecarry/presentation';

it('G1/G3: accepts a non-candidate goal as current input without borrowing another connection or changing ranges', async () => {
  const h = contextHarness();
  h.records.set('session-a', [source('Ship the billing page', 'session-a', 'ship')]);
  const c = h.repo.get('connection', h.core.work(h.project).projectId)!;
  h.core.updateConnection(
    c.id,
    h.command(h.project, {
      title: c.title,
      cwd: c.cwd,
      threadIds: ['session-a'],
      discover: false,
      startTurnIds: {},
      recordRanges: {
        'session-a': {
          start: { turnId: 'turn-a', itemId: 'ship' },
          end: { turnId: 'turn-a', itemId: 'ship' },
        },
      },
    }),
  );
  await h.core.collect(h.project);
  expect(h.core.goalCandidates(h.project)).toEqual([]);
  const before = h.repo.get('connection', c.id)!;
  const command = h.command(h.project, { text: 'Ship the billing page' });
  const receipt = h.core.describeGoal(h.project, command);
  expect(h.core.describeGoal(h.project, command)).toEqual(receipt);
  expect(h.repo.get('connection', c.id)).toEqual({ ...before, title: 'Ship the billing page' });
  expect(h.core.work(h.project).goal).toMatchObject({
    origin: 'user-input',
    text: 'Ship the billing page',
  });
  expect(h.core.work(h.project).goal?.evidenceId).toBeUndefined();
  await h.core.process(h.project);
  expect(h.core.snapshot(h.project).summary).not.toBeNull();
  expect(h.core.sources(h.project).map((s) => s.itemId)).toEqual(['ship']);
  expect(() => h.core.describeGoal(h.project, h.command(h.project, { text: ' ' }))).toThrow();
  await h.core.close();
});

it('G2: reconfirming a goal withdraws previous explanations even when sources stay accessible', async () => {
  const h = contextHarness();
  h.summary.generateExplanation = async (ctx) => ({
    sections: [{ id: 'body', title: 'Current', bodyIds: ['state'] }],
    nodes: [
      {
        id: 'state',
        role: 'state',
        kind: 'interpretation',
        nature: 'agent-interpretation',
        text: 'Selected goal state',
        condition: '',
        uncertainty: 'Selected input only',
        unknowns: [],
        evidence: [
          { revisionId: ctx.excerpts[0].revisionId, start: 0, quote: ctx.excerpts[0].text },
        ],
      },
    ],
    links: [],
    unknowns: [],
  });
  h.summary.checkExplanation = async (_, candidate) => fixtureAssessment(candidate);
  await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find((c) => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(
    h.project,
    h.command(h.project, { candidateId: candidate.id, action: 'confirm' }),
  ).workId;
  await h.core.collect(id);
  await h.core.process(id);
  await h.core.explanations.settled();
  const previous = h.core.explanations.view(id).revision!;
  expect(previous).not.toBeNull();
  const connection = h.repo.get('connection', h.core.work(id).projectId)!;
  h.core.describeGoal(id, h.command(id, { text: 'Only understand the CSV content checks' }));
  expect(h.core.snapshot(id).summary).toBeNull();
  expect(h.core.explanations.view(id).revision).toBeNull();
  expect(() => h.core.explanations.get(id, previous.id)).toThrow('Goal changed');
  expect(h.repo.get('connection', connection.id)?.recordRanges).toEqual(connection.recordRanges);
  await h.core.process(id);
  await h.core.explanations.settled();
  expect(h.core.explanations.view(id).revision?.input.goal?.intent.origin).toBe('user-input');
  await h.core.close();
});

it('G2: missing goal evidence leaves a recovery entry point and reconfirmation unblocks analysis', async () => {
  const h = contextHarness();
  await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find((c) => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(
    h.project,
    h.command(h.project, { candidateId: candidate.id, action: 'confirm' }),
  ).workId;
  await h.core.collect(id);
  h.records.set('session-a', r.A.slice(1));
  await h.core.collect(id);
  expect(h.core.snapshot(id).work.goal).toBeDefined();
  expect(h.core.snapshot(id).work.goal?.text).toBe('');
  h.core.describeGoal(id, h.command(id, { text: 'Review the still available CSV checks' }));
  expect(h.core.snapshot(id).work.goal?.origin).toBe('user-input');
  expect(h.core.sources(id).some((s) => s.itemId === 'A1')).toBe(false);
  await h.core.close();
});

it('legacy goal entry opens Resume without creating another work', () => {
  const html = renderToStaticMarkup(
    createElement(GoalChoices, {
      state: { goalCandidates: [] } as unknown as AppViewModel,
      onAction: () => {},
    }),
  );
  expect(html).toContain('Open Resume');
  expect(html).toContain('#/resume/');
  expect(html).not.toContain('Read this goal');
});

it('V1/V3/V4: restores the chosen report after range expansion, adopts verified result, withdraws D and prunes handoff selection', async () => {
  const { Controller } = await import('@statecarry/presentation');
  const h = contextHarness();
  h.summary.generateExplanation = async (ctx) => {
    const e =
      ctx.excerpts.find((e) => e.itemId === 'D3b') ??
      ctx.excerpts.find((e) => e.itemId === 'D3a') ??
      ctx.excerpts.find((e) => e.itemId === 'B3')!;
    return {
      sections: [{ id: 'body', title: 'Scope state', bodyIds: ['state'] }],
      nodes: [
        {
          id: 'state',
          role: 'state',
          kind: 'interpretation',
          nature: 'agent-interpretation',
          text: e.itemId,
          condition: '',
          uncertainty: 'Selected input',
          unknowns: [],
          evidence: [{ revisionId: e.revisionId, start: e.start, quote: e.text }],
        },
      ],
      links: [],
      unknowns: [],
    };
  };
  h.summary.checkExplanation = async (_, candidate) => fixtureAssessment(candidate);
  await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find((c) => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(
    h.project,
    h.command(h.project, { candidateId: candidate.id, action: 'confirm' }),
  ).workId;
  const run = async () => {
    await h.core.collect(id);
    await h.core.process(id);
    await h.core.explanations.settled();
  };
  await run();
  const memory = new Map<string, import('@statecarry/presentation').LocalWorkState>();
  const controller = new Controller(
    {
      projects: async () => h.core.listProjects(),
      connections: async () => h.repo.list('connection'),
      snapshot: async (id) => h.core.snapshot(id),
      evidence: async (sid, wid) => h.core.evidence(sid, wid),
      discover: h.reader.discover,
      subscribe: () => () => {},
      command: async () => {
        throw new Error('Unexpected mutation');
      },
      receipt: async () => {
        throw new Error('Unexpected receipt');
      },
      explanation: async <T>(path: string) =>
        h.core.explanations.get(id, path.split('/').at(-1)!) as T,
    },
    {
      read: (id) => memory.get(id) ?? null,
      write: (id, value) => {
        memory.set(id, value);
      },
    },
    h.core.ids.next,
  );
  await controller.start(`#/work/${id}`);
  const scope = (end?: string) => {
    const c = h.repo.get('connection', h.core.work(id).projectId)!;
    h.core.updateConnection(
      c.id,
      h.command(id, {
        title: c.title,
        cwd: c.cwd,
        threadIds: end
          ? ['session-a', 'session-b', 'session-c', 'session-d']
          : ['session-a', 'session-b', 'session-c'],
        startTurnIds: {},
        discover: false,
        recordRanges: {
          'session-a': c.recordRanges!['session-a'],
          ...(end
            ? {
                'session-d': {
                  start: { turnId: 'turn-a', itemId: 'D2' },
                  end: { turnId: 'turn-a', itemId: end },
                },
              }
            : {}),
        },
      }),
    );
  };
  scope('D3a');
  await run();
  await controller.refresh();
  expect(controller.getSnapshot().explanation?.newAvailable).toBe(true);
  await controller.action({ type: 'explanationAdopt' });
  const reportId = controller.getSnapshot().explanation?.revision?.id;
  expect(controller.getSnapshot().explanation?.revision?.candidate.nodes[0].text).toBe('D3a');
  await controller.action({ type: 'draft', value: 'Keep my draft' });
  scope('D3b');
  await controller.refresh();
  expect(memory.get(id)?.readingExplanationId).toBe(reportId);
  await h.core.collect(id);
  await controller.refresh();
  expect(controller.getSnapshot().explanation?.revision?.id).toBe(reportId);
  await h.core.process(id);
  await h.core.explanations.settled();
  await controller.refresh();
  expect(controller.getSnapshot().explanation?.newAvailable).toBe(true);
  await controller.action({ type: 'explanationAdopt' });
  expect(controller.getSnapshot().projects.find((p) => p.workId === id)?.current).toBe('D3b');
  await controller.action({ type: 'target', threadId: 'session-d' });
  await controller.action({ type: 'selectEvidence', id: r.D[3].id, selected: true });
  scope();
  await controller.refresh();
  expect(controller.getSnapshot().projects.find((p) => p.workId === id)?.current).not.toBe('D3b');
  expect(controller.getSnapshot().local).toMatchObject({
    draft: 'Keep my draft',
    targetThreadId: '',
    evidenceIds: [],
  });
  expect(() => h.core.evidence(r.D[3].id, id)).toThrow();
  expect(h.core.evidence(r.B[2].id, id).itemId).toBe('B3');
  controller.stop();
  await h.core.close();
});

it('G2: changed candidate text is re-proposed instead of reusing obsolete confirmed evidence', async () => {
  const h = contextHarness();
  await h.core.collect(h.project);
  const first = h.core.goalCandidates(h.project).find((c) => c.evidenceId === r.A[0].id)!;
  h.core.chooseGoal(h.project, h.command(h.project, { candidateId: first.id, action: 'confirm' }));
  const changed = {
    ...source('목표를 바꿔서 청구서 화면만 확인해줘.', 'session-a', 'A1'),
    actor: 'user' as const,
    kind: 'userMessage',
  };
  h.records.set('session-a', [changed, ...r.A.slice(1)]);
  await h.core.collect(h.project);
  const next = h.core.goalCandidates(h.project).find((c) => c.id === first.id)!;
  expect(next).toMatchObject({ evidenceId: changed.id, quote: changed.text, status: 'proposed' });
  expect(next.workId).toBeUndefined();
  await h.core.close();
});

it('G2/G3: a late summary from before reconfirmation cannot publish under the revised goal', async () => {
  const h = contextHarness();
  await h.core.collect(h.project);
  h.core.describeGoal(
    h.project,
    h.command(h.project, { text: 'Understand the original CSV checks' }),
  );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const generate = h.summary.generate;
  h.summary.generate = async (...args) => {
    entered();
    await gate;
    return generate(...args);
  };
  const pending = h.core.process(h.project);
  await started;
  h.core.describeGoal(
    h.project,
    h.command(h.project, { text: 'Understand only the error notification checks' }),
  );
  release();
  await pending;
  expect(h.core.snapshot(h.project).summary).toBeNull();
  expect(h.repo.list('job').some((j) => j.status === 'superseded')).toBe(true);
  h.summary.generate = generate;
  await h.core.process(h.project);
  expect(h.core.snapshot(h.project).summary?.inputVersion).toBe(
    h.core.work(h.project).inputVersion,
  );
  await h.core.close();
});

it('G2/G3: current user goal and unchanged closed ranges survive SQLite reopen', async () => {
  const { SQLiteRepository } = await import('../apps/server/src/adapters/sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'statecarry-context-completion-'));
  let repo = new SQLiteRepository(directory);
  const h = contextHarness(repo);
  try {
    await h.core.collect(h.project);
    const c = h.repo.get('connection', h.core.work(h.project).projectId)!;
    h.core.updateConnection(
      c.id,
      h.command(h.project, {
        title: c.title,
        cwd: c.cwd,
        threadIds: ['session-d'],
        startTurnIds: {},
        discover: false,
        recordRanges: {
          'session-d': {
            start: { turnId: 'turn-a', itemId: 'D2' },
            end: { turnId: 'turn-a', itemId: 'D3a' },
          },
        },
      }),
    );
    await h.core.collect(h.project);
    h.core.describeGoal(
      h.project,
      h.command(h.project, { text: 'Understand the reported Chrome retest' }),
    );
    const expected = h.core.work(h.project).goal;
    await h.core.close();
    repo.close();
    repo = new SQLiteRepository(directory);
    expect(repo.get('work', h.project)?.goal).toEqual(expected);
    expect(repo.get('connection', c.id)?.recordRanges?.['session-d'].end?.itemId).toBe('D3a');
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('M1/M5: every summary claim, including missing and rejected claims, requires its own assessment', async () => {
  const { summaryCheckCatalog } = await import('../apps/server/src/adapters/analysis-support');
  const { candidate } = await import('./helpers');
  const c = candidate(r.A[0]);
  c.claims[3] = { ...c.claims[3], text: null, evidence: [], missing: 'not-in-record' };
  const catalog = summaryCheckCatalog(c);
  const checks = Object.fromEntries(
    c.claims.map((claim) => [
      claim.id,
      {
        verdict: claim.text ? 'unsupported' : 'supported',
        reason: 'An assessed decision, never an omitted claim',
      },
    ]),
  );
  expect(catalog.decode({ checks }).checks).toHaveLength(c.claims.length);
  delete checks.next;
  expect(() => catalog.decode({ checks })).toThrow();
  expect(() =>
    catalog.decode({ checks: [{ claimId: 'purpose', verdict: 'supported', reason: 'Only one' }] }),
  ).toThrow();
});

it('V4: selecting a saved closed question reopens its preserved input after restoration', async () => {
  const { QuestionController, emptyQuestionView } =
    await import('../packages/presentation/src/questions');
  let view = emptyQuestionView();
  const controller = new QuestionController(
    {} as import('@statecarry/presentation').Gateway,
    () => 'request',
    (next) => {
      view = next;
    },
  );
  controller.openExplanation('work', 'old-summary', 'old-explanation', 'state', 'Earlier result');
  await controller.action({ type: 'questionInput', value: 'Keep this earlier question' });
  const saved = controller.saved('work');
  controller.reset(false);
  controller.restore(saved);
  controller.openExplanation('work', 'new-summary', 'new-explanation', 'state', 'Current result');
  const earlier = view.savedTargets!.find((t) => t.key.includes('old-explanation'))!;
  await controller.action({ type: 'questionSelect', key: earlier.key });
  expect(view).toMatchObject({
    open: true,
    input: 'Keep this earlier question',
    targetKey: earlier.key,
  });
  controller.reset(false);
});

it('M1: semantic repair recomposes an incomplete integrated judgment instead of appending a duplicate state', async () => {
  const { explanationHarness, contextFromInput } = await import('./explanation-fixtures');
  const { explanationRepairCatalog } =
    await import('../apps/server/src/adapters/explanation-prompts');
  const t = await explanationHarness();
  t.prepare();
  const view = await t.settled();
  const context = contextFromInput(view.revision!.input);
  context.input.goal = {
    intent: {
      text: 'Understand the recorded work',
      origin: 'user-input',
      confirmedAt: '2026-09-14T00:00:00Z',
    },
    relations: [],
    recordRanges: {},
  };
  const e = context.excerpts[0];
  const candidate = {
    sections: [{ id: 'current', title: 'Current', bodyIds: ['state'] }],
    nodes: [
      {
        id: 'state',
        role: 'state' as const,
        kind: 'interpretation' as const,
        nature: 'agent-interpretation' as const,
        text: 'Current bounded judgment',
        uncertainty: 'Selected input',
        condition: '',
        unknowns: [],
        evidence: [{ revisionId: e.revisionId, start: e.start, quote: e.text.slice(0, 100) }],
      },
    ],
    links: [],
    unknowns: [],
  };
  const assessment = { ...fixtureAssessment(candidate), narrativeComplete: false };
  const catalog = explanationRepairCatalog(context, candidate, assessment);
  const replacement = {
    role: 'state',
    kind: 'interpretation',
    nature: 'agent-interpretation',
    text: 'Recomposed bounded judgment',
    uncertainty: 'Selected input',
    condition: '',
    unknowns: [],
    evidenceIds: ['e0-0'],
  };
  const valid = { nodes: { state: replacement }, links: {}, additions: [] };
  expect(catalog.decode(valid).nodes[0].text).toBe('Recomposed bounded judgment');
  expect(() =>
    catalog.decode({
      ...valid,
      nodes: { state: { ...replacement, evidenceIds: ['invented-citation'] } },
    }),
  ).toThrow();
  expect(() => catalog.decode({ ...valid, nodes: {} })).toThrow();
  expect(() =>
    catalog.decode({
      ...valid,
      additions: [
        {
          beforeSectionId: 'end',
          section: { title: 'Another current', body: [{ ...replacement, reasons: [] }] },
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    catalog.decode({
      ...valid,
      additions: [
        {
          beforeSectionId: 'current',
          section: { title: 'Another current', body: [{ ...replacement, reasons: [] }] },
        },
      ],
    }),
  ).toThrow();
  await t.h.core.close();
});
