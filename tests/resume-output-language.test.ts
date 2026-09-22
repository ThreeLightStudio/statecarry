import { once } from 'node:events';
import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

it('passes the optional refresh output language through HTTP and leaves the default to the project', async () => {
  const h = harness();
  const projectId = h.connect();
  const refresh = vi.spyOn(h.core.analyses, 'refresh').mockResolvedValue(undefined);
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
          path: `/api/v1/projects/${projectId}/analysis/refresh`,
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
    expect(refresh).toHaveBeenLastCalledWith(projectId, 'ko');
    expect(await post({})).toEqual({ status: 202, body: { accepted: true } });
    expect(refresh).toHaveBeenLastCalledWith(projectId, undefined);
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
  const projectId = h.connect();
  const refresh = vi.spyOn(h.core.analyses, 'refresh').mockResolvedValue(undefined);
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
        path: `/api/v1/projects/${projectId}/analysis/localize`,
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
    expect(response.status).toBe(404);
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
            recentWork: '내보내기 구현을 정리하고 현재 검토 상태를 확인했습니다.',
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
  const result = await summary.generateAnalysis({
    outputLanguage: 'ko',
    records: [{ revisionId: 'r1', text: evidence, threadId: 'thread-a', actor: 'user' }],
  });
  expect(instructions).toContain('natural Korean');
  expect(instructions).toContain('recentWork');
  expect(instructions).not.toContain('complete short English sentences');
  expect(result.candidates[0].evidence).toEqual([{ revisionId: 'r1', quote: evidence }]);
  expect(result.candidates[0].progress?.reported).toEqual([{ revisionId: 'r1', quote: evidence }]);
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
    summary.generateAnalysis({
      outputLanguage: 'ko',
      records: [{ revisionId: 'r1', text: 'Keep exact.', threadId: 'thread-a', actor: 'user' }],
    }),
  ).resolves.toMatchObject({
    candidates: [expect.objectContaining({ nextAction: 'src/export.ts' })],
  });
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
  const result = await summary.generateAnalysis({
    records: [
      { revisionId: 'r1', text: 'Original evidence.', threadId: 'thread-a', actor: 'user' },
    ],
  });
  expect(instructions).toContain('clear English');
  expect(result.candidates[0].goal).toBe('Review export implementation');
});
