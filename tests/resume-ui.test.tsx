// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
import { Resume } from '../apps/web/src/ui/Resume';
import {
  presentResumeWork,
  resumeActorLabel,
  resumeRoleLabel,
  resumeStatusLabel,
  resumeUtteranceTypeLabel,
  type ResumeGateway,
  type ResumeWork,
} from '@statecarry/presentation';
import type { Continuation } from '@statecarry/contracts';

it('builds a user-facing resume model without exposing dismissed candidates or internal values', () => {
  const candidate: ResumeWork['candidates'][number] = {
    key: 'active-key',
    goal: 'Make the return brief clear',
    currentState: 'The return brief is rendered; its action still needs a check.',
    status: 'active',
    reason: 'The action has not been checked in the target conversation.',
    nextAction: 'Check the return brief in Codex',
    doneWhen: 'The target conversation shows the checked result',
    actionSource: 'suggested',
    threadId: 'thread-a',
    prerequisites: [],
    evidence: [{ revisionId: 'source-a', quote: 'The return brief is rendered.' }],
  };
  const waiting = {
    ...candidate,
    key: 'waiting-key',
    status: 'waiting' as const,
    nextAction: null,
    doneWhen: null,
    actionSource: null,
  };
  const work: ResumeWork = {
    workId: 'work-a',
    title: 'Return brief',
    cwd: '/project',
    version: 'v1',
    goalText: null,
    goalOrigin: 'inferred',
    sessionCount: 2,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    generatedAt: '2026-09-14T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: ['waiting-key'],
    candidates: [candidate, waiting],
  };
  const view = presentResumeWork(work);
  expect(view.candidates.map((item) => item.key)).toEqual(['active-key']);
  expect(view.dismissed.map((item) => item.key)).toEqual(['waiting-key']);
  expect(view.selected?.key).toBe('active-key');
  expect(view.selected?.statusLabel).toBe('Ready for the next action');
  expect(view.selected?.target.existing.available).toBe(true);
  expect(view.selected?.target.newSession.available).toBe(false);
  expect(resumeStatusLabel('done')).toBe('Reported as complete');
  expect(resumeRoleLabel('controlled-verification')).toBe('Verification conversation');
  expect(resumeActorLabel('agent')).toBe('Codex response');
  expect(resumeUtteranceTypeLabel('agent-proposal')).toBe('Codex proposal');
  const unsupported = presentResumeWork({
    ...work,
    navigation: {
      precision: 'unsupported',
      verifiedAt: '2026-09-14T00:00:00Z',
      detail: 'Opening conversations is unavailable in this environment.',
    },
  });
  expect(unsupported.selected?.target.existing.available).toBe(false);
  expect(unsupported.selected?.target.existing.url).toBeUndefined();
});

