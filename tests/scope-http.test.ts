import { describe, it, expect } from 'vitest';
import { request } from 'node:http';
import { once } from 'node:events';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness, source, read } from './helpers';

describe('scope and target changes', () => {
  it('changes ranges atomically, preserves source and rejects stale repeat bodies', async () => {
    const h = harness(), id = h.connect(); await h.core.collect(id); await h.core.process(id); const c = h.core.snapshot(id).connection;
    const command = h.command(id, { title: c.title, cwd: c.cwd, threadIds: c.threadIds, startTurnIds: { 'thread-a': 'later-turn' }, discover: false });
    const receipt = h.core.updateConnection(c.id, command);
    expect(h.core.sources(id)).toEqual([]); expect(h.repo.get('source', source().id)).not.toBeNull();
    expect(h.core.updateConnection(c.id, command)).toEqual(receipt);
    expect(() => h.core.updateConnection(c.id, { ...command, payload: { ...command.payload, discover: true } })).toThrow('another body');
    await h.core.collect(id); expect(h.core.snapshot(id).checkpoints[0].status).toBe('failed');
  });
  it('does not apply a read started before a range update', async () => {
    const h = harness(), id = h.connect(); let done!: () => void;
    h.reader.read = async () => { await new Promise<void>(r => { done = r; }); return read([source()]); };
    const pending = h.core.collect(id), c = h.core.snapshot(id).connection;
    h.core.updateConnection(c.id, h.command(id, { title: c.title, cwd: c.cwd, threadIds: ['thread-b'], startTurnIds: {}, discover: false }));
    done(); await pending; expect(h.core.sources(id)).toEqual([]); expect(h.repo.get('source', source().id)).toBeNull();
  });
  it('rejects foreign source items before any checkpoint commit', async () => {
    const h = harness(), id = h.connect(); h.reader.read = async () => ({ ...read([source()]), revisions: [source('wrong', 'thread-b')] });
    await h.core.collect(id); expect(h.core.sources(id)).toEqual([]); expect(h.repo.list('source')).toEqual([]); expect(h.core.snapshot(id).checkpoints[0].status).toBe('failed');
  });
  it('makes discovery failure visible while preserving last successful scope', async () => {
    const h = harness(), id = h.connect(), c = { ...h.core.snapshot(id).connection, discover: true }; h.repo.put('connection', c);
    await h.core.discover(c); const good = h.core.snapshot(id).connection;
    h.reader.discover = async () => { throw new Error('disconnected discovery'); }; await h.core.discover(good);
    const state = h.core.snapshot(id).connection.discovery!; expect(state.status).toBe('failed'); expect(state.successfulAt).toBe(good.discovery!.successfulAt); expect(state.limitations).toContain('disconnected discovery');
  });
  it('records missing and replaced source without deleting immutable history', async () => {
    const h = harness(), id = h.connect(); h.records([source(), source('old extra', 'thread-a', 'extra')]); await h.core.collect(id);
    h.reader.read = async () => ({ ...read([source()]), generation: 'replacement' }); await h.core.collect(id);
    const s = h.core.snapshot(id); expect(s.checkpoints[0].status).toBe('partial'); expect(s.checkpoints[0].limitations.join(' ')).toContain('absent'); expect(s.checkpoints[0].limitations.join(' ')).toContain('generation changed'); expect(h.repo.list('source')).toHaveLength(2);
  });
});

describe('actual loopback HTTP contract with simulated provider', () => {
  it('guards origin/host/schema, has receipts, rejects work execution', async () => {
    const h = harness(), events = new ChangeEvents(), server = createHttpServer(h.core, events, '/nonexistent', 4310);
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
    const call = (path: string, method = 'GET', value?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: address.port, path: `/api/v1${path}`, method, headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json', ...headers } }, res => { let data = ''; res.on('data', b => { data += b; }); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) })); }); req.on('error', reject); req.end(value === undefined ? undefined : JSON.stringify(value));
    });
    try {
      expect((await call('/projects', 'GET', undefined, { Origin: 'https://foreign.test' })).status).toBe(403);
      expect((await call('/projects', 'GET', undefined, { Host: 'foreign.test' })).status).toBe(403);
      expect((await call('/connections', 'POST', {})).status).toBe(400);
      const input = { requestId: 'connect-once', expectedRevision: 0, payload: { title: 'HTTP test', cwd: '/tmp/example', threadIds: ['thread-a'], startTurnIds: {}, discover: false } };
      const first = await call('/connections', 'POST', input); expect(first.status).toBe(200); expect((await call('/connections', 'POST', input)).body).toEqual(first.body);
      expect((await call('/commands/connect-once')).body.id).toBe('connect-once');
      expect((await call(`/work-contexts/${first.body.workId}/execute`, 'POST', { ...input, payload: {} })).status).toBe(404);
      expect((await call('/messages/send', 'POST', { ...input, payload: {} })).status).toBe(404);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
});
