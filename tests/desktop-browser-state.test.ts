// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { browserStatePreload } from '../apps/desktop/src/browser-state-preload';
import { createServerRuntime } from '../apps/server/src/runtime';

describe('desktop preferences across automatic ports', () => {
  it('restores state before the UI loads and flushes unsent inputs before stopping its server', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'statecarry-browser-state-'));
    const runtime = createServerRuntime({
      environment: 'production',
      dataDir,
      persistBrowserState: true,
    });
    const methods = {
      setItem: Storage.prototype.setItem,
      removeItem: Storage.prototype.removeItem,
      clear: Storage.prototype.clear,
    };
    const networkFetch = globalThis.fetch;
    let reopened: ReturnType<typeof createServerRuntime> | undefined;
    try {
      runtime.browserState!.write({ entries: { 'statecarry.response-language.v1': 'ko' } });
      await runtime.start();
      const origin = `http://${runtime.host}:${runtime.port}`;
      vi.stubGlobal('fetch', (url: string, options: RequestInit) =>
        networkFetch(new URL(url, origin), options),
      );
      window.localStorage.setItem('statecarry.stale-other-profile', 'stale');
      window.eval(
        browserStatePreload(runtime.browserState!.read(), window.location.origin, 'light'),
      );
      expect(window.localStorage.getItem('statecarry.response-language.v1')).toBe('ko');
      expect(window.localStorage.getItem('statecarry.stale-other-profile')).toBeNull();
      window.localStorage.setItem('statecarry.project-drafts.v3.example', 'unsent input');
      window.localStorage.removeItem('statecarry.response-language.v1');
      await runtime.browserState!.flushBeforeQuit((token) => {
        window.dispatchEvent(new window.CustomEvent('statecarry:flush', { detail: token }));
      });
      await runtime.stop();
      reopened = createServerRuntime({
        environment: 'production',
        dataDir,
        persistBrowserState: true,
      });
      await reopened.start();
      expect(reopened.browserState!.read()).toEqual({
        'statecarry.project-drafts.v3.example': 'unsent input',
      });
      const response = await networkFetch(
        `http://${reopened.host}:${reopened.port}/api/v1/local/browser-state`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4311' },
          body: JSON.stringify({ entries: {} }),
        },
      );
      expect(response.status).toBe(403);
      expect(reopened.browserState!.read()).toEqual({
        'statecarry.project-drafts.v3.example': 'unsent input',
      });
    } finally {
      Object.assign(Storage.prototype, methods);
      vi.unstubAllGlobals();
      await runtime.stop();
      await reopened?.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
