// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  Controller,
  type Gateway,
  type LocalWorkState,
  type UIAction,
} from '@statecarry/presentation';
import { HandoffExplanation } from '../apps/web/src/ui/HandoffExplanation';
import { explanationHarness, explanationRecords } from './explanation-fixtures';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

async function setup(prepareExplanation = true) {
  const t = await explanationHarness(),
    { h, id } = t,
    memory = new Map<string, LocalWorkState>(),
    requests: string[] = [];
  const gateway: Gateway = {
    projects: async () => h.core.listProjects(),
    connections: async () => h.repo.list('connection'),
    snapshot: async (w) => h.core.snapshot(w),
    evidence: async (e) => h.core.evidence(e),
    discover: h.reader.discover,
    subscribe: () => () => {},
    receipt: async (id) => h.repo.get('receipt', id)!,
    command: async (path, input) =>
      h.core.mutate(id, path.split('/').at(-1) as 'visits' | 'drafts', input),
    explanation: async <T,>(path: string, payload?: unknown): Promise<T> => {
      requests.push(path);
      const parts = path.split('/');
      if (path.endsWith('/prepare')) return h.core.explanations.prepare(id, payload) as T;
      if (parts.at(-2) === 'evidence')
        return h.core.explanations.evidence(id, parts.at(-3)!, parts.at(-1)!) as T;
      return h.core.explanations.get(id, parts.at(-1)!) as T;
    },
    question: async <T,>(path: string, payload?: any): Promise<T> => {
      const parts = path.split('/');
      if (path.endsWith('/end')) {
        h.core.questions.end(id, parts.at(-2)!);
        return {} as T;
      }
      if (path.endsWith('/questions')) return h.core.questions.create(id, payload) as T;
      if (path.endsWith('/turns')) return h.core.questions.submit(id, parts.at(-2)!, payload) as T;
      return h.core.questions.get(id, parts.at(-1)!) as T;
    },
  };
  const c = new Controller(
    gateway,
    {
      read: (id) => memory.get(id) ?? null,
      write: (id, value) => {
        memory.set(id, structuredClone(value));
      },
    },
    () => crypto.randomUUID(),
  );
  await c.start(`#/work/${id}`);
  if (prepareExplanation) {
    await c.action({ type: 'explanationPrepare' });
    await t.settled();
    await c.refresh();
  }
  return { ...t, c, gateway, requests, memory };
}
it('prepares only after explicit request; preserves inputs, pinned reading and separate question targets', async () => {
  const { h, id, c, counts, requests, settled } = await setup(false);
  try {
    await c.refresh();
    await c.refresh();
    expect(requests.filter((p) => p.endsWith('/prepare'))).toHaveLength(0);
    expect(counts().generated).toBe(0);
    await c.action({ type: 'explanationPrepare' });
    await settled();
    await c.refresh();
    const original = c.getSnapshot().explanation!.revision!;
    await c.action({ type: 'draft', value: '보존할 초안' });
    await c.action({ type: 'correction', slot: 'next', value: '보존할 수정' });
    await c.action({ type: 'selectEvidence', id: explanationRecords[0].id, selected: true });
    const local = structuredClone(c.getSnapshot().local);
    await c.action({ type: 'explanationQuestion', nodeId: 'origin' });
    await c.action({ type: 'questionInput', value: '처음 질문' });
    await c.action({ type: 'explanationQuestion', nodeId: 'choice' });
    await c.action({ type: 'questionInput', value: '다른 질문' });
    await c.action({ type: 'explanationQuestion', nodeId: 'origin' });
    expect(c.getSnapshot().question?.input).toBe('처음 질문');
    expect(requests.filter((p) => p.endsWith('/prepare'))).toHaveLength(1);
    expect(counts().generated).toBe(1);
    h.records([
      ...explanationRecords,
      { ...explanationRecords[4], key: 'new', id: 'new', text: '후속 관측' },
    ]);
    await h.core.collect(id);
    await h.core.process(id);
    await h.core.explanations.settled();
    await c.refresh();
    expect(c.getSnapshot().explanation?.revision?.id).toBe(original.id);
    expect(c.getSnapshot().explanation?.newAvailable).toBe(true);
    expect(c.getSnapshot().explanation?.stale).toBe(true);
    await c.action({ type: 'explanationAdopt' });
    expect(c.getSnapshot().explanation?.revision?.id).not.toBe(original.id);
    expect({ ...c.getSnapshot().local, readingExplanationId: local.readingExplanationId }).toEqual(
      local,
    );
    expect(c.getSnapshot().question?.input).toBe('처음 질문');
    expect(h.core.snapshot(id).visit).toBeNull();
    await c.action({ type: 'explanationEvidence', revisionId: explanationRecords[0].id });
    await vi.waitFor(() =>
      expect(h.core.snapshot(id).visit?.evidenceIds).toContain(explanationRecords[0].id),
    );
    const link = h.core.links(id)[0];
    h.repo.put('link', { ...link, status: 'separate' });
    await c.refresh();
    expect(c.getSnapshot().explanation?.revision).toBeNull();
    expect(c.getSnapshot().explanation?.raw).toEqual({});
    expect({ ...c.getSnapshot().local, readingExplanationId: local.readingExplanationId }).toEqual({
      ...local,
      evidenceIds: [],
      targetThreadId: '',
    });
  } finally {
    c.stop();
    await h.core.close();
  }
});

