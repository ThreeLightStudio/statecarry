import {
  DomainError,
  type Capabilities,
  type AnalysisSettings,
  EXPLANATION_LIMITS,
  QuestionCandidateError,
} from '@statecarry/contracts';
import type { SummaryProvider, AttemptMeta } from '@statecarry/core';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { acquireAnalysisSlot, type AnalysisMetric } from './analysis-support';
import {
  AnalysisRecipes,
  INSTRUCTIONS,
  strictSchema,
  type AnalysisRunResult,
} from './analysis-recipes';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS = 900_000;
const MAX_ATTEMPTS = 3;

const completionsResponseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.string().nullish(), reasoning: z.string().nullish() })
              .passthrough()
              .optional(),
            finish_reason: z.string().nullish(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .nullish(),
    error: z.object({ message: z.string().optional() }).passthrough().nullish(),
  })
  .passthrough();

export type OpenRouterSummaryOptions = {
  /** Stored Settings key or the OPENROUTER_API_KEY environment value. */
  apiKey: string | null;
  fetchImpl?: typeof fetch;
};

/** Runs the shared analysis recipes over the OpenRouter OpenAI-compatible API.
 * No local execution happens: every operation is one stateless chat completion
 * that must answer with JSON matching the recipe schema. */
export class OpenRouterSummary extends AnalysisRecipes implements SummaryProvider {
  readonly providerName = 'openrouter' as const;
  private state: Capabilities['summary'] = {
    state: 'unverified',
    detail: 'OpenRouter availability has not been checked yet',
    model: null,
    provider: 'openrouter',
  };
  private initialization: Promise<void> | null = null;
  private closing = false;
  private active = new Set<AbortController>();
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  constructor(
    dataDir: string,
    settings: Partial<Omit<AnalysisSettings, 'promptVersion'>>,
    options: OpenRouterSummaryOptions,
  ) {
    super(dataDir, settings);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }
  capability() {
    if (!this.apiKey)
      return {
        state: 'failed' as const,
        detail: 'Add your OpenRouter API key in Settings to analyze with OpenRouter.',
        model: null,
        provider: 'openrouter' as const,
        settings: this.configuration(),
      };
    if (this.state.state === 'unverified')
      return {
        ...this.state,
        detail: 'OpenRouter key is set. Availability has not been verified yet.',
        settings: this.configuration(),
      };
    return { ...this.state, settings: this.configuration() };
  }
  async preflight() {
    if (this.state.state === 'ready') return;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      try {
        if (!this.apiKey)
          throw new DomainError(
            'CAPABILITY_UNSUPPORTED',
            'OpenRouter API key is not set. Add it in Settings.',
          );
        await mkdir(this.analysisDir, { recursive: true, mode: 0o700 });
        const response = await this.fetchImpl(`${OPENROUTER_API_BASE}/key`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw this.classify(
            response.status,
            await response.text(),
            'OpenRouter key check failed',
          );
        this.state = {
          state: 'ready',
          detail:
            'OpenRouter key verified. Analysis requests are sent to the OpenRouter API; no code runs on this machine.',
          model: this.settings.model,
          provider: 'openrouter',
        };
      } catch (e) {
        this.state = {
          state: 'failed',
          detail: e instanceof Error ? e.message : String(e),
          model: null,
          provider: 'openrouter',
        };
        throw new DomainError(
          'CAPABILITY_UNSUPPORTED',
          `OpenRouter analysis unavailable: ${this.state.detail}`,
        );
      }
    })().finally(() => {
      this.initialization = null;
    });
    return this.initialization;
  }
  protected override async run(
    prompt: string,
    schema: z.ZodType,
    onRemote: (m: AttemptMeta) => void,
    phase: string,
    instructions = INSTRUCTIONS,
    validate: () => void = () => {},
  ): Promise<AnalysisRunResult> {
    if (this.closing) throw new Error('Summary provider is shutting down');
    if (!this.apiKey)
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'OpenRouter API key is not set. Add it in Settings.',
      );
    const queuedAt = Date.now(),
      release = await acquireAnalysisSlot(),
      started = Date.now();
    const effort = phase.startsWith('check')
      ? this.settings.checkEffort
      : this.settings.summaryEffort;
    const outputSchema = strictSchema(schema, phase.includes('explanation'));
    const schemaUtf16 = JSON.stringify(outputSchema).length;
    const timing: Record<string, number> = {};
    const mark = (name: string) => {
      timing[name] = Date.now() - started;
    };
    let outcome: 'completed' | 'failed' = 'failed',
      usage: Record<string, number> | null = null,
      routedModel = this.settings.model,
      requestId: string | null = null,
      withoutResponseFormat = false;
    const controller = new AbortController();
    this.active.add(controller);
    try {
      validate();
      if (this.closing) throw new Error('Summary provider is shutting down');
      mark('deadlineStartedMs');
      const timeout = setTimeout(() => {
        mark('timeoutObservedMs');
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      try {
        let content: string | null = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const body = this.requestBody(
            prompt,
            instructions,
            outputSchema,
            phase,
            withoutResponseFormat,
          );
          const response = await this.fetchImpl(`${OPENROUTER_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (response.ok) {
            const data = completionsResponseSchema.parse(await response.json());
            if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);
            const choice = data.choices[0];
            content = choice.message?.content ?? null;
            routedModel = data.model ?? routedModel;
            requestId = data.id ?? requestId;
            usage = data.usage
              ? {
                  ...(data.usage.prompt_tokens !== undefined
                    ? { inputTokens: data.usage.prompt_tokens }
                    : {}),
                  ...(data.usage.completion_tokens !== undefined
                    ? { outputTokens: data.usage.completion_tokens }
                    : {}),
                  ...(data.usage.total_tokens !== undefined
                    ? { totalTokens: data.usage.total_tokens }
                    : {}),
                }
              : null;
            break;
          }
          const errorText = await response.text();
          if (
            response.status === 400 &&
            !withoutResponseFormat &&
            /response_format|json_schema|schema/i.test(errorText)
          ) {
            // Some routed free models cannot honor json_schema: retry once by
            // embedding the schema in the instructions instead.
            withoutResponseFormat = true;
            continue;
          }
          if (response.status === 429 || response.status >= 500) {
            const error = this.classify(
              response.status,
              errorText,
              attempt === MAX_ATTEMPTS - 1
                ? 'OpenRouter request failed after retries'
                : 'OpenRouter request failed',
            );
            if (attempt === MAX_ATTEMPTS - 1) throw error;
            await this.retryDelay(attempt, response.headers.get('retry-after'));
            continue;
          }
          throw this.classify(response.status, errorText, 'OpenRouter request failed');
        }
        if (content === null)
          throw new Error('OpenRouter response did not include message content');
        if (
          (phase.includes('question') || phase.includes('explanation')) &&
          content.length > EXPLANATION_LIMITS.transport
        )
          throw new Error('Question output exceeds 64,000-character transport limit');
        const value = this.parseJson(content, phase);
        mark('modelCompletedMs');
        outcome = 'completed';
        if (this.state.state !== 'ready')
          this.state = { ...this.state, state: 'ready', model: routedModel };
        return {
          value,
          model: routedModel,
          remote: { pid: null, threadId: requestId, turnId: null, phase, provider: 'openrouter' },
        };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      this.active.delete(controller);
      mark('cleanupCompletedMs');
      release();
      await this.metric({
        id: randomUUID(),
        phase,
        model: routedModel,
        effort,
        provider: this.providerName,
        startedAt: new Date(started).toISOString(),
        elapsedMs: Date.now() - started,
        queueMs: started - queuedAt,
        outcome,
        usage,
        threadId: requestId,
        turnId: null,
        effortVerification: 'http-request',
        timing,
        inputSize: { promptUtf16: prompt.length, schemaUtf16 },
        idleSleepProtected: false,
      } satisfies AnalysisMetric);
    }
  }
  async resolve(meta: AttemptMeta | null) {
    // HTTP runs have no local process to interrogate: once a request is sent,
    // its outcome on the service side is unknown to this provider.
    void meta;
    return 'unknown' as const;
  }
  async close() {
    this.closing = true;
    for (const controller of this.active) controller.abort();
  }
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'StateCarry',
    };
  }
  private requestBody(
    prompt: string,
    instructions: string,
    outputSchema: Record<string, unknown>,
    phase: string,
    withoutResponseFormat: boolean,
  ) {
    const finalInstructions = withoutResponseFormat
      ? `${instructions}\nReturn ONLY a single JSON object that matches this JSON Schema exactly, with no surrounding prose or code fences:\n${JSON.stringify(outputSchema)}`
      : instructions;
    const body: Record<string, unknown> = {
      model: this.settings.model,
      messages: [
        { role: 'system', content: finalInstructions },
        { role: 'user', content: prompt },
      ],
    };
    if (!withoutResponseFormat)
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: `statecarry_${phase.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60) || 'analysis'}`,
          strict: true,
          schema: outputSchema,
        },
      };
    return body;
  }
  /** Maps one failed HTTP exchange to a state update and an error. Auth and
   * credit failures are durable, so they also surface in capability state. */
  private classify(status: number, text: string, prefix: string): Error {
    let detail = '';
    try {
      const data = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = data.error?.message ?? data.message ?? text.slice(0, 200);
    } catch {
      detail = text.slice(0, 200);
    }
    const message = detail ? `${prefix}: ${detail}` : `${prefix}: HTTP ${status}`;
    if (status === 401 || status === 402 || status === 403) {
      this.state = { state: 'failed', detail: message, model: null, provider: 'openrouter' };
      return new DomainError('CAPABILITY_UNSUPPORTED', message);
    }
    if (status === 429)
      this.state = {
        state: 'failed',
        detail: 'OpenRouter rate limit was reached. Analysis resumes automatically later.',
        model: this.state.model,
        provider: 'openrouter',
      };
    return new Error(message);
  }
  protected async retryDelay(attempt: number, retryAfter: string | null): Promise<void> {
    const seconds = retryAfter !== null && retryAfter !== '' ? Number(retryAfter) : NaN;
    const delay = Number.isFinite(seconds)
      ? Math.min(Math.max(seconds, 1) * 1000, 120_000)
      : Math.min(1000 * 2 ** attempt, 30_000);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  }
  private parseJson(content: string, phase: string): unknown {
    const attemptParse = (text: string) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    };
    const direct = attemptParse(content.trim());
    if (direct !== undefined) return direct;
    const unfenced = content
      .replace(/^[\s\S]*?```(?:json)?\s*/, '')
      .replace(/```[\s\S]*$/, '')
      .trim();
    const unfencedParsed = attemptParse(unfenced);
    if (unfencedParsed !== undefined) return unfencedParsed;
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sliced = attemptParse(content.slice(start, end + 1));
      if (sliced !== undefined) return sliced;
    }
    throw phase === 'question-generate' || phase === 'question-repair'
      ? new QuestionCandidateError(
          'The answer is not valid JSON.',
          { stage: 'candidate', violation: 'structure', itemId: null, repairs: 0 },
          content,
        )
      : new Error('Model response was not valid JSON');
  }
}
