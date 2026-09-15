import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { presentReturnContext } from '@statecarry/presentation';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { AT, harness, source, read, candidate } from './helpers';

function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((r) => {
      enter = r;
    }),
    wait: new Promise<void>((r) => {
      release = r;
    }),
    enter: () => enter(),
    release: () => release(),
  };
}
function timed(repo?: SQLiteRepository) {
  let now = Date.parse(AT);
  const h = harness(repo, { now: () => new Date(now).toISOString() });
  const original = h.reader.read;
  h.reader.read = async (id) => ({
    ...(await original(id)),
    observedAt: new Date(now).toISOString(),
  });
  return {
    ...h,
    advance: (ms = 1000) => {
      now += ms;
    },
  };
}

describe('fixed input completion under continuous collection', () => {
  it('publishes during continuous input, coalesces corrections and converges without duplicate analysis', async () => {
    const h = timed(),
      id = h.connect(),
      first = source('처음 방향');
    h.records([first]);
    await h.core.collect(id);
    h.advance(2000);
    const gen = gate(),
      check = gate();
    let generations = 0,
      checks = 0;
    h.summary.generate = async (s) => {
      generations++;
      if (generations === 1) {
        gen.enter();
        await gen.wait;
      }
      return { candidate: candidate(s.at(-1)!), model: 'fake' };
    };
    h.summary.check = async (c, s) => {
      checks++;
      if (checks === 1) {
        expect(s.map((x) => x.id)).toEqual([first.id]);
        check.enter();
        await check.wait;
      }
      return {
        checks: c.claims.map((x) => ({
          claimId: x.id,
          verdict: 'supported',
          reason: 'checked exact snapshot',
        })),
      };
    };
    const run = h.core.process(id);
    await gen.entered;
    let records = [first];
    for (let i = 0; i < 3; i++) {
      h.advance();
      records = [...records, source(`추가 ${i}`, 'thread-a', `extra-${i}`)];
      h.records(records);
      await h.core.collect(id);
    }
    expect(h.repo.list('job')).toHaveLength(1);
    expect(h.core.work(id).pendingRefresh?.inputVersion).toBe(h.core.work(id).inputVersion);
    gen.release();
    await check.entered;
    const corrected = source('정정: 이전 방향은 취소');
    records = [corrected, ...records.slice(1)];
    h.advance();
    h.records(records);
    await h.core.collect(id);
    h.advance();
    check.release();
    await run;
    const published = h.core.snapshot(id),
      summaryId = published.summary!.id;
    expect(published.summary!.sourceRevisionIds).toEqual([first.id]);
    expect(published.summary!.processingMs).toBe(5000);
    expect(published.summary!.inputCapturedAt).toBe(new Date(Date.parse(AT) + 2000).toISOString());
    expect(published.coverage!.updated).toEqual([
      { previousId: first.id, currentId: corrected.id },
    ]);
    expect(published.freshness).toMatchObject({ collection: 'checked', summary: 'outdated' });
    expect(published.refresh!.appliedJobId).toBe(published.jobs[0].id);
    expect(published.refresh!.pending).not.toBeNull();
    const view = presentReturnContext(published);
    expect(view.summaryStatusLabel).toBe('Earlier scope reflected');
    expect(view.pendingLabel).toContain('follow-up');
    expect(view.scopeNotice).toContain('Later corrections may not be reflected yet');
    // Collection continues AFTER publication; completion does not rely on a quiet interval.
    records.push(source('마지막 정정의 다음 행동', 'thread-a', 'last'));
    h.advance();
    h.records(records);
    await h.core.collect(id);
    expect(h.core.work(id).latestSummaryId).toBe(summaryId);
    expect(h.core.freshness(id).summary).toBe('outdated');
    expect(() =>
      h.core.prepareHandoff(id, h.core.work(id).revision, {
        threadId: 'thread-a',
        summaryId,
        evidenceIds: [first.id],
        text: '',
        draftRevision: 0,
      }),
    ).toThrow('New input');
    await h.core.process(id);
    expect(h.core.snapshot(id).summary!.claims[0].text).toBe('마지막 정정의 다음 행동');
    expect(h.core.snapshot(id).coverage!.pendingIds).toEqual([]);
    expect(h.core.freshness(id).summary).toBe('current');
    await h.core.collect(id);
    await h.core.process(id);
    expect(generations).toBe(2);
    expect(checks).toBe(2);
    expect(h.repo.list('job')).toHaveLength(2);
    expect(h.repo.get('source', first.id)).toEqual(first);
  });

  it.each(['generate', 'check'] as const)(
    'keeps hard invalidation during %s including a checker with no remote callbacks',
    async (phase) => {
      for (const change of ['link', 'range', 'settings'] as const) {
        const h = timed(),
          id = h.connect();
        await h.core.collect(id);
        await h.core.process(id);
        const prior = h.core.snapshot(id).summary!;
        h.records([source('later')]);
        await h.core.collect(id);
        const g = gate();
        if (phase === 'generate') {
          const original = h.summary.generate;
          h.summary.generate = async (s, meta) => {
            g.enter();
            await g.wait;
            return original(s, meta);
          };
        } else {
          const original = h.summary.check;
          h.summary.check = async (c, s, meta) => {
            g.enter();
            await g.wait;
            return original(c, s, meta);
          };
        }
        const run = h.core.process(id);
        await g.entered;
        if (change === 'settings') {
          const settings = h.summary.configuration();
          h.summary.configuration = () => ({ ...settings, checkEffort: 'high' });
        } else if (change === 'link') {
          const l = h.core.links(id)[0];
          h.core.mutate(
            id,
            'link',
            h.command(id, { status: 'separate', linkRevision: l.revision }),
            l.id,
          );
        } else {
          const c = h.core.snapshot(id).connection;
          h.core.updateConnection(
            c.id,
            h.command(id, {
              title: c.title,
              cwd: c.cwd,
              threadIds: c.threadIds,
              startTurnIds: { 'thread-a': 'new-start' },
              discover: false,
            }),
          );
        }
        g.release();
        await run;
        expect(h.core.work(id).latestSummaryId).toBe(prior.id);
        expect(h.repo.list('summary')).toHaveLength(1);
        expect(h.repo.list('job').at(-1)!.status).toBe('superseded');
        expect(h.core.freshness(id).summary).toBe('outdated');
      }
    },
  );

  it('keeps remote identity after premise invalidation and blocks follow-up until termination', async () => {
    const h = timed(),
      id = h.connect();
    await h.core.collect(id);
    const g = gate();
    h.summary.generate = async (_s, meta) => {
      g.enter();
      await g.wait;
      meta({ pid: 123, threadId: 'remote', turnId: 'turn', phase: 'generate' });
      throw new Error('unreachable');
    };
    h.summary.resolve = async () => 'unknown';
    const run = h.core.process(id);
    await g.entered;
    const settings = h.summary.configuration();
    h.summary.configuration = () => ({ ...settings, promptVersion: 'new' });
    g.release();
    await run;
    expect(h.repo.list('job')[0]).toMatchObject({ status: 'result-unknown', remote: { pid: 123 } });
    await h.core.process(id);
    expect(h.repo.list('job')).toHaveLength(1);
    h.summary.resolve = async () => 'terminated';
    h.summary.generate = async (s) => ({ candidate: candidate(s[0]), model: 'fake' });
    await h.core.process(id);
    expect(h.repo.list('job')[0].status).toBe('superseded');
    expect(h.core.freshness(id).summary).toBe('current');
  });

  it('rejects a late result after another summary was committed', async () => {
    const h = timed(),
      id = h.connect();
    await h.core.collect(id);
    await h.core.process(id);
    const previous = h.core.snapshot(id).summary!;
    h.records([source('new input')]);
    await h.core.collect(id);
    const g = gate(),
      original = h.summary.check;
    h.summary.check = async (c, s, meta) => {
      g.enter();
      await g.wait;
      return original(c, s, meta);
    };
    const run = h.core.process(id);
    await g.entered;
    const other = {
      ...previous,
      id: 'other-result',
      inputVersion: h.core.work(id).inputVersion,
      sourceRevisionIds: h.core.sources(id).map((s) => s.id),
      attemptToken: 'other',
    };
    h.repo.put('summary', other);
    const w = h.core.work(id);
    h.repo.put('work', { ...w, latestSummaryId: other.id, revision: w.revision + 1 });
    g.release();
    await run;
    expect(h.core.work(id).latestSummaryId).toBe(other.id);
    expect(h.repo.list('job').at(-1)!.error).toContain('late result');
  });

  it('preserves partial collection and missing-source boundaries independently of input equality', async () => {
    const h = timed(),
      id = h.connect(),
      a = source(),
      b = { ...source('extra', 'thread-a', 'extra'), eventAt: null };
    h.records([a, b]);
    await h.core.collect(id);
    await h.core.process(id);
    h.reader.read = async () => ({
      ...read([a]),
      status: 'partial',
      limitations: ['limited access'],
    });
    await h.core.collect(id);
    expect(h.core.snapshot(id).coverage!.absentIds).toEqual([b.id]);
    await h.core.process(id);
    expect(h.core.freshness(id)).toMatchObject({ summary: 'current', collection: 'partial' });
    const view = presentReturnContext(h.core.snapshot(id));
    expect(view.freshnessLabel).toContain('Scope partially checked');
    expect(view.scopeNotice).toContain('partially checked scope');
  });
});

