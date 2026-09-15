import { describe, expect, it, vi } from 'vitest';
import type { SessionExecutor } from '@statecarry/core';
import { harness, source } from './helpers';

function executor(): SessionExecutor {
  return {
    capability: () => ({
      create: 'supported',
      send: 'supported',
      verifiedAt: null,
      detail: 'test executor',
    }),
    create: vi.fn(async () => ({ threadId: 'new-thread' })),
    send: vi.fn(async () => ({ turnId: 'new-turn' })),
  };
}

describe('prepared continuation validity', () => {
  it('does not send stored evidence after the bounded record becomes inaccessible', async () => {
    const session = executor();
    const h = harness(undefined, undefined, session);
    const id = h.connect();
    const record = source('Use this checked record for the next action.', 'thread-a', 'evidence');
    h.records([record]);

    const connection = h.core.connection(h.core.work(id).projectId);
    h.core.updateConnection(
      connection.id,
      h.command(id, {
        title: connection.title,
        cwd: connection.cwd,
        threadIds: ['thread-a'],
        discover: false,
        startTurnIds: {},
        recordRanges: {
          'thread-a': {
            start: { turnId: record.turnId, itemId: record.itemId },
            end: { turnId: record.turnId, itemId: record.itemId },
          },
        },
      }),
    );
    await h.core.collect(id);

    const continuation = h.core.continuations.prepare(
      id,
      h.command(id, {
        targetMode: 'new-session',
        threadId: null,
        payload: {
          goal: 'Continue the checked work',
          currentState: 'The bounded record is currently accessible.',
          nextAction: 'Review the checked record',
          constraints: [],
          doneWhen: 'The checked result is recorded.',
          previousThreadId: 'thread-a',
          evidence: [{ revisionId: record.id, quote: record.text }],
        },
      }),
    );

    h.reader.read = async () => {
      throw new Error('synthetic reader failure');
    };
    await h.core.collect(id);

    expect(h.core.work(id).revision).toBe(continuation.target.expectedRevision);
    expect(h.core.accessibleSource(id, record.id)).toBeNull();
    await expect(
      h.core.continuations.send(id, h.command(id, { continuationId: continuation.id })),
    ).rejects.toMatchObject({ code: 'HANDOFF_EVIDENCE_INACCESSIBLE' });
    expect(session.create).not.toHaveBeenCalled();
    expect(session.send).not.toHaveBeenCalled();
  });
});
