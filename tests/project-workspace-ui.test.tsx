// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  browserDrafts,
  button,
  deferred,
  follow,
  go,
  installBrowser,
  mountProjectRoot,
  now,
  press,
  projectEntry,
  projectUiFixture,
  RAW_ERROR,
  RAW_SOURCE,
  settle,
  testReceipt,
  toggleDetails,
  typeField,
} from './project-ui-fixtures';
import { harness } from './helpers';
import type { Connection, ProjectDeletionPreview } from '@statecarry/contracts';

beforeEach(installBrowser);
afterEach(() => vi.unstubAllGlobals());

it('shows the StateCarry brand mark and inline beta preview in the single app header', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    const brand = mounted.host.querySelector<HTMLAnchorElement>('a.pw-brand[href="#/home"]');
    expect(brand).toBeTruthy();
    expect(brand?.querySelector('.pw-brand-mark')).toBeTruthy();
    expect(brand?.querySelector('.pw-brand-name')?.textContent).toBe('StateCarry');
    expect(brand?.querySelector('.pw-beta-badge')).toBeNull();
    const header = mounted.host.querySelector<HTMLElement>('.pw-app-header')!;
    expect(header.querySelector('.pw-app-header-title')?.textContent).toBe('Home');
    expect(header.querySelector('.pw-beta-badge')?.textContent).toBe('Beta');
    expect(mounted.host.querySelector('.pw-breadcrumb')).toBeNull();
    const beta = header.querySelector<HTMLElement>('.pw-beta-wrap');
    const popover = beta?.querySelector<HTMLElement>('.pw-beta-popover');
    expect(beta?.getAttribute('aria-describedby')).toBe('beta-preview-detail');
    expect(popover?.getAttribute('role')).toBe('tooltip');
    expect(popover?.textContent).toContain('StateCarry is still being stabilized');
  } finally {
    await mounted.unmount();
  }
});

it('shows up to three Home focus slots and moves full project browsing to Projects', async () => {
  const alpha = projectEntry('alpha');
  alpha.focused = true;
  const beta = projectEntry('beta');
  beta.focused = true;
  beta.analysis!.generatedAt = '2025-01-01T00:00:00Z';
  const gamma = projectEntry('gamma');
  const delta = projectEntry('delta');
  const disconnected = projectEntry('disconnected');
  disconnected.disconnectedAt = now;
  disconnected.analysis = null;
  const stale = projectEntry('stale');
  stale.analysis!.stale = true;
  stale.analysis!.state = 'limited';
  const h = projectUiFixture([alpha, beta, gamma, delta, disconnected, stale]);
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    const focus = mounted.host.querySelector('section[aria-labelledby="home-focus-heading"]')!;
    expect(focus.querySelectorAll('.pw-focus-card')).toHaveLength(2);
    expect(focus.querySelectorAll('.pw-focus-slot')).toHaveLength(1);
    expect(focus.textContent).toContain('2 of 3 in focus');
    expect(focus.querySelector('a[href="#/project/alpha"]')).toBeTruthy();
    expect(focus.querySelector('a[href="#/project/beta"]')).toBeTruthy();
    expect(focus.textContent).not.toContain('Project disconnected');
    expect(mounted.host.querySelector('[aria-labelledby="active-projects-heading"]')).toBeNull();
    await follow(mounted.host, '#/projects');
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Projects');
    expect(mounted.host.querySelector('select[name="project-filter"]')).toBeNull();
    expect(mounted.host.querySelector('input[name="workspace-search"]')).toBeTruthy();
    expect(
      mounted.host.querySelector('section[aria-labelledby="active-projects-heading"]')?.textContent,
    ).toContain('5 shown');
    expect(
      mounted.host.querySelector('section[aria-labelledby="disconnected-projects-heading"]')
        ?.textContent,
    ).toContain('Project disconnected');
    await typeField(mounted.host, 'input[name="workspace-search"]', 'beta');
    expect(
      mounted.host.querySelector('section[aria-labelledby="active-projects-heading"]')?.textContent,
    ).toContain('1 shown');
    expect(
      mounted.host.querySelector(
        'section[aria-labelledby="active-projects-heading"] a[href="#/project/beta"]',
      ),
    ).toBeTruthy();
    expect(h.analysisGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('keeps project search hidden below six projects and adds focus immediately when a slot is free', async () => {
  const alpha = projectEntry('alpha');
  alpha.focused = true;
  const beta = projectEntry('beta');
  const h = projectUiFixture([alpha, beta]);
  window.history.replaceState(null, '', '#/projects');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('input[name="workspace-search"]')).toBeNull();
    const betaCard = [...mounted.host.querySelectorAll<HTMLElement>('.pw-project-list-card')].find(
      (card) => card.textContent?.includes('Project beta'),
    )!;
    const add = [...betaCard.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === 'Add to focus',
    )!;
    await act(async () => {
      add.click();
    });
    expect(h.projectGateway.settings).toHaveBeenCalledWith('beta', 7, {
      responseLanguage: 'en',
      title: 'Project beta',
      purpose: 'Make exported work understandable when returning.',
      focused: true,
    });
    expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await mounted.unmount();
  }
});

it('opens a replacement modal when all three focus slots are full', async () => {
  const alpha = projectEntry('alpha');
  const beta = projectEntry('beta');
  const gamma = projectEntry('gamma');
  const delta = projectEntry('delta');
  alpha.focused = true;
  beta.focused = true;
  gamma.focused = true;
  const h = projectUiFixture([alpha, beta, gamma, delta]);
  window.history.replaceState(null, '', '#/projects');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    const deltaCard = [...mounted.host.querySelectorAll<HTMLElement>('.pw-project-list-card')].find(
      (card) => card.textContent?.includes('Project delta'),
    )!;
    const add = [...deltaCard.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === 'Add to focus',
    )!;
    await act(async () => {
      add.focus();
      add.click();
    });
    const dialog = mounted.host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Focus is full');
    expect(dialog.textContent).toContain('Project delta will take its place in Home focus.');
    expect(dialog.querySelectorAll('.pw-focus-replace-option')).toHaveLength(3);
    expect(document.activeElement).toBe(dialog.querySelector('#focus-replace-heading'));
    const first = dialog.querySelector<HTMLButtonElement>('.pw-focus-replace-option')!;
    await act(async () => {
      first.click();
    });
    expect(h.projectGateway.settings).toHaveBeenNthCalledWith(1, 'alpha', 7, {
      responseLanguage: 'en',
      title: 'Project alpha',
      purpose: 'Make exported work understandable when returning.',
      focused: false,
    });
    expect(h.projectGateway.settings).toHaveBeenNthCalledWith(2, 'delta', 7, {
      responseLanguage: 'en',
      title: 'Project delta',
      purpose: 'Make exported work understandable when returning.',
      focused: true,
    });
    expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(add);
  } finally {
    await mounted.unmount();
  }
});

