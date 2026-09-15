// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it, expect } from 'vitest';
import { Resume } from '../apps/web/src/ui/Resume';
import type { ResumeGateway, ResumeWork } from '@statecarry/presentation';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

it('drops a persisted continuation when the same candidate changes', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const item: ResumeWork = {
    workId: 'work-freshness',
    title: 'StateCarry',
    cwd: '/project',
    version: 'v1',
    revision: 1,
    goalText: 'Finish the export check',
    goalOrigin: 'user-input',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    generatedAt: '2026-09-14T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    session: {
      create: 'supported',
      send: 'supported',
      detail: 'Sessions are available.',
      verifiedAt: '2026-09-14T00:00:00Z',
    },
    navigation: {
      precision: 'thread',
      verifiedAt: '2026-09-14T00:00:00Z',
      detail: 'Thread links are available.',
    },
    candidates: [
      {
        key: 'export',
        goal: 'Finish the export check',
        currentState: 'The export is ready for its first check.',
        status: 'active',
        reason: 'The first check is open.',
        nextAction: 'Run the export check',
        doneWhen: 'The check result is recorded',
        actionSource: 'recorded',
        threadId: 'thread-export',
        prerequisites: [],
        evidence: [{ revisionId: 'record-export', quote: 'The export is ready.' }],
      },
    ],
    continuation: {
      id: 'continuation-freshness',
      workId: 'work-freshness',
      requestId: 'request-freshness',
      state: 'prepared',
      threadId: null,
      turnId: null,
      error: null,
      target: {
        mode: 'new-session',
        threadId: null,
        title: 'StateCarry continuation',
        workId: 'work-freshness',
        expectedRevision: 1,
        payload: {
          goal: 'Finish the export check',
          currentState: 'The export is ready for its first check.',
          nextAction: 'Run the export check',
          constraints: [],
          doneWhen: 'The check result is recorded',
          previousThreadId: 'thread-export',
        },
      },
      createdAt: '2026-09-14T00:00:00Z',
      updatedAt: '2026-09-14T00:00:00Z',
    },
  };
  const gateway: ResumeGateway = {
    list: async () => [item],
    refresh: async () => {},
    correct: async () => {},
    setGoal: async () => {},
    prepareContinuation: async () => item.continuation!,
    sendContinuation: async () => ({}) as any,
    continuation: async () => item.continuation!,
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId: item.workId }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Send the prepared context');
    item.version = 'v2';
    item.revision = 2;
    item.candidates[0] = {
      ...item.candidates[0],
      currentState: 'The export changed and needs a fresh check.',
      nextAction: 'Review the changed export',
      doneWhen: 'The changed export is reviewed',
    };
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId: item.workId }));
    });
    expect(host.textContent).not.toContain('Send the prepared context');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
