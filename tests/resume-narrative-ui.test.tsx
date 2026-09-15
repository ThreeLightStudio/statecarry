// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { presentResumeWork, type ResumeWork } from '@statecarry/presentation';
import { ResumeBrief } from '../apps/web/src/ui/ResumeBrief';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

function work(patch: Partial<ResumeWork> = {}): ResumeWork {
  return {
    workId: 'work-a',
    title: 'Export fix',
    cwd: '/synthetic-project',
    version: 'v1',
    goalText: 'Ship the export fix',
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
    candidates: [
      {
        key: 'candidate-a',
        goal: 'Ship the export fix',
        currentState: 'The export fix is implemented; the focused check is still open.',
        status: 'active',
        reason: 'The focused check has not been recorded yet.',
        nextAction: 'Run the focused export check',
        actionSource: 'recorded',
        doneWhen: 'The focused export check result is recorded',
        threadId: 'thread-a',
        prerequisites: [],
        evidence: [{ revisionId: 'record-a', quote: 'private-looking raw detail' }],
        progress: {
          reported: [{ revisionId: 'record-a', quote: 'reported' }],
          implemented: [{ revisionId: 'file-a', quote: 'implemented' }],
          verified: [],
        },
      },
    ],
    ...patch,
  };
}

async function renderBrief(value: ResumeWork) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const candidate = presentResumeWork(value).selected!;
  await act(async () => {
    root.render(createElement(ResumeBrief, { candidate, work: value }));
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  return host;
}

it('renders one content-first body without replaying raw evidence', async () => {
  const host = await renderBrief(work());
  expect(host.textContent).toContain(
    'The export fix is implemented; the focused check is still open.',
  );
  expect(host.textContent).toContain('The focused check has not been recorded yet.');
  expect(host.textContent).toContain('Run the focused export check');
  expect(host.textContent).toContain('The focused export check result is recorded');
  expect(host.textContent).not.toContain('private-looking raw detail');
  expect(host.querySelectorAll('h2')).toHaveLength(3);
});

it('renders a limited active brief as review context without stale action or done-when copy', async () => {
  const host = await renderBrief(
    work({
      state: 'limited',
      stale: true,
      stateDetail: 'The connected records changed. Check them again before continuing.',
    }),
  );
  expect(host.textContent).toContain('Before continuing');
  expect(host.textContent).toContain(
    'The connected records changed. Check them again before continuing.',
  );
  expect(host.textContent).not.toContain('Run the focused export check');
  expect(host.textContent).not.toContain('Complete when:');
});
