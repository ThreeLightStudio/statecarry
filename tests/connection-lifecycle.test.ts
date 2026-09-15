import { describe, expect, it } from 'vitest';
import { read, harness } from './helpers';

describe('connection lifecycle', () => {
  it('soft-removes a connection from active projects and restores it without deleting records', async () => {
    const h = harness();
    const workId = h.connect();
    await h.core.collect(workId);
    const connection = h.repo.list('connection')[0];
    const sourceId = h.repo.list('source')[0]?.id;
    expect(h.core.listProjects()).toHaveLength(1);

    const removed = h.core.removeConnection(connection.id, {
      requestId: 'remove-connection',
      expectedRevision: h.core.work(workId).revision,
      payload: {},
    });
    expect(removed.command).toBe('connection-remove');
    expect(h.core.listProjects()).toHaveLength(0);
    expect(h.repo.get('connection', connection.id)?.removedAt).toBeTruthy();
    expect(sourceId && h.repo.get('source', sourceId)).toBeTruthy();
    expect(() => h.core.snapshot(workId)).toThrow('Connection not found');

    const restored = h.core.restoreConnection(connection.id, {
      requestId: 'restore-connection',
      expectedRevision: h.core.work(workId).revision,
      payload: {},
    });
    expect(restored.command).toBe('connection-restore');
    expect(h.core.listProjects()).toHaveLength(1);
    expect(h.repo.get('connection', connection.id)?.removedAt).toBeNull();
  });

  it('does not let an in-flight read repopulate a removed connection', async () => {
    const h = harness();
    const workId = h.connect();
    const connection = h.repo.list('connection')[0];
    let release: ((value: ReturnType<typeof read>) => void) | undefined;
    h.reader.read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const collecting = h.core.collect(workId);
    await Promise.resolve();
    h.core.removeConnection(connection.id, {
      requestId: 'remove-during-read',
      expectedRevision: h.core.work(workId).revision,
      payload: {},
    });
    release?.(read([]));
    await collecting;
    expect(h.repo.list('source')).toHaveLength(0);
    expect(h.core.listProjects()).toHaveLength(0);
  });
});
