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
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
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
  beta.resume!.generatedAt = '2025-01-01T00:00:00Z';
  const gamma = projectEntry('gamma');
  const delta = projectEntry('delta');
  const disconnected = projectEntry('disconnected');
  disconnected.disconnectedAt = now;
  disconnected.resume = null;
  const stale = projectEntry('stale');
  stale.resume!.stale = true;
  stale.resume!.state = 'limited';
  const h = projectUiFixture([alpha, beta, gamma, delta, disconnected, stale]);
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    const focus = mounted.host.querySelector('section[aria-labelledby="home-focus-heading"]')!;
    expect(focus.querySelectorAll('.pw-focus-card')).toHaveLength(2);
    expect(focus.querySelectorAll('.pw-focus-slot')).toHaveLength(1);
    expect(focus.textContent).toContain('2 of 3 focus slots used');
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
    await go('#/project/beta');
    await follow(mounted.host, '#/project/beta?task=second');
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Project beta');
    expect(mounted.host.querySelector('[aria-label="Selected task"] h2')?.textContent).toBe(
      'Ship second beta export',
    );
    expect(
      mounted.host.querySelector('[aria-label="Your next choice"] .pw-button--primary')
        ?.textContent,
    ).toMatch(/Open Codex conversation|Copy task context/);
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
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
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
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
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    const deltaCard = [...mounted.host.querySelectorAll<HTMLElement>('.pw-project-list-card')].find(
      (card) => card.textContent?.includes('Project delta'),
    )!;
    const add = [...deltaCard.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === 'Add to focus',
    )!;
    await act(async () => {
      add.click();
    });
    const dialog = mounted.host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Focus is full');
    expect(dialog.textContent).toContain('Project delta will take its place in Home focus.');
    expect(dialog.querySelectorAll('.pw-focus-replace-option')).toHaveLength(3);
    const first = dialog.querySelector<HTMLButtonElement>('.pw-focus-replace-option')!;
    await act(async () => {
      first.click();
    });
    expect(h.projectGateway.settings).toHaveBeenNthCalledWith(1, 'alpha', 7, {
      title: 'Project alpha',
      purpose: 'Make exported work understandable when returning.',
      focused: false,
    });
    expect(h.projectGateway.settings).toHaveBeenNthCalledWith(2, 'delta', 7, {
      title: 'Project delta',
      purpose: 'Make exported work understandable when returning.',
      focused: true,
    });
    expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await mounted.unmount();
  }
});

