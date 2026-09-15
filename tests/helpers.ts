import { identity } from '../apps/server/src/adapters/identity';
import {
  StateCarry,
  type StateRepository,
  type Entities,
  type SourceReader,
  type SummaryProvider,
  type Navigator,
  type Clock,
  type SessionExecutor,
} from '@statecarry/core';
import type { Candidate, SourceRevision, SourceRead } from '@statecarry/contracts';
export class MemoryRepository implements StateRepository {
  data = new Map<string, unknown>();
  fail = false;
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] | null {
    return structuredClone((this.data.get(`${kind}:${id}`) as Entities[K]) ?? null);
  }
  list<K extends keyof Entities>(kind: K): Entities[K][] {
    return [...this.data.entries()]
      .filter(([k]) => k.startsWith(`${kind}:`))
      .map(([, v]) => structuredClone(v) as Entities[K]);
  }
  put<K extends keyof Entities>(kind: K, e: Entities[K]) {
    if (this.fail) throw new Error('injected commit failure');
    this.data.set(`${kind}:${e.id}`, structuredClone(e));
  }
  transaction<T>(fn: () => T): T {
    const before = structuredClone(this.data);
    try {
      return fn();
    } catch (e) {
      this.data = before;
      throw e;
    }
  }
}
export const AT = '2026-09-08T13:35:01.780Z';
export function source(
  text = '원문에 기록된 목적과 다음 단계',
  threadId = 'thread-a',
  itemId = 'item-a',
): SourceRevision {
  const key = `${threadId}:turn-a:${itemId}`,
    contentHash = identity.hash(text);
  return {
    id: identity.hash([key, contentHash]),
    key,
    provider: 'codex',
    host: 'local',
    threadId,
    turnId: 'turn-a',
    itemId,
    kind: 'userMessage',
    actor: 'user',
    text,
    contentHash,
    eventAt: AT,
    observedAt: AT,
    locator: { path: null, line: null, aliases: [] },
    turnStatus: 'completed',
    sourceStatus: null,
    pathKind: 'api',
    limitations: [],
  };
}
export function read(sources: SourceRevision[]): SourceRead {
  return {
    threadId: sources[0]?.threadId ?? 'thread-a',
    title: '기록 A',
    cwd: '/tmp/example',
    path: null,
    revisions: sources,
    status: 'checked',
    limitations: [],
    observedAt: AT,
    generation: 'one',
    manifest: {
      method: 'fake',
      filter: {},
      itemCount: sources.length,
      turnCount: 1,
      fingerprint: identity.hash(sources.map((s) => s.id)),
    },
  };
}
export function candidate(s: SourceRevision): Candidate {
  return {
    claims: (['purpose', 'current', 'direction', 'next', 'reason'] as const).map((slot) => ({
      id: slot,
      slot,
      text: s.text,
      nature: 'user-request' as const,
      evidence: [{ revisionId: s.id, quote: s.text }],
      condition: null,
      missing: null,
    })),
    limitations: [],
  };
}
export function harness(
  repo: StateRepository = new MemoryRepository(),
  clock: Clock = { now: () => AT },
  sessionExecutor?: SessionExecutor,
) {
  let records = [source()],
    generationCalls = 0,
    checkCalls = 0,
    openCalls = 0;
  const reader: SourceReader = {
    read: async () => read(records),
    discover: async () => ({ threads: [], complete: true, limitations: [] }),
    close: async () => {},
  };
  const summary: SummaryProvider = {
    configuration: () => ({
      model: 'fake',
      summaryEffort: 'medium',
      checkEffort: 'medium',
      promptVersion: 'fake-1',
    }),
    capability: () => ({ state: 'ready', detail: 'fake provider', model: 'fake' }),
    generate: async (s) => {
      generationCalls++;
      return { candidate: candidate(s[0]), model: 'fake' };
    },
    check: async (c) => {
      checkCalls++;
      return {
        checks: c.claims.map((c) => ({
          claimId: c.id,
          verdict: 'supported',
          reason: 'fake check',
        })),
      };
    },
    resolve: async () => 'terminated',
    close: async () => {},
  };
  const navigator: Navigator = {
    capability: () => ({ precision: 'thread', verifiedAt: AT, detail: 'fake navigator' }),
    open: async () => {
      openCalls++;
    },
  };
  const core = new StateCarry(
    repo,
    reader,
    summary,
    navigator,
    clock,
    identity,
    { changed() {} },
    sessionExecutor,
  );
  const connect = () =>
    core.connect({
      requestId: identity.next(),
      expectedRevision: 0,
      payload: {
        title: '프로젝트 A',
        cwd: '/tmp/example',
        threadIds: ['thread-a'],
        discover: false,
      },
    }).workId;
  return {
    core,
    repo,
    reader,
    summary,
    navigator,
    connect,
    records: (s: SourceRevision[]) => {
      records = s;
    },
    counts: () => ({ generationCalls, checkCalls, openCalls }),
    command: (workId: string, payload: Record<string, unknown>) => ({
      requestId: identity.next(),
      expectedRevision: core.work(workId).revision,
      payload,
    }),
  };
}
