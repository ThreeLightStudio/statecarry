// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Controller, type Gateway } from '@statecarry/presentation';
import { App } from '../apps/web/src/ui/App';
import { EXPLANATION_INSTRUCTIONS } from '../apps/server/src/adapters/explanation-prompts';
import { QUESTION_INSTRUCTIONS } from '../apps/server/src/adapters/question-prompts';
import { harness } from './helpers';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

it('keeps connection input and ignores discovery responses for a previous folder', async () => {
  const h = harness();
  const gateway: Gateway = {
    projects: async () => [],
    connections: async () => [],
    snapshot: async (id) => h.core.snapshot(id),
    evidence: async (id) => h.core.evidence(id),
    discover: h.reader.discover,
    subscribe: () => () => {},
    command: async () => {
      throw new Error('unused');
    },
    receipt: async () => {
      throw new Error('unused');
    },
  };
  const controller = new Controller(gateway, { read: () => null, write() {} }, () =>
    crypto.randomUUID(),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const pending: ((value: {
    threads: { id: string; title: string; cwd: string }[];
    complete: boolean;
    limitations: string[];
  }) => void)[] = [];
  const discover = vi.fn(
    () =>
      new Promise<{
        threads: { id: string; title: string; cwd: string }[];
        complete: boolean;
        limitations: string[];
      }>((resolve) => pending.push(resolve)),
  );
  const input = (label: string) =>
    [...host.querySelectorAll('label')]
      .find((el) => el.textContent?.startsWith(label))!
      .querySelector('input')!;
  const fill = async (el: HTMLInputElement, text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const search = () =>
    [...host.querySelectorAll('button')].find(
      (el) => el.textContent === 'Find conversations in this folder',
    )!;
  try {
    await act(async () =>
      root.render(
        createElement(App, {
          state: { ...controller.getSnapshot(), route: '#/connect' },
          onAction() {},
          onConnect: async () => undefined,
          onDiscover: discover,
        }),
      ),
    );
    await fill(input('Project name'), '내 프로젝트 — keep my input');
    await fill(input('Project folder'), '/tmp/first');
    await act(async () => search().click());
    await fill(input('Project folder'), '/tmp/second');
    await act(async () => search().click());
    await act(async () => pending[1]({ threads: [], complete: true, limitations: [] }));
    expect(host.textContent).toContain('No accessible conversations were found');
    await act(async () =>
      pending[0]({
        threads: [{ id: 'old', title: 'Wrong folder result', cwd: '/tmp/first' }],
        complete: true,
        limitations: [],
      }),
    );
    expect(host.textContent).not.toContain('Wrong folder result');
    expect(input('Project folder').value).toBe('/tmp/second');
    expect(input('Project name').value).toBe('내 프로젝트 — keep my input');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    await h.core.close();
  }
});

it('separates the source-language explanation policy from question-language answers', () => {
  expect(EXPLANATION_INSTRUCTIONS).toContain('predominant language of the source records');
  expect(EXPLANATION_INSTRUCTIONS).toContain('no clear predominant language, use English');
  expect(QUESTION_INSTRUCTIONS).toContain('language of the current user question');
  expect(QUESTION_INSTRUCTIONS).toContain('quotations in their original language');
  expect(EXPLANATION_INSTRUCTIONS + QUESTION_INSTRUCTIONS).not.toMatch(
    /in (?:natural )?Korean|Korean question/,
  );
});
