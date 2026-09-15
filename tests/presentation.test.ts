import { describe, it, expect } from 'vitest';
import {
  Controller,
  presentReturnContext,
  type Gateway,
  type LocalWorkState,
} from '@statecarry/presentation';
import type { ReturnContextSnapshot, Command, Receipt } from '@statecarry/contracts';
import { harness, source, read } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';

const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function setup() {
  const h = harness(),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const memory = new Map<string, LocalWorkState>(),
    calls: { path: string; command: Command }[] = [];
  const g: Gateway = {
    projects: async () => h.core.listProjects(),
    connections: async () => h.repo.list('connection'),
    snapshot: async (id) => h.core.snapshot(id),
    evidence: async (id) => h.core.evidence(id),
    discover: h.reader.discover,
    subscribe: () => () => {},
    receipt: async (id) => {
      const r = h.repo.get('receipt', id);
      if (!r) throw new Error('Receipt unavailable');
      return r;
    },
    command: async (path, command) => {
      calls.push({ path, command });
      const parts = path.split('/');
      if (parts[3] === 'handoff')
        return h.core.prepareHandoff(parts[2], command.expectedRevision, command.payload);
      return h.core.mutate(parts[2], parts[3] as 'drafts' | 'visits' | 'corrections', command);
    },
  };
  const controller = new Controller(
    g,
    {
      read: (id) => structuredClone(memory.get(id) ?? null),
      write: (id, value) => {
        memory.set(id, structuredClone(value));
      },
    },
    identity.next,
  );
  await controller.start(`#/work/${id}`);
  return { h, id, g, controller, calls, memory };
}

