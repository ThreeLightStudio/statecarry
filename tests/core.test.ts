import { describe, it, expect } from 'vitest';
import { checkCandidate, checkAssessment, relationshipEvidence } from '@statecarry/core';
import { source, candidate, harness, MemoryRepository } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';

describe('source and semantic boundaries', () => {
  it('identifies the actual Codex delegation envelope without treating quoted tool markers as verification requests', async () => {
    const h = harness(),
      id = h.connect();
    const s = {
      ...source(
        JSON.stringify({
          tool: 'create_thread',
          result:
            '<codex_delegation>\n<source_thread_id>parent-task</source_thread_id>\n<input>STATECARRY_CONTROLLED_VERIFICATION\nlimited request</input>\n</codex_delegation>',
        }),
      ),
      actor: 'tool' as const,
      kind: 'functionCallOutput',
    };
    h.records([s]);
    await h.core.collect(id);
    expect(h.core.links(id)[0].role).toBe('controlled-verification');
    expect(h.core.sources(id)[0].actor).toBe('tool');
    const other = harness(),
      otherId = other.connect();
    other.records([
      {
        ...s,
        text: JSON.stringify({ tool: 'read_thread', result: 'STATECARRY_CONTROLLED_VERIFICATION' }),
      },
    ]);
    await other.core.collect(otherId);
    expect(other.core.links(otherId)[0].role).toBe('work');
  });
  it('rejects nonexistent, foreign and changed citations before meaning evaluation', () => {
    const s = source(),
      c = candidate(s);
    c.claims[0].evidence[0].revisionId = 'foreign';
    expect(() => checkCandidate(c, [s])).toThrow('Citation');
    c.claims[0].evidence[0].revisionId = s.id;
    c.claims[0].evidence[0].quote = 'invented';
    expect(() => checkCandidate(c, [s])).toThrow('Citation');
  });
  it('requires missing slots and reasons, and refuses incomplete meaning checks', () => {
    const s = source(),
      c = candidate(s);
    c.claims[3].text = null;
    expect(() => checkCandidate(c, [s])).toThrow('reason');
    c.claims[3].missing = 'not-in-record';
    checkCandidate(c, [s]);
    expect(() => checkAssessment(c, { checks: [] })).toThrow('coverage');
  });
  it('does not turn an agent report into a user decision', () => {
    const s = { ...source('승인했다고 보고'), actor: 'agent' as const },
      c = candidate(s);
    c.claims[0].nature = 'user-decision';
    expect(() => checkCandidate(c, [s])).toThrow('non-user');
  });
  it('keeps an unsupported Next visible as unconfirmed, and supports discussion without Next', () => {
    const c = candidate(source());
    c.claims[3] = { ...c.claims[3], text: null, evidence: [], missing: 'not-in-record' };
    const checks = c.claims.map((x) => ({
      claimId: x.id,
      verdict: x.slot === 'next' ? 'uncertain' : 'supported',
      reason: 'no next in raw record',
    }));
    expect(checkAssessment(c, { checks }).claims[3].missing).toBe('not-in-record');
  });
  it('requires explicit relationship evidence, not a project name or cwd', () => {
    expect(relationshipEvidence([source('StateCarry /tmp/example')], ['thread-b'])).toEqual([]);
    expect(
      relationshipEvidence([source('thread-b 대화와는 무관하며 연결하지 마세요')], ['thread-b']),
    ).toEqual([]);
    expect(
      relationshipEvidence([source('thread-b 대화에서 이어갑니다')], ['thread-b']),
    ).toHaveLength(1);
  });
});

