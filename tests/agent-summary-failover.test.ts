import { describe, expect, it, vi } from 'vitest';
import { readAgentSettings } from '@statecarry/core';
import { AgentSummaryProvider } from '../apps/server/src/adapters/agent-summary';
import { harness } from './helpers';

const AT = '2026-09-26T00:00:00.000Z';

function snapshot() {
  return {
    cwd: '/tmp/failover-project',
    root: '/tmp/failover-project',
    branch: 'main',
    commit: 'head-a',
    dirty: true,
    changedPaths: ['src/work.ts'],
    changedFiles: [{ path: 'src/work.ts', status: 'modified' }],
    status: 'checked',
    checkedAt: AT,
    limitations: [],
    files: [
      {
        path: 'src/work.ts',
        hash: 'file-a',
        preview: 'Inspection quote is present.',
        status: 'checked',
      },
    ],
  };
}

function record(revisionId: string, text: string) {
  return {
    revisionId,
    threadId: 'project-inspection',
    actor: 'tool' as const,
    kind: 'fileObservation',
    at: AT,
    text,
    limitations: [],
  };
}

function group() {
  return {
    title: 'Current work',
    summary: 'A changed file contains the current work.',
    currentState: 'The changed file has a bounded inspection.',
    openItems: [],
    suggestedNextStep: 'Review the changed file.',
    reason: 'The file is part of the current change.',
    doneWhen: 'The file has been reviewed.',
    files: ['src/work.ts'],
    context: [],
  };
}

const workingTreeValue = { summary: 'One changed file needs review.', groups: [group()] };

function input() {
  return {
    projectTitle: 'Failover project',
    snapshot: snapshot(),
    records: [record('inspection-a', 'File observation: Inspection quote is present.')],
    executionResults: [],
  };
}

function providerWithStoredKey(h: ReturnType<typeof harness>) {
  h.repo.put('agentSettings', {
    id: 'default',
    settings: {
      provider: 'codex',
      openrouterModel: 'openrouter/free',
      openrouterApiKey: 'sk-or-v1-failover-aaaa',
    },
    updatedAt: AT,
  });
  const provider = new AgentSummaryProvider('/tmp/statecarry-agent-failover', {}, h.repo, {});
  const codex = (provider as any).codex;
  const openrouter = (provider as any).openrouterClient(readAgentSettings(h.repo));
  codex.preflight = async () => {};
  openrouter.preflight = async () => {};
  return { provider, codex, openrouter };
}

