import type { AgentSettings } from '@statecarry/contracts';
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

/** The app-level analysis provider. Reads the stored agent settings on every
 * delegation so a Settings change takes effect on the next analysis run
 * without restarting the server. */
export class AgentSummaryProvider implements SummaryProvider {
  private readonly codex: CodexSummary;
  private openrouter: OpenRouterSummary | null = null;
  private openrouterSignature: string | null = null;
  constructor(
    private readonly dataDir: string,
    codexSettings: Partial<Omit<AnalysisSettings, 'promptVersion'>>,
    private readonly repo: StateRepository,
    private readonly options: AgentSummaryOptions = {},
  ) {
    this.codex = new CodexSummary(dataDir, codexSettings);
  }
  private active(): SummaryProvider {
    const settings = readAgentSettings(this.repo);
    if (settings.provider !== 'openrouter') return this.codex;
    const apiKey = settings.openrouterApiKey ?? this.options.openrouterApiKeyFromEnv ?? null;
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
  capability() {
    return this.active().capability();
  }
  configuration() {
    return this.active().configuration();
  }
  generateAnalysis(input: unknown) {
    return this.active().generateAnalysis!(input);
  }
  analyzeWorkingTree(input: unknown) {
    return this.active().analyzeWorkingTree!(input);
  }
  generateExplanation(...args: Parameters<NonNullable<SummaryProvider['generateExplanation']>>) {
    return this.active().generateExplanation!(...args);
  }
  checkExplanation(...args: Parameters<NonNullable<SummaryProvider['checkExplanation']>>) {
    return this.active().checkExplanation!(...args);
  }
  answerQuestion(...args: Parameters<NonNullable<SummaryProvider['answerQuestion']>>) {
    return this.active().answerQuestion!(...args);
  }
  checkQuestion(...args: Parameters<NonNullable<SummaryProvider['checkQuestion']>>) {
    return this.active().checkQuestion!(...args);
  }
  rejectCandidate(...args: Parameters<NonNullable<SummaryProvider['rejectCandidate']>>) {
    return this.active().rejectCandidate!(...args);
  }
  generate(...args: Parameters<SummaryProvider['generate']>) {
    return this.active().generate(...args);
  }
  check(...args: Parameters<SummaryProvider['check']>) {
    return this.active().check(...args);
  }
  resolve(meta: AttemptMeta | null) {
    return this.active().resolve(meta);
  }
  async close() {
    await Promise.all([
      this.codex.close(),
      this.openrouter ? this.openrouter.close() : Promise.resolve(),
    ]);
  }
}