describe('durable fixed input and legacy recovery', () => {
  it.each(['snapshot', 'legacy-same', 'legacy-changed'] as const)(
    'recovers %s without mixing candidate input or inventing a boundary time',
    async (mode) => {
      const dir = mkdtempSync(join(tmpdir(), 'statecarry-fixed-'));
      let repo = new SQLiteRepository(dir);
      try {
        const h = timed(repo),
          id = h.connect(),
          first = source();
        await h.core.collect(id);
        h.summary.check = async () => {
          throw new Error('lost check response');
        };
        await h.core.process(id);
        const job = repo.list('job')[0];
        expect(job.candidate).not.toBeNull();
        const second = source('new correction');
        if (mode !== 'legacy-same') {
          h.records([second]);
          await h.core.collect(id);
        }
        repo.put('job', {
          ...job,
          status: 'checking',
          ...(mode === 'snapshot'
            ? {}
            : { inputSnapshot: undefined, queuedAt: undefined, phases: undefined }),
        });
        repo.close();
        repo = new SQLiteRepository(dir);
        const resumed = timed(repo);
        await resumed.core.recover();
        const checkedInputs: string[][] = [];
        const check = resumed.summary.check;
        resumed.summary.check = async (c, s, meta) => {
          checkedInputs.push(s.map((x) => x.id));
          return check(c, s, meta);
        };
        await resumed.core.process(id);
        const result = resumed.core.snapshot(id).summary!;
        if (mode === 'legacy-changed') {
          expect(repo.get('job', job.id)!.status).toBe('superseded');
          expect(repo.get('job', job.id)!.candidate).toEqual(job.candidate);
          expect(checkedInputs).toEqual([[second.id]]);
          expect(resumed.counts().generationCalls).toBe(1);
        } else {
          expect(checkedInputs).toEqual([[first.id]]);
          expect(resumed.counts().generationCalls).toBe(0);
          expect(result.inputCapturedAt).toBe(
            mode === 'snapshot' ? job.inputSnapshot!.capturedAt : null,
          );
        }
        if (mode === 'snapshot') {
          expect(resumed.core.freshness(id).summary).toBe('outdated');
          await resumed.core.process(id);
          expect(resumed.core.freshness(id).summary).toBe('current');
        }
        const count = repo.list('summary').length;
        // Reopening a job with its already committed attempt reconciles the existing result.
        const applied = repo.list('job').find((j) => j.resultId === result.id)!;
        repo.put('job', { ...applied, status: 'checking', resultId: null });
        await resumed.core.recover();
        await resumed.core.process(id);
        expect(repo.list('summary')).toHaveLength(count);
        expect(repo.get('source', first.id)).toEqual(first);
      } finally {
        repo.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('keeps an unknown recovered execution blocked across new input and restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'statecarry-unknown-'));
    let repo = new SQLiteRepository(dir);
    try {
      const h = timed(repo),
        id = h.connect();
      await h.core.collect(id);
      h.summary.generate = async (_s, meta) => {
        meta({ pid: 45, threadId: 'isolated', turnId: 'x', phase: 'generate' });
        throw new Error('lost');
      };
      h.summary.resolve = async () => 'unknown';
      await h.core.process(id);
      h.records([source('later')]);
      await h.core.collect(id);
      repo.close();
      repo = new SQLiteRepository(dir);
      const next = timed(repo);
      next.summary.resolve = async () => 'unknown';
      await next.core.recover();
      await next.core.process(id);
      expect(next.counts().generationCalls).toBe(0);
      expect(repo.list('job')).toHaveLength(1);
      next.summary.resolve = async () => 'terminated';
      await next.core.process(id);
      expect(next.core.snapshot(id).summary!.sourceRevisionIds).toEqual([source().id]);
      expect(next.core.freshness(id).summary).toBe('outdated');
      await next.core.process(id);
      expect(next.core.freshness(id).summary).toBe('current');
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('exposes the same coverage and execution identity over an isolated HTTP snapshot', async () => {
  const h = timed(),
    id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  h.records([source('corrected')]);
  await h.core.collect(id);
  const server = createHttpServer(h.core, new ChangeEvents(), '/nonexistent', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address missing');
    const snapshot = await new Promise<any>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/v1/work-contexts/${id}`,
          headers: { Host: '127.0.0.1:4310' },
        },
        (res) => {
          let body = '';
          res.on('data', (b) => {
            body += b;
          });
          res.on('end', () => {
            expect(res.statusCode).toBe(200);
            resolve(JSON.parse(body));
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(snapshot.coverage).toEqual(h.core.snapshot(id).coverage);
    expect(snapshot.refresh).toEqual(h.core.snapshot(id).refresh);
    const view = presentReturnContext(snapshot);
    expect(view.summaryStatusLabel).toBe('Earlier scope reflected');
    expect(
      view.ranges.find((r) => r.label === 'Updated sources not yet reflected')!.items[0].id,
    ).toBe(source('corrected').id);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not start another model call while shutdown is draining an unknown execution', async () => {
  const h = timed(),
    id = h.connect();
  await h.core.collect(id);
  h.summary.generate = async () => {
    throw new Error('lost response');
  };
  h.summary.resolve = async () => 'unknown';
  await h.core.process(id);
  const resolving = gate();
  h.summary.resolve = async () => {
    resolving.enter();
    await resolving.wait;
    return 'terminated';
  };
  let started = 0;
  h.summary.generate = async (s) => {
    started++;
    return { candidate: candidate(s[0]), model: 'fake' };
  };
  const processing = h.core.process(id);
  await resolving.entered;
  const closing = h.core.close();
  resolving.release();
  await Promise.all([processing, closing]);
  expect(started).toBe(0);
});

it('separates a failed follow-up duration from the displayed successful result', async () => {
  const h = timed(),
    id = h.connect();
  await h.core.collect(id);
  h.advance();
  await h.core.process(id);
  const applied = h.repo.list('job')[0];
  h.repo.put('job', { ...applied, error: 'prior successful job retry history' });
  const valid = h.core.snapshot(id).summary!;
  h.records([source('later scope')]);
  await h.core.collect(id);
  h.summary.generate = async () => {
    h.advance(5000);
    throw new Error('follow-up generation failed');
  };
  await h.core.process(id);
  await h.core.process(id);
  const snapshot = h.core.snapshot(id),
    view = presentReturnContext(snapshot);
  expect(snapshot.refresh!.appliedJobId).toBe(applied.id);
  expect(snapshot.refresh!.latestJobId).not.toBe(applied.id);
  expect(snapshot.summary).toEqual(valid);
  expect(view.processingLabel).toContain('Generation and checking since start 0s');
  expect(view.error).toBe('follow-up generation failed');
  expect(view.priorAttemptError).toBe('prior successful job retry history');
  expect(view.refreshTiming).toContain('10s');
});

it('migrates legacy jobs missing analysis fields without promoting unverifiable candidates', async () => {
  const h = timed(),
    id = h.connect();
  await h.core.collect(id);
  h.summary.check = async () => {
    throw new Error('lost check');
  };
  await h.core.process(id);
  const original = h.repo.list('job')[0];
  // Old deterministic IDs did not include the fixed-input policy version.
  const legacyId = h.core.ids.hash([
    id,
    original.inputVersion,
    original.extractorVersion,
    original.configurationHash,
  ]);
  const legacy = {
    ...original,
    id: legacyId,
    status: 'checking' as const,
    inputSnapshot: undefined,
    analysis: undefined,
    configurationHash: undefined,
  };
  // Use a fresh repository to load just the legacy persisted state.
  const next = harness();
  for (const kind of ['connection', 'work', 'link', 'checkpoint', 'source'] as const)
    for (const entity of h.repo.list(kind)) next.repo.put(kind, entity);
  next.repo.put('job', legacy);
  await next.core.recover();
  await next.core.process(id);
  expect(next.repo.get('job', legacyId)).toMatchObject({
    status: 'superseded',
    candidate: original.candidate,
  });
  expect(next.core.freshness(id).summary).toBe('current');
  expect(next.counts().generationCalls).toBe(1);
  expect(next.repo.list('job')).toHaveLength(2);
});
