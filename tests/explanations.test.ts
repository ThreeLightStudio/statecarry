import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPLANATION_LIMITS,
  type ExplanationCandidate,
  type ExplanationJob,
} from '@statecarry/contracts';
import { Explanations } from '../packages/core/src/explanations';
import {
  explanationContext,
  selectExplanationRanges,
  validateExplanation,
  assessExplanation,
} from '../packages/core/src/explanation-context';
import { explanationEvidenceCatalog } from '../apps/server/src/adapters/explanation-prompts';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import {
  explanationHarness,
  explanationRecords,
  fixtureExplanation,
  fixtureAssessment,
  contextFromInput,
} from './explanation-fixtures';

async function prepared() {
  const h = await explanationHarness();
  h.prepare();
  const v = await h.settled();
  expect(v.revision).not.toBeNull();
  return { ...h, revision: v.revision!, context: contextFromInput(v.revision!.input) };
}

describe('explanation contract and raw context', () => {
  it('uses raw originating context absent from summary claims, and no fixed body count', async () => {
    const { h, id, context, revision } = await prepared();
    expect(h.core.snapshot(id).summary!.claims.every((c) => !c.text?.includes('30초'))).toBe(true);
    expect(context.excerpts.some((e) => e.text.includes('30초'))).toBe(true);
    expect(revision.candidate.nodes[0].text).toContain('30초');
    const c = structuredClone(revision.candidate);
    c.links = [];
    c.nodes = c.nodes.filter((n) => c.sections.some((s) => s.bodyIds.includes(n.id)));
    expect(validateExplanation(c, context).links).toEqual([]);
    await h.core.close();
  });
  it.each([
    'foreign-citation',
    'wrong-offset',
    'speaker',
    'missing-parent',
    'self-cycle',
    'detached-cycle',
    'depth-three',
    'shared-depth-bypass',
    'body-child',
    'inference-without-uncertainty',
    'duplicate',
    'absent-claim',
  ])('rejects %s', async (violation) => {
    const { h, context, revision } = await prepared();
    const c = structuredClone(revision.candidate);
    if (violation === 'foreign-citation') c.nodes[0].evidence[0].revisionId = 'another-work';
    if (violation === 'wrong-offset') c.nodes[0].evidence[0].start++;
    if (violation === 'speaker') c.nodes[1].nature = 'user-decision';
    if (violation === 'missing-parent') c.links[0].parentId = 'missing';
    if (violation === 'self-cycle') c.links[0].childId = c.links[0].parentId;
    if (violation === 'detached-cycle') {
      c.links[0].parentId = 'constraint';
    }
    if (violation === 'depth-three') {
      c.nodes.push({ ...c.nodes.at(-1)!, id: 'third' });
      c.links.push({ ...c.links[1], id: 'third-link', parentId: 'constraint', childId: 'third' });
    }
    if (violation === 'shared-depth-bypass') {
      c.nodes.push({ ...c.nodes.at(-1)!, id: 'extra' });
      c.links.push(
        { ...c.links[1], id: 'via', parentId: 'choice', childId: 'extra' },
        { ...c.links[1], id: 'bypass', parentId: 'extra', childId: 'why' },
      );
    }
    if (violation === 'body-child') c.sections[0].bodyIds.push('why');
    if (violation === 'inference-without-uncertainty') c.nodes[0].kind = 'interpretation';
    if (violation === 'duplicate') c.nodes[0].id = c.nodes[1].id;
    if (violation === 'absent-claim') context.input.selectionComplete = false;
    expect(() => validateExplanation(c, context)).toThrow();
    await h.core.close();
  });
  it('checks every reason separately from node facts; rejects causal claims and missing history', async () => {
    const { h, revision } = await prepared(),
      c = revision.candidate;
    const a = fixtureAssessment(c);
    a.links[0].verdict = 'unsupported';
    expect(() => assessExplanation(c, a)).toThrow('rejected');
    expect(() =>
      assessExplanation(c, { ...fixtureAssessment(c), narrativeComplete: false }),
    ).toThrow();
    expect(() => assessExplanation(c, { ...fixtureAssessment(c), nodes: [] })).toThrow();
    await h.core.close();
  });
  it('bounds raw selection, retains origins and marks omissions rather than asserting absence', async () => {
    const { h, id } = await explanationHarness();
    const summary = h.core.snapshot(id).summary!;
    const records = Array.from({ length: 50 }, (_, i) => ({
      ...explanationRecords[i % 5],
      id: `long-${i}`,
      text: `${i === 0 ? '최초 요청' : '경과'} ${'긴 원문 '.repeat(2000)}`,
    }));
    const selection = selectExplanationRanges(summary, records);
    expect(selection.selectionComplete).toBe(false);
    expect(selection.ranges.some((r) => r.revisionId === 'long-0' && r.start === 0)).toBe(true);
    expect(selection.ranges.reduce((n, r) => n + r.end - r.start, 0)).toBeLessThanOrEqual(
      EXPLANATION_LIMITS.context,
    );
    await h.core.close();
  });
  it('handles no original user message and partial/legacy input without inventing provenance', async () => {
    const { h, id } = await explanationHarness();
    const summary = h.core.snapshot(id).summary!,
      records = explanationRecords.filter((s) => s.actor === 'agent');
    const selection = selectExplanationRanges(summary, records);
    const baseline = await prepared();
    const context = explanationContext(
      {
        ...baseline.revision.input,
        ...selection,
        sourceRevisionIds: records.map((s) => s.id),
        limitations: ['수집 일부 미확인'],
      },
      summary,
      records,
    );
    expect(context.excerpts.every((e) => e.actor === 'agent')).toBe(true);
    expect(context.input.limitations).toContain('수집 일부 미확인');
    await baseline.h.core.close();
    await h.core.close();
  });
  it('does not offer redacted secrets as citeable model fragments', async () => {
    const { h, context } = await prepared();
    const secretFixture = 'sk-' + 'synthetic'.repeat(4);
    context.excerpts[0].text += ' ' + secretFixture;
    const catalog = explanationEvidenceCatalog(context);
    expect(JSON.stringify(catalog.input)).not.toContain(secretFixture);
    expect(catalog.input.excerpts[0].fragments.some((f) => f.evidenceId === null)).toBe(true);
    await h.core.close();
  });
});