it('preserves exact source boundaries and submits source/profile changes with the reviewed revision', async () => {
  const h = projectUiFixture();
  const exact = {
    start: { turnId: 'turn-start', itemId: 'item-start' },
    end: { turnId: 'turn-end', itemId: 'item-end' },
  };
  const connection: Connection = {
    id: 'connection-alpha',
    projectId: 'alpha',
    title: 'Project alpha',
    cwd: '/synthetic/alpha',
    threadIds: ['thread-alpha'],
    startTurnIds: { 'thread-alpha': 'turn-start' },
    recordRanges: { 'thread-alpha': exact },
    discover: false,
    revision: 1,
    createdAt: now,
  };
  h.projectGateway.connections = vi.fn(async () => [connection]);
  h.projectGateway.discover = vi.fn(async () => ({
    threads: [
      { id: 'thread-alpha', title: 'Export discussion', cwd: connection.cwd },
      { id: 'thread-extra', title: 'Other discussion', cwd: connection.cwd },
    ],
    complete: true,
    limitations: [],
  }));
  window.history.replaceState(null, '', '#/project/alpha/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(h.projectGateway.sources).not.toHaveBeenCalled();
    await press(mounted.host, 'Find related conversations');
    const extra = [...mounted.host.querySelectorAll('label')]
      .find((label) => label.textContent === 'Other discussion')!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      extra.click();
    });
    await press(mounted.host, 'Save conversations');
    expect(h.projectGateway.sources).toHaveBeenCalledWith('alpha', 7, {
      threadIds: ['thread-alpha', 'thread-extra'],
      startTurnIds: { 'thread-alpha': 'turn-start' },
      recordRanges: { 'thread-alpha': exact },
      discover: false,
    });
    await typeField(mounted.host, 'textarea[name="purpose"]', 'A clearer project purpose.');
    const focus = mounted.host.querySelector<HTMLInputElement>(
      'section[aria-labelledby="project-profile-heading"] input[type="checkbox"]',
    )!;
    await act(async () => {
      focus.click();
    });
    await press(mounted.host, 'Save details');
    expect(h.projectGateway.settings).toHaveBeenCalledWith('alpha', 7, {
      responseLanguage: 'en',
      title: 'Project alpha',
      purpose: 'A clearer project purpose.',
      focused: true,
      iconAsset: null,
      bannerAsset: null,
    });
    expect(h.analysisGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('keeps unsaved source edits when range validation fails and hides the reload action', async () => {
  const h = projectUiFixture();
  const connection: Connection = {
    id: 'connection-alpha',
    projectId: 'alpha',
    title: 'Project alpha',
    cwd: '/synthetic/alpha',
    threadIds: ['thread-alpha'],
    startTurnIds: { 'thread-alpha': 'turn-start' },
    recordRanges: { 'thread-alpha': { start: { turnId: 'turn-start', itemId: '' } } },
    discover: false,
    revision: 1,
    createdAt: now,
  };
  h.projectGateway.connections = vi.fn(async () => [connection]);
  window.history.replaceState(null, '', '#/project/alpha/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await settle();
    expect(h.projectGateway.connections).toHaveBeenCalledTimes(1);
    await press(mounted.host, 'Save conversations');
    const notice = mounted.host.querySelector('.pw-notice[role="alert"]')!;
    expect(notice.textContent).toContain(
      'Complete the required IDs for the advanced conversation range, or remove it.',
    );
    expect([...notice.querySelectorAll('button')]).toHaveLength(0);
    expect(h.projectGateway.connections).toHaveBeenCalledTimes(1);
    expect(h.projectGateway.sources).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('shows a scoped removal preview and requires confirmation before removing only that registration', async () => {
  const h = projectUiFixture([projectEntry(), projectEntry('beta')]);
  const drafts = browserDrafts();
  drafts
    .memory()
    .write('alpha', {
      selectedKey: 'first',
      goalDraft: { text: 'Saved local draft', version: 'resume-v1' },
      actionDrafts: [],
      expanded: [],
      scroll: 0,
    });
  const blocked: ProjectDeletionPreview = {
    projectId: 'alpha',
    title: 'Project alpha',
    token: 'blocked-token',
    revision: 7,
    ownedRecords: 12,
    exclusiveSources: 2,
    sharedSources: 3,
    blocked: true,
    explanation: 'Work is still running. No data can be removed yet.',
  };
  vi.mocked(h.projectGateway.deletionPreview).mockResolvedValueOnce(blocked);
  window.history.replaceState(null, '', '#/project/alpha/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway, drafts.memory());
  try {
    await press(mounted.host, 'Review what will be deleted');
    expect(mounted.host.textContent).toContain(
      'Project data cannot be deleted while StateCarry is still checking work or the latest outcome is unresolved.',
    );
    expect(mounted.host.textContent).not.toContain(
      'Work is still running. No data can be removed yet.',
    );
    expect(
      [...mounted.host.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Delete project data',
      ),
    ).toBe(false);
    expect(h.projectGateway.delete).not.toHaveBeenCalled();
    await press(mounted.host, 'Review what will be deleted');
    const preview = mounted.host.querySelector('[aria-label="Deletion preview"]')!;
    expect(preview.textContent).toContain('Shared sources kept');
    expect(preview.textContent).not.toContain(
      'separate diagnostic files, and backups are retained',
    );
    expect(button(mounted.host, 'Delete project data').disabled).toBe(true);
    await act(async () => {
      preview.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await press(mounted.host, 'Delete project data');
    expect(h.projectGateway.delete).toHaveBeenCalledWith('alpha', 7, 'preview-token');
    expect(h.rows.projects.map((entry) => entry.projectId)).toEqual(['beta']);
    expect(window.location.hash).toBe('#/home');
    expect(drafts.memory().read('alpha')?.goalDraft).toBeNull();
    expect(h.projectGateway.disconnect).not.toHaveBeenCalled();
    expect(h.analysisGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('does not attach an old source read to a new project revision', async () => {
  const h = projectUiFixture();
  const connections = deferred<Connection[]>();
  let changed: (() => void) | undefined;
  h.analysisGateway.subscribe = (listener) => {
    changed = () => listener({ projectId: 'alpha', topic: 'sources' });
    return () => {};
  };
  h.projectGateway.connections = vi.fn(() => connections.promise);
  window.history.replaceState(null, '', '#/project/alpha/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    h.rows.projects[0].revision = 8;
    await act(async () => {
      changed!();
    });
    await vi.waitFor(() => expect(h.projectGateway.list).toHaveBeenCalledTimes(2));
    await settle();
    await act(async () => {
      connections.resolve([
        {
          id: 'connection-alpha',
          projectId: 'alpha',
          cwd: '/synthetic/alpha',
          title: 'Project alpha',
          threadIds: ['thread-alpha'],
          startTurnIds: {},
          discover: false,
          revision: 1,
          createdAt: now,
        },
      ]);
    });
    await settle();
    expect(mounted.host.textContent).toContain(
      'The project changed while these Codex conversations were open',
    );
    expect(button(mounted.host, 'Save conversations').disabled).toBe(true);
    expect(h.projectGateway.sources).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});
