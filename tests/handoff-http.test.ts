import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer, ChangeEvents } from '../apps/server/src/http';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { harness, source } from './helpers';

it('returns the displayed target and the durable receipt over HTTP, without repeating dispatch', async () => {
  const h = harness(),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4498);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4498, '127.0.0.1', resolve);
  });
  try {
    const payload = {
      threadId: 'thread-a',
      summaryId: h.core.work(id).latestSummaryId!,
      evidenceIds: [source().id],
      text: 'HTTP preserved draft',
      draftRevision: 0,
    };
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:4498/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const prepared = await post(`/work-contexts/${id}/handoff`, h.command(id, payload));
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({
      threadId: 'thread-a',
      title: '기록 A',
      role: 'work',
    });
    const command = h.command(id, { ...payload, workId: id });
    const response = await post('/handoffs/open', command),
      receipt = await response.json();
    expect(response.status).toBe(200);
    const lookup = await fetch(`http://127.0.0.1:4498/api/v1/commands/${command.requestId}`);
    expect(await lookup.json()).toMatchObject({
      ...receipt,
      handoff: { state: 'dispatched', target: { threadId: 'thread-a', draft: payload.text } },
    });
    expect(await (await post('/handoffs/open', command)).json()).toEqual(receipt);
    expect(
      (
        await post('/handoffs/open', {
          ...command,
          payload: { ...command.payload, text: 'changed' },
        })
      ).status,
    ).toBe(409);
    expect(h.counts().openCalls).toBe(1);
    expect(h.core.snapshot(id).draft).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('retains request identity and unknown outcome across a SQLite close/reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'statecarry-handoff-recovery-'));
  let repo = new SQLiteRepository(dir);
  try {
    const h = harness(repo),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const command = h.command(id, {
      threadId: 'thread-a',
      summaryId: h.core.work(id).latestSummaryId!,
      evidenceIds: [source().id],
      text: 'retained draft',
      draftRevision: 0,
    });
    const put = repo.put.bind(repo);
    repo.put = ((kind: any, value: any) => {
      if (kind === 'handoff' && value.state === 'dispatched')
        throw new Error('simulated process interruption before result persisted');
      put(kind, value);
    }) as typeof repo.put;
    await expect(h.core.openHandoff(id, command)).rejects.toThrow('interruption');
    expect(h.counts().openCalls).toBe(1);
    const receipt = repo.get('receipt', command.requestId)!;
    repo.close();
    repo = new SQLiteRepository(dir);
    const restored = harness(repo);
    await restored.core.recover();
    expect(repo.get('handoff', receipt.resultId)).toMatchObject({
      state: 'result-unknown',
      target: { draft: 'retained draft', threadId: 'thread-a' },
    });
    expect(await restored.core.openHandoff(id, command)).toEqual(receipt);
    expect(restored.counts().openCalls).toBe(0);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