describe('collection, processing, writes and navigation', () => {
  it('keeps the last valid summary when the meaning checker rejects a new Next', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const valid = h.core.work(id).latestSummaryId;
    h.records([source('unsupported new Next')]);
    await h.core.collect(id);
    h.summary.check = async (c) => ({
      checks: c.claims.map((x) => ({
        claimId: x.id,
        verdict: x.slot === 'next' ? 'unsupported' : 'supported',
        reason: 'Next is not authorized by the source',
      })),
    });
    await h.core.process(id);
    expect(h.core.work(id).latestSummaryId).toBe(valid);
    expect(h.core.snapshot(id).jobs.some((j) => j.error?.includes('Meaning check rejected'))).toBe(
      true,
    );
    expect(h.counts().openCalls).toBe(0);
  });
  it('collects same-turn corrections without a new turn and does not summarize identical reads twice', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const before = h.core.work(id);
    await h.core.collect(id);
    await h.core.process(id);
    expect(h.counts().generationCalls).toBe(1);
    expect(h.core.work(id)).toEqual(before);
    h.records([source(), source('정정: 인증서 다운로드 불필요', 'thread-a', 'correction')]);
    await h.core.collect(id);
    expect(h.core.sources(id)).toHaveLength(2);
    expect(h.core.work(id).inputVersion).not.toBe(before.inputVersion);
  });
  it('publishes validated fixed input while newer records await a follow-up', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    let done!: () => void;
    const gate = new Promise<void>((r) => {
      done = r;
    });
    const generate = h.summary.generate;
    h.summary.generate = async (s, meta) => {
      await gate;
      return generate(s, meta);
    };
    const processing = h.core.process(id);
    h.records([source('new revision')]);
    await h.core.collect(id);
    done();
    await processing;
    expect(h.core.snapshot(id).summary?.sourceRevisionIds).toEqual([source().id]);
    expect(h.core.freshness(id).summary).toBe('outdated');
    await h.core.process(id);
    expect(h.core.snapshot(id).summary?.claims[0].text).toBe('new revision');
  });
  it('retains last source and summary after a collection failure', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const summaryId = h.core.work(id).latestSummaryId;
    h.reader.read = async () => {
      throw new Error('offline');
    };
    await h.core.collect(id);
    expect(h.core.snapshot(id).checkpoints[0].status).toBe('failed');
    expect(h.core.work(id).latestSummaryId).toBe(summaryId);
  });
  it('limits automatic summary retries to two and cannot resend execution', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    h.summary.check = async () => {
      throw new Error('injected checker failure');
    };
    await h.core.process(id);
    await h.core.process(id);
    await h.core.process(id);
    expect(h.repo.list('job')[0].attempts).toBe(2);
    expect(h.repo.list('job')[0].status).toBe('failed');
    expect(h.counts().openCalls).toBe(0);
  });
  it('does not retry while previous attempt termination is unknown', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    h.summary.generate = async () => {
      throw new Error('lost response');
    };
    h.summary.resolve = async () => 'unknown';
    await h.core.process(id);
    await h.core.process(id);
    expect(h.repo.list('job')[0].attempts).toBe(1);
    expect(h.repo.list('job')[0].status).toBe('result-unknown');
  });
  it('blocks a newer input while an older isolated attempt is unknown, then resumes after termination', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    const generate = h.summary.generate;
    h.summary.generate = async () => {
      throw new Error('lost response');
    };
    h.summary.resolve = async () => 'unknown';
    await h.core.process(id);
    h.records([source('later input')]);
    await h.core.collect(id);
    h.summary.generate = generate;
    await h.core.process(id);
    expect(h.core.work(id).latestSummaryId).toBeNull();
    expect(h.repo.list('job').filter((j) => j.status === 'result-unknown')).toHaveLength(1);
    h.summary.resolve = async () => 'terminated';
    await h.core.process(id);
    expect(h.core.work(id).latestSummaryId).not.toBeNull();
    expect(h.repo.list('job').filter((j) => j.status === 'applied')).toHaveLength(1);
    expect(h.core.freshness(id).summary).toBe('outdated');
    await h.core.process(id);
    expect(h.core.freshness(id).summary).toBe('current');
  });
  it('persists a candidate before checking and recovers only that attempt', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    let fail = true;
    const check = h.summary.check;
    h.summary.check = async (c, s, meta) => {
      if (fail) {
        fail = false;
        throw new Error('check response lost');
      }
      return check(c, s, meta);
    };
    await h.core.process(id);
    expect(h.repo.list('job')[0].candidate).not.toBeNull();
    await h.core.process(id);
    expect(h.counts().generationCalls).toBe(1);
    expect(h.core.work(id).latestSummaryId).not.toBeNull();
  });
  it('keeps overlays across automatic summaries without modifying raw records or review', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const old = h.core.snapshot(id).summary!;
    h.core.mutate(
      id,
      'corrections',
      h.command(id, {
        slot: 'next',
        text: '사용자가 표시만 수정',
        baseSummaryId: old.id,
        active: true,
        overlayRevision: 0,
      }),
    );
    h.records([source('새 원문')]);
    await h.core.collect(id);
    await h.core.process(id);
    expect(h.core.snapshot(id).overlays[0].text).toBe('사용자가 표시만 수정');
    expect(h.core.sources(id)[0].text).toBe('새 원문');
    expect(h.core.snapshot(id).summary?.claims.some((c) => c.slot === 'completion')).toBe(false);
  });
  it('deactivates only the selected correction against a newer summary and preserves its history', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const originalSummary = h.core.snapshot(id).summary!;
    for (const slot of ['reason', 'next'])
      h.core.mutate(
        id,
        'corrections',
        h.command(id, {
          slot,
          text: `${slot} display correction`,
          baseSummaryId: originalSummary.id,
          active: true,
          overlayRevision: 0,
        }),
      );
    h.core.mutate(
      id,
      'drafts',
      h.command(id, {
        threadId: 'thread-a',
        evidenceIds: [h.core.sources(id)[0].id],
        summaryId: originalSummary.id,
        text: 'preserved draft',
        draftRevision: 0,
      }),
    );
    h.records([source('later record')]);
    await h.core.collect(id);
    await h.core.process(id);
    const before = h.core.snapshot(id),
      reason = before.overlays.find((o) => o.slot === 'reason')!,
      sources = h.repo.list('source');
    const payload = {
      slot: 'reason',
      text: reason.text,
      baseSummaryId: originalSummary.id,
      active: false,
      overlayRevision: reason.revision,
    };
    expect(() => h.core.mutate(id, 'corrections', h.command(id, payload))).toThrow(
      'Correction base changed',
    );
    expect(h.core.snapshot(id)).toEqual(before);
    const command = h.command(id, { ...payload, baseSummaryId: before.summary!.id });
    const receipt = h.core.mutate(id, 'corrections', command);
    expect(h.core.mutate(id, 'corrections', command)).toEqual(receipt);
    const after = h.core.snapshot(id);
    expect(after.overlays.find((o) => o.slot === 'reason')).toEqual({
      ...reason,
      active: false,
      revision: reason.revision + 1,
      baseSummaryId: before.summary!.id,
      history: [{ text: reason.text, active: true, at: reason.updatedAt }],
    });
    expect(after.overlays.find((o) => o.slot === 'next')).toEqual(
      before.overlays.find((o) => o.slot === 'next'),
    );
    expect(after.draft).toEqual(before.draft);
    expect(after.summary).toEqual(before.summary);
    expect(h.repo.list('source')).toEqual(sources);
    h.records([source('another later record')]);
    await h.core.collect(id);
    await h.core.process(id);
    expect(h.core.snapshot(id).overlays).toEqual(after.overlays);
  });
  it.each(['work', 'overlay'] as const)(
    'rejects an undo after another edit when the %s revision is stale',
    async (guard) => {
      const h = harness(),
        id = h.connect();
      await h.core.collect(id);
      await h.core.process(id);
      const baseSummaryId = h.core.work(id).latestSummaryId!;
      h.core.mutate(
        id,
        'corrections',
        h.command(id, {
          slot: 'reason',
          text: 'test correction',
          baseSummaryId,
          active: true,
          overlayRevision: 0,
        }),
      );
      const undo = h.command(id, {
        slot: 'reason',
        text: 'test correction',
        baseSummaryId,
        active: false,
        overlayRevision: 1,
      });
      h.core.mutate(
        id,
        'corrections',
        h.command(id, {
          slot: 'reason',
          text: 'new user correction',
          baseSummaryId,
          active: true,
          overlayRevision: 1,
        }),
      );
      const before = structuredClone((h.repo as MemoryRepository).data);
      if (guard === 'overlay') undo.expectedRevision = h.core.work(id).revision;
      expect(() => h.core.mutate(id, 'corrections', undo)).toThrow(
        guard === 'work' ? 'Displayed work revision changed' : 'Correction was edited elsewhere',
      );
      expect((h.repo as MemoryRepository).data).toEqual(before);
    },
  );
  it('records visible visits without re-summary or work completion', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const before = h.core.work(id);
    h.core.mutate(
      id,
      'visits',
      h.command(id, { summaryId: before.latestSummaryId, evidenceIds: [] }),
    );
    await h.core.process(id);
    expect(h.core.work(id)).toEqual(before);
    expect(h.counts().generationCalls).toBe(1);
  });
  it('returns the same receipt for a duplicate body and rejects ID reuse with changed input', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const command = h.command(id, { summaryId: h.core.work(id).latestSummaryId, evidenceIds: [] });
    const one = h.core.mutate(id, 'visits', command);
    expect(h.core.mutate(id, 'visits', command)).toEqual(one);
    expect(() =>
      h.core.mutate(id, 'visits', {
        ...command,
        payload: { ...command.payload, evidenceIds: ['different'] },
      }),
    ).toThrow('another body');
  });
  it('holds target, evidence and text fixed, rejects scope change and prevents duplicate opens', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const payload = {
      threadId: 'thread-a',
      summaryId: h.core.work(id).latestSummaryId,
      evidenceIds: [h.core.sources(id)[0].id],
      text: '초안',
      draftRevision: 0,
    };
    const command = h.command(id, payload);
    await Promise.all([h.core.openHandoff(id, command), h.core.openHandoff(id, command)]);
    expect(h.counts().openCalls).toBe(1);
    const l = h.core.links(id)[0];
    h.core.mutate(
      id,
      'link',
      h.command(id, { status: 'separate', linkRevision: l.revision }),
      l.id,
    );
    await expect(
      h.core.openHandoff(id, { ...command, requestId: identity.next() }),
    ).rejects.toMatchObject({ code: 'HANDOFF_TARGET_UNLINKED' });
    expect(h.counts().openCalls).toBe(1);
  });
  it('rejects handoff during collection and before newer input is summarized', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const payload = {
      threadId: 'thread-a',
      summaryId: h.core.work(id).latestSummaryId,
      evidenceIds: [h.core.sources(id)[0].id],
      text: '초안',
      draftRevision: 0,
    };
    let done!: (v: any) => void;
    const priorRead = h.reader.read;
    h.reader.read = () =>
      new Promise((r) => {
        done = r;
      });
    const pending = h.core.collect(id);
    expect(() => h.core.prepareHandoff(id, h.core.work(id).revision, payload)).toThrow(
      'still checking',
    );
    done(await priorRead('thread-a'));
    await pending;
    h.reader.read = priorRead;
    h.records([source('new evidence')]);
    await h.core.collect(id);
    expect(() => h.core.prepareHandoff(id, h.core.work(id).revision, payload)).toThrow(
      'not reflected',
    );
  });
  it('never succeeds in memory if the persistent transaction fails', async () => {
    const repo = new MemoryRepository(),
      h = harness(repo),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const before = structuredClone(repo.data);
    repo.fail = true;
    expect(() =>
      h.core.mutate(
        id,
        'visits',
        h.command(id, { summaryId: h.core.work(id).latestSummaryId, evidenceIds: [] }),
      ),
    ).toThrow('commit failure');
    expect(repo.data).toEqual(before);
  });
});