it('keeps ordinary failure, explanation and source controls free of original text and raw diagnostics', async () => {
  const entry = projectEntry();
  Object.assign(entry.resume!, {
    error: RAW_ERROR,
    limitations: [RAW_ERROR],
    stateDetail: RAW_SOURCE,
    blockedActions: [RAW_ERROR],
    state: 'limited',
  });
  entry.resume!.workspace!.limitations = [RAW_ERROR];
  entry.resume!.candidates[0].progress = {
    reported: [{ revisionId: 'source-alpha', quote: RAW_SOURCE }],
  };
  const h = projectUiFixture([entry]);
  h.projectGateway.discover = vi.fn(async () => ({
    threads: [],
    complete: false,
    limitations: [RAW_ERROR],
  }));
  window.history.replaceState(null, '', '#/project/alpha?task=first');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  const clean = () => {
    expect(mounted.host.textContent).not.toContain(RAW_SOURCE);
    expect(mounted.host.textContent).not.toContain(RAW_ERROR);
  };
  try {
    clean();
    await toggleDetails(mounted.host, 'What is this based on?');
    await toggleDetails(mounted.host, "This task isn't relevant");
    await toggleDetails(mounted.host, 'Inspect original records');
    clean();
    expect(h.projectGateway.evidence).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('[aria-label="Your next choice"] a')).toBeNull();
    await follow(mounted.host, '#/project/alpha/original/source-alpha?task=first');
    expect(mounted.host.querySelector('pre')?.textContent).toBe(RAW_SOURCE);
    await follow(mounted.host, '#/project/alpha?task=first');
    clean();
    await follow(mounted.host, '#/project/alpha/settings');
    await press(mounted.host, 'Find related conversations');
    expect(mounted.host.textContent).toContain('StateCarry could only check some conversations');
    clean();
    expect(h.projectGateway.settings).not.toHaveBeenCalled();
    expect(h.projectGateway.sources).not.toHaveBeenCalled();
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it.each([
  ['waiting', 'Waiting for input', 'Wait for the required input'],
  ['done', 'Result to review', 'Review the result, then accept it or describe what needs changing'],
  ['paused', 'Paused', 'This task is paused'],
  ['accepted', 'Accepted', 'This task is complete'],
  ['unclear', 'Needs a decision', 'Clarify the current situation'],
] as const)(
  'keeps %s distinct and does not turn it into an executable continuation',
  async (status, label, decision) => {
    const entry = projectEntry();
    entry.resume!.candidates = [entry.resume!.candidates[0]];
    const candidate = entry.resume!.candidates[0];
    candidate.status = status === 'accepted' ? 'done' : status;
    candidate.nextAction = 'AN_ACTION_THAT_MUST_NOT_BE_OFFERED';
    if (status === 'done') candidate.completion = { reported: candidate.evidence, verified: [] };
    if (status === 'accepted') entry.acceptedKeys = ['first'];
    const h = projectUiFixture([entry]);
    window.history.replaceState(null, '', '#/project/alpha?task=first');
    const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
    try {
      if (status === 'accepted') {
        expect(mounted.host.querySelector('[aria-label="Selected task"]')).toBeNull();
        expect(mounted.host.textContent).toContain('No next work has been chosen.');
        expect(mounted.host.textContent).toContain('The recorded work is complete.');
        expect(button(mounted.host, 'Set a new direction')).toBeTruthy();
        expect(h.resumeGateway.correct).not.toHaveBeenCalled();
        return;
      }
      const task = mounted.host.querySelector('[aria-label="Selected task"]')!;
      expect(task.querySelector('.pw-badge')?.textContent).toBe(label);
      expect(task.querySelector('.pw-decision-main')?.textContent).toContain(decision);
      expect(task.textContent).not.toContain('AN_ACTION_THAT_MUST_NOT_BE_OFFERED');
      expect(
        [...task.querySelectorAll('button,a')].some(
          (item) =>
            item.textContent === 'Copy task context' ||
            item.textContent === 'Open Codex conversation',
        ),
      ).toBe(false);
      if (status === 'done') {
        expect(button(mounted.host, 'Accept result').classList.contains('pw-button--primary')).toBe(
          true,
        );
        expect(task.textContent).toContain('acceptance has not been recorded');
      }
      expect(h.resumeGateway.correct).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  },
);

it('registers a no-session project, opens it, and requests its project-first overview', async () => {
  const core = harness();
  const h = projectUiFixture([]);
  h.projectGateway.list = vi.fn(async () => core.core.projects.list());
  h.projectGateway.create = vi.fn(async (input) =>
    core.core.projects.create({
      requestId: core.core.ids.next(),
      expectedRevision: 0,
      payload: input,
    }),
  );
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="title"]', 'My independent notes');
    await typeField(mounted.host, 'input[name="cwd"]', '/synthetic/notes');
    await typeField(
      mounted.host,
      'textarea[name="purpose"]',
      'Keep research decisions understandable over time.',
    );
    await typeField(
      mounted.host,
      'textarea[name="initial-goal"]',
      'Record the first experiment question.',
    );
    await press(mounted.host, 'Add project');
    const entry = core.core.projects.list().projects[0];
    expect(entry).toMatchObject({
      title: 'My independent notes',
      purpose: 'Keep research decisions understandable over time.',
      resume: { sessionCount: 0, goalText: 'Record the first experiment question.' },
    });
    expect(window.location.hash).toBe(`#/project/${entry.workId}`);
    expect(mounted.host.textContent).toContain('Record the first experiment question.');
    expect(mounted.host.textContent).toContain('No current work is available.');
    expect(button(mounted.host, 'Update overview').disabled).toBe(false);
    expect(h.projectGateway.create).toHaveBeenCalledWith(
      expect.objectContaining({ threadIds: [], discover: false }),
    );
    expect(h.resumeGateway.refresh).toHaveBeenCalledExactlyOnceWith(entry.workId);
    expect(core.counts().generationCalls).toBe(0);
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
    workId: 'alpha',
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
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
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
      title: 'Project alpha',
      purpose: 'A clearer project purpose.',
      focused: true,
    });
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
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
    workId: 'alpha',
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
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, drafts.memory());
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
    expect(h.rows.projects.map((entry) => entry.workId)).toEqual(['beta']);
    expect(window.location.hash).toBe('#/home');
    expect(drafts.memory().read('alpha')?.goalDraft).toBeNull();
    expect(h.projectGateway.disconnect).not.toHaveBeenCalled();
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('keeps newer input and the destination project when a previous project save completes late', async () => {
  const h = projectUiFixture([projectEntry(), projectEntry('beta')]);
  const drafts = browserDrafts();
  const saved = deferred<void>();
  h.resumeGateway.setGoal = vi.fn(() => saved.promise);
  window.history.replaceState(null, '', '#/project/alpha?task=second');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, drafts.memory());
  try {
    await press(mounted.host, 'Edit direction');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Submitted alpha goal');
    await press(mounted.host, 'Save goal');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Newer alpha draft');
    await go('#/project/beta');
    await press(mounted.host, 'Edit direction');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Independent beta draft');
    await act(async () => {
      saved.resolve();
    });
    await settle();
    expect(window.location.hash).toBe('#/project/beta');
    expect(mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      'Independent beta draft',
    );
    expect(h.resumeGateway.setGoal).toHaveBeenCalledWith(
      'alpha',
      'Submitted alpha goal',
      'resume-v1',
    );
    expect(drafts.memory().read('alpha')?.goalDraft?.text).toBe('Newer alpha draft');
    expect(drafts.memory().read('beta')?.goalDraft?.text).toBe('Independent beta draft');
    await go('#/project/alpha');
    expect(mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      'Newer alpha draft',
    );
  } finally {
    saved.resolve();
    await mounted.unmount();
  }
});

it('does not offer a save when the current goal text has not changed', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await press(mounted.host, 'Edit direction');
    expect(button(mounted.host, 'Save goal').disabled).toBe(true);
    expect(mounted.host.textContent).toContain('No goal changes to save.');
    expect(h.resumeGateway.setGoal).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('does not attach an old source read to a new project revision', async () => {
  const h = projectUiFixture();
  const connections = deferred<Connection[]>();
  h.projectGateway.connections = vi.fn(() => connections.promise);
  window.history.replaceState(null, '', '#/project/alpha/settings');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    h.rows.projects[0].revision = 8;
    await go('#/project/alpha/settings');
    await act(async () => {
      connections.resolve([
        {
          id: 'connection-alpha',
          workId: 'alpha',
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
