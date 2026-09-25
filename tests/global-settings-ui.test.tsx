// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentSettingsView } from '@statecarry/presentation';
import {
  installBrowser,
  mountProjectRoot,
  press,
  projectUiFixture,
  typeField,
} from './project-ui-fixtures';

const storageValues = new Map<string, string>();
const storage: Storage = {
  get length() {
    return storageValues.size;
  },
  clear() {
    storageValues.clear();
  },
  getItem(key) {
    return storageValues.get(key) ?? null;
  },
  key(index) {
    return [...storageValues.keys()][index] ?? null;
  },
  removeItem(key) {
    storageValues.delete(key);
  },
  setItem(key, value) {
    storageValues.set(key, value);
  },
};

beforeEach(() => {
  installBrowser();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  storage.clear();
});
afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

function fixtureWithAgentSettings(initial: AgentSettingsView) {
  const h = projectUiFixture();
  const view = { ...initial };
  Object.assign(h.projectGateway, {
    agentSettings: vi.fn(async () => ({ ...view })),
    saveAgentSettings: vi.fn(async (input: Record<string, unknown>) => {
      // Mimic the server: merge the input and mask the stored key.
      if (typeof input.provider === 'string')
        view.provider = input.provider as AgentSettingsView['provider'];
      if (typeof input.openrouterModel === 'string') view.openrouterModel = input.openrouterModel;
      if (input.openrouterApiKey !== undefined) {
        const key = input.openrouterApiKey as string | null;
        view.hasApiKey = key !== null;
        view.apiKeyHint = key ? `…${key.slice(-4)}` : null;
      }
      return { ...view };
    }),
  });
  return h;
}

it('renders the analysis agent card with the saved Codex default', async () => {
  const h = fixtureWithAgentSettings({
    provider: 'codex',
    openrouterModel: 'openrouter/free',
    hasApiKey: false,
    apiKeyHint: null,
  });
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('#analysis-agent-heading')?.textContent).toBe(
      'Analysis agent',
    );
    const select = mounted.host.querySelector<HTMLSelectElement>('select[name="analysis-agent"]');
    expect(select?.value).toBe('codex');
    expect(mounted.host.querySelector('input[name="openrouter-api-key"]')).toBeNull();
    expect(mounted.host.textContent).not.toContain('Save agent settings');
    expect(h.projectGateway.agentSettings).toHaveBeenCalledTimes(1);
  } finally {
    await mounted.unmount();
  }
});

it('saves OpenRouter settings with the key and model, then clears the key field', async () => {
  const h = fixtureWithAgentSettings({
    provider: 'codex',
    openrouterModel: 'openrouter/free',
    hasApiKey: false,
    apiKeyHint: null,
  });
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await typeField(mounted.host, 'select[name="analysis-agent"]', 'openrouter');
    expect(mounted.host.querySelector('input[name="openrouter-api-key"]')).toBeTruthy();
    await typeField(mounted.host, 'input[name="openrouter-api-key"]', 'sk-or-v1-ui-test-4321');
    await typeField(
      mounted.host,
      'input[name="openrouter-model"]',
      'deepseek/deepseek-chat-v3.1:free',
    );
    await press(mounted.host, 'Save agent settings');
    expect(h.projectGateway.saveAgentSettings).toHaveBeenCalledWith({
      provider: 'openrouter',
      openrouterModel: 'deepseek/deepseek-chat-v3.1:free',
      openrouterApiKey: 'sk-or-v1-ui-test-4321',
    });
    const keyField = mounted.host.querySelector<HTMLInputElement>(
      'input[name="openrouter-api-key"]',
    );
    expect(keyField?.value).toBe('');
    expect(keyField?.placeholder).toBe('…4321');
    // Saving refreshes both the stored view and the capability status.
    expect(h.projectGateway.capabilities).toHaveBeenCalledTimes(2);
    expect(h.projectGateway.agentSettings).toHaveBeenCalledTimes(2);
  } finally {
    await mounted.unmount();
  }
});

it('keeps the saved provider choice when switching back to Codex', async () => {
  const h = fixtureWithAgentSettings({
    provider: 'openrouter',
    openrouterModel: 'openrouter/free',
    hasApiKey: true,
    apiKeyHint: '…aaaa',
  });
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    const select = mounted.host.querySelector<HTMLSelectElement>('select[name="analysis-agent"]');
    expect(select?.value).toBe('openrouter');
    await typeField(mounted.host, 'select[name="analysis-agent"]', 'codex');
    expect(mounted.host.querySelector('input[name="openrouter-api-key"]')).toBeNull();
    await press(mounted.host, 'Save agent settings');
    expect(h.projectGateway.saveAgentSettings).toHaveBeenCalledWith({ provider: 'codex' });
  } finally {
    await mounted.unmount();
  }
});
