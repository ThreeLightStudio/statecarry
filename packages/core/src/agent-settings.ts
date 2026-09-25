import {
  agentSettingsInputSchema,
  agentSettingsSchema,
  agentProviderSchema,
  DomainError,
  type AgentProvider,
  type AgentSettings,
  type AgentSettingsView,
} from '@statecarry/contracts';
import type { StateRepository } from './ports';
import type { StateCarry } from './service';

const AGENT_SETTINGS_ID = 'default';

export const EMPTY_AGENT_SETTINGS: AgentSettings = {
  provider: 'codex',
  openrouterModel: 'openrouter/free',
  openrouterApiKey: null,
};

/** Read helper for server adapters that need the raw stored choice
 * (including the key) without going through the core service. */
export function readAgentSettings(repo: StateRepository): AgentSettings {
  return repo.get('agentSettings', AGENT_SETTINGS_ID)?.settings ?? EMPTY_AGENT_SETTINGS;
}

/** App-wide choice of the engine that runs background analysis (Codex or OpenRouter). */
export class AgentSettingsService {
  constructor(private readonly core: StateCarry) {}

  view(): AgentSettingsView {
    return this.toView(this.current());
  }

  save(input: unknown): AgentSettingsView {
    const parsed = agentSettingsInputSchema.parse(input ?? {});
    const current = this.current();
    const next: AgentSettings = {
      provider: parsed.provider ?? current.provider,
      openrouterModel: parsed.openrouterModel ?? current.openrouterModel,
      // Missing key keeps the stored one; explicit null clears it; a string replaces it.
      openrouterApiKey:
        parsed.openrouterApiKey === undefined ? current.openrouterApiKey : parsed.openrouterApiKey,
    };
    agentSettingsSchema.parse(next);
    this.core.repo.put('agentSettings', {
      id: AGENT_SETTINGS_ID,
      settings: next,
      updatedAt: this.core.clock.now(),
    });
    this.core.events.changed(null, 'agent');
    return this.toView(next);
  }

  /** Full stored settings, including the key. Server adapters only. */
  stored(): AgentSettings {
    return this.current();
  }

  private current(): AgentSettings {
    return readAgentSettings(this.core.repo);
  }

  private toView(settings: AgentSettings): AgentSettingsView {
    return {
      provider: settings.provider,
      openrouterModel: settings.openrouterModel,
      hasApiKey: settings.openrouterApiKey !== null,
      apiKeyHint: settings.openrouterApiKey ? `…${settings.openrouterApiKey.slice(-4)}` : null,
    };
  }
}

export function assertKnownAgentProvider(provider: string): asserts provider is AgentProvider {
  if (!agentProviderSchema.safeParse(provider).success)
    throw new DomainError('VALIDATION', `Unknown analysis agent: ${provider}`);
}
