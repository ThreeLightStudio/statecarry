import { expect, it, vi } from 'vitest';
import type { Continuation, SessionRun } from '@statecarry/contracts';
import type { StateCarry } from '@statecarry/core';
import { BackgroundLoop } from '../apps/server/src/background';

const request: Continuation = {
  id: 'request-a',
  projectId: 'project-a',
  requestId: 'send-a',
  state: 'result-unknown',
  threadId: 'thread-a',
  turnId: null,
  error: 'App dispatch outcome is unknown; no automatic retry',
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  target: {
    mode: 'new-session',
    threadId: null,
    title: 'Check the return flow',
    projectId: 'project-a',
    expectedRevision: 1,
    payload: {
      goal: null,
      currentState: 'The check was sent.',
      nextAction: 'Read its result.',
      constraints: [],
      doneWhen: 'The result is reviewed.',
    },
  },
};

it('rechecks saved requests in the background, throttles reads, and stops scheduling on shutdown', async () => {
  const execution: SessionRun = { status: 'running', report: '', error: null, questions: [] };
  const sync = vi.fn(async () => execution);
  const cancelPendingExecutionSyncs = vi.fn();
  const core = {
    questions: { sweep: vi.fn() },
    executions: { sync, cancelPendingExecutionSyncs },
    repo: { list: vi.fn(() => [request]) },
    listConnections: vi.fn(() => []),
    explanations: { tick: vi.fn() },
  } as unknown as StateCarry;
  const loop = new BackgroundLoop(core, vi.fn(), true);
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  loop.tick(100);
  loop.tick(200);
  expect(sync).toHaveBeenCalledOnce();
  await settle();
  loop.tick(3099);
  expect(sync).toHaveBeenCalledOnce();
  loop.tick(3100);
  expect(sync).toHaveBeenCalledTimes(2);

  loop.stop();
  loop.tick(10_000);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(cancelPendingExecutionSyncs).toHaveBeenCalledOnce();
});
