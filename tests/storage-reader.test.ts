import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { CodexReader, parseRollout, sourceText } from '../apps/server/src/adapters/codex-reader';
import { analysisChunks } from '../apps/server/src/adapters/codex-summary';
import { source, harness } from './helpers';

const dirs: string[] = [], repos: SQLiteRepository[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'statecarry-test-')); dirs.push(d); return d; };
const open = (d = dir()) => { const r = new SQLiteRepository(d); repos.push(r); return r; };
afterEach(() => { for (const r of repos.splice(0)) try { r.close(); } catch {} for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('actual SQLite storage', () => {
  it('rolls back both source and checkpoint on a failed transaction', () => {
    const r = open(), h = harness(r), id = h.connect(), s = source();
    expect(() => r.transaction(() => { r.put('source', s); r.put('work', { ...h.core.work(id), revision: 9 }); throw new Error('disk boundary'); })).toThrow('disk boundary');
    expect(r.get('source', s.id)).toBeNull(); expect(h.core.work(id).revision).toBe(1);
  });
  it('preserves the first immutable source and rejects target/content collisions', () => {
    const r = open(), s = source(); r.put('source', s);
    r.put('source', { ...s, observedAt: '2026-09-09T00:00:00Z' });
    expect(r.get('source', s.id)?.observedAt).toBe(s.observedAt);
    expect(() => r.put('source', { ...s, threadId: 'wrong-target' })).toThrow('Immutable');
    expect(() => r.put('source', { ...s, text: 'altered' })).toThrow('Immutable');
  });
  it('reopens work, valid summary, overlay, draft and receipt with the same identities', async () => {
    const d = dir(), r = open(d), h = harness(r), id = h.connect(); await h.core.collect(id); await h.core.process(id);
    const s = h.core.snapshot(id);
    h.core.mutate(id, 'corrections', h.command(id, { slot: 'next', text: 'persistent correction', baseSummaryId: s.summary!.id, overlayRevision: 0, active: true }));
    const command = h.command(id, { threadId: 'thread-a', summaryId: s.summary!.id, evidenceIds: [source().id], text: 'persistent draft', draftRevision: 0 });
    const receipt = h.core.mutate(id, 'drafts', command); r.close(); repos.splice(repos.indexOf(r), 1);
    const second = open(d), hh = harness(second), restored = hh.core.snapshot(id);
    expect(restored.summary?.id).toBe(s.summary!.id); expect(restored.draft?.text).toBe('persistent draft');
    expect(restored.overlays[0].text).toBe('persistent correction');
    expect(second.get('receipt', command.requestId)).toEqual(receipt);
    expect(hh.core.mutate(id, 'drafts', command)).toEqual(receipt);
  });
  it('refuses a second writer and invalid databases', () => {
    const d = dir(); open(d); expect(() => new SQLiteRepository(d)).toThrow('Another writer');
    const bad = dir(); writeFileSync(join(bad, 'statecarry.sqlite'), 'not a SQLite database');
    expect(() => new SQLiteRepository(bad)).toThrow();
  });
  it('uses actual foreign keys for owned records', () => {
    const r = open(); expect(() => r.put('visit', { id: 'missing', workId: 'missing', summaryId: 'x', evidenceIds: [], at: '' })).toThrow('FOREIGN KEY');
  });
});

describe('collection normalization and coverage', () => {
  it('retains raw original IDs and line positions and excludes reasoning', () => {
    const content = [
      { type: 'session_meta', payload: { id: 'thread-a' } },
      { type: 'turn_context', payload: { turn_id: 'turn-a' } },
      { type: 'response_item', timestamp: '2026-09-08T13:35:01Z', payload: { type: 'message', role: 'user', id: 'raw-id', content: [{ type: 'input_text', text: '정정 원문' }] } },
      { type: 'response_item', payload: { type: 'reasoning', text: 'private reasoning' } }
    ].map(x => JSON.stringify(x)).join('\n') + '\n';
    const result = parseRollout(content); expect(result.records).toHaveLength(1); expect(result.records[0]).toMatchObject({ id: 'raw-id', turnId: 'turn-a', line: 3, text: '정정 원문' });
    expect(sourceText({ type: 'reasoning', text: 'private' })).toBeNull();
  });
  it('does not parse a partially written line and reports damaged lines', () => {
    const result = parseRollout('{broken}\n{"type":"response_item"');
    expect(result.records).toEqual([]); expect(result.limitations.some(x => /Incomplete.*JSONL.*deferred/.test(x))).toBe(true); expect(result.limitations.some(x => x.includes('Invalid JSONL'))).toBe(true);
  });
  it('preserves nested tool errors independently from outer completion', () => {
    const record = sourceText({ type: 'mcpToolCall', tool: 'download', status: 'completed', result: { isError: true, content: 'expired' } });
    expect(record?.text).toContain('isError'); expect(record?.text).toContain('expired'); expect(record?.actor).toBe('tool');
  });
  it('fails closed when the provider returns another thread', async () => {
    const r = new CodexReader({ request: async () => ({ thread: { id: 'thread-b', turns: [] } }), close: async () => {} });
    await expect(r.read('thread-a')).rejects.toThrow('does not match');
  });
  it('tracks same-turn text and turn status changes in immutable version IDs', async () => {
    const item = { type: 'agentMessage', id: 'item-a', text: 'old result' };
    const turn = { id: 'turn-a', status: 'inProgress', items: [item] };
    const r = new CodexReader({ request: async () => ({ thread: { id: 'thread-a', turns: [turn] } }), close: async () => {} });
    const before = await r.read('thread-a'); item.text = 'corrected result'; turn.status = 'completed'; const after = await r.read('thread-a');
    expect(after.revisions[0].key).toBe(before.revisions[0].key); expect(after.revisions[0].id).not.toBe(before.revisions[0].id); expect(after.revisions[1].id).not.toBe(before.revisions[1].id);
  });
  it('bounds paging, keeps the original filter and reports a repeated cursor', async () => {
    const calls: unknown[] = [];
    const r = new CodexReader({ request: async (_m, p) => { calls.push(p); return { data: [{ id: 'thread-a', cwd: '/test', name: 'A' }], nextCursor: 'again' }; }, close: async () => {} });
    const result = await r.discover('/test'); expect(result.complete).toBe(false); expect(calls).toHaveLength(2); expect(calls[0]).toMatchObject({ cwd: '/test', useStateDbOnly: true, sourceKinds: ['cli', 'vscode', 'appServer'] });
  });
  it('labels narrower tool coverage and removes credential-like analysis input', () => {
    const tool = { ...source('x'.repeat(10000) + ' nested error: failed ' + 'y'.repeat(10000)), actor: 'tool' as const };
    const secret = source('Bearer ' + 'a'.repeat(40)); const input = JSON.stringify(analysisChunks([tool, secret]));
    expect(input).toContain('UNANALYZED GAP'); expect(input).toContain('nested error'); expect(input).toContain('CREDENTIAL OMITTED'); expect(input).not.toContain('a'.repeat(40));
    expect(tool.text.length).toBeGreaterThan(input.length);
  });
});