it('keeps progress and workspace checks available behind concise resume content', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const item: ResumeWork = {
    workId: 'work-progress',
    title: 'Return brief',
    cwd: '/project',
    version: 'v2',
    goalText: 'Finish the checked result',
    goalOrigin: 'user-input',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    generatedAt: '2026-09-14T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    workspace: {
      cwd: '/project',
      branch: 'main',
      commit: '0123456789abcdef',
      dirty: true,
      status: 'checked',
      checkedAt: '2026-09-14T00:00:00Z',
      limitations: [],
    },
    candidates: [
      {
        key: 'progress',
        goal: 'Finish the checked result',
        currentState: 'The implementation was reported; an independent check is still open.',
        status: 'active',
        reason: 'The independent check has not been recorded.',
        nextAction: 'Run the focused check',
        doneWhen: 'The check result is recorded',
        actionSource: 'recorded',
        threadId: 'thread-progress',
        prerequisites: ['Use the connected project'],
        evidence: [{ revisionId: 'source-progress', quote: 'Run the focused check' }],
        progress: {
          reported: [{ revisionId: 'source-progress', quote: 'The implementation was reported.' }],
          implemented: [
            { revisionId: 'source-progress', quote: 'The implementation was reported.' },
          ],
          verified: [],
        },
        completion: { reported: [], verified: [] },
      },
    ],
  };
  const gateway: ResumeGateway = {
    list: async () => [item],
    refresh: async () => {},
    correct: async () => {},
    setGoal: async () => {},
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId: item.workId }));
    });
    expect(host.textContent).toContain('Purpose');
    expect(host.textContent).toContain('Project state checked');
    expect(host.textContent).toContain('Branch · main');
    expect(host.textContent).toContain('Uncommitted changes present');
    const progress = [...host.querySelectorAll<HTMLDetailsElement>('details')].find(
      (detail) => detail.querySelector('summary')?.textContent === 'What has been completed so far',
    );
    expect(progress).toBeTruthy();
    expect(progress?.open).toBe(false);
    expect(progress?.textContent).toContain('Reported progress');
    expect(progress?.textContent).toContain('Implementation progress');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('shows a concise return brief and edits the same goal without exposing original text by default', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const item: ResumeWork = {
    workId: 'work-a',
    title: 'StateCarry',
    cwd: '/project',
    version: 'v1',
    goalText: null,
    goalOrigin: 'inferred',
    sessionCount: 2,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    generatedAt: '2026-09-14T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    candidates: [
      {
        key: 'resume',
        goal: 'Make resuming work understandable',
        currentState: 'The resume view exists; the old entry route still needs fixing.',
        status: 'active',
        reason: 'The old route opens raw goal candidates instead of the resume view.',
        nextAction: 'Fix the old work route',
        doneWhen: 'The old link opens the same work in Resume',
        actionSource: 'suggested',
        threadId: 'thread-a',
        prerequisites: [],
        evidence: [{ revisionId: 'e1', quote: 'RAW TRANSPORT ENVELOPE MUST STAY COLLAPSED' }],
      },
    ],
  };
  let saved: unknown;
  const gateway: ResumeGateway = {
    list: async () => [item],
    refresh: async () => {},
    correct: async () => {},
    setGoal: async (id, text, version) => {
      saved = { id, text, version };
      item.goalText = text;
      item.goalOrigin = 'user-input';
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
  };
  try {
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId: 'work-a' }));
    });
    expect(host.textContent).toContain('Where you left off');
    expect(host.textContent).toContain(item.candidates[0].currentState);
    expect(host.textContent).toContain('Inferred from connected records');
    expect(host.textContent).not.toContain('Read this goal');
    expect(host.querySelector('.resume-status')?.textContent).toBe('Ready for the next action');
    expect(host.querySelector('.resume-session-note')?.textContent).toContain('New session:');
    const quote = host.querySelector('blockquote')!;
    expect(quote.closest('details')!.open).toBe(false);
    await click('Confirm or edit goal');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(saved).toEqual({
      id: 'work-a',
      text: 'Make resuming work understandable',
      version: 'v1',
    });
    expect(host.textContent).toContain('Written by you');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    gateway.refresh = async () => {
      item.generatedAt = '2026-09-14T00:01:00Z';
      item.candidates[0].key = 'updated-key';
    };
    await click('Recheck records');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3100));
    });
    expect(host.querySelector('h1')?.textContent).toBe('Make resuming work understandable');
    expect(host.textContent).not.toContain('The selected candidate needs a recheck');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('checks a continuation after a lost send response before offering another action', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const item: ResumeWork = {
    workId: 'work-session',
    title: 'StateCarry',
    cwd: '/project',
    version: 'v1',
    revision: 1,
    goalText: 'Finish the checked result',
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
      detail: 'New sessions are available.',
      verifiedAt: '2026-09-14T00:00:00Z',
    },
    navigation: {
      precision: 'thread',
      verifiedAt: '2026-09-14T00:00:00Z',
      detail: 'Thread links are available.',
    },
    candidates: [
      {
        key: 'session-candidate',
        goal: 'Finish the checked result',
        currentState: 'The implementation is ready for its final check.',
        status: 'active',
        reason: 'The final check is still open.',
        nextAction: 'Run the final check',
        doneWhen: 'The result is recorded',
        actionSource: 'recorded',
        threadId: 'thread-session',
        prerequisites: [],
        evidence: [{ revisionId: 'source-session', quote: 'Run the final check' }],
      },
    ],
  };
  const continuation: Continuation = {
    id: 'continuation-1',
    workId: item.workId,
    requestId: 'request-1',
    state: 'prepared',
    threadId: null,
    turnId: null,
    error: null,
    target: {
      mode: 'new-session',
      threadId: null,
      title: 'StateCarry · continuation',
      workId: item.workId,
      expectedRevision: 1,
      payload: {
        goal: item.goalText,
        currentState: 'The implementation is ready for its final check.',
        nextAction: 'Run the final check',
        constraints: [],
        doneWhen: 'The result is recorded',
      },
    },
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
  };
  let prepares = 0,
    sends = 0,
    statusReads = 0;
  const gateway: ResumeGateway = {
    list: async () => [item],
    refresh: async () => {},
    correct: async () => {},
    setGoal: async () => {},
    prepareContinuation: async () => {
      prepares += 1;
      return continuation;
    },
    sendContinuation: async () => {
      sends += 1;
      throw new Error('Network disconnected after dispatch');
    },
    continuation: async () => {
      statusReads += 1;
      return { ...continuation, state: 'result-unknown', error: 'Provider outcome is unknown.' };
    },
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId: item.workId }));
    });
    const sendButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Prepare and send to a new session',
    )!;
    await act(async () => {
      sendButton.click();
    });
    expect(prepares).toBe(1);
    expect(sends).toBe(1);
    expect(statusReads).toBe(1);
    expect(host.textContent).toContain('The send result is unknown');
    expect(host.textContent).toContain('Check request status');
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it('keeps a non-Git brief readable until the user asks to recheck it', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const item: ResumeWork = {
    workId: 'work-non-git',
    title: 'Local folder',
    cwd: '/project',
    version: 'v1',
    goalText: 'Finish the export',
    goalOrigin: 'user-input',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: true,
    generatedAt: '2026-09-14T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    workspace: {
      cwd: '/project',
      root: null,
      branch: null,
      commit: null,
      dirty: null,
      status: 'unknown',
      checkedAt: '2026-09-14T00:00:00Z',
      limitations: ['This folder is not a Git repository.'],
    },
    candidates: [
      {
        key: 'export',
        goal: 'Finish the export',
        currentState: 'The export is ready for its final check.',
        status: 'active',
        reason: 'The final check is still open.',
        nextAction: 'Run the export check',
        doneWhen: 'The check result is recorded.',
        actionSource: 'recorded',
        threadId: 'thread-export',
        prerequisites: [],
        evidence: [{ revisionId: 'source-export', quote: 'Run the export check' }],
      },
    ],
  };
  let refreshes = 0;
  const gateway: ResumeGateway = {
    list: async () => [item],
    refresh: async () => {
      refreshes += 1;
    },
    correct: async () => {},
    setGoal: async () => {},
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
    expect(refreshes).toBe(0);
    expect(host.textContent).toContain('Finish the export');
    expect(host.textContent).toContain('Project state unavailable');
    expect(host.textContent).toContain('Check records again');
  } finally {
    root.unmount();
    host.remove();
  }
});
