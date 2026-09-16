import { once } from 'node:events';
import { request, type IncomingMessage } from 'node:http';
import { expect, it, vi } from 'vitest';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness, read, source } from './helpers';

it('separates unchanged collection completion from actual data changes through the HTTP stream', async () => {
  const h = harness();
  const workId = h.connect();
  await h.core.collect(workId);
  const events = new ChangeEvents();
  h.core.events.changed = (id) => events.changed(id);
  h.core.events.collectionSettled = (id) => events.collectionSettled(id);
  const server = createHttpServer(h.core, events, '/tmp/unused-web', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const req = request({
    hostname: '127.0.0.1',
    port: address.port,
    path: '/api/v1/events',
    headers: { Host: '127.0.0.1:4310' },
  });
  const responsePromise = once(req, 'response');
  req.end();
  const [response] = (await responsePromise) as [IncomingMessage];
  const packets: { event: string; data: unknown }[] = [];
  let buffer = '';
  response.setEncoding('utf8');
  response.on('data', (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const packet = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = packet.match(/^event: (.+)$/m)?.[1];
      const data = packet.match(/^data: (.+)$/m)?.[1];
      if (event && data) packets.push({ event, data: JSON.parse(data) });
    }
  });
  try {
    await vi.waitFor(() => expect(packets).toEqual([{ event: 'connected', data: {} }]));
    await h.core.collect(workId);
    await h.core.collect(workId);
    await h.core.collect(workId);
    await vi.waitFor(() => expect(packets).toHaveLength(4));
    expect(packets.slice(1)).toEqual(
      Array.from({ length: 3 }, () => ({ event: 'collection-settled', data: { workId } })),
    );

    const changed = source('A genuinely changed saved result.');
    h.records([changed]);
    await h.core.collect(workId);
    await vi.waitFor(() => expect(packets).toHaveLength(6));
    expect(packets.slice(-2)).toEqual([
      { event: 'change', data: { workId } },
      { event: 'collection-settled', data: { workId } },
    ]);

    let finish!: (value: ReturnType<typeof read>) => void;
    h.reader.read = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = h.core.collect(workId);
    expect(h.core.projects.list().projects[0].collecting).toBe(true);
    expect(packets).toHaveLength(6);
    finish(read([changed]));
    await pending;
    await vi.waitFor(() => expect(packets).toHaveLength(7));
    expect(packets.at(-1)).toEqual({ event: 'collection-settled', data: { workId } });
    expect(h.core.projects.list().projects[0].collecting).toBe(false);
    expect(h.counts()).toMatchObject({ generationCalls: 0, checkCalls: 0 });

    response.destroy();
    req.destroy();
    await vi.waitFor(() => {
      expect(events.listenerCount('change')).toBe(0);
      expect(events.listenerCount('collection-settled')).toBe(0);
    });
  } finally {
    response.destroy();
    req.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
