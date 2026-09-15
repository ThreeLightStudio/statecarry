import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Controller, type Gateway } from '@statecarry/presentation';
import { HandoffPanel } from '../apps/web/src/ui/HandoffPanel';
import { harness, source } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { renderToStaticMarkup } = webRequire('react-dom/server'), { createElement } = webRequire('react');

it('renders usable activation guidance and keeps inaccessible selections explicitly removable', async () => {
  const h = harness(), id = h.connect(); await h.core.collect(id); await h.core.process(id);
  h.navigator.capability = () => ({ precision: 'unsupported', verifiedAt: null, state: 'missing', detail: '검증 근거 미등록' });
  const gateway: Gateway = { projects: async () => h.core.listProjects(), connections: async () => h.repo.list('connection'), snapshot: async id => h.core.snapshot(id), evidence: async id => h.core.evidence(id), discover: h.reader.discover, subscribe: () => () => {},
    command: async (_path, command) => h.core.prepareHandoff(id, command.expectedRevision, command.payload), receipt: async () => { throw new Error('none'); } };
  const controller = new Controller(gateway, { read: () => null, write() {} }, identity.next); await controller.start(`#/work/${id}`);
  await controller.action({ type: 'selectEvidence', id: source().id, selected: true }); await controller.action({ type: 'prepareHandoff' });
  let html = renderToStaticMarkup(createElement(HandoffPanel, { state: controller.getSnapshot(), onAction() {} }));
  for (const text of ['기록 A', 'Work records', 'Set up opening in Codex', '--verify-navigation', 'thread-a', 'Codex conversation']) expect(html).toContain(text);
  expect(html).not.toContain('--navigation-evidence'); expect(html).not.toContain('--register-navigation-evidence');
  expect(html).toMatch(/disabled=""[^>]*>Open conversation in Codex/);
  await controller.action({ type: 'selectEvidence', id: 'inaccessible', selected: true });
  html = renderToStaticMarkup(createElement(HandoffPanel, { state: controller.getSnapshot(), onAction() {} }));
  expect(html).toContain('Outside the current access scope'); expect(html).toContain('Remove this evidence');
  expect(controller.getSnapshot().local.evidenceIds).toContain('inaccessible');
  const state = controller.getSnapshot();
  html = renderToStaticMarkup(createElement(HandoffPanel, { state: { ...state, local: { ...state.local, basisSummaryId: 'previous-summary' } }, onAction() {} }));
  expect(html).toContain('Your draft and evidence use a different summary basis');
  expect(html).toMatch(/disabled=""[^>]*>Review target and evidence/);
  expect(html).toContain('Keep evidence and use the current summary');

});
