import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { StateCarry } from '@statecarry/core';
import { relationshipEvidence } from '../packages/core/src/checks';
import { identity } from '../apps/server/src/adapters/identity';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { BackgroundLoop } from '../apps/server/src/background';
import {
  summarySettings,
  settingsFromEnvironment,
  requireSupportedSettings,
} from '../apps/server/src/adapters/summary-settings';
import * as summaryPolicy from '../apps/server/src/adapters/summary-settings';
import {
  acquireAnalysisSlot,
  citationContext,
  evidenceCatalog,
} from '../apps/server/src/adapters/analysis-support';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';
import { CodexReader, sourceText } from '../apps/server/src/adapters/codex-reader';
import { observationSchema } from '@statecarry/contracts';
import { harness, source, read, candidate, AT } from './helpers';

describe('stage 6 model policy and analysis', () => {
  it('uses Luna/medium independently of global settings and rejects unsupported selection', () => {
    const settings = summarySettings(
      settingsFromEnvironment({ model: 'gpt-6-astra', model_reasoning_effort: 'xhigh' }),
    );
    expect(settings).toMatchObject({
      model: 'gpt-5.6-luna',
      summaryEffort: 'medium',
      checkEffort: 'medium',
    });
    expect(() =>
      requireSupportedSettings(settings, [
        { model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
      ]),
    ).toThrow('no model fallback');
    expect(() =>
      requireSupportedSettings(settings, [
        { model: 'gpt-5.6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
      ]),
    ).toThrow('no effort fallback');
  });
  it('admits only two concurrent model calls and releases queued work', async () => {
    const a = await acquireAnalysisSlot(),
      b = await acquireAnalysisSlot();
    let entered = false;
    const pending = acquireAnalysisSlot().then((release) => {
      entered = true;
      return release;
    });
    await Promise.resolve();
    expect(entered).toBe(false);
    a();
    const c = await pending;
    expect(entered).toBe(true);
    b();
    c();
  });
  it('combines all cited contexts without accepting foreign or changed quotes', () => {
    const a = source('승인 대기', 'a'),
      b = source('승인 완료가 아니라 검수 요청입니다', 'b');
    const c = candidate(a);
    c.claims[0].evidence.push({ revisionId: b.id, quote: b.text });
    expect(
      citationContext(c, [a, b])
        .filter((x) => x.claimId === 'purpose')
        .map((x) => x.threadId),
    ).toEqual(['a', 'b']);
    expect(() => citationContext(c, [a])).toThrow('outside input');
  });
  it.each(['check effort', 'prompt version'] as const)(
    'reuses cached chunks until the %s changes',
    async (change) => {
      const dir = await mkdtemp(join(tmpdir(), 'statecarry-cache-'));
      const settingsFactory = summarySettings,
        settingsSpy = vi.spyOn(summaryPolicy, 'summarySettings');
      try {
        const output = {
          ...candidate(source()),
          claims: candidate(source()).claims.map(({ evidence, ...c }) => ({
            ...c,
            evidenceIds: ['q1'],
          })),
        };
        const a = new CodexSummary(dir);
        vi.spyOn(a, 'preflight').mockResolvedValue(undefined);
        const run = vi
          .spyOn(a as any, 'run')
          .mockResolvedValue({ value: output, model: 'gpt-5.6-luna' });
        await a.generate([source()], () => {});
        await a.generate([source()], () => {});
        expect(run).toHaveBeenCalledTimes(1);
        settingsSpy.mockImplementation((input) => {
          const settings = settingsFactory(input);
          return change === 'prompt version'
            ? { ...settings, promptVersion: settings.promptVersion + '-next' }
            : settings;
        });
        const b = new CodexSummary(dir, change === 'check effort' ? { checkEffort: 'high' } : {});
        vi.spyOn(b, 'preflight').mockResolvedValue(undefined);
        const other = vi
          .spyOn(b as any, 'run')
          .mockResolvedValue({ value: output, model: 'gpt-5.6-luna' });
        await b.generate([source()], () => {});
        await b.generate([source()], () => {});
        expect(other).toHaveBeenCalledOnce();
      } finally {
        settingsSpy.mockRestore();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it.each(['checkEffort', 'promptVersion'] as const)(
    'creates a new job on %s changes and preserves the earlier summary as history',
    async (field) => {
      const h = harness(),
        id = h.connect();
      await h.core.collect(id);
      await h.core.process(id);
      const prior = h.core.snapshot(id).summary!;
      const nextSettings = {
        ...h.summary.configuration(),
        ...(field === 'checkEffort'
          ? { checkEffort: 'high' as const }
          : { promptVersion: 'fake-next' }),
      };
      h.summary.configuration = () => nextSettings;
      expect(h.core.freshness(id).summary).toBe('outdated');
      await h.core.process(id);
      expect(h.core.snapshot(id).summary!.analysis).toEqual(nextSettings);
      expect(h.repo.get('summary', prior.id)).toEqual(prior);
      expect(h.repo.list('job')).toHaveLength(2);
    },
  );
  it('resolves model evidence IDs to exact immutable spans and rejects invented IDs', () => {
    const s = source('line one\nline two');
    const catalog = evidenceCatalog([[{ revisionId: s.id, text: s.text }]], [s]);
    const output = {
      ...candidate(s),
      claims: candidate(s).claims.map(({ evidence, ...c }) => ({ ...c, evidenceIds: ['q1'] })),
    };
    expect(catalog.decode(output).claims[0].evidence[0]).toEqual({
      revisionId: s.id,
      quote: s.text,
    });
    expect(catalog.encode(catalog.decode(output))).toEqual(output);
    output.claims[0].evidenceIds = ['invented'];
    expect(() => catalog.decode(output)).toThrow('Unknown evidence');
    const text = sourceText({
      type: 'commandExecution',
      command: 'test',
      aggregatedOutput: 'line one\nline two',
      status: 'completed',
      exitCode: 0,
    })!.text;
    expect(text.includes('line one\nline two')).toBe(true);
  });
  it('does not cache invalid references and bypasses a rejected candidate cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'statecarry-reject-'));
    try {
      const provider = new CodexSummary(dir);
      vi.spyOn(provider, 'preflight').mockResolvedValue(undefined);
      const output = {
        ...candidate(source()),
        claims: candidate(source()).claims.map(({ evidence, ...c }) => ({
          ...c,
          evidenceIds: ['q1'],
        })),
      };
      const wrong = structuredClone(output);
      wrong.claims[0].evidenceIds = ['unknown'];
      const run = vi
        .spyOn(provider as any, 'run')
        .mockResolvedValueOnce({ value: wrong, model: 'gpt-5.6-luna' })
        .mockResolvedValue({ value: output, model: 'gpt-5.6-luna' });
      await provider.generate([source()], () => {});
      expect(run.mock.calls[1][0]).toContain('Unknown evidence');
      await provider.generate([source()], () => {});
      expect(run).toHaveBeenCalledTimes(2);
      await provider.rejectCandidate([source()], candidate(source()), {
        checks: [{ claimId: 'next', verdict: 'unsupported', reason: 'precondition changed' }],
      });
      await provider.generate([source()], () => {});
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('stage 6 relations, freshness and scope', () => {
  it('collects an externally appended local record and preserves the earlier immutable revision', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'statecarry-external-'));
    const oldHome = process.env.CODEX_HOME;
    let repo: SQLiteRepository | undefined;
    try {
      process.env.CODEX_HOME = dir;
      await mkdir(join(dir, 'sessions'));
      const path = join(dir, 'sessions', 'external.jsonl'),
        tid = 'external-a';
      const record = (text: string) =>
        JSON.stringify({
          type: 'response_item',
          timestamp: AT,
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
        }) + '\n';
      await writeFile(
        path,
        JSON.stringify({ type: 'session_meta', payload: { id: tid } }) +
          '\n' +
          JSON.stringify({
            type: 'event_msg',
            payload: { type: 'task_started', turn_id: 'external-turn' },
          }) +
          '\n' +
          record('Original prerequisite'),
      );
      const reader = new CodexReader({
        request: async () => ({ thread: { id: tid, cwd: dir, path, turns: [] } }),
        close: async () => {},
      });
      repo = new SQLiteRepository(join(dir, 'data'));
      const h = harness(repo);
      h.reader.read = (id) => reader.read(id);
      const workId = h.core.connect({
        requestId: identity.next(),
        expectedRevision: 0,
        payload: { title: 'External record fixture', cwd: dir, threadIds: [tid], discover: false },
      }).workId;
      await h.core.collect(workId);
      const first = h.core.sources(workId)[0];
      // Simulates a conversation continuing outside StateCarry, with actual filesystem IO.
      await appendFile(path, record('The prerequisite has changed; do not use the old Next.'));
      await h.core.collect(workId);
      expect(h.core.sources(workId)).toHaveLength(2);
      expect(h.repo.get('source', first.id)).toEqual(first);
      expect(h.core.sources(workId)[1].locator.line).toBe(4);
      expect(h.core.freshness(workId).summary).toBe('missing');
      expect(h.core.sources(workId)[1].text).toContain('prerequisite has changed');
      await reader.close();
    } finally {
      repo?.close();
      if (oldHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = oldHome;
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('passes rejected semantics to regeneration without applying the rejected summary', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    const feedback = vi.fn();
    h.summary.rejectCandidate = feedback;
    h.summary.check = async (c) => ({
      checks: c.claims.map((x) => ({
        claimId: x.id,
        verdict: 'unsupported' as const,
        reason: 'An intended check is not a completed check',
      })),
    });
    await h.core.process(id);
    expect(feedback).toHaveBeenCalledOnce();
    expect(h.core.snapshot(id).summary).toBeNull();
    expect(h.repo.list('job')[0]).toMatchObject({ status: 'queued', candidate: null });
  });
  it('does not link a document mention, negation, quote, question or ambiguous references', () => {
    for (const text of [
      'docs/example-handoff.md',
      '이전 일과 별개입니다. docs/example-report.md',
      '> thread-b 대화에서 이어갑니다',
      'thread-b 대화에서 이어갑니까?',
      'thread-b와 thread-c에서 이어갑니다',
    ]) {
      expect(relationshipEvidence([source(text)], ['thread-b', 'thread-c'])).toEqual([]);
    }
    expect(
      relationshipEvidence([source('thread-b 대화에서 이어갑니다')], ['thread-b']),
    ).toHaveLength(1);
  });
  it('offers ambiguous sessions without merging and preserves separate/deferred decisions', async () => {
    const h = harness(),
      id = h.connect();
    const c = h.repo.list('connection')[0];
    h.repo.put('connection', { ...c, discover: true });
    h.reader.discover = async () => ({
      threads: ['new', 'clear'].map((id) => ({ id, title: id, cwd: c.cwd })),
      complete: true,
      limitations: [],
    });
    h.reader.read = async (tid) =>
      read([
        source(
          tid === 'clear'
            ? 'thread-a 대화에서 이어갑니다'
            : '이전 일과 별개입니다. docs/example-handoff.md',
          tid,
        ),
      ]);
    await h.core.discover(h.repo.get('connection', c.id)!);
    const proposed = h.core.links(id).find((l) => l.threadId === 'new')!;
    expect(proposed.status).toBe('proposed');
    expect(h.core.sources(id).some((s) => s.threadId === 'new')).toBe(false);
    expect(h.core.evidence(proposed.evidence[0]).threadId).toBe('new');
    expect(h.core.links(id).find((l) => l.threadId === 'clear')!.status).toBe('linked');
    await h.core.collect(id);
    expect(h.core.freshness(id)).toMatchObject({ collection: 'partial' });
    expect(h.core.freshness(id).reasons.join(' ')).toContain('unconfirmed relationships');
    h.core.mutate(
      id,
      'link',
      h.command(id, { status: 'separate', linkRevision: proposed.revision }),
      proposed.id,
    );
    await h.core.discover(h.repo.get('connection', c.id)!);
    expect(h.repo.get('link', proposed.id)!.status).toBe('separate');
  });
  it('shows failed or expired collection separately from summary input equality', async () => {
    const h = harness(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    h.reader.read = async () => {
      throw new Error('offline');
    };
    await h.core.collect(id);
    expect(h.core.freshness(id)).toMatchObject({ collection: 'unknown', summary: 'current' });
    const later = new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      { now: () => '2026-09-08T13:40:00Z' },
      identity,
      { changed() {} },
    );
    expect(later.listProjects()[0].freshness?.collection).toBe('unknown');
  });
  it('does not accept sessions returned outside the requested folder', async () => {
    const reader = new CodexReader({
      request: async () => ({ data: [{ id: 'foreign', cwd: '/outside' }], nextCursor: null }),
      close: async () => {},
    });
    const result = await reader.discover('/selected');
    expect(result.threads).toEqual([]);
    expect(result.complete).toBe(false);
  });
  it('continues another repository while discovery or reading is stalled', async () => {
    const h = harness(),
      first = h.connect();
    const second = h.core.connect({
      requestId: identity.next(),
      expectedRevision: 0,
      payload: { title: 'B', cwd: '/b', threadIds: ['b'], discover: false },
    }).workId;
    let finish!: () => void;
    const stalled = new Promise<void>((r) => {
      finish = r;
    });
    h.reader.read = async (id) => {
      if (id === 'thread-a') await stalled;
      return read([source('B record', id)]);
    };
    new BackgroundLoop(h.core).tick(1);
    await vi.waitFor(() => expect(h.core.sources(second)).toHaveLength(1));
    expect(h.core.sources(first)).toHaveLength(0);
    finish();
    await vi.waitFor(() => expect(h.core.sources(first)).toHaveLength(1));
  });
});

describe('two real fixture repositories, three synthetic sessions and SQLite recovery', () => {
  it('recovers jobs, saved inputs and histories after disconnect, lost check response and restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'statecarry-six-'));
    let repo: SQLiteRepository | undefined;
    try {
      const roots = [join(dir, 'repo-a'), join(dir, 'repo-b')];
      for (const root of roots) {
        await mkdir(root);
        execFileSync('rtk', ['git', 'init', root], { stdio: 'ignore' });
      }
      repo = new SQLiteRepository(join(dir, 'data'));
      const h = harness(repo);
      const records = [
        source('A purpose and next', 'a'),
        source('B is a discussion without an execution request', 'b'),
        source('a 대화에서 이어갑니다', 'a-next'),
      ];
      h.reader.read = async (id) => read(records.filter((s) => s.threadId === id));
      const works = roots.map(
        (cwd, i) =>
          h.core.connect({
            requestId: identity.next(),
            expectedRevision: 0,
            payload: {
              title: `Repo ${i}`,
              cwd,
              threadIds: i ? ['b'] : ['a', 'a-next'],
              discover: false,
            },
          }).workId,
      );
      for (const id of works) {
        await h.core.collect(id);
        await h.core.process(id);
      }
      const before = h.core.snapshot(works[0]),
        draft = h.command(works[0], {
          summaryId: before.summary!.id,
          evidenceIds: [records[0].id],
          threadId: 'a-next',
          text: 'saved draft',
          draftRevision: 0,
        });
      const receipt = h.core.mutate(works[0], 'drafts', draft); // Transport may lose this response after durable commit.
      const job = repo.list('job').find((j) => j.workId === works[0] && j.status === 'applied')!;
      repo.put('job', {
        ...job,
        status: 'checking',
        candidate: candidate(records[0]),
        resultId: null,
      });
      repo.close();
      repo = new SQLiteRepository(join(dir, 'data'));
      const resumed = harness(repo);
      await resumed.core.recover();
      expect(repo.get('receipt', receipt.id)).toEqual(receipt);
      expect(repo.get('draft', works[0])!.text).toBe('saved draft');
      expect(resumed.core.sources(works[0]).map((s) => s.threadId)).toEqual(['a', 'a-next']);
      expect(resumed.core.sources(works[1]).map((s) => s.threadId)).toEqual(['b']);
      expect(repo.get('summary', before.summary!.id)).toEqual(before.summary);
      await resumed.core.process(works[0]);
      expect(resumed.counts().generationCalls).toBe(0);
      expect(resumed.counts().checkCalls).toBe(0); // An already committed result is reconciled, never checked/applied twice.
      resumed.reader.read = async () => {
        throw new Error('connection lost');
      };
      await resumed.core.collect(works[1]);
      expect(resumed.core.freshness(works[1]).collection).toBe('unknown');
      resumed.reader.read = async (id) => read(records.filter((s) => s.threadId === id));
      await resumed.core.collect(works[1]);
      expect(resumed.core.freshness(works[1]).collection).toBe('checked');
      await writeFile(
        join(dir, 'case-kind.txt'),
        'Controlled synthetic sessions; not real user evidence',
      );
    } finally {
      repo?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('accepts only metadata observation events, excluding text and keystrokes', () => {
    const event = {
      id: 'e',
      kind: 'return',
      at: AT,
      workId: null,
      summaryId: null,
      targetId: null,
      result: 'observed',
    };
    expect(observationSchema.safeParse(event).success).toBe(true);
    expect(observationSchema.safeParse({ ...event, text: 'private draft' }).success).toBe(false);
  });
});
