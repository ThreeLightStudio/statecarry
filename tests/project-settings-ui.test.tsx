// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  follow,
  installBrowser,
  mountProjectRoot,
  press,
  projectEntry,
  projectUiFixture,
  settle,
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
    await press(mounted.host, 'Update overview');
    const toastLayer = mounted.host.querySelector('.pw-toast-layer');
    expect(toastLayer).toBeTruthy();
    expect(toastLayer?.querySelector('[role="status"]')?.textContent).toContain(
      'Overview update started',
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
      'StateCarry can use Codex when creating or updating overviews.',
    );
    expect(mounted.host.textContent).toContain('Branch main');
    expect(mounted.host.textContent).toContain('Project files were checked for this overview.');
    expect(h.projectGateway.capabilities).toHaveBeenCalledTimes(1);

    await press(mounted.host, 'Check again');
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
    await press(mounted.host, 'Update overview');
    expect(h.resumeGateway.refresh).toHaveBeenLastCalledWith('alpha', 'ko');
  } finally {
    await mounted.unmount();
  }
});

it('toggles the update UI preview from Advanced settings in development', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(mounted.host.textContent).toContain('Advanced');
    expect(mounted.host.textContent).toContain('Developer mode');
    const toggle = mounted.host.querySelector<HTMLInputElement>('input[name="preview-update-ui"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(false);
    expect(mounted.host.querySelector('[aria-label="Download update"]')).toBeNull();

    await act(async () => {
      toggle!.click();
    });
    await settle();

    expect(toggle?.checked).toBe(true);
    expect(window.localStorage.getItem('statecarry.developer.update-ui-preview.v1')).toBe('1');
    const download = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Download update"]',
    );
    expect(download).toBeTruthy();

    vi.useFakeTimers();
    await act(async () => {
      download!.click();
    });
    expect(mounted.host.textContent).toContain('42%');
    expect(mounted.host.querySelector('[aria-label="Restart to update"]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    const restart = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Restart to update"]',
    );
    expect(restart).toBeTruthy();

    await act(async () => {
      restart!.click();
    });
    expect(mounted.host.textContent).toContain('Restarting…');

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(mounted.host.querySelector('[aria-label="Download update"]')).toBeTruthy();
    vi.useRealTimers();

    await act(async () => {
      toggle!.click();
    });
    await settle();

    expect(toggle?.checked).toBe(false);
    expect(window.localStorage.getItem('statecarry.developer.update-ui-preview.v1')).toBeNull();
    expect(mounted.host.querySelector('[aria-label="Download update"]')).toBeNull();
  } finally {
    vi.useRealTimers();
    await mounted.unmount();
  }
});

it('shows readable non-Git projects as codebase-ready while Git stays unavailable', async () => {
  const entry = projectEntry();
  Object.assign(entry.resume!.workspace!, {
    status: 'checked',
    root: entry.cwd,
    branch: null,
    commit: null,
    dirty: null,
    files: [{ path: 'src/main.ts', hash: 'file-hash', status: 'checked', selection: 'sampled' }],
    limitations: ['Git state unavailable: not a Git repository'],
  });
  const h = projectUiFixture([entry]);
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    const integration = mounted.host.querySelector(
      '[aria-label="Integration status for Project alpha"]',
    );
    expect(integration?.textContent).toContain('StateCarry inspected 1 selected project file');
    expect(integration?.textContent).toContain(
      'Git is unavailable for this folder. Project files can still be checked.',
    );
  } finally {
    await mounted.unmount();
  }
});

it('shows discovered Codex tooling as available before the analysis isolation check runs', async () => {
  const h = projectUiFixture();
  vi.mocked(h.projectGateway.capabilities!).mockResolvedValue({
    apiVersion: 1,
    source: 'codex-local',
    summary: {
      state: 'unverified',
      detail: 'RTK and Codex CLI are available. Analysis isolation has not been checked yet.',
      model: null,
    },
    navigation: {
      precision: 'thread',
      verifiedAt: null,
      detail: 'Synthetic navigation is available.',
      state: 'verified-route',
    },
    session: {
      create: 'unsupported',
      send: 'unsupported',
      detail: 'Synthetic session actions are unavailable.',
      verifiedAt: null,
    },
    collectionIntervalMs: 15000,
    discoveryIntervalMs: 60000,
  });
  window.history.replaceState(null, '', '#/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(mounted.host.textContent).toContain('Detected · not verified');
    expect(mounted.host.textContent).toContain(
      "Codex was found, but StateCarry hasn't verified analysis yet.",
    );
    expect(mounted.host.textContent).not.toContain('RTK and Codex CLI');
    expect(mounted.host.textContent).not.toContain('Analysis isolation');
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