describe('explanation execution', () => {
  it('coalesces preparation, preserves work/draft basis, reuses result across reopen and reads', async () => {
    const { h, id, prepare, settled, counts } = await explanationHarness();
    const work = h.core.work(id),
      snapshot = h.core.snapshot(id);
    prepare();
    prepare();
    await settled();
    prepare();
    await settled();
    expect(counts()).toEqual({ generated: 1, checked: 1 });
    expect(h.core.work(id)).toEqual(work);
    expect(h.core.snapshot(id).summary).toEqual(snapshot.summary);
    expect(h.core.snapshot(id).visit).toBeNull();
    const r = h.core.explanations.view(id).revision!;
    expect(
      h.core.explanations.evidence(id, r.id, r.candidate.nodes[0].evidence[0].revisionId).id,
    ).toBe(explanationRecords[0].id);
    await h.core.close();
  });
  it('does not prepare legacy summaries on GET or background polling', async () => {
    const { h, id, counts } = await explanationHarness();
    h.core.snapshot(id);
    h.core.explanations.tick();
    await h.core.explanations.settled();
    expect(counts()).toEqual({ generated: 0, checked: 0 });
    await h.core.close();
  });
  it('automatically prepares after a new summary is published', async () => {
    const { h, id, counts } = await explanationHarness();
    h.records([
      ...explanationRecords,
      { ...explanationRecords[4], id: 'new-revision', key: 'new-key', text: '추가 수집' },
    ]);
    await h.core.collect(id);
    await h.core.process(id);
    await h.core.explanations.settled();
    expect(counts().generated).toBe(1);
    expect(h.core.explanations.view(id).revision?.summaryId).toBe(h.core.work(id).latestSummaryId);
    await h.core.close();
  });
  it.each(['summary', 'unlink', 'start-range', 'configuration'])(
    'rejects late results after %s change',
    async (change) => {
      const { h, id, prepare, settled } = await explanationHarness();
      let release!: (value: ExplanationCandidate) => void;
      h.summary.generateExplanation = vi.fn(
        (context) =>
          new Promise((resolve) => {
            release = () => resolve(fixtureExplanation(context));
          }),
      );
      prepare();
      await vi.waitFor(() => expect(release).toBeDefined());
      if (change === 'summary')
        h.repo.put('work', { ...h.core.work(id), latestSummaryId: 'new-summary' });
      if (change === 'unlink') {
        const l = h.core.links(id)[0];
        h.repo.put('link', { ...l, status: 'separate' });
      }
      if (change === 'start-range') {
        const w = h.core.work(id),
          c = h.repo.get('connection', w.projectId)!;
        h.repo.put('connection', { ...c, revision: c.revision + 1 });
      }
      if (change === 'configuration')
        h.summary.configuration = () => ({
          model: 'changed',
          summaryEffort: 'medium',
          checkEffort: 'medium',
          promptVersion: 'fake-1',
        });
      release({} as ExplanationCandidate);
      await settled();
      expect(h.repo.list('explanation')).toHaveLength(0);
      expect(h.repo.list('explanationJob')[0].status).toBe('superseded');
      await h.core.close();
    },
  );
  it('limits semantic repair to one replacement and four calls', async () => {
    const { h, prepare, settled, counts } = await explanationHarness();
    let checks = 0;
    h.summary.checkExplanation = async (_, c) => {
      const a = fixtureAssessment(c);
      if (!checks++) a.links[0].verdict = 'unsupported';
      return a;
    };
    prepare();
    const v = await settled();
    expect(v.revision).not.toBeNull();
    expect(v.job?.calls).toBe(4);
    expect(v.job?.repairs).toBe(1);
    expect(counts().generated).toBe(2);
    expect(() =>
      h.core.explanations.retry(v.revision!.workId, v.job!.id, { requestId: 'retry' }),
    ).toThrow();
    await h.core.close();
  });
  it('retains the bounded budget across a manual retry and rejects unknown termination', async () => {
    const { h, id, prepare, settled } = await explanationHarness();
    h.summary.generateExplanation = async () => {
      throw new Error('transport failure');
    };
    prepare();
    let v = await settled();
    expect(v.job?.calls).toBe(1);
    expect(v.job?.status).toBe('failed');
    h.summary.generateExplanation = async (c) => fixtureExplanation(c);
    h.core.explanations.retry(id, v.job!.id, { requestId: 'retry' });
    v = await settled();
    expect(v.job?.calls).toBe(3);
    expect(v.revision).not.toBeNull();
    const j = h.repo.list('explanationJob')[0];
    h.repo.put('explanationJob', { ...j, status: 'result-unknown', resultId: null, remote: null });
    const recovery = new Explanations(h.core);
    await recovery.recover();
    // A committed matching result wins even when a crash left stale execution metadata.
    expect(h.repo.get('explanationJob', j.id)?.status).toBe('ready');
    await h.core.close();
  });
  it('recovers terminated checking from a fixed candidate and blocks PID-less crash retries', async () => {
    const { h, id, prepare, settled } = await explanationHarness();
    prepare();
    await settled();
    const j = h.repo.list('explanationJob')[0],
      candidate = h.repo.list('explanation')[0].candidate;
    const crashed: ExplanationJob = {
      ...j,
      attemptToken: 'crashed',
      status: 'checking',
      calls: 1,
      resultId: null,
      candidate,
      remote: { pid: 123, threadId: 'thread', turnId: 'turn', phase: 'check-explanation' },
    };
    h.repo.put('explanationJob', crashed);
    const recovered = new Explanations(h.core);
    await recovered.recover();
    recovered.tick();
    await recovered.settled();
    expect(h.repo.get('explanationJob', j.id)?.calls).toBe(2);
    h.repo.put('explanationJob', { ...crashed, remote: null });
    const unknown = new Explanations(h.core);
    await unknown.recover();
    unknown.tick();
    await unknown.settled();
    expect(h.repo.get('explanationJob', j.id)?.status).toBe('result-unknown');
    expect(() => unknown.retry(id, j.id, { requestId: 'bad-retry' })).toThrow();
    await h.core.close();
  });
  it('exposes retry eligibility for the remaining check budget', async () => {
    const { h, id } = await prepared();
    const j = h.repo.list('explanationJob')[0];
    const candidate = h.repo.list('explanation')[0].candidate;
    h.repo.put('explanationJob', { ...j, status: 'failed', calls: 3, retries: 0, candidate });
    expect(h.core.explanations.view(id).job?.canRetry).toBe(true);
    h.repo.put('explanationJob', { ...j, status: 'failed', calls: 3, retries: 0, candidate: null });
    expect(h.core.explanations.view(id).job?.canRetry).toBe(false);
    await h.core.close();
  });
  it('uses work-specific access even when the same source is linked elsewhere', async () => {
    const { h, id, revision } = await prepared();
    const other = h.connect();
    await h.core.collect(other);
    const l = h.core.links(id)[0];
    h.repo.put('link', { ...l, status: 'separate' });
    expect(() => h.core.explanations.evidence(id, revision.id, explanationRecords[0].id)).toThrow();
    expect(() => h.core.explanations.get(other, revision.id)).toThrow();
    await h.core.close();
  });
  it('stores immutable explanation entities in the existing SQLite schema', async () => {
    const { h, id, revision } = await prepared(),
      directory = mkdtempSync(join(tmpdir(), 'explanation-db-'));
    try {
      let db = new SQLiteRepository(directory);
      db.put('work', h.core.work(id));
      db.put('explanation', revision);
      db.close();
      db = new SQLiteRepository(directory);
      expect(db.get('explanation', revision.id)).toEqual(revision);
      expect(() => db.put('explanation', { ...revision, generatedAt: 'changed' })).toThrow(
        'Immutable',
      );
      db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
      await h.core.close();
    }
  });
});