describe('presentation and controller boundaries', () => {
  it.each(['conflict', 'response-loss'])(
    'does not look up a nonexistent preparation receipt after %s',
    async (reason) => {
      const t = await setup();
      let lookups = 0,
        preparations = 0;
      await t.controller.action({ type: 'draft', value: 'keep on rejection' });
      await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
      const before = structuredClone(t.controller.getSnapshot().local);
      t.g.receipt = async () => {
        lookups++;
        throw new Error('404');
      };
      t.g.command = async () => {
        preparations++;
        throw Object.assign(new Error('preparation unavailable'), {
          code: reason === 'conflict' ? 'HANDOFF_COLLECTING' : 'RESULT_UNKNOWN',
        });
      };
      await t.controller.action({ type: 'prepareHandoff' });
      expect(preparations).toBe(1);
      expect(lookups).toBe(0);
      expect(t.controller.getSnapshot().error).not.toContain('영수증');
      if (reason === 'response-loss')
        expect(t.controller.getSnapshot().error).toContain('try reviewing again');
      expect(t.controller.getSnapshot().local).toEqual(before);
      expect(t.controller.getSnapshot().handoff).toBeNull();
      expect(t.h.counts().openCalls).toBe(0);
    },
  );

  it.each(['refresh', 'revisit'])(
    'restores a newer saved draft over a clean browser cache on %s',
    async (mode) => {
      const t = await setup(),
        summaryId = t.h.core.snapshot(t.id).summary!.id;
      await t.controller.action({
        type: 'correction',
        slot: 'reason',
        value: 'keep this correction input',
      });
      await t.controller.action({ type: 'scroll', value: 420 });
      t.h.core.mutate(
        t.id,
        'drafts',
        t.h.command(t.id, {
          summaryId,
          threadId: 'thread-a',
          evidenceIds: [source().id],
          draftRevision: 0,
          text: 'saved in another window',
        }),
      );
      if (mode === 'revisit') await t.controller.navigate(`#/work/${t.id}`);
      else await t.controller.refresh();
      expect(t.controller.getSnapshot().local).toMatchObject({
        draft: 'saved in another window',
        draftRevision: 1,
        basisSummaryId: summaryId,
        evidenceIds: [source().id],
        targetThreadId: 'thread-a',
        dirty: false,
        correction: 'keep this correction input',
        scroll: 420,
      });
      expect(t.memory.get(t.id)?.draft).toBe('saved in another window');
      expect(t.calls).toHaveLength(0);
    },
  );
  it('keeps unsaved local text and evidence on revisit when a newer server draft exists', async () => {
    const t = await setup(),
      summaryId = t.h.core.snapshot(t.id).summary!.id;
    await t.controller.action({ type: 'draft', value: 'keep my unsaved draft' });
    t.h.core.mutate(
      t.id,
      'drafts',
      t.h.command(t.id, {
        summaryId,
        threadId: 'thread-a',
        evidenceIds: [source().id],
        draftRevision: 0,
        text: 'other saved draft',
      }),
    );
    await t.controller.navigate(`#/work/${t.id}`);
    expect(t.controller.getSnapshot().local).toMatchObject({
      draft: 'keep my unsaved draft',
      draftRevision: 0,
      dirty: true,
      evidenceIds: [],
    });
    expect(t.h.core.snapshot(t.id).draft?.text).toBe('other saved draft');
    expect(t.calls).toHaveLength(0);
  });
  it('restores local state when an SSE refresh wins over the initial navigation fetch', async () => {
    const t = await setup();
    await t.controller.action({ type: 'draft', value: 'persisted before reload' });
    const wait = deferred<ReturnContextSnapshot>(),
      original = t.g.snapshot;
    let count = 0;
    t.g.snapshot = async (id) => (++count === 1 ? wait.promise : original(id));
    const navigation = t.controller.navigate(`#/work/${t.id}`);
    await t.controller.refresh();
    expect(t.controller.getSnapshot().local.draft).toBe('persisted before reload');
    wait.resolve(t.h.core.snapshot(t.id));
    await navigation;
    expect(t.controller.getSnapshot().local.draft).toBe('persisted before reload');
  });
  it('keeps the draft summary version until the user explicitly rebases it', async () => {
    const t = await setup(),
      before = t.h.core.snapshot(t.id).summary!.id;
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    t.h.records([source(), source('later message', 'thread-a', 'later')]);
    await t.h.core.collect(t.id);
    await t.h.core.process(t.id);
    await t.controller.refresh();
    expect(t.controller.getSnapshot().local.basisSummaryId).toBe(before);
    await t.controller.action({ type: 'prepareHandoff' });
    expect(t.controller.getSnapshot().handoff).toBeNull();
    expect(t.controller.getSnapshot().error).toContain('changed');
    expect(t.calls).toHaveLength(0); // Known basis mismatch is explained before sending an avoidable 409.
    await t.controller.action({ type: 'adoptSummary' });
    await t.controller.action({ type: 'prepareHandoff' });
    expect(t.controller.getSnapshot().handoff?.summaryId).toBe(t.h.core.snapshot(t.id).summary!.id);
  });
  it('does not overwrite a draft saved in another window after a background refresh', async () => {
    const t = await setup(),
      summaryId = t.h.core.snapshot(t.id).summary!.id;
    await t.controller.action({ type: 'draft', value: 'my unsaved edit' });
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    t.h.core.mutate(
      t.id,
      'drafts',
      t.h.command(t.id, {
        summaryId,
        threadId: 'thread-a',
        evidenceIds: [source().id],
        draftRevision: 0,
        text: 'other window',
      }),
    );
    await t.controller.refresh();
    await t.controller.action({ type: 'saveDraft' });
    expect(t.h.core.snapshot(t.id).draft?.text).toBe('other window');
    expect(t.controller.getSnapshot().local.draft).toBe('my unsaved edit');
    await t.controller.action({ type: 'adoptDraftVersion' });
    await t.controller.action({ type: 'saveDraft' });
    expect(t.h.core.snapshot(t.id).draft?.text).toBe('my unsaved edit');
  });
  it('switches between two project targets without carrying one draft into the other', async () => {
    const t = await setup(),
      second = t.h.connect();
    await t.h.core.collect(second);
    await t.h.core.process(second);
    await t.controller.action({ type: 'draft', value: 'first project' });
    await t.controller.navigate(`#/work/${second}`);
    expect(t.controller.getSnapshot().detail?.workId).toBe(second);
    expect(t.controller.getSnapshot().local.draft).toBe('');
    await t.controller.action({ type: 'draft', value: 'second project' });
    await t.controller.navigate(`#/work/${t.id}`);
    expect(t.controller.getSnapshot().local.draft).toBe('first project');
  });
  it('does not record a visit merely by fetching a snapshot', async () => {
    const t = await setup();
    expect(t.h.core.snapshot(t.id).visit).toBeNull();
    const summaryId = t.h.core.snapshot(t.id).summary!.id;
    await t.controller.action({ type: 'displayed', summaryId });
    await t.controller.action({ type: 'displayed', summaryId });
    expect(t.calls).toHaveLength(1);
    expect(t.h.core.snapshot(t.id).visit?.summaryId).toBe(summaryId);
    expect(t.h.counts().openCalls).toBe(0);
  });
  it('records opened evidence only after a display event and never promotes it to review', async () => {
    const t = await setup(),
      summaryId = t.h.core.work(t.id).latestSummaryId!;
    const evidenceId = t.h.core.sources(t.id)[0].id;
    await t.controller.action({ type: 'evidence', id: evidenceId });
    expect(t.h.core.snapshot(t.id).visit).toBeNull();
    await t.controller.action({ type: 'displayed', summaryId });
    expect(t.h.core.snapshot(t.id).visit?.evidenceIds).toEqual([evidenceId]);
    expect(t.h.core.snapshot(t.id).overlays).toEqual([]);
    expect(t.h.counts().openCalls).toBe(0);
  });
  it('rejects late snapshots from a previous project', async () => {
    const t = await setup(),
      old = t.h.core.snapshot(t.id),
      wait = deferred<ReturnContextSnapshot>();
    t.g.snapshot = async () => wait.promise;
    const refresh = t.controller.refresh();
    await t.controller.navigate('#/projects');
    wait.resolve(old);
    await refresh;
    expect(t.controller.getSnapshot().detail).toBeNull();
    expect(t.controller.getSnapshot().route).toBe('#/projects');
  });
  it('keeps drafts and selected evidence across navigation without promoting them', async () => {
    const t = await setup();
    await t.controller.action({ type: 'draft', value: 'unsent text' });
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    await t.controller.navigate('#/projects');
    await t.controller.navigate(`#/work/${t.id}`);
    expect(t.controller.getSnapshot().local.draft).toBe('unsent text');
    expect(t.controller.getSnapshot().local.evidenceIds).toEqual([source().id]);
    expect(t.h.core.snapshot(t.id).draft).toBeNull();
    expect(t.h.counts().openCalls).toBe(0);
  });
  it('recovers the committed receipt after response loss without resending', async () => {
    const t = await setup(),
      original = t.g.command;
    t.g.command = async (p, c) => {
      await original(p, c);
      throw new Error('response lost');
    };
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    await t.controller.action({ type: 'draft', value: 'save exactly once' });
    await t.controller.action({ type: 'saveDraft' });
    expect(t.calls).toHaveLength(1);
    expect(t.h.core.snapshot(t.id).draft?.revision).toBe(1);
    expect(t.controller.getSnapshot().local.dirty).toBe(false);
  });
  it('keeps edits when both command and receipt are unavailable', async () => {
    const t = await setup();
    let sends = 0;
    t.g.command = async () => {
      sends++;
      throw new Error('transport failed');
    };
    t.g.receipt = async () => {
      throw new Error('lookup failed');
    };
    await t.controller.action({ type: 'draft', value: 'retain on unknown' });
    await t.controller.action({ type: 'saveDraft' });
    expect(sends).toBe(1);
    expect(t.controller.getSnapshot().local.draft).toBe('retain on unknown');
    expect(t.controller.getSnapshot().local.dirty).toBe(true);
    expect(t.controller.getSnapshot().error).toBeTruthy();
  });
  it('coalesces same-tick save actions and does not mark newer edits saved', async () => {
    const t = await setup(),
      wait = deferred<Receipt>();
    let sends = 0;
    t.g.command = async () => {
      sends++;
      return wait.promise;
    };
    const a = t.controller.action({ type: 'saveDraft' }),
      b = t.controller.action({ type: 'saveDraft' });
    await t.controller.action({ type: 'draft', value: 'newer edit' });
    wait.resolve({
      id: 'receipt',
      command: 'drafts',
      workId: t.id,
      committedRevision: 1,
      resultId: t.id,
      bodyHash: '',
      createdAt: '',
    });
    await Promise.all([a, b]);
    expect(sends).toBe(1);
    expect(t.controller.getSnapshot().local.dirty).toBe(true);
    expect(t.controller.getSnapshot().local.draft).toBe('newer edit');
  });
  it('clears prepared handoff whenever draft or evidence changes', async () => {
    const t = await setup();
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    await t.controller.action({ type: 'prepareHandoff' });
    expect(t.controller.getSnapshot().handoff?.threadId).toBe('thread-a');
    await t.controller.action({ type: 'draft', value: 'changed after preparation' });
    expect(t.controller.getSnapshot().handoff).toBeNull();
    expect(t.h.counts().openCalls).toBe(0);
  });
  it('does not replace new edits with a late handoff response', async () => {
    const t = await setup(),
      wait = deferred<ReturnType<typeof t.h.core.prepareHandoff>>();
    await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
    const target = t.h.core.prepareHandoff(t.id, t.h.core.work(t.id).revision, {
      threadId: 'thread-a',
      evidenceIds: [source().id],
      summaryId: t.h.core.snapshot(t.id).summary!.id,
      draftRevision: 0,
      text: '',
    });
    t.g.command = async () => wait.promise;
    const pending = t.controller.action({ type: 'prepareHandoff' });
    await t.controller.action({ type: 'draft', value: 'newer draft' });
    wait.resolve(target);
    await pending;
    expect(t.controller.getSnapshot().handoff).toBeNull();
    expect(t.controller.getSnapshot().local.draft).toBe('newer draft');
  });
  it('shows stale input and preserves overlay provenance separately from source', async () => {
    const t = await setup(),
      s = t.h.core.snapshot(t.id);
    t.h.core.mutate(
      t.id,
      'corrections',
      t.h.command(t.id, {
        slot: 'next',
        text: '내 표시 수정',
        baseSummaryId: s.summary!.id,
        overlayRevision: 0,
        active: true,
      }),
    );
    t.h.records([source('changed input')]);
    await t.h.core.collect(t.id);
    const view = presentReturnContext(t.h.core.snapshot(t.id));
    expect(view.stale).toBe(true);
    expect(view.next[0].text).toBe('내 표시 수정');
    expect(view.next[0].nature).toBe('Edited by you');
    expect(t.h.core.snapshot(t.id).summary?.claims[3].text).not.toBe('내 표시 수정');
    expect(view.next[0].uncertainty).toContain(
      'Display edits are not automatically checked for meaning',
    );
  });
  it('keeps prior failure history separate from the successfully applied summary', async () => {
    const t = await setup(),
      job = t.h.repo.list('job')[0];
    t.h.repo.put('job', { ...job, status: 'applied', error: 'previous citation mismatch' });
    const view = presentReturnContext(t.h.core.snapshot(t.id));
    expect(view.error).toBeNull();
    expect(view.priorAttemptError).toBe('previous citation mismatch');
    expect(t.h.repo.get('job', job.id)?.error).toBe('previous citation mismatch');
  });
});

