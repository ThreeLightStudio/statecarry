// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  follow,
  installBrowser,
  mountProjectRoot,
  press,
  projectEntry,
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

it('renders mutation notices in a fixed toast layer without replacing inline errors', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await press(mounted.host, 'Prepare an updated overview');
    const toastLayer = mounted.host.querySelector('.pw-toast-layer');
    expect(toastLayer).toBeTruthy();
    expect(toastLayer?.querySelector('[role="status"]')?.textContent).toContain(
      'Overview preparation started',
    );
    expect(mounted.host.querySelector('main > .pw-notice[role="status"]')).toBeNull();
  } finally {
    await mounted.unmount();
  }
});

it('keeps primary RouteLink controls as real anchors with the shadcn foreground class', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    const link = [...mounted.host.querySelectorAll<HTMLAnchorElement>('a[href="#/new"]')].find(
      (item) => item.classList.contains('pw-button--primary'),
    );
    expect(link).toBeTruthy();
    expect(link?.className).toContain('pw-button--primary');
    expect(link?.className).toContain('text-primary-foreground');
  } finally {
    await mounted.unmount();
  }
});

it('shows global integration settings, persists Korean responses, and uses them for overview refresh', async () => {
  const entry = projectEntry();
  const h = projectUiFixture([entry]);
  window.history.replaceState(null, '', '#/settings');
  let mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(window.location.hash).toBe('#/settings');
    expect(mounted.host.querySelector('h1')?.textContent).toBe('StateCarry settings');
    expect(
      mounted.host
        .querySelector<HTMLAnchorElement>('a[href="#/settings"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(mounted.host.textContent).toContain(
      'StateCarry can use the Codex installation available on this machine.',
    );
    expect(mounted.host.textContent).toContain('Branch main');
    expect(mounted.host.textContent).toContain('The project folder is checked automatically');
    expect(h.projectGateway.capabilities).toHaveBeenCalledTimes(1);

    await press(mounted.host, 'Recheck Codex');
    expect(h.projectGateway.capabilities).toHaveBeenCalledTimes(2);
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);

    await typeField(mounted.host, 'select[name="response-language"]', 'ko');
    expect(window.localStorage.getItem('statecarry.response-language.v1')).toBe('ko');
    expect(h.resumeGateway.localize).toHaveBeenCalledWith('alpha', 'ko');

    await mounted.unmount();
    mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
    expect(
      mounted.host.querySelector<HTMLSelectElement>('select[name="response-language"]')?.value,
    ).toBe('ko');

    await follow(mounted.host, '#/project/alpha');
    await press(mounted.host, 'Prepare an updated overview');
    expect(h.resumeGateway.refresh).toHaveBeenLastCalledWith('alpha', 'ko');
  } finally {
    await mounted.unmount();
  }
});

it('repairs a saved language mismatch when settings opens after an earlier Korean preference', async () => {
  window.localStorage.setItem('statecarry.response-language.v1', 'ko');
  const entry = projectEntry();
  entry.resume!.outputLanguage = 'en';
  const h = projectUiFixture([entry]);
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(h.resumeGateway.localize).toHaveBeenCalledWith('alpha', 'ko');
    expect(entry.resume!.outputLanguage).toBe('ko');
  } finally {
    await mounted.unmount();
  }
});

it('uses the persisted Korean response language for a newly created project overview', async () => {
  window.localStorage.setItem('statecarry.response-language.v1', 'ko');
  const h = projectUiFixture([]);
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="cwd"]', '/synthetic/new-korean-project');
    await press(mounted.host, 'Add project');
    expect(h.resumeGateway.refresh).toHaveBeenLastCalledWith('new-project', 'ko');
  } finally {
    await mounted.unmount();
  }
});
