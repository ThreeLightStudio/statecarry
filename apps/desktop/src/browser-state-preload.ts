import { randomUUID } from 'node:crypto';

export function browserStatePreload(entries: Record<string, string>, origin: string) {
  // The native preload restores browser-owned state before React reads it.
  return `(() => {
    if (window !== window.top || location.origin !== ${JSON.stringify(origin)}) return;
    const saved = ${JSON.stringify(entries)};
    const storage = window.localStorage;
    const session = ${JSON.stringify(randomUUID())};
    const marker = 'statecarry.profile-bootstrap';
    if (sessionStorage.getItem(marker) !== session) {
      for (const key of Object.keys(storage)) {
        if (key.startsWith('statecarry.')) storage.removeItem(key);
      }
      for (const [key, value] of Object.entries(saved)) storage.setItem(key, value);
      sessionStorage.setItem(marker, session);
    }
    let chain = Promise.resolve();
    let timer;
    function save(flush) {
      clearTimeout(timer);
      const entries = Object.fromEntries(Object.keys(storage)
        .filter(key => key.startsWith('statecarry.')).map(key => [key, storage.getItem(key)]));
      const body = JSON.stringify({ entries, ...(flush ? { flush } : {}) });
      chain = chain.catch(() => {}).then(async () => {
        const response = await fetch('/api/v1/local/browser-state', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          keepalive: new TextEncoder().encode(body).length < 60000,
        });
        if (!response.ok) throw new Error('Could not save browser state');
      });
      chain.catch(error => console.error(error));
      return chain;
    }
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(...args) {
        const result = original.apply(this, args);
        if (this === storage) { clearTimeout(timer); timer = setTimeout(() => save(), 50); }
        return result;
      };
    }
    window.addEventListener('statecarry:flush', event => { void save(event.detail); });
    window.addEventListener('pagehide', () => { void save(); });
  })();`;
}
