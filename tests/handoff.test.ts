import { describe, expect, it } from 'vitest';
import { DomainError, type Command } from '@statecarry/contracts';
import { harness, source, read } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';

async function prepared() {
  const h = harness(),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const payload = {
    threadId: 'thread-a',
    summaryId: h.core.project(id).latestSummaryId!,
    evidenceIds: [source().id],
    text: '전송하지 않을 초안',
    draftRevision: 0,
  };
  const command = h.command(id, payload);
  return { h, id, payload, command };
}

describe('handoff freshness and receipts', () => {
  it('uses the linked title/role and exactly the selected ID without changing work or draft', async () => {
    const { h, id, command, payload } = await prepared(),
      before = h.core.snapshot(id);
    let target: string | undefined;
    h.navigator.open = async (threadId) => {
      target = threadId;
    };
    expect(h.core.prepareHandoff(id, command.expectedRevision, payload)).toMatchObject({
      title: '기록 A',
      role: 'work',
      threadId: 'thread-a',
    });
    const receipt = await h.core.openHandoff(id, command);
    expect(target).toBe('thread-a');
    expect(h.repo.get('handoff', receipt.resultId)?.state).toBe('dispatched');
    expect(h.core.snapshot(id)).toEqual(before);
  });
  it('does not invalidate preparation when only collection observation time changes', async () => {
    const { h, id, command } = await prepared();
    h.reader.read = async () => ({
      ...read([{ ...source(), observedAt: '2026-09-10T09:00:00.000Z' }]),
      observedAt: '2026-09-10T09:00:00.000Z',
    });
    await h.core.collect(id);
    expect(h.core.project(id).revision).toBe(command.expectedRevision);
    await h.core.openHandoff(id, command);
    expect(h.counts().openCalls).toBe(1);
  });
  it.each([
    'collecting',
    'input',
    'summary',
    'scope',
    'configuration',
    'extractor',
    'access',
    'revision',
    'capability',
  ])('blocks a prepared request after %s changes without dispatch', async (change) => {
    const { h, id, command } = await prepared();
    const checkpoint = h.repo.list('checkpoint')[0],
      summary = h.repo.list('summary')[0];
    const codes: Record<string, string> = {
      collecting: 'HANDOFF_COLLECTING',
      input: 'HANDOFF_INPUT_CHANGED',
      summary: 'HANDOFF_SUMMARY_CHANGED',
      scope: 'HANDOFF_TARGET_UNLINKED',
      configuration: 'HANDOFF_CONFIGURATION_CHANGED',
      extractor: 'HANDOFF_CONFIGURATION_CHANGED',
      access: 'HANDOFF_EVIDENCE_INACCESSIBLE',
      revision: 'REVISION_CONFLICT',
      capability: 'CAPABILITY_UNSUPPORTED',
    };
    if (change === 'collecting') h.repo.put('checkpoint', { ...checkpoint, status: 'reading' });
    if (change === 'input' || change === 'summary') {
      h.records([source(), source('new', 'thread-a', 'new')]);
      await h.core.collect(id);
      if (change === 'summary') await h.core.process(id);
    }
    if (change === 'scope') {
      const link = h.core.links(id)[0];
      h.core.mutate(
        id,
        'link',
        h.command(id, { status: 'separate', linkRevision: link.revision }),
        link.id,
      );
    }
    if (change === 'configuration') {
      const settings = h.summary.configuration();
      h.summary.configuration = () => ({ ...settings, promptVersion: 'changed' });
    }
    if (change === 'extractor') h.repo.put('summary', { ...summary, extractorVersion: 'old' });
    if (change === 'access') h.repo.put('checkpoint', { ...checkpoint, revisionIds: [] });
    if (change === 'revision')
      h.repo.put('project', { ...h.core.project(id), revision: command.expectedRevision + 1 });
    if (change === 'capability')
      h.navigator.capability = () => ({
        precision: 'unsupported',
        verifiedAt: null,
        detail: 'removed evidence',
      });
    await expect(h.core.openHandoff(id, command)).rejects.toMatchObject({ code: codes[change] });
    expect(h.counts().openCalls).toBe(0);
    expect(h.repo.list('receipt').filter((r) => r.command === 'open')).toEqual([]);
  });
  it('never admits a comparison target outside the linked scope', async () => {
    const { h, id, command, payload } = await prepared();
    expect(() =>
      h.core.prepareHandoff(id, command.expectedRevision, {
        ...payload,
        threadId: '00000000-0000-4000-8000-000000000002',
      }),
    ).toThrow();
    expect(h.core.links(id)).toHaveLength(1);
  });
  it('coalesces concurrent duplicates, rejects changed payload, and retains the original receipt after freshness changes', async () => {
    const { h, id, command } = await prepared();
    let finish!: () => void,
      calls = 0;
    h.navigator.open = () => {
      calls++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const first = h.core.openHandoff(id, command),
      second = await h.core.openHandoff(id, command);
    expect(h.repo.get('handoff', second.resultId)?.state).toBe('dispatching');
    await expect(
      h.core.openHandoff(id, { ...command, payload: { ...command.payload, text: 'different' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    finish();
    expect(await first).toEqual(second);
    h.records([source('changed')]);
    await h.core.collect(id);
    expect(await h.core.openHandoff(id, command)).toEqual(second);
    expect(calls).toBe(1);
  });
  it.each(['failed', 'result-unknown'])(
    'persists %s and never retries the same request',
    async (state) => {
      const { h, id, command } = await prepared();
      let calls = 0;
      h.navigator.open = async () => {
        calls++;
        throw state === 'failed'
          ? new Error('OS failed')
          : new DomainError('RESULT_UNKNOWN', 'signal');
      };
      const receipt = await h.core.openHandoff(id, command);
      expect(h.repo.get('handoff', receipt.resultId)?.state).toBe(state);
      await h.core.openHandoff(id, command);
      expect(calls).toBe(1);
    },
  );
  it('recovers persisted dispatching as unknown without executing and never reports a result write failure as OS failure', async () => {
    const { h, id, command } = await prepared();
    const put = h.repo.put.bind(h.repo);
    h.repo.put = ((kind: any, value: any) => {
      if (kind === 'handoff' && value.state === 'dispatched') throw new Error('write failed');
      put(kind, value);
    }) as typeof h.repo.put;
    await expect(h.core.openHandoff(id, command)).rejects.toThrow('write failed');
    expect(h.repo.list('handoff')[0].state).toBe('dispatching');
    expect(h.counts().openCalls).toBe(1);
    h.repo.put = put;
    const restored = harness(h.repo);
    await restored.core.recover();
    expect(h.repo.list('handoff')[0].state).toBe('result-unknown');
    await restored.core.openHandoff(id, command);
    expect(restored.counts().openCalls).toBe(0);
  });
});
