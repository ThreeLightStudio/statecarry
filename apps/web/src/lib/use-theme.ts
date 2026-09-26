import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const themeStorageKey = 'statecarry.appearance.theme.v1';

export function readThemePreference(storage: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value = storage.getItem(themeStorageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  preference: ThemePreference,
): void {
  try {
    if (preference === 'system') storage.removeItem(themeStorageKey);
    else storage.setItem(themeStorageKey, preference);
  } catch {
    // The choice stays active for this tab when browser storage is unavailable.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

type ThemeHintWindow = Window & { __STATECARRY_SYSTEM_THEME__?: unknown };

/**
 * The desktop webview does not resolve prefers-color-scheme, so its native
 * preload seeds the resolved system theme; browsers without the hint ignore it.
 */
function systemThemeHint(): 'dark' | 'light' | null {
  const hint = (window as ThemeHintWindow).__STATECARRY_SYSTEM_THEME__;
  return hint === 'dark' || hint === 'light' ? hint : null;
}

/** Mirrors the pre-paint resolution in index.html so the attribute is always owned here. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

function preferStorage() {
  return window.localStorage;
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(window.localStorage),
  );
  const [systemDark, setSystemDark] = useState(
    () =>
      (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false) ||
      systemThemeHint() === 'dark',
  );

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const changed = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(preferStorage(), next);
  }, []);

  return { preference, resolved, setPreference } as const;
}
