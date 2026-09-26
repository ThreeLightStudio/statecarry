// Resolves the theme before first paint so the saved choice (or the system
// preference) applies without a light flash. Loaded as an external file because
// the local service's CSP (script-src 'self') blocks inline scripts.
// The desktop webview cannot resolve prefers-color-scheme, so its native
// preload seeds __STATECARRY_SYSTEM_THEME__ as a fallback hint.
// Kept in sync with use-theme.ts.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('statecarry.appearance.theme.v1');
  } catch (error) {
    // No stored preference when storage is unavailable.
  }
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  var hint = window.__STATECARRY_SYSTEM_THEME__;
  var dark = stored === 'dark' || (stored !== 'light' && (prefersDark.matches || hint === 'dark'));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
