import type { AgentSettings, Capabilities } from '@statecarry/contracts';
import type { SummaryProvider, AttemptMeta, StateRepository } from '@statecarry/core';
import { readAgentSettings } from '@statecarry/core';
import { CodexSummary } from './codex-summary';
import { OpenRouterSummary } from './openrouter-summary';
import type { AnalysisSettings } from '@statecarry/contracts';
import { identity } from './identity';

export type AgentSummaryOptions = {
  /** OPENROUTER_API_KEY environment fallback when no key is stored in settings. */
  openrouterApiKeyFromEnv?: string | null;
};

/** Codex reports usage exhaustion as plain RPC error text without a structured
 * code, so classification stays a conservative message match. Non-matching
 * errors never hand off; update the patterns when the CLI wording changes. */
const USAGE_LIMIT_PATTERN = /usage limit|limit (has been )?reached|rate limit|quota/i;

/** How long a classified exhaustion skips Codex before the next analysis call
 * probes it again; a probe that still fails on the limit re-extends the window. */
const EXHAUSTION_WINDOW_MS = 60 * 60 * 1000;

function isUsageLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return USAGE_LIMIT_PATTERN.test(message);
}

/** The app-level analysis provider. Reads the stored agent settings on every
 * delegation so a Settings change takes effect on the next analysis run
 * without restarting the server. When a Codex call fails on its usage limit
 * and an OpenRouter key is available, the whole call continues on OpenRouter
 * and Codex stays skipped until the exhaustion window lapses. */
export class AgentSummaryProvider implements SummaryProvider {
  private readonly codex: CodexSummary;
  private openrouter: OpenRouterSummary | null = null;
  private openrouterSignature: string | null = null;
  private codexExhaustedUntil = 0;
  constructor(
    private readonly dataDir: string,
    codexSettings: Partial<Omit<AnalysisSettings, 'promptVersion'>>,
    private readonly repo: StateRepository,
    private readonly options: AgentSummaryOptions = {},
  ) {
    this.codex = new CodexSummary(dataDir, codexSettings);
  }
  private openrouterKey(settings: AgentSettings): string | null {
    return settings.openrouterApiKey ?? this.options.openrouterApiKeyFromEnv ?? null;
  }
  private openrouterClient(settings: AgentSettings): OpenRouterSummary {
    const apiKey = this.openrouterKey(settings);
    const signature = `${settings.openrouterModel}\u0000${apiKey ? identity.hash(apiKey) : 'none'}`;
    if (!this.openrouter || this.openrouterSignature !== signature) {
      // Settings changed: drop the old client together with any in-flight request.
      void this.openrouter?.close();
      this.openrouter = new OpenRouterSummary(
        this.dataDir,
        { model: settings.openrouterModel, summaryEffort: 'medium', checkEffort: 'medium' },
        { apiKey },
      );
      this.openrouterSignature = signature;
    }
    return this.openrouter;
  }
  /** The adapter the next analysis call runs on: the stored choice, except
   * that an exhausted Codex defers to OpenRouter for the rest of the window. */
  private active(settings: AgentSettings = readAgentSettings(this.repo)): SummaryProvider {
    if (
      settings.provider !== 'openrouter' &&
      !(Date.now() < this.codexExhaustedUntil && this.openrouterKey(settings))
    )
      return this.codex;
    return this.openrouterClient(settings);
  }
  /** Runs one analysis call on a single adapter, handing off to OpenRouter as
   * a whole when the Codex attempt fails on its usage limit. */
  private async handoff<T>(call: (provider: SummaryProvider) => Promise<T>): Promise<T> {
    const settings = readAgentSettings(this.repo);
    if (this.active(settings) !== this.codex) return call(this.openrouterClient(settings));
    try {
      return await call(this.codex);
    } catch (error) {
      if (!isUsageLimitError(error)) throw error;
      this.codexExhaustedUntil = Date.now() + EXHAUSTION_WINDOW_MS;
      if (!this.openrouterKey(settings)) throw error;
      return call(this.openrouterClient(settings));
    }
  }
  capability(): Capabilities['summary'] {
    const settings = readAgentSettings(this.repo);
    if (settings.provider === 'openrouter') return this.openrouterClient(settings).capability();
    if (Date.now() < this.codexExhaustedUntil) {
      if (!this.openrouterKey(settings))
        return {
          state: 'failed',
          detail:
            'Codex usage limit reached. Save an OpenRouter API key in Settings to keep analysis running.',
          model: null,
          provider: 'codex',
          settings: this.codex.configuration(),
        };
      const capability = this.openrouterClient(settings).capability();
      return {
        ...capability,
        detail:
          capability.state === 'ready'
            ? 'Codex usage limit reached. Analysis continues with OpenRouter.'
            : `Codex usage limit reached. ${capability.detail}`,
      };
    }
    return this.codex.capability();
  }
  configuration() {
    return this.active().configuration();
  }
  generateAnalysis(input: unknown) {
    return this.handoff((provider) => provider.generateAnalysis!(input));
  }
  analyzeWorkingTree(input: unknown) {
    return this.handoff((provider) => provider.analyzeWorkingTree!(input));
  }
  generateExplanation(...args: Parameters<NonNullable<SummaryProvider['generateExplanation']>>) {
    return this.handoff((provider) => provider.generateExplanation!(...args));
  }
  checkExplanation(...args: Parameters<NonNullable<SummaryProvider['checkExplanation']>>) {
    return this.handoff((provider) => provider.checkExplanation!(...args));
  }
  answerQuestion(...args: Parameters<NonNullable<SummaryProvider['answerQuestion']>>) {
    return this.handoff((provider) => provider.answerQuestion!(...args));
  }
  checkQuestion(...args: Parameters<NonNullable<SummaryProvider['checkQuestion']>>) {
    return this.handoff((provider) => provider.checkQuestion!(...args));
  }
  rejectCandidate(...args: Parameters<NonNullable<SummaryProvider['rejectCandidate']>>) {
    return this.handoff((provider) => provider.rejectCandidate!(...args));
  }
  generate(...args: Parameters<SummaryProvider['generate']>) {
    return this.handoff((provider) => provider.generate(...args));
  }
  check(...args: Parameters<SummaryProvider['check']>) {
    return this.handoff((provider) => provider.check(...args));
  }
  async resolve(meta: AttemptMeta | null) {
    // Attempt metas carry their adapter so a handoff or a settings change
    // never interrogates the wrong process; absent means a codex attempt.
    if (meta?.provider === 'openrouter')
      return this.openrouter ? this.openrouter.resolve(meta) : ('unknown' as const);
    return this.codex.resolve(meta);
  }
  async close() {
    await Promise.all([
      this.codex.close(),
      this.openrouter ? this.openrouter.close() : Promise.resolve(),
    ]);
  }
}
