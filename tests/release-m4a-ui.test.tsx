// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Controller, type Gateway } from '@statecarry/presentation';
import { App } from '../apps/web/src/ui/App';
import { harness } from './helpers';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
it('keeps selection local until confirmation and sends the chosen first range or explicit all-turn range', async () => {
  const h = harness(); const gateway: Gateway = { projects: async () => [], connections: async () => [], snapshot: async id => h.core.snapshot(id), evidence: async id => h.core.evidence(id), discover: h.reader.discover, subscribe: () => () => {}, command: async () => { throw new Error('unused'); }, receipt: async () => { throw new Error('unused'); } };
  const controller = new Controller(gateway, { read: () => null, write() {} }, () => crypto.randomUUID());
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const connect = vi.fn(async () => undefined), list = vi.fn(async () => ({ turns: [{ id: 'chosen', at: '2026-09-13' }] }));
  const input = (label: string) => [...host.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))!.querySelector('input')!;
  const change = async (el: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
  const click = async (text: string) => act(async () => [...host.querySelectorAll('button')].find(el => el.textContent?.trim() === text)!.click());
  try {
    await act(async () => root.render(createElement(App, { state: { ...controller.getSnapshot(), route: '#/connect' }, onAction() {}, onConnect: connect, onDiscover: h.reader.discover, onListTurns: list })));
    await change(input('Project name'), 'Fixture'); await change(input('Project folder'), '/fixture'); await change(input('Conversation IDs continued'), 'thread-a');
    await click('Find starting turns'); expect(list).toHaveBeenCalledWith('thread-a'); expect(connect).not.toHaveBeenCalled(); expect(h.counts().generationCalls).toBe(0);
    const select = host.querySelector('select')!; await act(async () => { select.value = 'chosen'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('Connect selected records'); expect(connect.mock.calls[0]).toEqual([{ title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: { 'thread-a': 'chosen' }, discover: true }]);
    await click('Use all accessible turns'); await click('Connect selected records'); expect(connect.mock.calls[1]).toEqual([{ title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: {}, discover: true }]);
  } finally { await act(async () => root.unmount()); host.remove(); await h.core.close(); }
});
