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

it('compares all registered work with explicit focus, searchable projects and exact task navigation', async () => {
  const alpha = projectEntry('alpha');
  const beta = projectEntry('beta');
  beta.focused = true;
  beta.resume!.generatedAt = '2025-01-01T00:00:00Z';
  const disconnected = projectEntry('disconnected');
  disconnected.disconnectedAt = now;
  disconnected.resume = null;
  const stale = projectEntry('stale');
  stale.resume!.stale = true;
  stale.resume!.state = 'limited';
  const h = projectUiFixture([alpha, beta, disconnected, stale]);
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    const pending = mounted.host.querySelector('section[aria-labelledby="pending-heading"]')!;
    expect(pending.querySelector('a')?.getAttribute('href')).toBe('#/project/beta?task=first');
    expect(pending.textContent).not.toContain('Project disconnected');
    expect(pending.textContent).toContain('fresh check');
    expect(
      mounted.host.querySelector('section[aria-labelledby="all-projects-heading"]')?.textContent,
    ).toContain('4 shown · 4 registered');
    const disconnectedFocus = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Make Project disconnected my Home focus"]',
    );
    expect(disconnectedFocus).toBeTruthy();
    await typeField(mounted.host, 'input[name="workspace-search"]', 'beta');
    expect(pending.querySelectorAll('a')).toHaveLength(2);
    expect(
      mounted.host.querySelector('section[aria-labelledby="all-projects-heading"]')?.textContent,
    ).toContain('1 shown · 4 registered');
    await follow(mounted.host, '#/project/beta?task=second');
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Project beta');
    expect(mounted.host.querySelector('[aria-label="Selected task"] h2')?.textContent).toBe(
      'Ship second beta export',
    );
    expect(
      mounted.host.querySelector('[aria-label="Your next choice"] .pw-button--primary')
        ?.textContent,
    ).toMatch(/Open working conversation|Copy task/);
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('keeps ordinary failure, explanation and source-scope expansions free of original text and raw diagnostics', async () => {
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
    await toggleDetails(mounted.host, 'This is the wrong work');
    await toggleDetails(mounted.host, 'Inspect original records');
    clean();
    expect(h.projectGateway.evidence).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('[aria-label="Your next choice"] a')).toBeNull();
    await follow(mounted.host, '#/project/alpha/original/source-alpha?task=first');
    expect(mounted.host.querySelector('pre')?.textContent).toBe(RAW_SOURCE);
    await follow(mounted.host, '#/project/alpha?task=first');
    clean();
    await follow(mounted.host, '#/project/alpha/settings');
    await press(mounted.host, 'Find conversations in this folder');
    expect(mounted.host.textContent).toContain('Only part of the available conversations');
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
  ['done', 'Result to review', 'Review the result against the finish condition'],
  ['paused', 'Paused', 'Keep this work paused'],
  ['accepted', 'Accepted', 'This task is accepted'],
  ['unclear', 'Decision needed', 'Clarify the current situation'],
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
      const task = mounted.host.querySelector('[aria-label="Selected task"]')!;
      expect(task.querySelector('.pw-badge')?.textContent).toBe(label);
      expect(task.querySelector('.pw-decision-main')?.textContent).toContain(decision);
      expect(task.textContent).not.toContain('AN_ACTION_THAT_MUST_NOT_BE_OFFERED');
      expect(
        [...task.querySelectorAll('button,a')].some(
          (item) =>
            item.textContent === 'Copy task for my working tool' ||
            item.textContent === 'Open working conversation',
        ),
      ).toBe(false);
      if (status === 'done') {
        expect(
          button(mounted.host, 'Accept as complete').classList.contains('pw-button--primary'),
        ).toBe(true);
        expect(task.textContent).toContain('acceptance has not been recorded');
      }
      if (status === 'accepted')
        expect(mounted.host.textContent).toContain('No next goal has been chosen');
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
    expect(mounted.host.textContent).toContain('Keep research decisions understandable over time.');
    expect(mounted.host.textContent).toContain('Record the first experiment question.');
    expect(mounted.host.textContent).toContain('checks the codebase and Git state automatically');
    expect(mounted.host.textContent).toContain('No Codex conversation is connected');
    expect(button(mounted.host, 'Prepare the first overview').disabled).toBe(false);
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
    await press(mounted.host, 'Find conversations in this folder');
    const extra = [...mounted.host.querySelectorAll('label')]
      .find((label) => label.textContent === 'Other discussion')!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      extra.click();
    });
    await press(mounted.host, 'Save Codex context');
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
    await press(mounted.host, 'Save project settings');
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
    await press(mounted.host, 'Review saved-data removal');
    expect(mounted.host.textContent).toContain(
      'Work is still running. No data can be removed yet.',
    );
    expect(
      [...mounted.host.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === "Remove this project's saved data",
      ),
    ).toBe(false);
    expect(h.projectGateway.delete).not.toHaveBeenCalled();
    await press(mounted.host, 'Review saved-data removal');
    const preview = mounted.host.querySelector('[aria-label="Removal preview"]')!;
    expect(preview.textContent).toContain('Shared source copies that will be kept');
    expect(preview.textContent).toContain('separate diagnostic files, and backups are retained');
    expect(button(mounted.host, "Remove this project's saved data").disabled).toBe(true);
    await act(async () => {
      preview.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await press(mounted.host, "Remove this project's saved data");
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
    await press(mounted.host, 'Edit goal');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Submitted alpha goal');
    await press(mounted.host, 'Save goal');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Newer alpha draft');
    await follow(mounted.host, '#/project/beta');
    await press(mounted.host, 'Edit goal');
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
    await follow(mounted.host, '#/project/alpha');
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
    await press(mounted.host, 'Edit goal');
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
      'The project changed after this source selection was opened',
    );
    expect(button(mounted.host, 'Save Codex context').disabled).toBe(true);
    expect(h.projectGateway.sources).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});
