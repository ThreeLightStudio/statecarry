// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SavedResumeEdits } from '@statecarry/presentation';
import { LocalResumeMemory } from '../apps/web/src/adapters/resume-memory';
import { harness } from './helpers';
import {
  act,
  button,
  follow,
  installBrowser,
  mountProjectRoot,
  now,
  press,
  projectEntry,
  projectUiFixture,
  testReceipt,
  typeField,
} from './project-ui-fixtures';

beforeEach(installBrowser);
afterEach(() => vi.unstubAllGlobals());

function draft(): SavedResumeEdits {
  return {
    selectedKey: 'old-task',
    goalDraft: { text: 'An obsolete draft goal', version: 'old-version' },
    actionDrafts: [
      [
        'old-task',
        { action: 'An obsolete next step', done: 'Old finish condition', version: 'old-version' },
      ],
    ],
    expanded: [],
    scroll: 0,
  };
}

function browserStorage() {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { values, storage, memory: () => new LocalResumeMemory(() => storage) };
}

function freshProject() {
  const entry = projectEntry('new-statecarry');
  Object.assign(entry, {
    title: 'StateCarry',
    purpose: 'Return to projects with understandable context.',
  });
  Object.assign(entry.resume!, {
    sessionCount: 0,
    goalText: null,
    goalOrigin: 'inferred',
    candidates: [],
    state: 'empty',
    stale: true,
    generatedAt: null,
  });
  return entry;
}

it.each([
  ['/synthetic/alpha', '/synthetic//alpha/./nested/..///'],
  ['/', '/temporary/.././'],
])(
  'opens an existing folder registration %s without applying the new form context',
  async (savedFolder, enteredFolder) => {
    const entry = projectEntry();
    entry.cwd = savedFolder;
    entry.acceptedKeys = ['first'];
    const before = structuredClone(entry);
    const h = projectUiFixture([entry]);
    window.history.replaceState(null, '', '#/new');
    const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
    try {
      await typeField(mounted.host, 'input[name="title"]', 'Do not replace the name');
      await typeField(mounted.host, 'textarea[name="purpose"]', 'Do not replace the purpose');
      await typeField(mounted.host, 'textarea[name="initial-goal"]', 'Do not replace the goal');
      await typeField(mounted.host, 'input[name="cwd"]', enteredFolder);
      const notice = mounted.host.querySelector('[aria-label="Existing project folder"]')!;
      expect(notice.textContent).toContain('This folder is already a project');
      expect(notice.textContent).toContain('do not replace the existing project');
      expect(mounted.host.querySelector('input[name="title"]')).toBeNull();
      expect(
        [...mounted.host.querySelectorAll('button')].some(
          (item) => item.textContent?.trim() === 'Add project',
        ),
      ).toBe(false);
      await act(async () => {
        mounted.host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(h.projectGateway.create).not.toHaveBeenCalled();
      await follow(mounted.host, '#/project/alpha');
      expect(h.rows.projects).toEqual([before]);
      expect(mounted.host.textContent).toContain(before.purpose);
      expect(mounted.host.textContent).toContain(before.resume!.goalText);
      expect(h.projectGateway.settings).not.toHaveBeenCalled();
      expect(h.projectGateway.sources).not.toHaveBeenCalled();
      expect(h.projectGateway.restore).not.toHaveBeenCalled();
      expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
      expect(h.resumeGateway.correct).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  },
);

it('keeps the same basename in a different absolute folder available for registration', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="cwd"]', '/another/alpha');
    await typeField(mounted.host, 'input[name="title"]', 'Another alpha');
    expect(mounted.host.querySelector('[aria-label="Existing project folder"]')).toBeNull();
    expect(button(mounted.host, 'Add project').disabled).toBe(false);
    await press(mounted.host, 'Add project');
    expect(h.projectGateway.create).toHaveBeenCalledExactlyOnceWith({
      title: 'Another alpha',
      cwd: '/another/alpha',
      purpose: '',
      threadIds: [],
      startTurnIds: {},
      recordRanges: {},
      discover: false,
    });
    expect(window.location.hash).toBe('#/project/new-project');
    expect(h.resumeGateway.refresh).toHaveBeenCalledExactlyOnceWith('new-project');
  } finally {
    await mounted.unmount();
  }
});

