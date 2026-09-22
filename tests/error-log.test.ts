import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DomainError, projectProfileSchema } from '@statecarry/contracts';
import { StateCarry, type ErrorReporter } from '@statecarry/core';
import { reportServerError } from '../apps/server/src/error-log';
import { ChangeEvents, createHttpServer } from '../apps/server/src/http';
import { harness } from './helpers';

beforeEach(() => vi.stubEnv('NO_COLOR', '1'));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('uses muted red when color is forced and resets it after each error', () => {
  vi.stubEnv('NO_COLOR', undefined);
  vi.stubEnv('FORCE_COLOR', '1');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  reportServerError(new Error('Example failure'), { operation: 'test' });
  expect(log.mock.calls[0][0]).toBe('\x1b[38;5;174m[statecarry:error]');
  expect(log.mock.calls[0][1]).toMatch(/\x1b\[0m$/);
  expect(JSON.parse(log.mock.calls[0][1].replace(/\x1b\[0m$/, '')).message).toBe('Example failure');
});

it.each(['NO_COLOR', 'FORCE_COLOR'] as const)(
  'honors the %s opt-out without escape codes',
  (option) => {
    vi.stubEnv('NO_COLOR', option === 'NO_COLOR' ? '1' : undefined);
    vi.stubEnv('FORCE_COLOR', option === 'FORCE_COLOR' ? '0' : '1');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportServerError(new Error('Example failure'), { operation: 'test' });
    expect(log.mock.calls[0][0]).toBe('[statecarry:error]');
    expect(log.mock.calls[0][1]).not.toContain('\x1b');
  },
);

it('logs bounded error details and codes while masking credentials', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const secret = 'sk-syntheticsecret0123456789';
  reportServerError(
    new DomainError('SUMMARY_UNAVAILABLE', `Provider failed: ${secret} password=private-value`),
    { operation: 'project-analysis', projectId: 'example' },
  );
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0][0]).toBe('[statecarry:error]');
  const entry = JSON.parse(log.mock.calls[0][1]);
  expect(entry).toMatchObject({
    operation: 'project-analysis',
    projectId: 'example',
    code: 'SUMMARY_UNAVAILABLE',
  });
  expect(entry.message).toContain('Provider failed');
  expect(JSON.stringify(entry)).not.toContain(secret);
  expect(JSON.stringify(entry)).not.toContain('private-value');
  reportServerError(new Error('x'.repeat(10000)), { operation: 'test' });
  expect(JSON.parse(log.mock.calls[1][1]).message).toHaveLength(4000);
});

it('reports validation paths without serializing the invalid input', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = projectProfileSchema.safeParse({
    title: 'Example',
    purpose: '',
    focused: 'private-input-value',
  });
  if (result.success) throw new Error('Expected invalid fixture');
  reportServerError(result.error, { operation: 'project-analysis' });
  const entry = JSON.parse(log.mock.calls[0][1]);
  expect(entry).toMatchObject({
    code: 'VALIDATION',
    issues: [{ path: ['focused'], code: 'invalid_type' }],
  });
  expect(JSON.stringify(entry)).not.toContain('private-input-value');
});

function failingCore(reporter: ErrorReporter) {
  const h = harness();
  const id = h.connect();
  const failure = new DomainError('SUMMARY_UNAVAILABLE', 'Synthetic provider failure', 503);
  h.summary.generateAnalysis = vi.fn(async () => {
    throw failure;
  });
  const core = new StateCarry(
    h.repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    h.core.ids,
    h.core.events,
    undefined,
    undefined,
    reporter,
  );
  return { core, id, failure };
}

it('reports the original asynchronous analysis failure without rejecting or leaving work busy', async () => {
  const reporter = vi.fn();
  const { core, id, failure } = failingCore(reporter);
  await core.analyses.refresh(id);
  expect(reporter).toHaveBeenCalledExactlyOnceWith(failure, {
    operation: 'project-analysis',
    projectId: id,
  });
  expect(core.analyses.view(id)).toMatchObject({
    busy: false,
    error: 'Synthetic provider failure',
  });
});

it('preserves failure recovery even if the diagnostic sink throws', async () => {
  const { core, id } = failingCore(() => {
    throw new Error('Diagnostic sink unavailable');
  });
  await expect(core.analyses.refresh(id)).resolves.toBeUndefined();
  expect(core.analyses.view(id).busy).toBe(false);
});

it('logs the initialization HTTP code and its original cause without changing the response', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { core, id } = failingCore(reportServerError);
  const server = createHttpServer(core, new ChangeEvents(), '/tmp/no-web', 0);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  try {
    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/v1/projects/${id}/initialize?token=private-query-value`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(response).toEqual({
      status: 503,
      body: {
        error: { code: 'PROJECT_INITIALIZATION_FAILED', message: 'Synthetic provider failure' },
      },
    });
    const entries = log.mock.calls.map((call) => JSON.parse(call[1]));
    expect(entries).toEqual([
      expect.objectContaining({
        operation: 'project-analysis',
        code: 'SUMMARY_UNAVAILABLE',
        projectId: id,
      }),
      expect.objectContaining({
        operation: 'http-request',
        code: 'PROJECT_INITIALIZATION_FAILED',
        method: 'POST',
        status: 503,
        path: `/api/v1/projects/${id}/initialize`,
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('private-query-value');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
