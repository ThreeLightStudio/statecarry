import { describe, expect, it } from 'vitest';
import { conversationFlows } from '../packages/core/src/conversation-flow';
import {
  Controller,
  presentReturnContext,
  type Gateway,
  type LocalWorkState,
} from '@statecarry/presentation';
import type { Observation, SourceRevision, SummaryRevision } from '@statecarry/contracts';
import { source } from './helpers';
import { flowHarness } from './conversation-flow-fixtures';

const derive = (s: SummaryRevision, records: SourceRevision[]) =>
  conversationFlows(s, (id) => records.find((r) => r.id === id) ?? null);
describe('fixed-summary conversation flow', () => {
  it('reuses checked request, proposal and decision without inventing causal edges or making model calls', async () => {
    const { h, id, records } = await flowHarness(),
      before = h.counts();
    const flow = h.core.snapshot(id).conversationFlows!.find((f) => f.claimId === 'current')!;
    expect(flow.items.map((i) => i.type)).toEqual([
      'user-request',
      'agent-proposal',
      'user-decision',
      'agent-interpretation',
    ]);
    expect(flow.items.every((i) => i.status === 'supported')).toBe(true);
    expect(flow).not.toHaveProperty('edges');
    expect(flow.items[0].sources[0]).toMatchObject({
      revisionId: records[0].id,
      quoteStarts: [0],
      threadId: 'thread-a',
      actor: 'user',
    });
    expect(h.core.snapshot(id).conversationFlows).toEqual(h.core.snapshot(id).conversationFlows);
    expect(h.counts()).toEqual(before);
  });
  it('keeps a proposal a proposal when no decision exists', async () => {
    const { h, id, records } = await flowHarness();
    h.records(records.slice(0, 2));
    await h.core.collect(id);
    await h.core.process(id);
    const flows = h.core.snapshot(id).conversationFlows!;
    expect(flows.flatMap((f) => f.items).some((i) => i.type === 'user-decision')).toBe(false);
    expect(flows.find((f) => f.claimId === 'next')!.items.at(-1)!.type).toBe('agent-proposal');
  });
  it('preserves an explicit checked change without inferring supersession from timestamps', async () => {
    const { h, id, records } = await flowHarness(),
      s = h.core.snapshot(id).summary!;
    const change = source(
      '앞선 선택을 바꿉니다. 원문은 선택한 경우에만 엽니다.',
      'thread-a',
      'changed-decision',
    );
    const decision = s.claims.find((c) => c.id === 'decision')!;
    s.claims.push({
      ...decision,
      id: 'change',
      text: change.text,
      evidence: [{ revisionId: change.id, quote: change.text }],
    });
    s.sourceRevisionIds.push(change.id);
    s.checks.checks.push({ claimId: 'change', verdict: 'supported', reason: 'synthetic check' });
    s.claims
      .find((c) => c.id === 'current')!
      .evidence.push({ revisionId: change.id, quote: change.text });
    const f = derive(s, [...records, change]).find((f) => f.claimId === 'current')!;
    expect(f.items.filter((i) => i.type === 'user-decision').map((i) => i.summary)).toEqual([
      decision.text,
      change.text,
    ]);
    expect(f).not.toHaveProperty('edges');
  });
  it.each([
    'agent-decision',
    'outside-input',
    'bad-quote',
    'missing-source',
    'uncertain-check',
    'absent-check',
  ])('limits %s and excludes it from related discussion', async (mode) => {
    const { h, id, records } = await flowHarness(),
      s = h.core.snapshot(id).summary!;
    const c = s.claims.find((c) => c.id === 'decision')!,
      r = records[2];
    if (mode === 'agent-decision') r.actor = 'agent';
    if (mode === 'outside-input')
      s.sourceRevisionIds = s.sourceRevisionIds.filter((id) => id !== r.id);
    if (mode === 'bad-quote') c.evidence[0].quote = 'never said';
    if (mode === 'missing-source') records.pop();
    if (mode === 'uncertain-check')
      s.checks.checks.find((check) => check.claimId === c.id)!.verdict = 'uncertain';
    if (mode === 'absent-check')
      s.checks.checks = s.checks.checks.filter((check) => check.claimId !== c.id);
    const flows = derive(s, records);
    expect(flows.find((f) => f.claimId === c.id)!.items.at(-1)!.status).toBe('limited');
    expect(
      flows
        .find((f) => f.claimId === 'current')!
        .items.filter((i) => i.claimId !== 'current')
        .some((i) => i.claimId === c.id),
    ).toBe(false);
  });
  it('does not pull in another conversation merely because it is later in the summary', async () => {
    const { h, id, records } = await flowHarness(),
      s = h.core.snapshot(id).summary!;
    const other = source('별개 대화의 결정', 'thread-b');
    s.sourceRevisionIds.push(other.id);
    s.claims.push({
      ...s.claims[0],
      id: 'other',
      text: other.text,
      evidence: [{ revisionId: other.id, quote: other.text }],
    });
    s.checks.checks.push({ claimId: 'other', verdict: 'supported', reason: 'synthetic' });
    expect(
      derive(s, [...records, other])
        .find((f) => f.claimId === 'current')!
        .items.some((i) => i.claimId === 'other'),
    ).toBe(false);
  });
  it('exposes source time and collection limitations without calling collection time a decision time', async () => {
    const { h, id, records } = await flowHarness(),
      s = h.core.snapshot(id).summary!;
    records[0].eventAt = null;
    records[0].limitations = ['일부 기록만 수집했습니다.'];
    s.limitations.push('고정 입력의 일부 대화가 누락됐습니다.');
    const flow = derive(s, records)[0];
    expect(flow.limitations).toContain('고정 입력의 일부 대화가 누락됐습니다.');
    expect(flow.items[0].limitations).toEqual(
      expect.arrayContaining(['Send time unknown', '일부 기록만 수집했습니다.']),
    );
    expect(flow.items[0].sources[0].eventAt).toBeNull();
  });
  it('uses stored old revisions after correction and never substitutes the latest source', async () => {
    const { h, id, records } = await flowHarness(),
      old = h.core.snapshot(id);
    const corrected = source('수정된 새 요청입니다.', 'thread-a', 'request');
    h.records([corrected, ...records.slice(1)]);
    await h.core.collect(id);
    const next = h.core.snapshot(id);
    expect(next.conversationFlows).toEqual(old.conversationFlows);
    expect(next.coverage!.updated).toContainEqual({
      previousId: records[0].id,
      currentId: corrected.id,
    });
    expect(next.conversationFlows![0].items[0].sources[0].revisionId).toBe(records[0].id);
  });
  it('keeps overlay provenance and offers limited old-data fallback', async () => {
    const { h, id } = await flowHarness(),
      s = h.core.snapshot(id);
    h.core.mutate(
      id,
      'corrections',
      h.command(id, {
        slot: 'current',
        text: '사용자가 바꾼 문장',
        baseSummaryId: s.summary!.id,
        overlayRevision: 0,
        active: true,
      }),
    );
    const snapshot = h.core.snapshot(id),
      view = presentReturnContext(snapshot);
    expect(view.current[0].flow.edited).toBe(true);
    expect(view.current[0].flow.preview).toContain('Evidence for the original summary');
    expect(view.current[0].flow.title).not.toContain('사용자가 바꾼 문장');
    delete snapshot.conversationFlows;
    const fallback = presentReturnContext(snapshot).current[0].flow;
    expect(fallback.items).toHaveLength(1);
    expect(fallback.items[0].status).toBe('limited');
    expect(fallback.items[0].sources.length).toBe(3);
  });
  it('rejects a mismatched input boundary in a transported flow', async () => {
    const { h, id } = await flowHarness(),
      snapshot = h.core.snapshot(id);
    snapshot
      .conversationFlows!.find((f) => f.claimId === 'current')!
      .sourceRevisionIds.push('foreign-revision');
    expect(presentReturnContext(snapshot).current[0].flow.items[0].status).toBe('limited');
  });
  it('does not expose source metadata for a conversation removed from this work', async () => {
    const { h, id } = await flowHarness();
    const link = h.core.snapshot(id).links[0];
    h.repo.put('link', { ...link, status: 'separate' });
    const item = h.core.snapshot(id).conversationFlows![0]?.items[0];
    expect(item).toBeUndefined();
    expect(h.core.snapshot(id).summary).toBeNull();
  });
});