it('fills the absolute project path from the local folder picker and keeps manual entry after cancel', async () => {
  const h = projectUiFixture();
  vi.mocked(h.projectGateway.chooseFolder!).mockResolvedValueOnce({
    path: '/picked/local-project',
  });
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await press(mounted.host, 'Choose folder');
    expect(h.projectGateway.chooseFolder).toHaveBeenCalledTimes(1);
    expect(mounted.host.querySelector<HTMLInputElement>('input[name=\"cwd\"]')?.value).toBe(
      '/picked/local-project',
    );
    expect(mounted.host.querySelector<HTMLInputElement>('input[name=\"title\"]')?.placeholder).toBe(
      'local-project',
    );

    await typeField(mounted.host, 'input[name=\"cwd\"]', '/manual/project');
    vi.mocked(h.projectGateway.chooseFolder!).mockResolvedValueOnce({ path: null });
    await press(mounted.host, 'Choose folder');
    expect(mounted.host.querySelector<HTMLInputElement>('input[name=\"cwd\"]')?.value).toBe(
      '/manual/project',
    );
    expect(h.projectGateway.create).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('uses the folder name when a new project is registered without a separate name', async () => {
  const h = projectUiFixture([]);
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="cwd"]', '/another/project-alpha');
    expect(button(mounted.host, 'Add project').disabled).toBe(false);
    await press(mounted.host, 'Add project');
    expect(h.projectGateway.create).toHaveBeenCalledExactlyOnceWith({
      title: 'project-alpha',
      cwd: '/another/project-alpha',
      purpose: '',
      threadIds: [],
      startTurnIds: {},
      recordRanges: {},
      discover: false,
    });
    expect(h.resumeGateway.refresh).toHaveBeenCalledExactlyOnceWith('new-project');
  } finally {
    await mounted.unmount();
  }
});

it('opens a disconnected registration without restoring it or creating another registration', async () => {
  const entry = projectEntry();
  entry.disconnectedAt = now;
  entry.resume = null;
  const h = projectUiFixture([entry]);
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="cwd"]', '/synthetic/alpha/');
    expect(mounted.host.textContent).toContain('This folder is already a project');
    await follow(mounted.host, '#/project/alpha');
    expect(mounted.host.textContent).toContain('This project is disconnected');
    expect(h.projectGateway.create).not.toHaveBeenCalled();
    expect(h.projectGateway.restore).not.toHaveBeenCalled();
    expect(h.rows.projects[0].disconnectedAt).toBe(now);
  } finally {
    await mounted.unmount();
  }
});

