import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import type { SourceReader } from '@statecarry/core';
import { DomainError, type SourceRead, type SourceRevision } from '@statecarry/contracts';
import { CodexRpc } from './rpc';
import { identity } from './identity';

const omitted = new Set(['reasoning', 'hookPrompt', 'contextCompaction']);
const USER_ID = /^[A-Za-z0-9_-]+$/;
export function safeId(id: string) {
  if (!USER_ID.test(id) || id.length > 180)
    throw new DomainError('VALIDATION', 'Invalid provider identifier');
  return id;
}
export function sourceText(item: any): { text: string; actor: SourceRevision['actor'] } | null {
  if (omitted.has(item.type)) return null;
  if (item.type === 'userMessage')
    return {
      text: (item.content ?? [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n'),
      actor: 'user',
    };
  if (['agentMessage', 'plan'].includes(item.type))
    return { text: item.text ?? '', actor: 'agent' };
  if (item.type === 'commandExecution')
    return {
      text: `command: ${item.command ?? ''}\nstatus: ${item.status ?? 'unknown'}\nexitCode: ${item.exitCode ?? 'unknown'}\noutput:\n${item.aggregatedOutput ?? ''}`,
      actor: 'tool',
    };
  if (item.type === 'fileChange')
    return { text: JSON.stringify({ changes: item.changes, status: item.status }), actor: 'tool' };
  if (['mcpToolCall', 'dynamicToolCall', 'functionCallOutput'].includes(item.type))
    return {
      text: JSON.stringify({
        tool: item.tool ?? item.name,
        arguments: item.arguments,
        result: item.result ?? item.contentItems ?? item.output,
        error: item.error,
        status: item.status,
      }),
      actor: 'tool',
    };
  return {
    text: JSON.stringify({ type: item.type, status: item.status ?? null }),
    actor: 'system',
  };
}
export type RawRecord = {
  id: string | null;
  turnId: string | null;
  text: string;
  actor: SourceRevision['actor'];
  eventAt: string | null;
  line: number;
  kind: string;
};
export function parseRollout(contents: string): {
  records: RawRecord[];
  limitations: string[];
  sessionId: string | null;
} {
  const lines = contents.split('\n'),
    records: RawRecord[] = [],
    limitations: string[] = [];
  if (lines.at(-1) !== '') {
    lines.pop();
    limitations.push('Incomplete final JSONL line deferred');
  } else lines.pop();
  let turnId: string | null = null,
    sessionId: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    let raw: any;
    try {
      raw = JSON.parse(lines[i]);
    } catch {
      limitations.push(`Invalid JSONL line ${i + 1}`);
      continue;
    }
    const p = raw.payload;
    if (raw.type === 'session_meta') {
      sessionId = p?.id ?? null;
      continue;
    }
    if (raw.type === 'turn_context') {
      turnId = p?.turn_id ?? turnId;
      continue;
    }
    if (raw.type === 'event_msg' && p?.type === 'task_started') {
      turnId = p.turn_id ?? turnId;
      continue;
    }
    if (raw.type !== 'response_item' || !p) continue;
    if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
      const text = (p.content ?? [])
        .filter((c: any) => ['input_text', 'output_text', 'text'].includes(c.type))
        .map((c: any) => c.text)
        .join('\n');
      if (text)
        records.push({
          id: p.id ?? null,
          turnId,
          text,
          actor: p.role === 'user' ? 'user' : 'agent',
          eventAt: raw.timestamp ?? null,
          line: i + 1,
          kind: p.role === 'user' ? 'userMessage' : 'agentMessage',
        });
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      const text = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
      records.push({
        id: p.call_id ?? p.id ?? null,
        turnId,
        text,
        actor: 'tool',
        eventAt: raw.timestamp ?? null,
        line: i + 1,
        kind: 'rawToolOutput',
      });
    }
  }
  return { records, limitations, sessionId };
}

