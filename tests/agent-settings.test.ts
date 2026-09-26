import { describe, expect, it } from 'vitest';
import { readAgentSettings } from '@statecarry/core';
import { AgentSummaryProvider } from '../apps/server/src/adapters/agent-summary';
import { harness } from './helpers';

describe('agent settings service', () => {
  it('defaults to Codex with no OpenRouter key', () => {
    const h = harness();
    expect(h.core.agent.view()).toEqual({
      provider: 'codex',
      openrouterModel: 'openrouter/free',
      hasApiKey: false,
      apiKeyHint: null,
    });
  });

  it('saves the provider choice and never exposes the stored key', () => {
    const h = harness();
    const saved = h.core.agent.save({
      provider: 'openrouter',
      openrouterModel: 'deepseek/deepseek-chat-v3.1:free',
      openrouterApiKey: 'sk-or-v1-1234567890abcd',
    });
    expect(saved).toEqual({
      provider: 'openrouter',
      openrouterModel: 'deepseek/deepseek-chat-v3.1:free',
      hasApiKey: true,
      apiKeyHint: '…abcd',
    });
    expect(JSON.stringify(saved)).not.toContain('sk-or-v1-1234567890abcd');
    expect(readAgentSettings(h.core.repo).openrouterApiKey).toBe('sk-or-v1-1234567890abcd');
  });

  it('keeps the stored key when it is omitted and clears it on null', () => {
    const h = harness();
    h.core.agent.save({ provider: 'openrouter', openrouterApiKey: 'sk-or-v1-keep-me-aaaa' });
    const kept = h.core.agent.save({ openrouterModel: 'openrouter/free' });
    expect(kept.hasApiKey).toBe(true);
    expect(kept.provider).toBe('openrouter');
    const cleared = h.core.agent.save({ openrouterApiKey: null });
    expect(cleared.hasApiKey).toBe(false);
    expect(cleared.apiKeyHint).toBeNull();
  });

  it('rejects unknown providers and models', () => {
    const h = harness();
    expect(() => h.core.agent.save({ provider: 'claude' })).toThrow();
    expect(() => h.core.agent.save({ openrouterApiKey: '' })).toThrow();
    expect(() => h.core.agent.save({ unrelated: true })).toThrow();
  });
});

describe('agent summary provider delegation', () => {
  it('delegates to Codex by default and switches with the stored settings', () => {
    const h = harness();
    const provider = new AgentSummaryProvider('/tmp/statecarry-agent-test', {}, h.repo, {});
    expect(provider.capability().provider).toBe('codex');
    expect(provider.configuration().model).toBe('gpt-6-luna');
    h.repo.put('agentSettings', {
      id: 'default',
      settings: {
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        openrouterApiKey: 'sk-or-v1-switch-aaaa',
      },
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
    const capability = provider.capability();
    expect(capability.provider).toBe('openrouter');
    expect(capability.state).toBe('unverified');
    expect(provider.configuration().model).toBe('openrouter/free');
  });

  it('uses the environment key when settings store none', () => {
    const h = harness();
    const provider = new AgentSummaryProvider('/tmp/statecarry-agent-test', {}, h.repo, {
      openrouterApiKeyFromEnv: 'sk-or-v1-env-key',
    });
    h.repo.put('agentSettings', {
      id: 'default',
      settings: {
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        openrouterApiKey: null,
      },
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
    expect(provider.capability().state).toBe('unverified');
    expect(provider.capability().detail).not.toContain('Add your OpenRouter API key');
  });

  it('reports a failed capability when OpenRouter is selected without any key', () => {
    const h = harness();
    const provider = new AgentSummaryProvider('/tmp/statecarry-agent-test', {}, h.repo, {});
    h.repo.put('agentSettings', {
      id: 'default',
      settings: {
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        openrouterApiKey: null,
      },
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
    const capability = provider.capability();
    expect(capability.state).toBe('failed');
    expect(capability.detail).toContain('Add your OpenRouter API key in Settings');
  });
});
