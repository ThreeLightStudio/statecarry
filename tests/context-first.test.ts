import { expect, it } from 'vitest';
import { contextHarness, contextRecords as r } from './context-first-fixtures';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectExplanationRanges } from '../packages/core/src/explanation-context';
import { source } from './helpers';
import { fixtureAssessment } from './explanation-fixtures';

it('UX1–UX2: proposes distinct goals, persists choices, and includes explicit followup and parallel sources', async () => {
  const h = contextHarness(); await h.core.collect(h.project);
  const choices = h.core.goalCandidates(h.project);
  expect(choices.map(c => c.quote).join(' ')).toContain('청구서');
  expect(choices.filter(c => c.status === 'proposed')).toHaveLength(2);
  expect(choices.find(c => c.evidenceId === r.X[0].id)?.status).toBe('dismissed');
  const candidate = choices.find(c => c.evidenceId === r.A[0].id)!;
  const command = h.command(h.project, { candidateId: candidate.id, action: 'confirm' });
  const chosen = h.core.chooseGoal(h.project, command);
  expect(h.core.chooseGoal(h.project, command)).toEqual(chosen);
  expect(h.core.links(chosen.workId).filter(l => l.status === 'linked').map(l => l.threadId)).toEqual(['session-a', 'session-b', 'session-c']);
  await h.core.collect(chosen.workId);
  expect(h.core.sources(chosen.workId).map(s => s.itemId)).toEqual([...r.A, ...r.B, ...r.C].map(s => s.itemId));
  expect(h.core.goalCandidates(h.project).find(c => c.id === candidate.id)?.status).toBe('confirmed');
  const other = choices.find(c => c.evidenceId === r.X[0].id)!;
  h.core.chooseGoal(h.project, h.command(h.project, { candidateId: other.id, action: 'dismiss' }));
  await h.core.collect(h.project);
  expect(h.core.goalCandidates(h.project).find(c => c.id === other.id)?.status).toBe('dismissed');
});