describe('stage 6 three-work return and read recovery', () => {
  it('preserves drafts, corrections, evidence and scroll without focusing restored evidence', async () => {
    const t = await setup();
    const ids = [t.id];
    t.h.reader.read = async (threadId) => read([source(`record ${threadId}`, threadId)]);
    for (const thread of ['b', 'c']) {
      const id = t.h.core.connect({
        requestId: identity.next(),
        expectedRevision: 0,
        payload: { title: thread, cwd: `/tmp/${thread}`, threadIds: [thread], discover: false },
      }).workId;
      await t.h.core.collect(id);
      await t.h.core.process(id);
      ids.push(id);
    }
    for (let i = 0; i < ids.length; i++) {
      await t.controller.navigate(`#/work/${ids[i]}`);
      const evidenceId = t.h.core.sources(ids[i])[0].id;
      await t.controller.action({ type: 'draft', value: `draft ${i}` });
      await t.controller.action({ type: 'correction', value: `correction ${i}`, slot: 'reason' });
      await t.controller.action({ type: 'evidence', id: evidenceId });
      await t.controller.action({ type: 'selectEvidence', id: evidenceId, selected: true });
      await t.controller.action({ type: 'scroll', workId: ids[i], value: i * 100 + 80 });
    }
    await t.controller.action({ type: 'scroll', workId: ids[0], value: 90 });
    for (let i = 0; i < ids.length; i++) {
      await t.controller.navigate(`#/work/${ids[i]}`);
      await Promise.resolve();
      const state = t.controller.getSnapshot();
      expect(state.local).toMatchObject({
        draft: `draft ${i}`,
        correction: `correction ${i}`,
        scroll: i === 0 ? 90 : i * 100 + 80,
      });
      expect(state.local.evidenceIds).toEqual([t.h.core.sources(ids[i])[0].id]);
      expect(state.evidenceFocusId).toBeNull();
    }
  });
  it('ignores a previous work read failure and clears recovered read errors only', async () => {
    const t = await setup(),
      wait = deferred<ReturnContextSnapshot>();
    const original = t.g.snapshot;
    t.g.snapshot = async () => wait.promise;
    const old = t.controller.refresh();
    await t.controller.navigate('#/projects');
    wait.reject(new Error('old read failed'));
    await old;
    expect(t.controller.getSnapshot().error).toBeNull();
    t.g.snapshot = async () => {
      throw new Error('read disconnected');
    };
    await t.controller.navigate(`#/work/${t.id}`);
    expect(t.controller.getSnapshot().error).toContain('read disconnected');
    t.g.snapshot = original;
    await t.controller.refresh();
    expect(t.controller.getSnapshot().error).toBeNull();
  });
});

