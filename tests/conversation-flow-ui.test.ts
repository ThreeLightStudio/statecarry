// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  Controller,
  emptyQuestionView,
  type Gateway,
  type UIAction,
} from '@statecarry/presentation';
import { App } from '../apps/web/src/ui/App';
import { ConversationFlow } from '../apps/web/src/ui/ConversationFlow';
import { flowHarness } from './conversation-flow-fixtures';
import { questionHarness } from './question-fixtures';
import { source } from './helpers';
const renderer = vi.hoisted(() => ({
  render: vi.fn(
    async (source: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg">${[...source.matchAll(/^([ns]\d+)\[/gm)].map((m, i) => `<g class="node" id="flowchart-${m[1]}-${i}"><rect/><text>${m[1]}</text></g>`).join('')}</svg>`,
  ),
}));
vi.mock('../apps/web/src/ui/flow-renderer', () => ({ renderFlowSvg: renderer.render }));

const webRequire = createRequire(resolve('apps/web/package.json'));
const { createElement, act } = webRequire('react') as typeof import('react');
const { createRoot } = webRequire('react-dom/client') as typeof import('react-dom/client');
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => {
  renderer.render.mockClear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // jsdom lacks native dialog behavior; real-browser QA covers focus trapping and layout.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function setup() {
  const fixture = await flowHarness(),
    { h, id } = fixture;
  const gateway: Gateway = {
    projects: async () => h.core.listProjects(),
    connections: async () => h.repo.list('connection'),
    snapshot: async (id) => h.core.snapshot(id),
    evidence: async (id) => h.core.evidence(id),
    discover: h.reader.discover,
    subscribe: () => () => {},
    command: async (_, c) => h.core.mutate(id, 'visits', c),
    receipt: async () => {
      throw new Error('unused');
    },
  };
  const controller = new Controller(gateway, { read: () => null, write() {} }, () =>
    crypto.randomUUID(),
  );
  await controller.start(`#/work/${id}`);
  const onAction = (a: UIAction) => {
    void controller.action(a);
  };
  const render = () =>
    root.render(
      createElement(App, {
        state: controller.getSnapshot(),
        onAction,
        onConnect: async () => undefined,
        onDiscover: async () => ({ threads: [], complete: true, limitations: [] }),
      }),
    );
  await act(async () => render());
  return { ...fixture, controller, render };
}
it('opens flow before raw text, selects revision IDs, closes and restores focus', async () => {
  const { controller, render, records } = await setup();
  const opener = host.querySelector<HTMLButtonElement>(
    '.summary-section[aria-label="Current status"] .flow-trigger',
  )!;
  expect(opener.textContent).toBe('Conversation context');
  expect(opener.textContent).not.toContain('근거 1 보기');
  expect(document.getElementById(opener.getAttribute('aria-describedby')!)!.textContent).toContain(
    'Claim meaning check',
  );
  opener.focus();
  await act(async () => {
    opener.click();
    render();
  });
  const dialog = host.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain('User request');
  expect(dialog.textContent).toContain('AI Proposal');
  expect(dialog.textContent).toContain('User decision');
  expect(dialog.querySelector('pre')).toBeNull();
  expect(controller.getSnapshot().evidence).toEqual({});
  const select = dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  await act(async () => {
    select.click();
    render();
  });
  expect(controller.getSnapshot().local.evidenceIds).toEqual([records[0].id]);
  const raw = [...dialog.querySelectorAll('button')].find(
    (b) => b.textContent === 'Read quote and source',
  )!;
  await act(async () => {
    raw.click();
    await Promise.resolve();
    render();
  });
  expect(dialog.querySelector('pre')!.textContent).toBe(records[0].text);
  await act(async () => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    render();
  });
  expect(host.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  controller.stop();
});

const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(
    (b) => b.textContent === label,
  )!;
async function showGraph(render: () => void) {
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(
        '.summary-section[aria-label="Current status"] .flow-trigger',
      )!
      .click();
    render();
  });
  expect(renderer.render).not.toHaveBeenCalled();
  await act(async () => {
    button('Graph').click();
  });
  await act(async () => {
    await import('../apps/web/src/ui/FlowGraph');
    await import('../apps/web/src/ui/flow-renderer');
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('.flow-node-list button')).not.toBeNull();
  });
}
it('selects SVG and keyboard equivalents without reading raw evidence, preserving selection on refresh and switching', async () => {
  const { h, id, records, controller, render } = await setup();
  await controller.action({ type: 'draft', value: '그래프에서도 보존할 초안' });
  await showGraph(render);
  await vi.waitFor(() => expect(host.querySelector('g.node')).not.toBeNull());
  await act(async () => {
    host
      .querySelector<SVGGElement>('g.node')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  let visible = [...host.querySelectorAll<HTMLLIElement>('.flow-items > li')].filter(
    (i) => !i.hidden,
  );
  expect(visible).toHaveLength(1);
  expect(visible[0].textContent).toContain('User request');
  expect(controller.getSnapshot().evidence).toEqual({});
  expect(h.core.snapshot(id).visit?.evidenceIds ?? []).toEqual([]);
  expect(host.querySelector('.flow-node-list')!.getAttribute('aria-describedby')).toBeTruthy();
  const selectionButton = host.querySelector<HTMLButtonElement>('.flow-node-list button')!;
  expect(document.getElementById(selectionButton.getAttribute('aria-controls')!)).toBe(
    host.querySelector('.flow-items'),
  );
  expect(document.activeElement).toBe(host.querySelector('.flow-details-heading'));
  expect(host.querySelector('.flow-details-heading')!.scrollIntoView).toHaveBeenCalled();
  expect(controller.getSnapshot().evidence).toEqual({});
  await act(async () => button('Back to item selection').click());
  expect(document.activeElement).toBe(selectionButton);
  await act(async () => selectionButton.click());
  expect(document.activeElement).toBe(host.querySelector('.flow-details-heading'));
  const raw = [...visible[0].querySelectorAll('button')].find(
    (b) => b.textContent === 'Read quote and source',
  )!;
  await act(async () => {
    raw.click();
    await Promise.resolve();
    render();
  });
  expect(visible[0].querySelector('pre')!.textContent).toBe(records[0].text);
  await act(async () => {
    visible[0].querySelector<HTMLInputElement>('input')!.click();
    render();
  });
  const hub = [...host.querySelectorAll<HTMLButtonElement>('.flow-node-list button')].find((b) =>
    b.textContent!.includes('Shared source'),
  )!;
  await act(async () => {
    hub.focus();
    hub.click();
    button('Text').click();
    button('Graph').click();
  });
  expect(hub.getAttribute('aria-pressed')).toBe('true');
  visible = [...host.querySelectorAll<HTMLLIElement>('.flow-items > li')].filter((i) => !i.hidden);
  expect(visible).toHaveLength(2);
  expect(host.querySelector('.flow-details-heading')!.textContent).toBe(
    'Items linked to shared source 2 items',
  );
  h.records([source('그래프가 열린 뒤 새 요청', 'thread-a', 'request'), ...records.slice(1)]);
  await h.core.collect(id);
  await h.core.process(id);
  await act(async () => {
    await controller.refresh();
    render();
  });
  expect(host.querySelector('dialog')!.textContent).toContain('the summary you opened');
  expect(hub.getAttribute('aria-pressed')).toBe('true');
  expect(controller.getSnapshot().local.draft).toBe('그래프에서도 보존할 초안');
  expect(controller.getSnapshot().local.evidenceIds).toContain(records[0].id);
  expect(renderer.render).toHaveBeenCalledTimes(1);
  controller.stop();
});
it('keeps usable text when rendering fails', async () => {
  renderer.render.mockRejectedValueOnce(new Error('synthetic renderer failure'));
  const { controller, render } = await setup();
  await showGraph(render);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('dialog')!.textContent).toContain('The graph could not be displayed');
  });
  expect(
    [...host.querySelectorAll<HTMLLIElement>('.flow-items > li')].every((i) => !i.hidden),
  ).toBe(true);
  expect(controller.getSnapshot().evidence).toEqual({});
  await act(async () => button('Text').click());
  expect(button('Text').getAttribute('aria-pressed')).toBe('true');
  controller.stop();
});
it('keeps full conditions and the mounted question session/input across graph selection and view changes', async () => {
  const { controller } = await setup();
  const state = controller.getSnapshot(),
    flow = structuredClone(state.detail!.current[0].flow);
  const item = flow.items.find((item) => item.claimId === flow.claimId)!;
  item.summary = '긴 요약 (2단계) '.repeat(12) + '전체 문장 끝';
  item.condition = '검토를 마친 경우에만 진행';
  const { create } = await questionHarness();
  const session = create(),
    actions: UIAction[] = [];
  const question = { ...emptyQuestionView(), open: true, input: '작성 중인 질문', session };
  await act(async () =>
    root.render(
      createElement(ConversationFlow, {
        flow,
        state: { ...state, question },
        onAction: (a) => actions.push(a),
      }),
    ),
  );
  const input = host.querySelector('textarea')!;
  await act(async () => button('Graph').click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('.flow-node-list button')).not.toBeNull();
  });
  const selected = host.querySelector<HTMLButtonElement>(
    '.flow-node-list button[aria-pressed=true]',
  )!;
  expect(selected.textContent).toContain('…');
  const revealed: string[] = [];
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('flow-details-heading'))
      revealed.push(host.querySelector('.flow-items>li:not([hidden]) .flow-text')!.textContent!);
  });
  await act(async () => selected.click());
  expect(document.activeElement).toBe(host.querySelector('.flow-details-heading'));
  const details = host.querySelector('.flow-items>li:not([hidden])')!;
  expect(details.querySelector('.flow-text')!.textContent).toBe(item.summary);
  expect(details.querySelector('.condition')!.textContent).toContain(item.condition);
  expect(details.textContent).toContain(item.statusLabel);
  await act(async () => button('Back to item selection').click());
  expect(document.activeElement).toBe(selected);
  const other = host.querySelector<HTMLButtonElement>('.flow-node-list button')!;
  await act(async () => other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.activeElement).toBe(selected);
  expect(revealed).toEqual([item.summary]);
  await act(async () => other.click());
  expect(revealed.at(-1)).toBe(flow.items[0].summary);
  await act(async () => selected.click());
  expect(revealed).toEqual([item.summary, flow.items[0].summary, item.summary]);
  await act(async () => button('Text').click());
  await act(async () => button('Graph').click());
  expect(host.querySelector('textarea')).toBe(input);
  expect(input.value).toBe('작성 중인 질문');
  expect(question.session).toBe(session);
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect(actions).toEqual([]);
  controller.stop();
});
it('discards a render completing after dialog close', async () => {
  let finish!: (svg: string) => void;
  renderer.render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { controller, render } = await setup();
  await showGraph(render);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => {
    button('Close').click();
    render();
  });
  await act(async () => finish('<svg id="late-render"/>'));
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.querySelector('#late-render')).toBeNull();
  controller.stop();
});
it('keeps old flow on refresh, warns on overlay and preserves the draft', async () => {
  const { h, id, records, controller, render } = await setup();
  await controller.action({ type: 'draft', value: '보존할 초안' });
  const opener = host.querySelector<HTMLButtonElement>(
    '.summary-section[aria-label="Current status"] .flow-trigger',
  )!;
  opener.focus();
  await act(async () => {
    opener.click();
    render();
  });
  const oldSummary = controller.getSnapshot().openedFlow!.summaryId;
  h.core.mutate(
    id,
    'corrections',
    h.command(id, {
      slot: 'current',
      text: '수정된 사용자 문장',
      baseSummaryId: oldSummary,
      overlayRevision: 0,
      active: true,
    }),
  );
  await act(async () => {
    await controller.refresh();
    render();
  });
  expect(host.querySelector('dialog')!.textContent).toContain(
    'Your edited text has not been validated against this context.',
  );
  h.records([source('이후의 새 요청', 'thread-a', 'request'), ...records.slice(1)]);
  await h.core.collect(id);
  await h.core.process(id);
  await act(async () => {
    await controller.refresh();
    render();
  });
  const dialog = host.querySelector('dialog')!;
  expect(dialog.textContent).toContain('the summary you opened');
  expect(dialog.textContent).not.toContain('이후의 새 요청');
  expect(controller.getSnapshot().local.draft).toBe('보존할 초안');
  controller.stop();
});
