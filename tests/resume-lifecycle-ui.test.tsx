// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Resume } from '../apps/web/src/ui/Resume';
import { HttpResumeGateway } from '../apps/web/src/adapters/resume-gateway';
import type {
  ResumeGateway,
  ResumeWork,
  ResumeMemory,
  SavedResumeEdits,
} from '@statecarry/presentation';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function record(): ResumeWork {
  return {
    workId: 'lifecycle-a',
    title: 'Export',
    cwd: '/synthetic-project',
    version: 'v1',
    goalText: 'Ship the export',
    goalOrigin: 'user-input',
    sessionCount: 1,
    busy: false,
    stale: false,
    updatesAvailable: false,
    error: null,
    state: 'ready',
    generatedAt: '2026-09-15T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    candidates: ['first', 'second'].map((key) => ({
      key,
      goal: `Export ${key}`,
      currentState: `The ${key} export check is ready.`,
      status: 'active',
      reason: 'The saved output still needs a check.',
      nextAction: `Review ${key} output`,
      doneWhen: 'The output is checked.',
      actionSource: 'recorded',
      threadId: 'synthetic-thread',
      prerequisites: [],
      evidence: [{ revisionId: 'synthetic-record', quote: 'Review the saved output.' }],
    })),
  };
}

async function mount(
  gateway: ResumeGateway,
  memory?: ResumeMemory,
  viewCache?: { works: ResumeWork[] },
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
    host.remove();
  };
  cleanups.push(unmount);
  await act(async () =>
    root.render(createElement(Resume, { gateway, workId: 'lifecycle-a', memory, viewCache })),
  );
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
    expect(button, label).toBeTruthy();
    await act(async () => button!.click());
  };
  const type = async (name: string, value: string) => {
    const input = host.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        value,
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { host, click, type, unmount };
}

function gatewayFor(item = record()) {
  return {
    list: vi.fn(async () => [structuredClone(item)]),
    refresh: vi.fn(async () => {}),
    setGoal: vi.fn(async () => {}),
    correct: vi.fn(async () => {}),
  } satisfies ResumeGateway;
}

it('restores the selected candidate and original-version drafts after unmount and remount', async () => {
  const values = new Map<string, SavedResumeEdits>();
  const memory = {
    read: (id: string) => values.get(id) ?? null,
    write: (id: string, value: SavedResumeEdits) => {
      values.set(id, structuredClone(value));
    },
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const gateway = gatewayFor();
  const first = await mount(gateway, memory);
  await act(async () =>
    first.host.querySelectorAll<HTMLButtonElement>('.resume-choices button')[1].click(),
  );
  await first.click('Edit goal');
  await first.type('goal', 'Unsaved goal');
  await first.click('Right work, wrong next step');
  await first.type('next-action', 'Unsaved action');
  await first.unmount();
  const second = await mount(gateway, memory);
  expect(
    second.host.querySelector('.resume-choices button[aria-pressed="true"]')?.textContent,
  ).toContain('Export second');
  expect(second.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
    'Unsaved goal',
  );
  expect(
    second.host.querySelector<HTMLTextAreaElement>('textarea[name="next-action"]')?.value,
  ).toBe('Unsaved action');
  expect(gateway.refresh).not.toHaveBeenCalled();
  expect(gateway.setGoal).not.toHaveBeenCalled();
});

it('keeps the brief on a stream error and fetches saved results on reconnect without analysis', async () => {
  const streams: FakeStream[] = [];
  class FakeStream extends EventTarget {
    closed = false;
    constructor(_url: string) {
      super();
      streams.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal('EventSource', FakeStream);
  let item = record();
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => [structuredClone(item)] }));
  vi.stubGlobal('fetch', fetcher);
  const view = await mount(new HttpResumeGateway());
  await view.click('Edit goal');
  await view.type('goal', 'Keep while offline');
  await act(async () => streams[0].dispatchEvent(new Event('error')));
  expect(view.host.textContent).toContain('Connection lost');
  expect(view.host.textContent).toContain('The first export check is ready.');
  expect(view.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
    'Keep while offline',
  );
  item = { ...item, version: 'v2', updatesAvailable: true };
  await act(async () => streams[0].dispatchEvent(new Event('connected')));
  expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  expect(view.host.textContent).toMatch(/New (?:connected )?records/);
  expect(
    fetcher.mock.calls.every(
      (call) => !((call as unknown[])[1] as RequestInit | undefined)?.method,
    ),
  ).toBe(true);
  await view.unmount();
  expect(streams[0].closed).toBe(true);
});

it('does not drop a change event received while the previous list read is pending', async () => {
  const gate = deferred<ResumeWork[]>();
  let changed!: () => void;
  const next = { ...record(), goalText: 'New saved goal', version: 'v2' };
  const gateway = {
    ...gatewayFor(),
    list: vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue([next]),
    subscribe(listener: () => void) {
      changed = listener;
      return () => {};
    },
  };
  const view = await mount(gateway);
  await act(async () => {
    changed();
    gate.resolve([record()]);
  });
  expect(gateway.list).toHaveBeenCalledTimes(2);
  expect(view.host.querySelector('h1')?.textContent).toBe('New saved goal');
  expect(gateway.refresh).not.toHaveBeenCalled();
});

