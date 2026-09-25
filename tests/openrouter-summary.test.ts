import { describe, expect, it, vi } from 'vitest';
import { DomainError, observationSchema } from '@statecarry/contracts';
import { OpenRouterSummary } from '../apps/server/src/adapters/openrouter-summary';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function completionBody(content: string, model = 'openrouter/free') {
  return {
    id: 'gen-1',
    model,
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

type CapturedRequest = { url: string; headers: Record<string, unknown>; body: any };

function fetchMock(handler: (url: string, request: number) => Response | Promise<Response>) {
  const requests: CapturedRequest[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = String(url);
    requests.push({
      url: urlText,
      headers: (init?.headers ?? {}) as Record<string, unknown>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return handler(urlText, requests.length);
  });
  return { impl, requests };
}

function summary(
  fetchImpl: ReturnType<typeof fetchMock>['impl'],
  apiKey: string | null = 'sk-or-v1-test-key',
) {
  return new OpenRouterSummary(
    '/tmp/statecarry-openrouter-test',
    { model: 'openrouter/free', summaryEffort: 'medium', checkEffort: 'medium' },
    { apiKey, fetchImpl },
  );
}

const schema = observationSchema;
type RunFn = (
  prompt: string,
  schema: unknown,
  onRemote: () => void,
  phase: string,
  instructions?: string,
) => Promise<{ value: unknown; model: string }>;
const runOnce = async (s: OpenRouterSummary, prompt = 'hello') =>
  (s as unknown as { run: RunFn }).run(prompt, schema, () => {}, 'resume');

describe('OpenRouter summary provider', () => {
  it('reports a missing key as failed capability without network calls', () => {
    const { impl } = fetchMock(() => {
      throw new Error('unexpected network call');
    });
    const s = summary(impl, null);
    const capability = s.capability();
    expect(capability.state).toBe('failed');
    expect(capability.provider).toBe('openrouter');
    expect(capability.detail).toContain('Add your OpenRouter API key in Settings');
    expect(impl).not.toHaveBeenCalled();
  });

  it('verifies the key once and reports readiness', async () => {
    const { impl, requests } = fetchMock((url) => {
      expect(url.endsWith('/key')).toBe(true);
      return jsonResponse(200, { data: { label: 'statecarry' } });
    });
    const s = summary(impl);
    await s.preflight();
    const capability = s.capability();
    expect(capability.state).toBe('ready');
    expect(capability.model).toBe('openrouter/free');
    expect(requests[0].headers.Authorization).toBe('Bearer sk-or-v1-test-key');
    await s.preflight();
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('maps an invalid key to a durable failed state', async () => {
    const { impl } = fetchMock(() => jsonResponse(401, { error: { message: 'Invalid key' } }));
    const s = summary(impl);
    await expect(s.preflight()).rejects.toBeInstanceOf(DomainError);
    const capability = s.capability();
    expect(capability.state).toBe('failed');
    expect(capability.detail).toContain('Invalid key');
  });

  it('sends one strict-JSON chat request and decodes the resume analysis', async () => {
    const candidateResponse = {
      candidates: [
        {
          key: 'goal-a',
          goal: 'Ship the export feature',
          currentState: 'The export path works and tests pass.',
          status: 'active',
          reason: 'The last change completed the export path.',
          nextAction: 'Verify the export on a clean workspace.',
          actionSource: 'suggested',
          doneWhen: 'The export succeeds on a clean workspace.',
          threadId: 'r1',
          prerequisites: [],
          evidence: [{ ref: 'R1' }],
          progress: { reported: [], implemented: [], verified: [] },
          completion: { reported: [], verified: [] },
        },
      ],
    };
    const { impl, requests } = fetchMock((url) =>
      url.endsWith('/key')
        ? jsonResponse(200, { data: {} })
        : jsonResponse(200, completionBody(JSON.stringify(candidateResponse))),
    );
    const s = summary(impl);
    const result = await s.generateAnalysis({
      records: [{ revisionId: 'r1', text: 'Recorded hello world', threadId: 'r1', actor: 'user' }],
    });
    expect(result.candidates[0].evidence[0]).toEqual({
      revisionId: 'r1',
      quote: 'Recorded hello world',
    });
    const chat = requests.find((request) => request.url.endsWith('/chat/completions'))!;
    expect(chat.body.model).toBe('openrouter/free');
    expect(chat.body.messages[0].role).toBe('system');
    expect(chat.body.messages[1].content).toContain('Recorded hello world');
    expect(chat.body.response_format.type).toBe('json_schema');
    expect(chat.body.response_format.json_schema.strict).toBe(true);
    expect(chat.body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(chat.headers.Authorization).toBe('Bearer sk-or-v1-test-key');
    expect(s.metrics[0]?.provider).toBe('openrouter');
    expect(s.metrics[0]?.outcome).toBe('completed');
    expect(s.capability().state).toBe('ready');
  });

  it('recovers from a 429 with a retry and records the limit state', async () => {
    const { impl, requests } = fetchMock((url, request) => {
      if (url.endsWith('/key')) return jsonResponse(200, { data: {} });
      if (request === 1)
        return jsonResponse(
          429,
          { error: { message: 'Rate limit exceeded' } },
          { 'retry-after': '1' },
        );
      return jsonResponse(200, completionBody(JSON.stringify({ answer: 'ok' })));
    });
    const s = summary(impl);
    (s as unknown as { retryDelay: () => Promise<void> }).retryDelay = async () => {};
    const result = await runOnce(s);
    expect(result.value).toEqual({ answer: 'ok' });
    expect(requests.filter((request) => request.url.endsWith('/chat/completions'))).toHaveLength(2);
    expect(s.metrics[0]?.outcome).toBe('completed');
  });

  it('falls back to schema-in-instructions when the model rejects json_schema', async () => {
    const { impl, requests } = fetchMock((url, request) => {
      if (url.endsWith('/key')) return jsonResponse(200, { data: {} });
      if (request === 1)
        return jsonResponse(400, {
          error: { message: 'response_format json_schema is not supported by this model' },
        });
      return jsonResponse(200, completionBody(JSON.stringify({ answer: 'ok' })));
    });
    const s = summary(impl);
    const result = await runOnce(s);
    expect(result.value).toEqual({ answer: 'ok' });
    const chatRequests = requests.filter((request) => request.url.endsWith('/chat/completions'));
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[0].body.response_format).toBeTruthy();
    expect(chatRequests[1].body.response_format).toBeUndefined();
    expect(chatRequests[1].body.messages[0].content).toContain('JSON Schema');
  });

  it('extracts fenced JSON from free-model prose', async () => {
    const { impl } = fetchMock((url) =>
      url.endsWith('/key')
        ? jsonResponse(200, { data: {} })
        : jsonResponse(200, completionBody('Here is the result:\n```json\n{"answer":"ok"}\n```')),
    );
    const s = summary(impl);
    const result = await runOnce(s);
    expect(result.value).toEqual({ answer: 'ok' });
  });

  it('throws the question candidate error for invalid question JSON', async () => {
    const { impl } = fetchMock((url) =>
      url.endsWith('/key')
        ? jsonResponse(200, { data: {} })
        : jsonResponse(200, completionBody('not json at all')),
    );
    const s = summary(impl);
    await expect(
      (s as unknown as { run: (...args: unknown[]) => Promise<unknown> }).run(
        'hello',
        schema,
        () => {},
        'question-generate',
      ),
    ).rejects.toThrow('The answer is not valid JSON.');
  });
});
