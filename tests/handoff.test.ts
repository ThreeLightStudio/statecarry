import { describe, expect, it } from 'vitest';
import { DomainError, type Command } from '@statecarry/contracts';
import { Controller, type Gateway, type LocalWorkState } from '@statecarry/presentation';
import { harness, source, read } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';
import { LocalBrowserMemory } from '../apps/web/src/adapters/browser-memory';

async function prepared() {
  const h = harness(),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const payload = {
    threadId: 'thread-a',
    summaryId: h.core.work(id).latestSummaryId!,
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
    expect(h.core.work(id).revision).toBe(command.expectedRevision);
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
      h.repo.put('work', { ...h.core.work(id), revision: command.expectedRevision + 1 });
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

async function ui() {
  const t = await prepared(),
    memory = new Map<string, LocalWorkState>(),
    sends: Command[] = [];
  let failStorage = false;
  const browser = {
    read: (id: string) => structuredClone(memory.get(id) ?? null),
    write: (id: string, state: LocalWorkState) => {
      if (failStorage) throw new Error('quota');
      memory.set(id, structuredClone(state));
    },
  };
  const gateway: Gateway = {
    projects: async () => t.h.core.listProjects(),
    connections: async () => t.h.repo.list('connection'),
    snapshot: async (id) => t.h.core.snapshot(id),
    evidence: async (id) => t.h.core.evidence(id),
    discover: t.h.reader.discover,
    subscribe: (_listener, connection) => {
      connection?.('connected');
      return () => {};
    },
    receipt: async (id) => {
      const receipt = t.h.repo.get('receipt', id);
      if (!receipt) throw new Error('unavailable');
      return { ...receipt, handoff: t.h.repo.get('handoff', receipt.resultId) };
    },
    command: async (path, command) => {
      if (path.endsWith('/handoff'))
        return t.h.core.prepareHandoff(t.id, command.expectedRevision, command.payload);
      if (path === '/handoffs/open') {
        sends.push(command);
        expect(memory.get(t.id)?.openRequest?.requestId).toBe(command.requestId);
        const { workId, ...payload } = command.payload;
        return t.h.core.openHandoff(String(workId), { ...command, payload });
      }
      return t.h.core.mutate(t.id, 'visits', command);
    },
  };
  const create = async () => {
    const controller = new Controller(gateway, browser, identity.next);
    await controller.start(`#/work/${t.id}`);
    return controller;
  };
  const controller = await create();
  await controller.action({ type: 'draft', value: t.payload.text });
  await controller.action({ type: 'selectEvidence', id: source().id, selected: true });
  await controller.action({ type: 'prepareHandoff' });
  return {
    ...t,
    controller,
    create,
    gateway,
    memory,
    sends,
    browser,
    failStorage: () => {
      failStorage = true;
    },
  };
}

describe('browser request recovery', () => {
  it('stores before sending and prevents double click and reload from sending twice', async () => {
    const t = await ui();
    await Promise.all([
      t.controller.action({ type: 'openHandoff' }),
      t.controller.action({ type: 'openHandoff' }),
    ]);
    const second = await t.create();
    await second.action({ type: 'openHandoff' });
    expect(t.sends).toHaveLength(1);
    expect(t.h.counts().openCalls).toBe(1);
    expect(second.getSnapshot().local).toMatchObject({
      draft: t.payload.text,
      evidenceIds: [source().id],
      openRequest: { state: 'dispatched' },
    });
    expect(second.getSnapshot().message).toContain('Open request sent');
  });
  it('recovers response loss using the same receipt and keeps unknown across unavailable lookup/reload', async () => {
    const t = await ui(),
      send = t.gateway.command,
      receipt = t.gateway.receipt;
    t.gateway.command = async (path, command) => {
      await send(path, command);
      throw new Error('lost response');
    };
    t.gateway.receipt = async () => {
      throw new Error('lost lookup');
    };
    await t.controller.action({ type: 'openHandoff' });
    const requestId = t.controller.getSnapshot().local.openRequest?.requestId;
    const restored = await t.create();
    await restored.action({ type: 'openHandoff' });
    expect(restored.getSnapshot().local.openRequest).toMatchObject({
      requestId,
      state: 'result-unknown',
    });
    expect(t.sends).toHaveLength(1);
    t.gateway.receipt = receipt;
    await restored.action({ type: 'checkHandoff' });
    expect(restored.getSnapshot().local.openRequest?.state).toBe('dispatched');
    expect(t.sends).toHaveLength(1);
  });
  it('does not dispatch if the request ID cannot be stored', async () => {
    const t = await ui();
    t.failStorage();
    await t.controller.action({ type: 'openHandoff' });
    expect(t.sends).toHaveLength(0);
    expect(t.controller.getSnapshot().error).toContain('could not be saved');
    expect(t.controller.getSnapshot().local.draft).toBe(t.payload.text);
  });
  it('requires explicit preparation and a new button press for a failed retry', async () => {
    const t = await ui();
    t.h.navigator.open = async () => {
      throw new Error('OS failed');
    };
    await t.controller.action({ type: 'openHandoff' });
    const first = t.controller.getSnapshot().local.openRequest!.requestId;
    await t.controller.action({ type: 'openHandoff' });
    expect(t.sends).toHaveLength(1);
    await t.controller.action({ type: 'retryHandoff' });
    expect(t.sends).toHaveLength(1);
    expect(t.controller.getSnapshot().handoff).not.toBeNull();
    t.h.navigator.open = async () => {};
    await t.controller.action({ type: 'openHandoff' });
    expect(t.sends).toHaveLength(2);
    expect(t.controller.getSnapshot().local.openRequest?.requestId).not.toBe(first);
    expect(t.h.repo.list('handoff').map((h) => h.state)).toEqual(['failed', 'dispatched']);
  });
  it('preserves draft basis on target changes and edits on collection/summary rejection', async () => {
    const t = await ui(),
      basis = t.controller.getSnapshot().local.basisSummaryId;
    t.h.records([source(), source('later', 'thread-a', 'later')]);
    await t.h.core.collect(t.id);
    await t.h.core.process(t.id);
    await t.controller.refresh();
    await t.controller.action({ type: 'target', threadId: 'thread-a' });
    await t.controller.action({ type: 'prepareHandoff' });
    expect(t.controller.getSnapshot().local).toMatchObject({
      basisSummaryId: basis,
      draft: t.payload.text,
      evidenceIds: [source().id],
    });
    expect(t.controller.getSnapshot().error).toContain('update to the current summary');
    expect(t.sends).toHaveLength(0);
  });
  it('keeps legacy browser edits and blocks unreadable persisted requests', () => {
    const values = new Map<string, string>();
    const memory = new LocalBrowserMemory(
      () =>
        ({
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        }) as unknown as Storage,
    );
    const legacy = {
      draft: 'keep',
      evidenceIds: ['e'],
      expandedIds: [],
      targetThreadId: 'thread-a',
      editVersion: 1,
    };
    values.set('statecarry.work.v1.w', JSON.stringify(legacy));
    expect(memory.read('w')?.draft).toBe('keep');
    values.set(
      'statecarry.work.v1.w',
      JSON.stringify({ ...legacy, openRequest: { requestId: 'known' } }),
    );
    expect(memory.read('w')).toMatchObject({
      draft: 'keep',
      openRequest: { requestId: 'known', state: 'result-unknown' },
    });
  });
});
