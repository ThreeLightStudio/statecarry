import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

it('passes the optional refresh output language through HTTP and defaults to English', async () => {
  const h = harness();
  const workId = h.connect();
  const refresh = vi.spyOn(h.core.resumes, 'refresh').mockResolvedValue(undefined);
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  const post = (value: unknown) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/v1/resume/${workId}/refresh`,
          method: 'POST',
          headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(value));
    });
  try {
    expect(await post({ outputLanguage: 'ko' })).toEqual({ status: 202, body: { accepted: true } });
    expect(refresh).toHaveBeenLastCalledWith(workId, 'ko');
    expect(await post({})).toEqual({ status: 202, body: { accepted: true } });
    expect(refresh).toHaveBeenLastCalledWith(workId, 'en');
    const invalid = await post({ outputLanguage: 'ja' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION');
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('localizes a saved overview through HTTP without starting a refresh', async () => {
  const h = harness();
  const workId = h.connect();
  const refresh = vi.spyOn(h.core.resumes, 'refresh').mockResolvedValue(undefined);
  const localize = vi
    .spyOn(h.core.resumes, 'localize')
    .mockResolvedValue(h.core.resumes.view(workId));
  const server = createHttpServer(h.core, new ChangeEvents(), '/tmp/no-web', 4310);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: `/api/v1/resume/${workId}/localize`,
        method: 'POST',
        headers: { Host: '127.0.0.1:4310', 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ outputLanguage: 'ko' }));
  });
  try {
    expect(response).toEqual({ status: 200, body: { localized: true, outputLanguage: 'ko' } });
    expect(localize).toHaveBeenCalledExactlyOnceWith(workId, 'ko');
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('sends Korean generation instructions while restoring evidence in its original language', async () => {
  const summary = new CodexSummary('/tmp/statecarry-language-test');
  let instructions = '';
  (summary as any).preflight = async () => {};
  (summary as any).run = async (
    _prompt: string,
    _schema: unknown,
    _onRemote: unknown,
    _phase: string,
    valueInstructions: string,
  ) => {
    instructions = valueInstructions;
    return {
      value: {
        candidates: [
          {
            key: 'export-review',
            goal: '내보내기 구현 확인',
            currentState: '내보내기 구현이 기록되어 있으며 현재 상태를 확인해야 합니다.',
            status: 'active',
            reason: '현재 코드 상태를 확인해야 다음 작업을 안전하게 정할 수 있습니다.',
            nextAction: '내보내기 구현 상태를 확인합니다.',
            actionSource: 'suggested',
            doneWhen: '현재 구현 상태가 확인됩니다.',
            threadId: 'thread-a',
            prerequisites: ['연결된 프로젝트 파일을 확인합니다.'],
            evidence: [{ ref: 'R1' }],
            progress: { reported: [{ ref: 'R1' }], implemented: [], verified: [] },
            completion: { reported: [], verified: [] },
          },
        ],
      },
    };
  };
  const evidence = 'Original English evidence must remain unchanged.';
  const result = await summary.generateResume({
    outputLanguage: 'ko',
    records: [{ revisionId: 'r1', text: evidence, threadId: 'thread-a', actor: 'user' }],
  });
  expect(instructions).toContain('natural Korean');
  expect(instructions).not.toContain('complete short English sentences');
  expect(result.candidates[0].evidence).toEqual([{ revisionId: 'r1', quote: evidence }]);
  expect(result.candidates[0].progress?.reported).toEqual([{ revisionId: 'r1', quote: evidence }]);
});

it('rejects English generated explanation fields for a Korean overview request', async () => {
  const summary = new CodexSummary('/tmp/statecarry-language-validation-test');
  (summary as any).preflight = async () => {};
  (summary as any).run = async () => ({
    value: {
      candidates: [
        {
          key: 'english-output',
          goal: 'Review export implementation',
          currentState: 'The implementation is ready for review.',
          status: 'active',
          reason: 'The current implementation needs review.',
          nextAction: 'Review the implementation.',
          actionSource: 'suggested',
          doneWhen: 'The implementation is reviewed.',
          threadId: 'thread-a',
          prerequisites: [],
          evidence: [{ ref: 'R1' }],
          progress: { reported: [], implemented: [], verified: [] },
          completion: { reported: [], verified: [] },
        },
      ],
    },
  });
  await expect(
    summary.generateResume({
      outputLanguage: 'ko',
      records: [
        {
          revisionId: 'r1',
          text: 'Keep this exact evidence.',
          threadId: 'thread-a',
          actor: 'user',
        },
      ],
    }),
  ).rejects.toThrow(/Korean overview/);
});

it('allows code-only individual fields when the Korean candidate is explanatory overall', async () => {
  const summary = new CodexSummary('/tmp/statecarry-language-code-field-test');
  (summary as any).preflight = async () => {};
  (summary as any).run = async () => ({
    value: {
      candidates: [
        {
          key: 'code-field',
          goal: '내보내기 경로를 확인합니다',
          currentState: '현재 구현이 준비되어 있으며 마지막 경로 확인이 남았습니다.',
          status: 'active',
          reason: '현재 코드 위치를 확인하면 다음 변경 범위를 확정할 수 있습니다.',
          nextAction: 'src/export.ts',
          actionSource: 'suggested',
          doneWhen: 'src/export.ts',
          threadId: 'thread-a',
          prerequisites: ['pnpm test'],
          evidence: [{ ref: 'R1' }],
          progress: { reported: [], implemented: [], verified: [] },
          completion: { reported: [], verified: [] },
        },
      ],
    },
  });
  await expect(
    summary.generateResume({
      outputLanguage: 'ko',
      records: [{ revisionId: 'r1', text: 'Keep exact.', threadId: 'thread-a', actor: 'user' }],
    }),
  ).resolves.toMatchObject({
    candidates: [expect.objectContaining({ nextAction: 'src/export.ts' })],
  });
});

it('localizes only explanatory fields and keeps localization input free of evidence', async () => {
  const summary = new CodexSummary('/tmp/statecarry-localize-provider-test');
  let prompt = '';
  let instructions = '';
  (summary as any).preflight = async () => {};
  (summary as any).run = async (
    valuePrompt: string,
    _schema: unknown,
    _onRemote: unknown,
    _phase: string,
    valueInstructions: string,
  ) => {
    prompt = valuePrompt;
    instructions = valueInstructions;
    return {
      value: {
        candidates: [
          {
            key: 'same-key',
            goal: '내보내기를 확인합니다',
            currentState: '내보내기 구현이 준비되어 있습니다.',
            reason: '마지막 확인이 남아 있습니다.',
            nextAction: 'src/export.ts',
            doneWhen: '검토가 완료됩니다',
            prerequisites: ['pnpm test'],
          },
        ],
      },
    };
  };
  const result = await summary.localizeResume({
    outputLanguage: 'ko',
    candidates: [
      {
        key: 'same-key',
        goal: 'Review export',
        currentState: 'The export is ready.',
        reason: 'One review remains.',
        nextAction: 'src/export.ts',
        doneWhen: 'The review is complete',
        prerequisites: ['pnpm test'],
      },
    ],
  });
  expect(prompt).not.toContain('evidence');
  expect(instructions).toContain('complete, grammatical sentence ending in ., !, or ?');
  expect(result.candidates[0]).toMatchObject({ key: 'same-key', nextAction: 'src/export.ts' });
});

it('repairs a clipped English current state without adding evidence or re-analysis input', async () => {
  const summary = new CodexSummary('/tmp/statecarry-localize-repair-test');
  const run = vi.fn();
  let calls = 0;
  (summary as any).preflight = async () => {};
  (summary as any).run = run.mockImplementation(async (prompt: string) => {
    calls++;
    expect(prompt).not.toContain('evidence');
    return {
      value: {
        candidates: [
          {
            key: 'same-key',
            goal: 'Review the export',
            currentState:
              calls === 1
                ? `${'Current project state '.repeat(9)}the¿?`
                : 'The export implementation is ready, while final verification remains open.',
            reason: 'Final verification remains.',
            nextAction: 'src/export.ts',
            doneWhen: 'The review is complete.',
            prerequisites: ['pnpm test'],
          },
        ],
      },
    };
  });
  const result = await summary.localizeResume({
    outputLanguage: 'en',
    candidates: [
      {
        key: 'same-key',
        goal: '내보내기를 확인합니다',
        currentState: '내보내기 구현이 준비되어 있으며 최종 검증이 남았습니다.',
        reason: '최종 검증이 남았습니다.',
        nextAction: 'src/export.ts',
        doneWhen: '검토가 완료됩니다.',
        prerequisites: ['pnpm test'],
      },
    ],
  });
  expect(run).toHaveBeenCalledTimes(2);
  expect(result.candidates[0].currentState).toBe(
    'The export implementation is ready, while final verification remains open.',
  );
});

it('persists localized text and language while preserving candidate evidence and identity', async () => {
  const h = harness();
  const id = h.connect();
  const record = (await h.reader.read('thread-a')).revisions[0];
  h.records([record]);
  const original = {
    key: 'same-key',
    goal: 'Review export',
    currentState: 'The export is ready for review.',
    status: 'active' as const,
    reason: 'One review remains.',
    nextAction: 'Review export',
    actionSource: 'recorded' as const,
    doneWhen: 'Review is complete',
    threadId: record.threadId,
    prerequisites: ['Use the project'],
    evidence: [{ revisionId: record.id, quote: record.text }],
    progress: { reported: [{ revisionId: record.id, quote: record.text }] },
    completion: { reported: [], verified: [] },
  };
  h.summary.generateResume = async () => ({ candidates: [original] });
  await h.core.resumes.refresh(id, 'en');
  const before = structuredClone(h.core.work(id).resume!);
  const generate = vi.spyOn(h.summary, 'generateResume');
  (h.summary as any).localizeResume = vi.fn(async () => ({
    candidates: [
      {
        key: original.key,
        goal: '내보내기를 검토합니다',
        currentState: '내보내기가 검토 준비 상태입니다.',
        reason: '마지막 검토가 남아 있습니다.',
        nextAction: '내보내기를 검토합니다',
        doneWhen: '검토가 완료됩니다',
        prerequisites: ['프로젝트를 사용합니다'],
      },
    ],
  }));
  await h.core.resumes.localize(id, 'ko');
  const after = h.core.work(id).resume!;
  expect(after.outputLanguage).toBe('ko');
  expect(after.scope).toBe(before.scope);
  expect(after.version).toBe(before.version);
  expect(after.generatedAt).toBe(before.generatedAt);
  expect(after.workspaceBefore).toEqual(before.workspaceBefore);
  expect(after.workspaceAfter).toEqual(before.workspaceAfter);
  expect(after.candidates[0]).toMatchObject({
    key: original.key,
    status: original.status,
    actionSource: original.actionSource,
    threadId: original.threadId,
    evidence: original.evidence,
    progress: original.progress,
    completion: original.completion,
  });
  expect(after.candidates[0].goal).toBe('내보내기를 검토합니다');
  expect(generate).toHaveBeenCalledTimes(0);
  expect(h.core.resumes.view(id).outputLanguage).toBe('ko');
});

it('keeps English as the provider default when outputLanguage is omitted', async () => {
  const summary = new CodexSummary('/tmp/statecarry-language-default-test');
  let instructions = '';
  (summary as any).preflight = async () => {};
  (summary as any).run = async (
    _prompt: string,
    _schema: unknown,
    _onRemote: unknown,
    _phase: string,
    valueInstructions: string,
  ) => {
    instructions = valueInstructions;
    return {
      value: {
        candidates: [
          {
            key: 'english-default',
            goal: 'Review export implementation',
            currentState: 'The implementation is ready for review.',
            status: 'active',
            reason: 'The current implementation needs review.',
            nextAction: 'Review the implementation.',
            actionSource: 'suggested',
            doneWhen: 'The implementation is reviewed.',
            threadId: 'thread-a',
            prerequisites: [],
            evidence: [{ ref: 'R1' }],
            progress: { reported: [], implemented: [], verified: [] },
            completion: { reported: [], verified: [] },
          },
        ],
      },
    };
  };
  const result = await summary.generateResume({
    records: [
      { revisionId: 'r1', text: 'Original evidence.', threadId: 'thread-a', actor: 'user' },
    ],
  });
  expect(instructions).toContain('clear English');
  expect(result.candidates[0].goal).toBe('Review export implementation');
});
