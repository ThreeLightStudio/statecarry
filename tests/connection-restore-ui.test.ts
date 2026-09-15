import { describe, expect, it } from 'vitest';
import { Controller, type BrowserMemory, type Gateway } from '@statecarry/presentation';
import type { Command, HandoffTarget, Receipt } from '@statecarry/contracts';
import { harness, source } from './helpers';

const memory = (): BrowserMemory => {
  const values = new Map<string, ReturnType<BrowserMemory['read']>>();
  return {
    read: (id) => structuredClone(values.get(id) ?? null),
    write: (id, value) => values.set(id, structuredClone(value)),
  };
};

describe('removed connection UI lifecycle', () => {
  it('lists a removed connection and restores the same work without re-analysis', async () => {
    const h = harness(),
      workId = h.connect(),
      record = source('The export remains ready to resume.');
    h.records([record]);
    await h.core.collect(workId);
    let resumeCalls = 0;
    h.summary.generateResume = async () => {
      resumeCalls++;
      return {
        candidates: [
          {
            key: 'same-work',
            goal: 'Ship the export',
            currentState: 'The export remains ready to resume.',
            status: 'active',
            reason: 'The recorded next step is still open.',
            nextAction: 'Review the export result',
            doneWhen: 'The export result is recorded.',
            actionSource: 'recorded',
            threadId: record.threadId,
            prerequisites: [],
            evidence: [{ revisionId: record.id, quote: record.text }],
          },
        ],
      };
    };
    await h.core.resumes.refresh(workId);
    const view = h.core.resumes.view(workId);
    h.core.resumes.correct(workId, {
      candidateKey: 'same-work',
      version: view.version,
      kind: 'wrong-action',
      nextAction: 'Inspect the saved export',
      doneWhen: 'The saved export is inspected.',
    });
    const before = h.core.work(workId),
      connection = h.core.connection(before.projectId);

    const command = async (path: string, input: Command): Promise<Receipt | HandoffTarget> => {
      if (path === `/connections/${connection.id}/remove`)
        return h.core.removeConnection(connection.id, input);
      if (path === `/connections/${connection.id}/restore`)
        return h.core.restoreConnection(connection.id, input);
      throw new Error(`Unexpected command ${path}`);
    };
    const gateway = {
      projects: async () => h.core.listProjects(),
      connections: async () => h.core.listConnections(),
      removedConnections: async () => h.core.listRemovedConnections(),
      snapshot: async (id: string) => h.core.snapshot(id),
      evidence: async (id: string, owner?: string) => h.core.evidence(id, owner),
      discover: h.reader.discover,
      command,
      receipt: async () => {
        throw new Error('Unexpected receipt lookup');
      },
      subscribe: () => () => {},
    } satisfies Gateway;
    const controller = new Controller(gateway, memory(), h.core.ids.next);
    await controller.start(`#/work/${workId}`);
    await controller.action({ type: 'removeConnection' });

    const removedState = controller.getSnapshot();
    expect(removedState.route).toBe('#/connections');
    expect(removedState.projects).toEqual([]);
    expect(removedState.removedConnections).toEqual([
      expect.objectContaining({
        connection: expect.objectContaining({ id: connection.id, workId }),
        workRevision: h.core.work(workId).revision,
      }),
    ]);
    const removed = removedState.removedConnections![0];

    await controller.action({
      type: 'restoreConnection',
      connectionId: removed.connection.id,
      workId: removed.connection.workId,
      workRevision: removed.workRevision,
    });

    expect(controller.getSnapshot().route).toBe(`#/work/${workId}`);
    expect(h.core.listProjects()).toEqual([expect.objectContaining({ workId })]);
    expect(h.core.work(workId).resume).toEqual(before.resume);
    expect(h.core.work(workId).resumeOverrides).toEqual(before.resumeOverrides);
    expect(resumeCalls).toBe(1);
  });
});
