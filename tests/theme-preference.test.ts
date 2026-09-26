// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare global {
  var __STATECARRY_SYSTEM_THEME__: 'dark' | 'light' | undefined;
}

import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  themeStorageKey,
  useTheme,
  writeThemePreference,
  type ThemePreference,
} from '../apps/web/src/lib/use-theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('storage unavailable');
  },
  setItem: () => {
    throw new Error('storage unavailable');
  },
  removeItem: () => {
    throw new Error('storage unavailable');
  },
};

describe('theme preference storage', () => {
  it('reads a stored light or dark choice', () => {
    expect(readThemePreference(memoryStorage({ [themeStorageKey]: 'light' }))).toBe('light');
    expect(readThemePreference(memoryStorage({ [themeStorageKey]: 'dark' }))).toBe('dark');
  });

  it('falls back to system when the stored value is missing or unknown', () => {
    expect(readThemePreference(memoryStorage())).toBe('system');
    expect(readThemePreference(memoryStorage({ [themeStorageKey]: 'midnight' }))).toBe('system');
  });

  it('falls back to system when storage is unavailable', () => {
    expect(readThemePreference(throwingStorage)).toBe('system');
  });

  it('stores an explicit choice and clears the key for system', () => {
    const storage = memoryStorage();
    writeThemePreference(storage, 'dark');
    expect(storage.getItem(themeStorageKey)).toBe('dark');
    writeThemePreference(storage, 'light');
    expect(storage.getItem(themeStorageKey)).toBe('light');
    writeThemePreference(storage, 'system');
    expect(storage.getItem(themeStorageKey)).toBeNull();
  });

  it('keeps the in-memory choice when storage is unavailable', () => {
    expect(() => writeThemePreference(throwingStorage, 'dark')).not.toThrow();
  });
});

describe('theme resolution', () => {
  it('follows the system setting only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('records the resolved theme on the document element', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('useTheme', () => {
  let unmount: (() => void) | null = null;

  afterEach(() => {
    unmount?.();
    unmount = null;
    window.localStorage.removeItem(themeStorageKey);
    delete window.__STATECARRY_SYSTEM_THEME__;
    document.documentElement.dataset.theme = '';
  });

  type ThemeProbeState = {
    preference: ThemePreference;
    resolved: 'light' | 'dark';
    setPreference: (next: ThemePreference) => void;
  };

  function mountProbe(capture: (state: ThemeProbeState) => void) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const probe = createElement(function ThemeProbe() {
      const theme = useTheme();
      capture(theme);
      return null;
    });
    return {
      render: async () => {
        await act(async () => {
          root.render(probe);
        });
      },
      stop: () => {
        root.unmount();
        host.remove();
      },
    };
  }

  it('applies a stored dark choice on mount', async () => {
    window.localStorage.setItem(themeStorageKey, 'dark');
    const state: { current: ThemeProbeState | null } = { current: null };
    const probe = mountProbe((next) => {
      state.current = next;
    });
    unmount = probe.stop;
    await probe.render();
    expect(state.current?.preference).toBe('dark');
    expect(state.current?.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light when nothing is stored and the system is light', async () => {
    const state: { current: ThemeProbeState | null } = { current: null };
    const probe = mountProbe((next) => {
      state.current = next;
    });
    unmount = probe.stop;
    await probe.render();
    expect(state.current?.preference).toBe('system');
    expect(state.current?.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('uses the desktop system-theme hint when the media query stays light', async () => {
    // jsdom matchMedia always reports light, mirroring the desktop webview.
    window.__STATECARRY_SYSTEM_THEME__ = 'dark';
    const state: { current: ThemeProbeState | null } = { current: null };
    const probe = mountProbe((next) => {
      state.current = next;
    });
    unmount = probe.stop;
    await probe.render();
    expect(state.current?.preference).toBe('system');
    expect(state.current?.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists and applies a new preference without remounting', async () => {
    const state: { current: ThemeProbeState | null } = { current: null };
    const probe = mountProbe((next) => {
      state.current = next;
    });
    unmount = probe.stop;
    await probe.render();
    await act(async () => {
      state.current?.setPreference('dark');
    });
    expect(state.current?.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(themeStorageKey)).toBe('dark');
  });
});
