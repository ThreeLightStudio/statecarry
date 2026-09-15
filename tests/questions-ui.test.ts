// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  QuestionController,
  emptyQuestionView,
  type Gateway,
  type QuestionView,
  type UIAction,
} from '@statecarry/presentation';
import { ContextQuestions } from '../apps/web/src/ui/ContextQuestions';
import { questionHarness } from './question-fixtures';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

it('IME Enter and Shift+Enter never submit; normal Enter does; source body is opt-in', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    actions: UIAction[] = [];
  try {
    await act(async () =>
      root.render(
        createElement(ContextQuestions, {
          state: { ...emptyQuestionView(), open: true, input: 'Question' },
          onAction: (a) => actions.push(a),
        }),
      ),
    );
    const input = host.querySelector('textarea')!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(actions).toEqual([]);
    expect(host.querySelector('pre')).toBeNull();
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(actions).toEqual([{ type: 'questionSubmit' }]);
    const example = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Why is this action needed?',
    )!;
    await act(async () => example.click());
    expect(actions.at(-1)?.type).toBe('questionInput');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps a closed panel session, clears on navigation, and ignores late delivery', async () => {
  const { h, id } = await questionHarness();
  let view: QuestionView = emptyQuestionView();
  let release!: () => void;
  const gateway = {
    question: async (path: string, payload: any) => {
      if (path.endsWith('/end')) return {};
      if (path.endsWith('/questions')) return h.core.questions.create(id, payload);
      if (path.endsWith('/turns')) {
        const s = h.core.questions.submit(id, path.split('/').at(-2)!, payload);
        await new Promise<void>((r) => {
          release = r;
        });
        return s;
      }
      return h.core.questions.get(id, path.split('/').at(-1)!);
    },
  } as Gateway;
  const controller = new QuestionController(
    gateway,
    () => crypto.randomUUID(),
    (v) => {
      view = v;
    },
  );
  controller.open(id, h.core.work(id).latestSummaryId!, 'next');
  await controller.action({ type: 'questionInput', value: '왜?' });
  const pending = controller.action({ type: 'questionSubmit' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  controller.hide();
  expect(view.input).toBe('왜?');
  expect(view.session).not.toBeNull();
  controller.open(id, h.core.work(id).latestSummaryId!, 'next');
  expect(view.open).toBe(true);
  controller.reset();
  release();
  await pending;
  await h.core.questions.settled();
  expect(view.session).toBeNull();
  expect(view.input).toBe('');
});

it('reconnect refresh only reads after an uncertain submission', async () => {
  const { h, id } = await questionHarness();
  let view = emptyQuestionView(),
    posts = 0;
  const gateway = {
    question: async (path: string, payload: any) => {
      if (path.endsWith('/questions')) return h.core.questions.create(id, payload);
      if (path.endsWith('/turns')) {
        posts++;
        h.core.questions.submit(id, path.split('/').at(-2)!, payload);
        throw Object.assign(new Error('lost'), { code: 'RESULT_UNKNOWN' });
      }
      return h.core.questions.get(id, path.split('/').at(-1)!);
    },
  } as Gateway;
  const controller = new QuestionController(
    gateway,
    () => crypto.randomUUID(),
    (v) => {
      view = v;
    },
  );
  controller.open(id, h.core.work(id).latestSummaryId!, 'next');
  await controller.action({ type: 'questionInput', value: '왜?' });
  await controller.action({ type: 'questionSubmit' });
  expect(view.uncertain).toBe(true);
  await h.core.questions.settled();
  await controller.refresh();
  expect(posts).toBe(1);
  expect(view.session!.turns).toHaveLength(1);
});

it('shows repair progress, blocks submission, and preserves the next-question input', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const { create } = await questionHarness(),
    session = create();
  session.turns.push({
    id: 'repairing',
    text: '배경은?',
    status: 'repairing',
    attempts: 1,
    answer: null,
    assessment: null,
    limitations: [],
    error: null,
    retryable: false,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    actions: UIAction[] = [];
  try {
    await act(async () =>
      root.render(
        createElement(ContextQuestions, {
          state: { ...emptyQuestionView(), open: true, input: '작성 중인 후속 질문', session },
          onAction: (a) => actions.push(a),
        }),
      ),
    );
    expect(host.textContent).toContain('Revising against sources');
    const input = host.querySelector('textarea')!;
    expect(input.value).toBe('작성 중인 후속 질문');
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(actions).toEqual([]);
    const close = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close question',
    )!;
    await act(async () => close.click());
    expect(actions).toEqual([{ type: 'questionClose' }]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
