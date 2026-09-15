// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
import { Resume } from '../apps/web/src/ui/Resume';
import { App } from '../apps/web/src/ui/App';
import {
  presentResumeWork,
  resumeHandoffText,
  type ResumeGateway,
  type ResumeWork,
} from '@statecarry/presentation';

const baseWork = (overrides: Partial<ResumeWork> = {}): ResumeWork => ({
  workId: 'follow-up-work',
  title: 'StateCarry',
  cwd: '/project',
  version: 'v1',
  goalText: 'Finish the checked result',
  goalOrigin: 'user-input',
  sessionCount: 1,
  updatesAvailable: false,
  busy: false,
  error: null,
  stale: false,
  generatedAt: '2026-09-15T00:00:00Z',
  correctedKeys: [],
  dismissedKeys: [],
  candidates: [
    {
      key: 'check',
      goal: 'Finish the checked result',
      currentState: 'The implementation is recorded; the final check remains.',
      status: 'active',
      reason: 'The final check has not been recorded.',
      nextAction: 'Run the final check',
      doneWhen: 'The check result is recorded',
      actionSource: 'recorded',
      threadId: 'thread-check',
      prerequisites: [],
      evidence: [{ revisionId: 'record-check', quote: 'Run the final check.' }],
    },
  ],
  ...overrides,
});

const gatewayFor = (work: ResumeWork): ResumeGateway => ({
  list: async () => [work],
  refresh: async () => {},
  correct: async () => {},
  setGoal: async () => {},
});

async function renderResume(work: ResumeWork, gateway: ResumeGateway = gatewayFor(work)) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Resume, { gateway, workId: work.workId }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

it('keeps the return brief single-purpose and avoids completion counts', async () => {
  const work = baseWork({
    candidates: [
      {
        ...baseWork().candidates[0],
        progress: {
          reported: [{ revisionId: 'r', quote: 'The implementation is recorded.' }],
          implemented: [{ revisionId: 'r', quote: 'The implementation is recorded.' }],
          verified: [],
        },
      },
    ],
  });
  const { host, root } = await renderResume(work);
  try {
    expect(host.querySelectorAll('.resume-goal-tools')).toHaveLength(1);
    expect(host.textContent).toContain('Completed so far');
    expect(host.textContent).not.toContain('What remains');
    expect(host.textContent).not.toMatch(/\b\d+ implementation update/);
    expect(host.textContent).toContain('Complete when: The check result is recorded');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('turns a connection failure into recovery copy and keeps diagnostics behind details', async () => {
  const gateway: ResumeGateway = {
    ...gatewayFor(baseWork()),
    list: async () => {
      throw new TypeError('Failed to fetch');
    },
  };
  const { host, root } = await renderResume(baseWork(), gateway);
  try {
    const alert = host.querySelector('.resume-error');
    expect(alert?.querySelector(':scope > p')?.textContent).toContain(
      'could not reach the local server',
    );
    expect(alert?.querySelector(':scope > p')?.textContent).not.toContain('Failed to fetch');
    expect(alert?.querySelector('details summary')?.textContent).toBe('Technical details');
    expect(alert?.querySelector('details')?.textContent).toContain('Failed to fetch');
    expect(alert?.textContent).toContain('Try again');
    expect(alert?.textContent).toContain('Review connection');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('uses Presentation handoff text for both actionable and review-only briefs', async () => {
  const work = baseWork();
  const view = presentResumeWork(work);
  const candidate = view.selected!;
  const { host, root } = await renderResume(work);
  try {
    expect(
      (host.querySelector('textarea[aria-label="Handoff instructions"]') as HTMLTextAreaElement)
        ?.value,
    ).toBe(resumeHandoffText(candidate, work));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  const reviewWork = baseWork({
    candidates: [
      {
        ...work.candidates[0],
        status: 'waiting',
        nextAction: null,
        doneWhen: null,
        actionSource: null,
      },
    ],
  });
  const reviewView = presentResumeWork(reviewWork);
  const rendered = await renderResume(reviewWork);
  try {
    expect(
      (
        rendered.host.querySelector(
          'textarea[aria-label="Handoff instructions"]',
        ) as HTMLTextAreaElement
      )?.value,
    ).toBe(resumeHandoffText(reviewView.selected!, reviewWork));
    expect(
      (
        rendered.host.querySelector(
          'textarea[aria-label="Handoff instructions"]',
        ) as HTMLTextAreaElement
      )?.value,
    ).toContain('Review the saved StateCarry brief');
  } finally {
    await act(async () => rendered.root.unmount());
    rendered.host.remove();
  }
});

it('keeps the legacy app recovery banner readable when the server fetch fails', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const state = {
    route: '#/connect',
    projects: [],
    detail: null,
    transport: 'disconnected',
    error: 'TypeError: Failed to fetch',
    message: null,
    busy: false,
    local: {},
    evidence: {},
    evidenceFocusId: null,
    openedFlow: null,
  } as any;
  try {
    await act(async () => {
      root.render(
        createElement(App, {
          state,
          onAction: () => {},
          onConnect: async () => undefined,
          onDiscover: async () => ({ threads: [], complete: true, limitations: [] }),
        }),
      );
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.innerHTML.split('<details>')[0]).toContain('could not reach the local server');
    expect(alert?.innerHTML.split('<details>')[0]).not.toContain('TypeError: Failed to fetch');
    expect(alert?.querySelector('details summary')?.textContent).toBe('Technical details');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