export class CodexReader implements SourceReader {
  constructor(private rpc: Pick<CodexRpc, 'request' | 'close'> = new CodexRpc()) {}
  private knownPaths = new Map<string, string>();
  private files = new Map<string, { size: number; generation: string }>();
  async discover(cwd: string) {
    const threads: { id: string; title: string; cwd: string }[] = [];
    const scopeErrors: string[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>(),
      cursors: (string | null)[] = [];
    const filter = {
      cwd,
      useStateDbOnly: true,
      sourceKinds: ['cli', 'vscode', 'appServer'],
      archived: false,
      sortKey: 'updated_at',
      limit: 50,
    };
    for (let page = 0; page < 50; page++) {
      cursors.push(cursor);
      const result = await this.rpc.request('thread/list', { ...filter, cursor });
      for (const t of result.data ?? []) {
        if (typeof t.cwd !== 'string' || resolve(t.cwd) !== resolve(cwd)) {
          scopeErrors.push('Provider returned a session outside selected folder; excluded');
          continue;
        }
        if (t.path) this.knownPaths.set(t.id, t.path);
        threads.push({ id: t.id, title: t.name || t.preview?.slice(0, 100) || t.id, cwd: t.cwd });
      }
      cursor = result.nextCursor ?? null;
      if (!cursor)
        return {
          threads,
          complete: !scopeErrors.length,
          limitations: scopeErrors,
          manifest: { filter, cursors, complete: !scopeErrors.length },
        };
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    return {
      threads,
      complete: false,
      manifest: { filter, cursors, complete: false },
      limitations: ['Discovery page range incomplete'],
    };
  }
  private async raw(
    threadId: string,
    path: string | null,
    startTurnId?: string,
    metadataOnly = false,
  ) {
    if (!path)
      return {
        records: [] as RawRecord[],
        limitations: ['Local source path unavailable'],
        sessionId: null,
        generation: 'api',
      };
    const root = resolve(process.env.CODEX_HOME ?? `${homedir()}/.codex`),
      absolute = resolve(path);
    const rel = relative(root, absolute);
    if (
      rel.startsWith('..') ||
      !/^(sessions|archived_sessions)\//.test(rel) ||
      !absolute.endsWith('.jsonl')
    )
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'Provider path is outside the expected record directory',
      );
    const info = await stat(absolute);
    if (info.size > 96 * 1024 * 1024)
      throw new DomainError('SOURCE_UNAVAILABLE', 'Local source exceeds the 96 MiB read limit');
    const prior = this.files.get(threadId);
    let generation = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
    const turns: { id: string; at: string | null }[] = [];
    let parsed: ReturnType<typeof parseRollout>;
    if (startTurnId || metadataOnly) {
      let sessionId: string | null = null,
        active = false,
        found = false,
        lineNumber = 0;
      const records: RawRecord[] = [],
        limitations: string[] = [];
      const stream = createReadStream(absolute, { encoding: 'utf8' });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let bytes = 0,
        currentTurn: string | null = null;
      try {
        for await (const line of lines) {
          lineNumber++;
          bytes += Buffer.byteLength(line) + 1;
          if (bytes > info.size) {
            limitations.push('Incomplete final JSONL line deferred');
            break;
          }
          // Inspect only boundary envelopes until the approved starting turn. Never project earlier bodies.
          const envelopeType = /"type"\s*:\s*"([^"\\]+)"/.exec(line)?.[1];
          if (
            envelopeType === 'session_meta' ||
            envelopeType === 'turn_context' ||
            (envelopeType === 'event_msg' && /"type"\s*:\s*"task_started"/.test(line))
          ) {
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              throw new DomainError('SOURCE_UNAVAILABLE', 'Invalid source boundary');
            }
            if (event.type === 'session_meta') sessionId = event.payload?.id ?? null;
            const id =
              event.type === 'turn_context'
                ? event.payload?.turn_id
                : event.type === 'event_msg' && event.payload?.type === 'task_started'
                  ? event.payload?.turn_id
                  : null;
            if (id) {
              safeId(id);
              currentTurn = id;
              if (!turns.some((t) => t.id === id)) turns.push({ id, at: event.timestamp ?? null });
              if (id === startTurnId) found = true;
              active =
                found &&
                turns.findIndex((t) => t.id === id) >= turns.findIndex((t) => t.id === startTurnId);
            }
          }
          if (!metadataOnly && active && currentTurn) {
            const part = parseRollout(
              JSON.stringify({ type: 'turn_context', payload: { turn_id: currentTurn } }) +
                '\n' +
                line +
                '\n',
            );
            records.push(...part.records.map((r) => ({ ...r, line: lineNumber })));
            limitations.push(...part.limitations);
          }
        }
      } finally {
        lines.close();
        stream.destroy();
      }
      if (!metadataOnly && !found)
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'Selected start turn is missing; no records collected',
        );
      parsed = { records, limitations, sessionId };
    } else parsed = parseRollout(await readFile(absolute, 'utf8'));
    if (parsed.sessionId !== threadId)
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'Local record session id differs from the requested target',
      );
    if (prior && info.size < prior.size) {
      parsed.limitations.push('Source file shrank; prior history is retained');
      generation += `:replacement:${identity.hash(parsed.records.map((r) => r.id))}`;
    }
    if (
      prior &&
      prior.generation.split(':replacement:')[0] !== generation.split(':replacement:')[0]
    )
      parsed.limitations.push('Source file generation changed; prior history is retained');
    this.files.set(threadId, { size: info.size, generation });
    return { ...parsed, generation, turns };
  }
  async listTurns(threadId: string) {
    safeId(threadId);
    const { thread } = await this.rpc.request('thread/read', { threadId, includeTurns: false });
    if (thread.id !== threadId)
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'Returned thread does not match requested target',
      );
    if (!thread.path) throw new DomainError('SOURCE_UNAVAILABLE', 'Local turn list unavailable');
    const result = await this.raw(threadId, thread.path, undefined, true);
    return { turns: 'turns' in result ? result.turns : [] };
  }
  async read(threadId: string, startTurnId?: string): Promise<SourceRead> {
    safeId(threadId);
    if (startTurnId) safeId(startTurnId);
    const observedAt = new Date().toISOString();
    let thread: any,
      apiError: string | null = null;
    try {
      const response = await this.rpc.request('thread/read', {
        threadId,
        includeTurns: !startTurnId,
      });
      thread = response.thread;
      if (thread.id !== threadId)
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'Returned thread does not match requested target',
        );
      if (thread.path) this.knownPaths.set(threadId, thread.path);
    } catch (e) {
      if (e instanceof DomainError) throw e;
      apiError = e instanceof Error ? e.message : String(e);
      if (!this.knownPaths.has(threadId)) throw e;
      thread = {
        id: threadId,
        turns: [],
        path: this.knownPaths.get(threadId),
        cwd: '',
        name: threadId,
      };
    }
    const path = thread.path ?? this.knownPaths.get(threadId) ?? null;
    let raw: Awaited<ReturnType<CodexReader['raw']>>;
    try {
      raw = await this.raw(threadId, path, startTurnId);
    } catch (e) {
      if (e instanceof DomainError) throw e;
      raw = {
        records: [],
        limitations: [`Local locator unavailable: ${String(e)}`],
        sessionId: null,
        generation: 'api',
      };
    }
    if (startTurnId && (!path || !raw.records.some((r) => r.turnId === startTurnId)))
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'Selected start turn has no readable local records',
      );
    if (startTurnId) {
      thread.turns = [];
      apiError = 'Selected range uses local JSONL only';
    }
    const limitations = [
      ...raw.limitations,
      ...(apiError
        ? [`API unavailable; known JSONL only: ${apiError}`, 'Turn state coverage unavailable']
        : []),
    ];
    const revisions: SourceRevision[] = [],
      matched = new Set<number>();
    const add = (
      kind: string,
      itemId: string,
      turnId: string,
      actor: SourceRevision['actor'],
      text: string,
      turnStatus: string,
      sourceStatus: string | null,
      record?: RawRecord,
      pathKind: 'api' | 'jsonl' = 'api',
    ) => {
      const itemLimitations: string[] = apiError
        ? [
            'Tool result and turn state coverage are partial in this local JSONL read; missing execution details do not establish completion.',
          ]
        : [];
      // Retain the accessible text. Larger records remain evidence-readable; summary input is chunked separately.
      if (text.length > 2_000_000) {
        text = text.slice(0, 2_000_000);
        itemLimitations.push('Source item exceeds 2,000,000 characters; remainder not collected');
      }
      if (/<<ccr:|\[\d+ words compressed|truncated output|_ccr_dropped/.test(text))
        itemLimitations.push('Provider output contains compression or truncation markers');
      const key = ['codex', 'local', threadId, turnId, itemId, pathKind].join(':');
      // Coverage is part of an immutable revision, including when a scoped read replaces an older projection.
      const contentHash = identity.hash({
        text,
        turnStatus,
        sourceStatus,
        actor,
        eventAt: record?.eventAt ?? null,
        ...(apiError ? { coverage: 'local-only-v1' } : {}),
      });
      revisions.push({
        id: identity.hash([key, contentHash]),
        key,
        provider: 'codex',
        host: 'local',
        threadId,
        turnId,
        itemId,
        actor,
        kind,
        text,
        contentHash,
        eventAt: record?.eventAt ?? null,
        observedAt,
        locator: {
          path,
          line: record?.line ?? null,
          aliases: record?.id && record.id !== itemId ? [record.id] : [],
        },
        turnStatus,
        sourceStatus,
        pathKind,
        limitations: itemLimitations,
      });
    };
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) {
        const projected = sourceText(item);
        if (!projected) continue;
        const record = raw.records.find(
          (r) =>
            !matched.has(r.line) &&
            r.turnId === turn.id &&
            r.actor === projected.actor &&
            (r.id === item.id || r.text.trim() === projected.text.trim()),
        );
        if (record) matched.add(record.line);
        const itemId = item.id ?? `unstable:${item.type}:${identity.hash(projected.text)}`;
        add(
          item.type,
          itemId,
          turn.id,
          projected.actor,
          projected.text,
          turn.status,
          item.status ?? null,
          record,
        );
      }
      add(
        'turnStatus',
        `turn:${turn.id}`,
        turn.id,
        'system',
        JSON.stringify({ status: turn.status, error: turn.error ?? null }),
        turn.status,
        null,
      );
    }
    // Supplement only raw messages and tool outputs not represented by the API; aliases retain provenance.
    for (const r of raw.records) {
      if (matched.has(r.line) || !r.turnId) continue;
      if (r.actor === 'tool' && !apiError) continue; // API has typed tool results; do not duplicate differently shaped outputs.
      add(
        r.kind,
        r.id ?? `line:${raw.generation}:${r.line}`,
        r.turnId,
        r.actor,
        r.text,
        'unknown',
        null,
        r,
        'jsonl',
      );
    }
    if (!revisions.length)
      limitations.push('No readable source items; absence of work is not established');
    limitations.push(...new Set(revisions.flatMap((s) => s.limitations)));
    const fingerprint = identity.hash(revisions.map((s) => s.id));
    return {
      threadId,
      title: thread.name || thread.preview?.slice(0, 100) || threadId,
      cwd: thread.cwd ?? '',
      path,
      revisions,
      status: limitations.length ? 'partial' : 'checked',
      limitations,
      observedAt,
      generation: raw.generation,
      manifest: {
        method: apiError ? 'known-jsonl-fallback' : 'thread/read+jsonl-locators',
        filter: { threadId, includeTurns: true, excluded: [...omitted] },
        itemCount: revisions.length,
        turnCount: thread.turns?.length ?? 0,
        fingerprint,
      },
    };
  }
  async close() {
    await this.rpc.close();
  }
}