it('requires review instead of arbitrarily choosing among legacy duplicate folders', async () => {
  const a = projectEntry('alpha'),
    b = projectEntry('beta');
  b.cwd = a.cwd;
  const h = projectUiFixture([a, b]);
  window.history.replaceState(null, '', '#/new');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await typeField(mounted.host, 'input[name="cwd"]', a.cwd);
    expect(mounted.host.textContent).toContain('This folder is used by more than one project');
    expect(mounted.host.querySelector('[aria-label="Existing project folder"]')).toBeNull();
    expect(
      [...mounted.host.querySelectorAll('button')].some(
        (item) => item.textContent?.trim() === 'Add project',
      ),
    ).toBe(false);
    expect(h.projectGateway.create).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('uses the real server reuse receipt when another registration was absent from the initial list', async () => {
  const core = harness();
  const original = core.core.projects.create({
    requestId: core.core.ids.next(),
    expectedRevision: 0,
    payload: {
      title: 'Already registered',
      cwd: '/synthetic/statecarry',
      purpose: 'Keep original purpose',
      goal: 'Keep original goal',
      threadIds: [],
      discover: false,
    },
  });
  const beforeWork = core.core.work(original.workId);
  const beforeConnection = core.core.connection(original.resultId);
  const h = projectUiFixture([]);
  h.projectGateway.list = vi.fn(async () => core.core.projects.list());
  vi.mocked(h.projectGateway.list).mockResolvedValueOnce({ projects: [] });
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
    await typeField(mounted.host, 'input[name="cwd"]', '/synthetic//statecarry/');
    await typeField(mounted.host, 'input[name="title"]', 'Attempted replacement');
    await typeField(mounted.host, 'textarea[name="purpose"]', 'Attempted new purpose');
    await typeField(mounted.host, 'textarea[name="initial-goal"]', 'Attempted new goal');
    await press(mounted.host, 'Add project');
    expect(h.projectGateway.create).toHaveBeenCalledTimes(1);
    expect(await vi.mocked(h.projectGateway.create).mock.results[0].value).toMatchObject({
      command: 'project-reuse',
      workId: original.workId,
    });
    expect(window.location.hash).toBe('#/new');
    expect(mounted.host.textContent).toContain('This folder is already a project');
    expect(mounted.host.textContent).toContain('do not replace the existing project');
    expect(core.core.work(original.workId)).toEqual(beforeWork);
    expect(core.core.connection(original.resultId)).toEqual(beforeConnection);
    await follow(mounted.host, `#/project/${original.workId}`);
    expect(mounted.host.textContent).toContain('Keep original purpose');
    expect(mounted.host.textContent).toContain('Keep original goal');
    expect(core.core.projects.list().projects).toHaveLength(1);
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(core.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });
  } finally {
    await mounted.unmount();
  }
});

