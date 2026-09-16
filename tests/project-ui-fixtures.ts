import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, vi } from 'vitest';
import type {
  ProjectGateway,
  ProjectWorkspace,
  ProjectWorkspaceEntry,
  ResumeGateway,
  ResumeMemory,
} from '@statecarry/presentation';
import type { Capabilities, Receipt } from '@statecarry/contracts';
import { Root } from '../apps/web/src/Root';
import { LocalResumeMemory } from '../apps/web/src/adapters/resume-memory';
import { source } from './helpers';

const requireWeb = createRequire(resolve('apps/web/package.json'));
export const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

export const RAW_SOURCE = 'RAW_SOURCE_ONLY_FOR_EXPLICIT_INSPECTION';
export const RAW_ERROR = 'RAW_TRANSPORT_ERROR_MUST_NOT_REACH_THE_SCREEN';
export const now = '2026-09-15T10:00:00Z';

export function projectEntry(id = 'alpha'): ProjectWorkspaceEntry {
  return {
    workId: id,
    connectionId: `connection-${id}`,
    title: `Project ${id}`,
    cwd: `/synthetic/${id}`,
    purpose: 'Make exported work understandable when returning.',
    focused: false,
    revision: 7,
    disconnectedAt: null,
    acceptedKeys: [],
    pausedKeys: [],
    resume: {
      workId: id,
      title: `Project ${id}`,
      cwd: `/synthetic/${id}`,
      version: 'resume-v1',
      revision: 7,
      goalText: `Ship the ${id} export`,
      goalOrigin: 'user-input',
      sessionCount: 1,
      updatesAvailable: false,
      busy: false,
      error: null,
      stale: false,
      state: 'ready',
      generatedAt: now,
      correctedKeys: [],
      dismissedKeys: [],
      workspace: {
        cwd: `/synthetic/${id}`,
        status: 'checked',
        branch: 'main',
        commit: 'synthetic-commit',
        dirty: false,
        checkedAt: now,
        limitations: [],
      },
      candidates: ['first', 'second'].map((key) => ({
        key,
        goal: `Ship ${key} ${id} export`,
        currentState: `The ${key} ${id} export has a saved result.`,
        status: 'active',
        reason: 'The output needs a focused check before it can be used.',
        nextAction: `Review the ${key} ${id} export output`,
        doneWhen: `The ${key} ${id} export check is recorded`,
        actionSource: 'recorded',
        threadId: `thread-${id}`,
        prerequisites: [],
        evidence: [{ revisionId: `source-${id}`, quote: RAW_SOURCE }],
      })),
    },
  };
}

export function testReceipt(id: string, revision = 8): Receipt {
  return {
    id: `receipt-${id}`,
    command: 'ui-test',
    bodyHash: 'test',
    workId: id,
    committedRevision: revision,
    resultId: id,
    createdAt: now,
  };
}

export function projectUiFixture(entries = [projectEntry()]) {
  const rows: ProjectWorkspace = { projects: entries };
  const capabilities: Capabilities = {
    apiVersion: 1,
    source: 'codex-local',
    summary: {
      state: 'ready',
      detail: 'Codex summary generation is available.',
      model: 'synthetic-model',
    },
    navigation: {
      precision: 'thread',
      verifiedAt: now,
      detail: 'Synthetic navigation is available.',
      state: 'verified-route',
    },
    session: {
      create: 'supported',
      send: 'supported',
      detail: 'Synthetic session actions are available.',
      verifiedAt: now,
    },
    collectionIntervalMs: 15000,
    discoveryIntervalMs: 60000,
  };
  const projectGateway: ProjectGateway = {
    capabilities: vi.fn(async () => capabilities),
    chooseFolder: vi.fn(async () => ({ path: null })),
    list: vi.fn(async () => structuredClone(rows)),
    create: vi.fn(async () => testReceipt('new-project')),
    settings: vi.fn(async (id) => testReceipt(id)),
    sources: vi.fn(async (id) => testReceipt(id)),
    disconnect: vi.fn(async (id) => testReceipt(id)),
    restore: vi.fn(async (id) => testReceipt(id)),
    deletionPreview: vi.fn(async (id) => ({
      workId: id,
      title: `Project ${id}`,
      token: 'preview-token',
      revision: rows.projects.find((entry) => entry.workId === id)!.revision,
      ownedRecords: 12,
      exclusiveSources: 2,
      sharedSources: 3,
      blocked: false,
      explanation:
        'The selected application records are removed permanently. Original files, shared source copies, minimal receipts, separate diagnostic files, and backups are retained.',
    })),
    delete: vi.fn(async (id) => {
      rows.projects = rows.projects.filter((entry) => entry.workId !== id);
      return testReceipt(id);
    }),
    connections: vi.fn(async () =>
      rows.projects
        .filter((entry) => !entry.disconnectedAt)
        .map((entry) => ({
          id: entry.connectionId,
          workId: entry.workId,
          title: entry.title,
          cwd: entry.cwd,
          threadIds: [`thread-${entry.workId}`],
          startTurnIds: {},
          discover: false,
          revision: 1,
          createdAt: now,
        })),
    ),
    discover: vi.fn(async () => ({ threads: [], complete: true, limitations: [] })),
    turns: vi.fn(async () => ({ turns: [] })),
    evidence: vi.fn(async (_owner, id) => ({ ...source(RAW_SOURCE), id })),
  };
  const resumeGateway: ResumeGateway = {
    list: vi.fn(async () => []),
    refresh: vi.fn(async () => {}),
    localize: vi.fn(async (id, outputLanguage) => {
      const entry = rows.projects.find((item) => item.workId === id);
      if (entry?.resume) entry.resume.outputLanguage = outputLanguage;
    }),
    setGoal: vi.fn(async () => {}),
    correct: vi.fn(async () => {}),
    subscribe: () => () => {},
  };
  return { rows, projectGateway, resumeGateway };
}

export function installBrowser() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
}

export function browserDrafts() {
  const values = new Map<string, string>();
  const storage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return { values, memory: () => new LocalResumeMemory(() => storage) };
}

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export async function settle() {
  await act(async () => {
    await tick();
  });
}

export async function mountProjectRoot(
  projectGateway: ProjectGateway,
  resumeGateway: ResumeGateway,
  resumeMemory?: ResumeMemory,
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Root, { projectGateway, resumeGateway, resumeMemory }));
    await tick();
  });
  await settle();
  return {
    host,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

export async function go(href: string) {
  await act(async () => {
    window.history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await tick();
  });
  await settle();
}

export async function follow(host: HTMLElement, href: string) {
  const link = [...host.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
    (item) => item.getAttribute('href') === href,
  );
  expect(link, `Missing route link ${href}`).toBeTruthy();
  await act(async () => {
    link!.click();
    await tick();
  });
  await settle();
}

export function button(host: HTMLElement, label: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(node, `Missing button ${label}`).toBeTruthy();
  return node!;
}

export async function press(host: HTMLElement, label: string) {
  const node = button(host, label);
  expect(node.disabled, `Disabled button ${label}`).toBe(false);
  await act(async () => {
    node.click();
    await tick();
  });
  await settle();
}

export async function typeField(host: HTMLElement, selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector,
  );
  expect(field, `Missing input ${selector}`).toBeTruthy();
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field!.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
    await tick();
  });
}

export async function toggleDetails(host: HTMLElement, label: string) {
  const summary = [...host.querySelectorAll('summary')].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(summary, `Missing expansion ${label}`).toBeTruthy();
  await act(async () => {
    summary!.click();
    await tick();
  });
  await settle();
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
