import { it, expect } from 'vitest';
import { createHttpServer, ChangeEvents } from '../apps/server/src/http';
import { questionHarness, questionRecords } from './question-fixtures';
it('HTTP binds work/session/answer and rejects arbitrary revisions and hostile origin', async () => {
  const { h, id } = await questionHarness(),
    port = 4397;
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', port);
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}/api/v1/work-contexts/${id}/questions`;
  const post = (url: string, payload: unknown, origin = `http://127.0.0.1:${port}`) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(payload),
    });
  try {
    const input = {
      requestId: 'create',
      summaryId: h.core.work(id).latestSummaryId,
      claimId: 'next',
    };
    expect((await post(base, { ...input, revisionIds: ['arbitrary'] })).status).toBe(400);
    expect((await post(base, input, 'https://attacker.invalid')).status).toBe(403);
    const s = await (await post(base, input)).json();
    const submit = { requestId: 'submit', text: '왜?' };
    expect((await post(`${base}/${s.id}/turns`, submit)).status).toBe(202);
    await h.core.questions.settled();
    const result = await (await fetch(`${base}/${s.id}`)).json(),
      t = result.turns[0];
    expect(
      (await fetch(`${base}/${s.id}/turns/${t.id}/evidence/${questionRecords[0].id}`)).status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/${s.id}/turns/${t.id}/evidence/${questionRecords[4].id}`)).status,
    ).toBe(409);
    expect((await fetch(base.replace(id, 'another-work') + `/${s.id}`)).status).toBe(404);
    expect((await post(`${base}/${s.id}/turns`, submit)).status).toBe(202);
    expect(h.core.questions.get(id, s.id).turns).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await h.core.close();
  }
});
