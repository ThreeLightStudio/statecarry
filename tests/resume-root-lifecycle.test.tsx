// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  Controller,
  type Gateway,
  type ResumeGateway,
  type ResumeWork,
} from '@statecarry/presentation';
import { Root } from '../apps/web/src/Root';
import { LocalResumeMemory } from '../apps/web/src/adapters/resume-memory';
import { harness } from './helpers';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

function resumeWork(workId: string): ResumeWork {
  return {
    workId,
    title: 'Synthetic export work',
    cwd: '/synthetic-project',
    version: 'resume-v1',
    revision: 7,
    goalText: 'Ship the synthetic export',
    goalOrigin: 'user-input',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    state: 'ready',
    generatedAt: '2026-09-15T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    workspace: {
      cwd: '/synthetic-project',
      status: 'checked',
      branch: 'main',
      commit: 'synthetic-commit',
      dirty: false,
      checkedAt: '2026-09-15T00:00:00Z',
      limitations: [],
    },
    candidates: ['first', 'second'].map((key) => ({
      key,
      goal: `Ship ${key} export`,
      currentState: `The ${key} export candidate is ready for review.`,
      status: 'active' as const,
      reason: 'The saved output still needs a focused check.',
      nextAction: `Review the ${key} export output`,
      doneWhen: `The ${key} export check is recorded`,
      actionSource: 'recorded' as const,
      threadId: 'synthetic-thread',
      prerequisites: [],
      evidence: [{ revisionId: 'synthetic-record', quote: 'Review the saved export output.' }],
    })),
  };
}

it('preserves Resume edits through Root detail routing and restart without reviving a removed candidate', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  const h = harness();
  const workId = h.connect();
  const storageValues = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
  };
  const controllerCommands = vi.fn<Gateway['command']>(async () => {
    throw new Error('Root detail roundtrip must remain read-only');
  });
  const explanationPaths: string[] = [];
  const controllerGateway: Gateway = {
    projects: async () => h.core.listProjects(),
    connections: async () => h.core.listConnections(),
    removedConnections: async () => h.core.listRemovedConnections(),
    snapshot: async (id) => h.core.snapshot(id),
    evidence: async (id, owner) => h.core.evidence(id, owner),
    discover: h.reader.discover,
    command: controllerCommands,
    receipt: async () => {
      throw new Error('Unexpected receipt lookup');
    },
    subscribe: () => () => {},
    explanation: async <T,>(path: string) => {
      explanationPaths.push(path);
      return {} as T;
    },
  };

  let rows = [resumeWork(workId)];
  const resumeList = vi.fn(async () => structuredClone(rows));
  const resumeRefresh = vi.fn(async () => {});
  const resumeSetGoal = vi.fn(async () => {});
  const resumeCorrect = vi.fn(async () => {});
  const resumeGateway: ResumeGateway = {
    list: resumeList,
    refresh: resumeRefresh,
    setGoal: resumeSetGoal,
    correct: resumeCorrect,
    subscribe: () => () => {},
  };

  const newController = () =>
    new Controller(controllerGateway, { read: () => null, write: () => {} }, h.core.ids.next);
  const newResumeMemory = () => new LocalResumeMemory(() => storage);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const mount = async (controller: Controller, memory: LocalResumeMemory) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Root, { controller, resumeGateway, resumeMemory: memory }));
      await tick();
    });
    return { host, root };
  };
  const route = async (host: HTMLElement, href: string) => {
    const link = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    expect(link, `Missing route link: ${href}`).toBeTruthy();
    await act(async () => {
      window.location.hash = link!.getAttribute('href')!;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await tick();
    });
  };
  const click = async (host: HTMLElement, label: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === label,
    );
    expect(button, `Missing button: ${label}`).toBeTruthy();
    await act(async () => button!.click());
  };
  const type = async (host: HTMLElement, name: string, value: string) => {
    const input = host.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
    expect(input, `Missing field: ${name}`).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        value,
      );
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const expectDraft = (host: HTMLElement) => {
    expect(
      host.querySelector('.resume-choices button[aria-pressed="true"]')?.textContent,
    ).toContain('Ship second export');
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      'Unsaved root goal',
    );
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="next-action"]')?.value).toBe(
      'Unsaved root action',
    );
  };

  window.location.hash = `#/resume/${workId}`;
  let mounted = await mount(newController(), newResumeMemory());
  try {
    const choices = mounted.host.querySelectorAll<HTMLButtonElement>('.resume-choices button');
    expect(choices).toHaveLength(2);
    await act(async () => choices[1].click());
    await click(mounted.host, 'Edit goal');
    await type(mounted.host, 'goal', 'Unsaved root goal');
    await click(mounted.host, 'Right work, wrong next step');
    await type(mounted.host, 'next-action', 'Unsaved root action');

    const savedBeforeRoute = newResumeMemory().read(workId)!;
    expect(savedBeforeRoute.selectedKey).toBe('second');
    expect(savedBeforeRoute.goalDraft).toEqual({ text: 'Unsaved root goal', version: 'resume-v1' });
    expect(savedBeforeRoute.actionDrafts).toContainEqual([
      'second',
      expect.objectContaining({ action: 'Unsaved root action', version: 'resume-v1' }),
    ]);

    await route(mounted.host, `#/details/${workId}`);
    expect(mounted.host.querySelector('.resume-card')).toBeNull();
    expect(mounted.host.textContent).toContain('Project / Return');
    resumeList.mockRejectedValueOnce(new Error('Synthetic Resume GET is offline'));
    await route(mounted.host, `#/resume/${workId}`);
    expect(mounted.host.textContent).toContain('The second export candidate is ready for review.');
    expect(mounted.host.textContent).toContain('Synthetic Resume GET is offline');
    await click(mounted.host, 'Try again');
    expectDraft(mounted.host);

    await act(async () => mounted.root.unmount());
    mounted.host.remove();
    mounted = await mount(newController(), newResumeMemory());
    expectDraft(mounted.host);

    await route(mounted.host, `#/details/${workId}`);
    rows = [{ ...resumeWork(workId), candidates: [] }];
    await route(mounted.host, `#/resume/${workId}`);
    expect(mounted.host.querySelector('.resume-card')).toBeNull();
    expect(mounted.host.querySelector('textarea[name="next-action"]')).toBeNull();
    expect(mounted.host.textContent).toContain('The selected candidate needs a recheck');

    expect(resumeList.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(resumeRefresh).not.toHaveBeenCalled();
    expect(resumeSetGoal).not.toHaveBeenCalled();
    expect(resumeCorrect).not.toHaveBeenCalled();
    expect(controllerCommands).not.toHaveBeenCalled();
    expect(explanationPaths.filter((path) => path.endsWith('/prepare'))).toEqual([]);
    expect(h.counts().generationCalls).toBe(0);
    expect(h.counts().checkCalls).toBe(0);
  } finally {
    await act(async () => mounted.root.unmount());
    mounted.host.remove();
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  }
});
