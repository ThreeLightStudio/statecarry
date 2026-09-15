import { it, expect } from 'vitest';
import { createHttpServer, ChangeEvents } from '../apps/server/src/http';
import { explanationHarness, explanationRecords } from './explanation-fixtures';
import { fixtureAnswer } from './question-fixtures';
it('HTTP scopes preparation, evidence and explanation questions while keeping legacy question input', async () => {
  const { h, id, settled, counts } = await explanationHarness(),
    port = 4394;
  h.summary.answerQuestion = async (c) => fixtureAnswer(c);
  h.summary.checkQuestion = async (_, a) => ({
    checks: a.items.map((i) => ({ itemId: i.id, verdict: 'supported', reason: 'fixture' })),
    unknownsSafe: true,
  });
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', port);
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}/api/v1/work-contexts/${id}`,
    input = { requestId: 'prepare', summaryId: h.core.work(id).latestSummaryId };
  const post = (url: string, payload: unknown, origin = `http://127.0.0.1:${port}`) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(payload),
    });
  try {
    await fetch(base);
    expect(counts().generated).toBe(0);
    expect(
      (await post(`${base}/explanations/prepare`, input, 'https://attacker.invalid')).status,
    ).toBe(403);
    expect((await post(`${base}/explanations/prepare`, input)).status).toBe(202);
    const view = await settled(),
      r = view.revision!;
    expect((await post(`${base}/explanations/prepare`, input)).status).toBe(202);
    expect(counts().generated).toBe(1);
    expect(
      (await fetch(`${base}/explanations/${r.id}/evidence/${explanationRecords[0].id}`)).status,
    ).toBe(200);
    expect((await fetch(`${base}/explanations/${r.id}/evidence/missing`)).status).toBe(404);
    expect((await fetch(base.replace(id, 'another-work') + `/explanations/${r.id}`)).status).toBe(
      404,
    );
    const create = await post(`${base}/questions`, {
      requestId: 'q1',
      summaryId: r.summaryId,
      explanationId: r.id,
      nodeId: 'origin',
    });
    expect(create.status).toBe(200);
    const session = await create.json();
    expect(session.claimId).toBeNull();
    expect(session.target.nodeId).toBe('origin');
    expect(
      (
        await post(`${base}/questions`, {
          requestId: 'bad',
          summaryId: r.summaryId,
          claimId: 'origin',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`${base}/questions`, {
          requestId: 'legacy',
          summaryId: r.summaryId,
          claimId: 'next',
        })
      ).status,
    ).toBe(200);
    await post(`${base}/questions/${session.id}/turns`, {
      requestId: 'turn',
      text: '왜 시작했나요?',
    });
    await h.core.questions.settled();
    const answer = await (await fetch(`${base}/questions/${session.id}`)).json();
    expect(answer.turns[0].answer.items[0].evidence[0].revisionId).toBe(explanationRecords[0].id);
    const link = h.core.links(id)[0];
    h.repo.put('link', { ...link, status: 'separate' });
    expect(
      (await fetch(`${base}/explanations/${r.id}/evidence/${explanationRecords[0].id}`)).status,
    ).toBe(409);
    const invalid = await (await fetch(`${base}/questions/${session.id}`)).json();
    expect(invalid.invalidated).toBe(true);
    expect(invalid.turns[0].answer).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await h.core.close();
  }
});
