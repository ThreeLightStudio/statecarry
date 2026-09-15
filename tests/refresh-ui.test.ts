import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Controller, type Gateway } from '@statecarry/presentation';
import { App } from '../apps/web/src/ui/App';
import { harness, source } from './helpers';
import { identity } from '../apps/server/src/adapters/identity';
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { renderToStaticMarkup } = webRequire('react-dom/server');
const { createElement } = webRequire('react');

it('renders reflected and corrected ranges with distinct processing states and unknown source times', async () => {
  const h = harness(), id = h.connect(); const first = { ...source(), eventAt: null }; h.records([first]); await h.core.collect(id); await h.core.process(id);
  h.records([{ ...source('정정된 행동'), eventAt: null }]); await h.core.collect(id);
  const gateway: Gateway = { projects: async () => h.core.listProjects(), connections: async () => h.repo.list('connection'), snapshot: async id => h.core.snapshot(id), evidence: async id => h.core.evidence(id),
    discover: h.reader.discover, subscribe: () => () => {}, command: async () => { throw new Error('No writes in render test'); }, receipt: async () => { throw new Error('No receipts'); } };
  const controller = new Controller(gateway, { read: () => null, write() {} }, identity.next); await controller.start(`#/work/${id}`);
  const html = renderToStaticMarkup(createElement(App, { state: controller.getSnapshot(), onAction() {}, onConnect: async () => undefined, onDiscover: async () => ({ threads: [], complete: true, limitations: [] }) }));
  for (const label of ['Earlier scope reflected', 'Waiting for a follow-up summary', 'Updated sources not yet reflected', 'Previously reflected versions', 'Send time unknown', 'Summary generated', 'Input captured']) expect(html).toContain(label);
  expect(html).not.toContain('모두 반영됨'); expect(html).toContain('thread-a / turn-a / item-a');
});
