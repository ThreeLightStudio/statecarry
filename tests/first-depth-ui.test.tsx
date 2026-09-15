// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Controller, presentReturnContext, type AppViewModel, type Gateway } from '@statecarry/presentation';
import { App } from '../apps/web/src/ui/App';
import { HandoffExplanation } from '../apps/web/src/ui/HandoffExplanation';
import { explanationHarness } from './explanation-fixtures';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

async function setup() {
  const t = await explanationHarness(), { h, id } = t;
  const gateway: Gateway = {
    projects: async () => h.core.listProjects(), connections: async () => h.repo.list('connection'),
    snapshot: async w => h.core.snapshot(w), evidence: async e => h.core.evidence(e), discover: h.reader.discover,
    subscribe: () => () => {}, receipt: async key => h.repo.get('receipt', key)!, command: async () => { throw new Error('unused'); },
  };
  const controller = new Controller(gateway, { read: () => null, write() {} }, () => crypto.randomUUID());
  await controller.start(`#/work/${id}`); t.prepare(); const latest = await t.settled();
  const revision = latest.revision!;
  const base = controller.getSnapshot();
  const state: AppViewModel = { ...base, explanation: { latest, revision, raw: {}, stale: false, newAvailable: false, busy: false, error: null } };
  return { ...t, state, controller };
}

it('keeps specific claim uncertainty when the common scope warning is present', async () => {
  const t = await setup();
  try {
    const snapshot = t.h.core.snapshot(t.id);
    snapshot.summary!.claims.find(c => c.slot === 'current')!.verdict = 'unsupported';
    snapshot.freshness!.collection = 'partial';
    const view = presentReturnContext(snapshot);
    expect(view.scopeNotice).toBeTruthy();
    expect(view.current[0].uncertainty).toBe('Interpretation not established by the evidence');
    expect(view.next[0].uncertainty).toBeNull();
  } finally { t.controller.stop(); await t.h.core.close(); }
});

it('distinguishes failed explanation with a summary from no readable result', async () => {
  const t = await setup(), host = document.createElement('div'), root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('scrollTo', vi.fn());
  try {
    const state = { ...t.state, explanation: { ...t.state.explanation!, revision: null, latest: { ...t.state.explanation!.latest!, job: { ...t.state.explanation!.latest!.job!, status: 'failed' as const, error: 'Synthetic failure', canRetry: false } } } };
    const render = (value: AppViewModel) => act(async () => root.render(createElement(App, { state: value, onAction() {}, onConnect: async () => undefined, onDiscover: t.h.reader.discover })));
    await render(state);
    expect(host.querySelector('[aria-label="Validated summary"]')).not.toBeNull();
    expect(host.textContent).toContain('The explanation could not be prepared.');
    expect(host.textContent).not.toContain('No validated summary is available.');
    const details = [...host.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === 'Explanation status details')!;
    expect(details.open).toBe(false); expect(details.textContent).toContain('Synthetic failure');
    await render({ ...state, detail: { ...state.detail!, summaryId: null } });
    expect(host.querySelector('[aria-label="Validated summary"]')).toBeNull();
    expect(host.textContent).toContain('No validated summary is available.');
  } finally { await act(async () => root.unmount()); t.controller.stop(); await t.h.core.close(); vi.unstubAllGlobals(); }
});

it('opens a selected sentence question in place and retains it across disclosure toggles', async () => {
  const t = await setup(), host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  try {
    const revision = t.state.explanation!.revision!;
    const state: AppViewModel = { ...t.state, question: { anchorType: 'explanation', targetKey: JSON.stringify([t.id, revision.summaryId, { explanationId: revision.id, nodeId: 'choice' }]), open: true, input: 'Keep this unsent question', session: null, error: null, busy: false, uncertain: false, raw: {} } };
    await act(async () => root.render(createElement(HandoffExplanation, { state, onAction() {} })));
    const sentence = host.querySelector('[data-explanation-node="choice"]')!;
    const detail = sentence.querySelector<HTMLDetailsElement>('.sentence-detail')!;
    const input = sentence.querySelector('textarea')!;
    expect(detail.open).toBe(true); expect(document.activeElement).toBe(input);
    expect(host.querySelectorAll('.context-questions')).toHaveLength(1);
    detail.open = false;
    await act(async () => root.render(createElement(HandoffExplanation, { state: { ...state }, onAction() {} })));
    expect(detail.open).toBe(false);
    detail.open = true;
    expect(sentence.querySelector('textarea')).toBe(input);
    expect(input.value).toBe('Keep this unsent question');
    expect(host.querySelector('[data-explanation-node="origin"] details')?.hasAttribute('open')).toBe(false);
    const heading = host.querySelector('h2')!; heading.focus();
    await act(async () => root.render(createElement(HandoffExplanation, { state: { ...state, explanation: { ...state.explanation!, revision: { ...revision, id: 'new-reading-revision' } } }, onAction() {} })));
    expect(host.querySelector<HTMLTextAreaElement>('.context-questions textarea')!.value).toBe('Keep this unsent question');
    expect(document.activeElement).toBe(heading);
  } finally { await act(async () => root.unmount()); host.remove(); t.controller.stop(); await t.h.core.close(); vi.unstubAllGlobals(); }
});