it('renders the body, two reason levels and explicit citations without reading raw sources', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { h, c, requests } = await setup(),
    host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    actions: UIAction[] = [];
  try {
    await act(async () =>
      root.render(
        createElement(HandoffExplanation, {
          state: c.getSnapshot(),
          onAction: (a) => actions.push(a),
        }),
      ),
    );
    expect(host.textContent).toContain('30초');
    expect(host.querySelectorAll('.explanation-reason').length).toBe(2);
    expect(host.querySelectorAll('pre')).toHaveLength(0);
    const summaries = [...host.querySelectorAll<HTMLDetailsElement>('.explanation-reason')];
    summaries[0].open = true;
    summaries[1].open = true;
    expect(summaries[0].querySelector('summary')?.textContent).toBe('왜 합성 파일로 바꿨나요?');
    const citation = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.startsWith('Read quotes and evidence'),
    )!;
    await act(async () => citation.click());
    expect(host.querySelector('blockquote')).not.toBeNull();
    expect(actions.map((a) => a.type)).toEqual(['explanationEvidence']);
    const raw = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Read the full source',
    )!;
    await act(async () => raw.click());
    expect(actions.at(-1)?.type).toBe('explanationEvidence');
    expect(requests.filter((p) => p.includes('/evidence/'))).toHaveLength(0);
    const state = c.getSnapshot();
    await act(async () =>
      root.render(
        createElement(HandoffExplanation, {
          state: { ...state, explanation: { ...state.explanation!, newAvailable: true } },
          onAction: (a) => actions.push(a),
        }),
      ),
    );
    const adopt = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Read the new explanation',
    )!;
    adopt.focus();
    await act(async () => adopt.click());
    expect(document.activeElement).toBe(adopt);
    expect(actions.at(-1)?.type).toBe('explanationAdopt');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    c.stop();
    await h.core.close();
  }
});

it('UX5 preserves question input and reading version across goal switching and reload', async () => {
  const { c, id, gateway, memory } = await setup();
  await c.action({ type: 'explanationQuestion', nodeId: 'origin' });
  await c.action({ type: 'questionInput', value: '보존할 목표 질문' });
  const reading = c.getSnapshot().explanation!.revision!.id;
  await c.navigate('#/projects');
  await c.navigate(`#/work/${id}`);
  await c.action({ type: 'explanationQuestion', nodeId: 'origin' });
  expect(c.getSnapshot().question?.input).toBe('보존할 목표 질문');
  expect(c.getSnapshot().explanation?.revision?.id).toBe(reading);
  const reloaded = new Controller(
    gateway,
    {
      read: (id) => memory.get(id) ?? null,
      write: (id, state) => {
        memory.set(id, structuredClone(state));
      },
    },
    () => crypto.randomUUID(),
  );
  await reloaded.start(`#/work/${id}`);
  await reloaded.action({ type: 'explanationQuestion', nodeId: 'origin' });
  expect(reloaded.getSnapshot().question?.input).toBe('보존할 목표 질문');
  expect(reloaded.getSnapshot().local.draft).toBe(c.getSnapshot().local.draft);
});