describe('agent summary usage-limit failover', () => {
  it('hands the whole call to OpenRouter when Codex fails on its usage limit', async () => {
    const h = harness();
    const { provider, codex, openrouter } = providerWithStoredKey(h);
    codex.run = vi.fn(async () => {
      throw new Error("You've hit your usage limit. Your limit will reset on Friday at 9:00 AM.");
    });
    openrouter.run = vi.fn(async () => ({ value: workingTreeValue, model: 'openrouter/free' }));

    const result = await provider.analyzeWorkingTree(input());

    expect(result.groups[0].title).toBe('Current work');
    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(openrouter.run).toHaveBeenCalledTimes(1);
    (openrouter as any).state = {
      state: 'ready',
      detail: 'OpenRouter key verified.',
      model: 'openrouter/free',
      provider: 'openrouter',
    };
    const capability = provider.capability();
    expect(capability.provider).toBe('openrouter');
    expect(capability.state).toBe('ready');
    expect(capability.detail).toBe(
      'Codex usage limit reached. Analysis continues with OpenRouter.',
    );
    expect(provider.configuration().model).toBe('openrouter/free');
  });

  it('skips Codex inside the exhaustion window and probes Codex again after it lapses', async () => {
    const h = harness();
    const { provider, codex, openrouter } = providerWithStoredKey(h);
    codex.run = vi.fn(async () => {
      throw new Error('Usage limit reached: the 5-hour limit is exhausted.');
    });
    openrouter.run = vi.fn(async () => ({ value: workingTreeValue, model: 'openrouter/free' }));

    await provider.analyzeWorkingTree(input());
    expect(codex.run).toHaveBeenCalledTimes(1);
    await provider.analyzeWorkingTree(input());
    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(openrouter.run).toHaveBeenCalledTimes(2);

    (provider as any).codexExhaustedUntil = 0;
    codex.run = vi.fn(async () => ({ value: workingTreeValue, model: 'gpt-6-luna' }));
    const result = await provider.analyzeWorkingTree(input());
    expect(result.groups[0].title).toBe('Current work');
    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(openrouter.run).toHaveBeenCalledTimes(2);
    expect(provider.capability().provider).toBe('codex');
  });

  it('propagates non-usage-limit Codex errors without handing off', async () => {
    const h = harness();
    const { provider, codex, openrouter } = providerWithStoredKey(h);
    codex.run = vi.fn(async () => {
      throw new Error('Codex disconnected (1): sandbox settings differ');
    });
    openrouter.run = vi.fn(async () => ({ value: workingTreeValue, model: 'openrouter/free' }));

    await expect(provider.analyzeWorkingTree(input())).rejects.toThrow('Codex disconnected');
    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(openrouter.run).not.toHaveBeenCalled();
    expect(provider.capability().provider).toBe('codex');
  });

  it('keeps the failure and asks for a key when Codex is exhausted without any OpenRouter key', async () => {
    const h = harness();
    const provider = new AgentSummaryProvider('/tmp/statecarry-agent-failover', {}, h.repo, {});
    const codex = (provider as any).codex;
    codex.preflight = async () => {};
    codex.run = vi.fn(async () => {
      throw new Error("You've hit your usage limit. Your limit will reset on Friday at 9:00 AM.");
    });

    await expect(provider.analyzeWorkingTree(input())).rejects.toThrow('usage limit');
    const capability = provider.capability();
    expect(capability.state).toBe('failed');
    expect(capability.detail).toBe(
      'Codex usage limit reached. Save an OpenRouter API key in Settings to keep analysis running.',
    );
  });

  it('runs OpenRouter exclusively when it is the stored choice', async () => {
    const h = harness();
    h.repo.put('agentSettings', {
      id: 'default',
      settings: {
        provider: 'openrouter',
        openrouterModel: 'openrouter/free',
        openrouterApiKey: 'sk-or-v1-only-aaaa',
      },
      updatedAt: AT,
    });
    const provider = new AgentSummaryProvider('/tmp/statecarry-agent-failover', {}, h.repo, {});
    const codex = (provider as any).codex;
    codex.run = vi.fn(async () => {
      throw new Error('Codex should never run');
    });
    const openrouter = (provider as any).openrouterClient(readAgentSettings(h.repo));
    openrouter.preflight = async () => {};
    openrouter.run = vi.fn(async () => ({ value: workingTreeValue, model: 'openrouter/free' }));

    const result = await provider.analyzeWorkingTree(input());

    expect(result.groups[0].title).toBe('Current work');
    expect(codex.run).not.toHaveBeenCalled();
    expect(openrouter.run).toHaveBeenCalledTimes(1);
  });

  it('routes resolve() by the adapter recorded in the attempt meta', async () => {
    const h = harness();
    const { provider, codex } = providerWithStoredKey(h);
    codex.resolve = vi.fn(async () => 'terminated' as const);

    await expect(
      provider.resolve({
        pid: 123,
        threadId: 't',
        turnId: 'u',
        phase: 'generate',
        provider: 'openrouter',
      }),
    ).resolves.toBe('unknown');
    await expect(
      provider.resolve({ pid: 123, threadId: 't', turnId: 'u', phase: 'generate' }),
    ).resolves.toBe('terminated');
    await expect(provider.resolve(null)).resolves.toBe('terminated');
    expect(codex.resolve).toHaveBeenCalledTimes(2);
  });
});