it('shows a storage failure while leaving the current goal draft editable', async () => {
  const memory = {
    read: () => null,
    write: () => {
      throw new Error('storage disabled');
    },
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const view = await mount(gatewayFor(), memory);
  await view.click('Edit goal');
  await view.type('goal', 'Preserve this draft');
  expect(view.host.textContent).toContain('Browser storage is unavailable');
  expect(view.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
    'Preserve this draft',
  );
});

it('keeps the draft version until the user explicitly reviews it against current records', async () => {
  const memory: ResumeMemory = {
    read: () => ({
      selectedKey: 'first',
      goalDraft: { text: 'Earlier draft', version: 'v0' },
      actionDrafts: [],
      expanded: [],
      scroll: 0,
    }),
    write: () => {},
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const gateway = gatewayFor();
  const view = await mount(gateway, memory);
  expect(view.host.textContent).toContain('This draft was written against earlier records');
  expect(gateway.setGoal).not.toHaveBeenCalled();
  await view.click('Use current records for this edit');
  expect(gateway.setGoal).not.toHaveBeenCalled();
  expect(view.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
    'Earlier draft',
  );
  await view.click('Save goal');
  expect(gateway.setGoal.mock.calls).toEqual([['lifecycle-a', 'Earlier draft', 'v1']]);
});

it('restores expanded reading panels and scroll without preserving a transient busy flag', async () => {
  const values = new Map<string, SavedResumeEdits>();
  const memory: ResumeMemory = {
    read: (id) => values.get(id) ?? null,
    write: (id, value) => {
      values.set(id, structuredClone(value));
    },
  };
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('scrollY', 370);
  const gateway = gatewayFor();
  const first = await mount(gateway, memory);
  const panel = first.host.querySelector<HTMLDetailsElement>('.resume-manual-handoff')!;
  await act(async () => {
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    window.dispatchEvent(new Event('scroll'));
  });
  await first.unmount();
  const second = await mount(gateway, memory);
  expect(scroll).toHaveBeenLastCalledWith(0, 370);
  expect(second.host.querySelector<HTMLDetailsElement>('.resume-manual-handoff')?.open).toBe(true);
  expect(second.host.textContent).not.toContain('Checking connected records');
  expect(gateway.refresh).not.toHaveBeenCalled();
});

it.each([true, false])(
  'provides one primary destination, with navigation supported=%s',
  async (supported) => {
    const item = record();
    item.navigation = {
      precision: supported ? 'thread' : 'unsupported',
      verifiedAt: null,
      detail: supported ? 'Recorded link available.' : 'Use manual handoff.',
    };
    const view = await mount(gatewayFor(item));
    const primary = view.host.querySelectorAll('.resume-primary-actions .resume-primary');
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toBe(
      supported ? 'Confirm & open in Codex' : 'Copy handoff instructions',
    );
    expect(view.host.querySelector<HTMLDetailsElement>('.resume-manual-handoff')?.open).toBe(false);
    expect(view.host.querySelector('.resume-brief-summary')).toBeNull();
    expect(view.host.querySelector('.resume-narrative')?.textContent).toContain(
      item.candidates[0].reason,
    );
    expect(view.host.querySelectorAll('.resume-narrative .resume-action')).toHaveLength(1);
  },
);

it('does not mistake a cached in-progress flag for an active check when returning offline', async () => {
  const item = { ...record(), busy: true };
  const gateway = gatewayFor();
  gateway.list.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const view = await mount(gateway, undefined, { works: [item] });
  expect(view.host.textContent).toContain(item.candidates[0].currentState);
  expect(view.host.querySelector('.resume-narrative .resume-action')).toBeNull();
  expect(view.host.textContent).not.toContain('Checking connected records');
  expect(
    [...view.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Recheck records',
    )?.disabled,
  ).toBe(false);
  expect(gateway.refresh).not.toHaveBeenCalled();
});

it.each([false, true])(
  'removes cached work missing from an authoritative list, other work present=%s',
  async (hasOtherWork) => {
    const cached = record();
    const gateway = gatewayFor();
    gateway.list.mockResolvedValue(hasOtherWork ? [{ ...record(), workId: 'other-work' }] : []);
    const view = await mount(gateway, undefined, { works: [cached] });
    expect(view.host.querySelector('.resume-card')).toBeNull();
    expect(view.host.querySelector('.resume-primary-actions')).toBeNull();
    expect(view.host.textContent).not.toContain(cached.candidates[0].currentState);
    expect(view.host.textContent).toContain('This connected work is no longer available');
    expect(gateway.refresh).not.toHaveBeenCalled();
  },
);