it('preserves all local choices across an older-range publication, follow-up and failure', async () => {
  const t = await setup();
  await t.controller.action({ type: 'draft', value: 'unsent stable draft' });
  await t.controller.action({ type: 'correction', slot: 'reason', value: 'unsaved reason' });
  await t.controller.action({ type: 'evidence', id: source().id });
  await t.controller.action({ type: 'selectEvidence', id: source().id, selected: true });
  await t.controller.action({ type: 'scroll', value: 550 });
  const local = structuredClone(t.controller.getSnapshot().local),
    evidence = structuredClone(t.controller.getSnapshot().evidence);
  t.h.records([source('first changed range')]);
  await t.h.core.collect(t.id);
  const gate = deferred<void>(),
    entered = deferred<void>(),
    check = t.h.summary.check;
  t.h.summary.check = async (c, s, meta) => {
    entered.resolve();
    await gate.promise;
    return check(c, s, meta);
  };
  const run = t.h.core.process(t.id);
  await entered.promise;
  t.h.records([source('second correction')]);
  await t.h.core.collect(t.id);
  gate.resolve();
  await run;
  await t.controller.refresh();
  expect(t.controller.getSnapshot().detail!.summaryStatusLabel).toBe('Earlier scope reflected');
  expect(t.controller.getSnapshot().local).toEqual(local);
  expect(t.controller.getSnapshot().evidence).toEqual(evidence);
  const valid = t.h.core.work(t.id).latestSummaryId;
  t.h.summary.check = async () => {
    throw new Error('checker disconnected');
  };
  await t.h.core.process(t.id);
  await t.h.core.process(t.id);
  await t.controller.refresh();
  expect(t.h.core.work(t.id).latestSummaryId).toBe(valid);
  expect(t.controller.getSnapshot().local).toEqual(local);
  expect(t.controller.getSnapshot().evidence).toEqual(evidence);
  expect(t.controller.getSnapshot().detail!.error).toContain('checker disconnected');
});