it('prunes old browser IDs on the successful full list and starts the new project without old suggestions or goals', async () => {
  const entry = freshProject();
  const disconnected = projectEntry('disconnected');
  disconnected.disconnectedAt = now;
  disconnected.resume = null;
  const h = projectUiFixture([entry, disconnected]);
  const data = browserStorage();
  for (const id of ['old-registration-a', 'old-registration-b', 'disconnected'])
    data.memory().write(id, draft());
  data.storage.setItem('statecarry.work.v1.old-registration-a', 'Old legacy detail draft');
  data.storage.setItem('statecarry.work.v1.disconnected', 'Keep disconnected detail draft');
  data.storage.setItem('another-app', 'keep');
  window.history.replaceState(null, '', '#/project/new-statecarry');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, data.memory());
  try {
    expect(data.memory().read('old-registration-a')).toBeNull();
    expect(data.memory().read('old-registration-b')).toBeNull();
    expect(data.storage.getItem('statecarry.work.v1.old-registration-a')).toBeNull();
    expect(data.storage.getItem('statecarry.work.v1.disconnected')).toBe(
      'Keep disconnected detail draft',
    );
    expect(data.memory().read('disconnected')).toEqual(draft());
    expect(data.storage.getItem('another-app')).toBe('keep');
    expect(mounted.host.textContent).not.toContain('obsolete');
    expect(mounted.host.querySelector('[aria-label="Selected task"]')).toBeNull();
    expect(mounted.host.textContent).not.toContain('No next task has been chosen');
    expect(mounted.host.textContent).toContain('checks project files and Git automatically');
    expect(mounted.host.textContent).toContain('No Codex conversations added');
    expect(button(mounted.host, 'Create overview').disabled).toBe(false);
    await press(mounted.host, 'Set goal');
    expect(mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      '',
    );
    expect(data.memory().read('new-statecarry')?.goalDraft?.text).toBe('');
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('does not recreate a pruned old key when the displayed project disappears during a successful read', async () => {
  const h = projectUiFixture();
  const data = browserStorage();
  data.memory().write('alpha', draft());
  data.storage.setItem('statecarry.work.v1.alpha', 'Old detail draft');
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, data.memory());
  try {
    expect(mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      'An obsolete draft goal',
    );
    h.rows.projects = [freshProject()];
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mounted.host.textContent).toContain('Project not available');
    expect(data.memory().read('alpha')).toBeNull();
    expect(data.storage.getItem('statecarry.work.v1.alpha')).toBeNull();
    await follow(mounted.host, '#/home');
    await follow(mounted.host, '#/project/new-statecarry');
    expect(mounted.host.textContent).not.toContain('obsolete');
    expect(data.memory().read('new-statecarry')).toBeNull();
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('preserves old keys when the full-list read fails and reports a subsequent storage cleanup failure in the real UI', async () => {
  const h = projectUiFixture([freshProject()]);
  vi.mocked(h.projectGateway.list).mockRejectedValueOnce(new Error('RAW_LIST_FAILURE'));
  const data = browserStorage();
  data.memory().write('old-registration', draft());
  data.storage.removeItem.mockImplementation(() => {
    throw new Error('RAW_PRUNE_FAILURE');
  });
  window.history.replaceState(null, '', '#/home');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, data.memory());
  try {
    expect(data.storage.removeItem).not.toHaveBeenCalled();
    expect(data.memory().read('old-registration')).toEqual(draft());
    await press(mounted.host, 'Try again');
    expect(mounted.host.textContent).toContain('Old browser drafts could not be cleared');
    expect(mounted.host.textContent).not.toContain('RAW_PRUNE_FAILURE');
    expect(mounted.host.textContent).not.toContain('RAW_LIST_FAILURE');
    await follow(mounted.host, '#/project/new-statecarry');
    expect(mounted.host.textContent).not.toContain('An obsolete draft goal');
    expect(data.memory().read('new-statecarry')).toBeNull();
  } finally {
    await mounted.unmount();
  }
});

it('keeps Codex context optional before an explicit first analysis, with no inferred user goal', async () => {
  const entry = freshProject();
  const h = projectUiFixture([entry]);
  let threadIds: string[] = [];
  h.projectGateway.connections = vi.fn(async () => [
    {
      id: entry.connectionId,
      workId: entry.workId,
      title: entry.title,
      cwd: entry.cwd,
      threadIds,
      startTurnIds: {},
      discover: false,
      revision: 1,
      createdAt: now,
    },
  ]);
  h.projectGateway.discover = vi.fn(async () => ({
    threads: [{ id: 'chosen-thread', title: 'Current project discussion', cwd: entry.cwd }],
    complete: true,
    limitations: [],
  }));
  h.projectGateway.sources = vi.fn(async (id, _revision, input) => {
    threadIds = [...input.threadIds];
    entry.resume!.sessionCount = threadIds.length;
    return testReceipt(id);
  });
  window.history.replaceState(null, '', '#/project/new-statecarry');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(mounted.host.textContent).toContain('No goal has been recorded');
    expect(button(mounted.host, 'Create overview').disabled).toBe(false);
    expect(mounted.host.textContent).toContain('No Codex conversations added');
    await follow(mounted.host, '#/project/new-statecarry/settings');
    expect(mounted.host.textContent).toContain('Codex conversations');
    await press(mounted.host, 'Find related conversations');
    const checkbox = [...mounted.host.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === 'Current project discussion')!
      .querySelector<HTMLInputElement>('input')!;
    await act(async () => checkbox.click());
    await press(mounted.host, 'Save conversations');
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
    await follow(mounted.host, '#/project/new-statecarry');
    expect(mounted.host.querySelector('[aria-label="Selected task"]')).toBeNull();
    expect(button(mounted.host, 'Create overview').disabled).toBe(false);
    await press(mounted.host, 'Create overview');
    expect(h.resumeGateway.refresh).toHaveBeenCalledExactlyOnceWith('new-statecarry');
    expect(mounted.host.textContent).toContain(
      'Overview update started. You can keep reading while StateCarry checks the project.',
    );
    expect(h.resumeGateway.setGoal).not.toHaveBeenCalled();
    expect(entry.resume!.goalText).toBeNull();
  } finally {
    await mounted.unmount();
  }
});
