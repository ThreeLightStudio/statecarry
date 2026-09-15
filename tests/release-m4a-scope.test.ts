import { it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexReader } from '../apps/server/src/adapters/codex-reader';
import { harness, source } from './helpers';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.forEach(d => rmSync(d, { recursive: true, force: true })); dirs.length = 0; });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'm4a-scope-')); dirs.push(home); mkdirSync(join(home, 'sessions')); vi.stubEnv('CODEX_HOME', home);
  const path = join(home, 'sessions', 'scope.jsonl');
  const events = [{ type: 'session_meta', payload: { id: 'thread-a' } }, ...['old', 'chosen', 'later'].flatMap(id => [
    { type: 'turn_context', timestamp: '2026-09-13T00:00:00Z', payload: { turn_id: id } },
    { type: 'response_item', payload: { type: 'message', role: 'user', id: `item-${id}`, content: [{ type: 'input_text', text: `${id} BODY` }] } }
  ]), { type: 'turn_context', payload: { turn_id: 'old' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old repeated BODY' }] } }];
  writeFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const request = vi.fn(async () => ({ thread: { id: 'thread-a', path, cwd: '/fixture', name: 'Fixture' } }));
  return { reader: new CodexReader({ request, close: async () => {} }), request };
}
it('lists only turn metadata and never requests provider bodies before approval', async () => {
  const { reader, request } = fixture(); const result = await reader.listTurns('thread-a');
  expect(result.turns.map(t => t.id)).toEqual(['old', 'chosen', 'later']);
  expect(JSON.stringify(result)).not.toContain('BODY');
  expect(request).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: 'thread-a', includeTurns: false });
});
it('first scoped collection stores and sends only the approved local turns to generation and checking', async () => {
  const { reader, request } = fixture(), h = harness(); h.reader.read = reader.read.bind(reader);
  const generate = vi.spyOn(h.summary, 'generate'), check = vi.spyOn(h.summary, 'check');
  const id = h.core.connect({ requestId: 'scoped', expectedRevision: 0, payload: { title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: { 'thread-a': 'chosen' }, discover: false } }).workId;
  expect(request).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  await h.core.collect(id); await h.core.process(id);
  expect(h.repo.list('source').map(s => s.turnId)).toEqual(['chosen', 'later']);
  expect(generate).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledTimes(1);
  for (const s of h.repo.list('source')) {
    expect(s.turnStatus).toBe('unknown');
    expect(s.limitations.join(' ')).toContain('missing execution details do not establish completion');
  }
  expect(JSON.stringify(generate.mock.calls)).toContain('Tool result and turn state coverage are partial');
  expect(JSON.stringify(check.mock.calls)).toContain('Tool result and turn state coverage are partial');
  expect(h.core.snapshot(id).summary!.limitations.join(' ')).toContain('missing execution details do not establish completion');
  expect(JSON.stringify(generate.mock.calls)).not.toContain('old BODY'); expect(JSON.stringify(check.mock.calls)).not.toContain('old BODY');
  expect(request.mock.calls.every(call => (call as any)[1].includeTurns === false)).toBe(true);
  await h.core.close();
});
it('missing starting turns fail without source storage or model requests', async () => {
  const { reader } = fixture(), h = harness(); h.reader.read = reader.read.bind(reader);
  const id = h.core.connect({ requestId: 'bad-start', expectedRevision: 0, payload: { title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: { 'thread-a': 'missing' }, discover: false } }).workId;
  await h.core.collect(id); await h.core.process(id);
  expect(h.repo.list('source')).toEqual([]); expect(h.counts().generationCalls).toBe(0);
  expect(h.core.snapshot(id).checkpoints[0]).toMatchObject({ status: 'failed' });
  await expect(reader.read('thread-a', 'bad/id')).rejects.toThrow('Invalid provider identifier'); await h.core.close();
});
it('rejects a starting turn mapped to an unselected conversation at initial connection', () => {
  const h = harness(); expect(() => h.core.connect({ requestId: 'foreign', expectedRevision: 0, payload: { title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: { other: 'chosen' }, discover: false } })).toThrow('outside selected'); expect(h.repo.list('connection')).toEqual([]);
});
it('does not include earlier-turn supplements appearing after the starting turn in a reader result', async () => {
  const h = harness(); const old = { ...source('old BODY'), turnId: 'old' }, selected = { ...source('chosen BODY', 'thread-a', 'chosen'), turnId: 'chosen' }, supplement = { ...source('old supplement', 'thread-a', 'supplement'), turnId: 'old' };
  h.records([old, selected, supplement]); const id = h.core.connect({ requestId: 'order', expectedRevision: 0, payload: { title: 'Fixture', cwd: '/fixture', threadIds: ['thread-a'], startTurnIds: { 'thread-a': 'chosen' }, discover: false } }).workId;
  await h.core.collect(id); expect(h.core.sources(id)).toEqual([selected]); await h.core.close();
});