describe('flow controller state', () => {
  it('pins open flow through publication, preserves edits and only records raw reads after explicit opening', async () => {
    const { h, id, records } = await flowHarness();
    const observations: Observation[] = [],
      memory = new Map<string, LocalWorkState>();
    let reads = 0;
    const gateway: Gateway = {
      projects: async () => h.core.listProjects(),
      connections: async () => h.repo.list('connection'),
      snapshot: async (id) => h.core.snapshot(id),
      evidence: async (id) => {
        reads++;
        return h.core.evidence(id);
      },
      subscribe: () => () => {},
      discover: h.reader.discover,
      command: async (path, command) =>
        h.core.mutate(id, path.endsWith('visits') ? 'visits' : 'drafts', command),
      receipt: async () => {
        throw new Error('unused');
      },
      observe: async (o) => {
        observations.push(o);
      },
    };
    const controller = new Controller(
      gateway,
      {
        read: (id) => memory.get(id) ?? null,
        write: (id, state) => {
          memory.set(id, state);
        },
      },
      () => crypto.randomUUID(),
    );
    await controller.start(`#/work/${id}`);
    await controller.action({ type: 'draft', value: '보존할 초안' });
    await controller.action({ type: 'correction', value: '보존할 수정', slot: 'reason' });
    await controller.action({ type: 'selectEvidence', id: records[0].id, selected: true });
    await controller.action({ type: 'scroll', value: 440 });
    const local = structuredClone(controller.getSnapshot().local),
      flowId = controller.getSnapshot().detail!.current[0].flow.id;
    await controller.action({ type: 'openFlow', id: flowId });
    const opened = structuredClone(controller.getSnapshot().openedFlow);
    await controller.action({ type: 'displayed', summaryId: opened!.summaryId });
    expect(h.core.snapshot(id).visit!.evidenceIds).toEqual([]);
    expect(reads).toBe(0);
    expect(observations.filter((o) => o.kind === 'evidence')).toHaveLength(0);
    h.records([source('새로운 요청입니다.', 'thread-a', 'request'), ...records.slice(1)]);
    await h.core.collect(id);
    await h.core.process(id);
    await controller.refresh();
    expect(controller.getSnapshot().openedFlow).toEqual(opened);
    expect(controller.getSnapshot().detail!.summaryId).not.toBe(opened!.summaryId);
    expect(controller.getSnapshot().local).toEqual(local);
    await controller.action({ type: 'evidence', id: records[0].id, withinFlow: true });
    expect(controller.getSnapshot().evidence[records[0].id].text).toBe(records[0].text);
    expect(controller.getSnapshot().evidenceFocusId).toBeNull();
    expect(observations.filter((o) => o.kind === 'evidence')).toHaveLength(1);
    expect(observations.find((o) => o.kind === 'evidence')!.summaryId).toBe(opened!.summaryId);
    await controller.action({ type: 'closeFlow' });
    expect(controller.getSnapshot().openedFlow).toBeNull();
    expect(controller.getSnapshot().local).toEqual({ ...local, expandedIds: [records[0].id] });
    controller.stop();
  });
});