it('UX3–UX4 publishes an initial explanation and schedules another after dedicated followup discovery', async () => {
  const h = contextHarness(); await h.core.collect(h.project);
  h.summary.generateExplanation = async context => {
    const e = context.excerpts[0];
    return { sections: [{ id: 'body', title: 'Current goal', bodyIds: ['state'] }], nodes: [{ id: 'state', role: 'state', kind: 'interpretation', nature: 'agent-interpretation', text: '선택한 CSV 목표의 현재 조건을 확인합니다.', uncertainty: '합성 화면 및 상태 전이 검사 대역입니다.', condition: '', unknowns: [], evidence: [{ revisionId: e.revisionId, start: e.start, quote: e.text }] }], links: [], unknowns: [] };
  };
  h.summary.checkExplanation = async (_, candidate) => fixtureAssessment(candidate);
  const candidate = h.core.goalCandidates(h.project).find(c => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(h.project, h.command(h.project, { candidateId: candidate.id, action: 'confirm' })).workId;
  await h.core.collect(id); await h.core.process(id); await h.core.explanations.settled();
  const first = h.core.explanations.view(id).revision!;
  expect(first).toBeTruthy();
  h.records.set('session-e', r.E);
  await h.core.discover(h.core.repo.get('connection', h.core.work(id).projectId)!);
  await h.core.collect(id); await h.core.process(id);
  // Do not hide preparation errors behind the old, still-accessible explanation.
  h.core.explanations.prepare(id, { requestId: h.core.ids.next(), summaryId: h.core.work(id).latestSummaryId });
  h.core.explanations.tick(); await h.core.explanations.settled();
  const next = h.core.explanations.view(id);
  expect(next.revision?.summaryId).toBe(h.core.work(id).latestSummaryId);
  expect(next.revision?.id).not.toBe(first.id);
  expect(next.accessibleIds).toContain(first.id);
});

it('C07/C08: keeps a missing-session condition separate from a scope withdrawal and preserves stored sources', async () => {
  const h = contextHarness(); await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find(c => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(h.project, h.command(h.project, { candidateId: candidate.id, action: 'confirm' })).workId;
  await h.core.collect(id); await h.core.process(id);
  const summary = h.core.snapshot(id).summary!;
  h.records.delete('session-c'); await h.core.collect(id);
  expect(h.core.snapshot(id).checkpoints.find(cp => cp.threadId === 'session-c')?.status).toBe('failed');
  expect(h.core.snapshot(id).summary?.id).toBe(summary.id);
  const link = h.core.links(id).find(l => l.threadId === 'session-c')!;
  h.core.mutate(id, 'link', h.command(id, { status: 'separate', linkRevision: link.revision }), link.id);
  expect(h.core.snapshot(id).summary).toBeNull();
  expect(h.core.listProjects().find(p => p.workId === id)?.current).toBeNull();
  expect(h.repo.get('source', r.C[2].id)?.text).toBe(r.C[2].text);
  expect(() => h.core.evidence(r.C[2].id, id)).toThrow();
  expect(() => h.core.evidence(r.C[2].id)).toThrow();
});

it('keeps material constraints and failures in long input while explicitly marking excerpt selection partial', async () => {
  const h = contextHarness(); await h.core.collect(h.project); await h.core.process(h.project);
  const summary = h.core.snapshot(h.project).summary!;
  const sources = [r.A[0], ...Array.from({ length: 80 }, (_, i) => ({ ...source('routine log '.repeat(400), 'session-a', `long-${i}`), actor: 'agent' as const })), r.A[1], ...r.B, ...r.C];
  const selection = selectExplanationRanges(summary, sources);
  expect(selection.selectionComplete).toBe(false);
  expect(selection.ranges.map(r => r.revisionId)).toContain(r.A[1].id);
  expect(selection.ranges.map(r => r.revisionId)).toContain(r.B[3].id);
});

it('preserves the original discovery boundaries and persists goal choices without migrating existing entities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'statecarry-goals-'));
  const repo = new SQLiteRepository(directory);
  try {
    const h = contextHarness(repo), original = h.core.repo.get('connection', h.core.work(h.project).projectId)!;
    h.core.updateConnection(original.id, h.command(h.project, { title: original.title, cwd: original.cwd, threadIds: original.threadIds, startTurnIds: {}, discover: true, recordRanges: { 'session-d': { start: { turnId: 'turn-a', itemId: 'D2' }, end: { turnId: 'turn-a', itemId: 'D3b' } } } }));
    await h.core.collect(h.project);
    const candidate = h.core.goalCandidates(h.project).find(c => c.evidenceId === r.A[0].id)!;
    const id = h.core.chooseGoal(h.project, h.command(h.project, { candidateId: candidate.id, action: 'confirm' })).workId;
    await h.core.collect(id);
    await h.core.discover(h.core.repo.get('connection', h.core.work(id).projectId)!);
    expect(h.core.sources(id).some(s => ['D1', 'D4'].includes(s.itemId))).toBe(false);
    expect(() => h.core.evidence(r.D[0].id, id)).toThrow();
    const parent = repo.get('work', h.project)!;
    expect(parent.goalCandidates?.find(c => c.id === candidate.id)?.workId).toBe(id);
    expect(repo.get('connection', h.core.work(id).projectId)?.discoveryScope?.recordRanges['session-d'].end?.itemId).toBe('D3b');
    expect(repo.get('connection', original.id)?.recordRanges?.['session-d'].start.itemId).toBe('D2');
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('UX2/UX4/UX5: closes a mixed session at an item, prevents cross-goal evidence access, fails closed if boundaries disappear', async () => {
  const h = contextHarness(); await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find(c => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(h.project, h.command(h.project, { candidateId: candidate.id, action: 'confirm' })).workId;
  const c = h.core.repo.get('connection', h.core.work(id).projectId)!;
  h.core.updateConnection(c.id, h.command(id, { title: c.title, cwd: c.cwd, threadIds: [...c.threadIds, 'session-d'], startTurnIds: c.startTurnIds, discover: true, recordRanges: { ...c.recordRanges, 'session-d': { start: { turnId: 'turn-a', itemId: 'D2' }, end: { turnId: 'turn-a', itemId: 'D3b' } } } }));
  await h.core.collect(id);
  expect(h.core.sources(id).filter(s => s.threadId === 'session-d').map(s => s.itemId)).toEqual(['D2', 'D3a', 'D3b']);
  expect(() => h.core.evidence(r.D[0].id, id)).toThrow();
  expect(() => h.core.evidence(r.D[4].id, id)).toThrow();
  expect(h.core.evidence(r.D[0].id, h.project)).toBeTruthy();
  h.records.set('session-d', r.D.filter(s => s.itemId !== 'D3b'));
  await h.core.collect(id);
  expect(h.core.sources(id).some(s => s.threadId === 'session-d')).toBe(false);
  expect(h.core.snapshot(id).checkpoints.find(cp => cp.threadId === 'session-d')?.status).toBe('failed');
});

it('UX4: automatically discovers a dedicated followup but leaves mixed sessions and dismissed experiments separate', async () => {
  const h = contextHarness(); await h.core.collect(h.project);
  const candidate = h.core.goalCandidates(h.project).find(c => c.evidenceId === r.A[0].id)!;
  const id = h.core.chooseGoal(h.project, h.command(h.project, { candidateId: candidate.id, action: 'confirm' })).workId;
  await h.core.collect(id); h.records.set('session-e', r.E);
  await h.core.discover(h.core.repo.get('connection', h.core.work(id).projectId)!);
  expect(h.core.links(id).find(l => l.threadId === 'session-e')?.status).toBe('linked');
  expect(h.core.links(id).find(l => l.threadId === 'session-d')?.status).toBe('proposed');
  const x = h.core.links(id).find(l => l.threadId === 'session-x')!;
  h.core.mutate(id, 'link', h.command(id, { status: 'separate', linkRevision: x.revision }), x.id);
  await h.core.discover(h.core.repo.get('connection', h.core.work(id).projectId)!);
  expect(h.core.links(id).find(l => l.threadId === 'session-x')?.status).toBe('separate');
});
