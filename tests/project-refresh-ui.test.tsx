// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceSnapshot } from '@statecarry/contracts';
import {
  act,
  deferred,
  installBrowser,
  mountProjectRoot,
  projectUiFixture,
} from './project-ui-fixtures';

beforeEach(installBrowser);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('checks once on app return, with no periodic read or analysis', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.projectGateway.observe).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(2);
    expect(h.projectGateway.observe).toHaveBeenCalledTimes(2);
    expect(h.projectGateway.analyzeWorkspace).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('.pw-app-header .pw-workspace-status')).toBeNull();
    expect(mounted.host.querySelector('.pw-app-header')?.textContent).toContain('Send feedback');
    expect(mounted.host.querySelector('.pw-app-header')?.textContent).not.toContain(
      'Check for changes',
    );
    expect(h.analysisGateway.refresh).not.toHaveBeenCalled();
    expect(h.analysisGateway.setGoal).not.toHaveBeenCalled();
    expect(h.analysisGateway.correct).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await mounted.unmount();
  }
});

it('keeps the first stream connection from starting the full workspace read before ProjectNow', async () => {
  const h = projectUiFixture();
  const originalNow = h.projectGateway.now!;
  const pendingNow = deferred<Awaited<ReturnType<typeof originalNow>>>();
  h.projectGateway.registrations = vi.fn(async () => ({
    projects: h.rows.projects.map((entry) => ({
      projectId: entry.projectId,
      connectionId: entry.connectionId,
      title: entry.title,
      cwd: entry.cwd,
      purpose: entry.purpose,
      focused: entry.focused,
      iconAsset: entry.iconAsset ?? null,
      bannerAsset: entry.bannerAsset ?? null,
      revision: entry.revision,
      disconnectedAt: entry.disconnectedAt,
    })),
  }));
  h.projectGateway.now = vi.fn(() => pendingNow.promise);
  let connected!: (state: 'connected' | 'disconnected') => void;
  h.analysisGateway.subscribe = (_listener, onConnection) => {
    connected = onConnection!;
    return () => {};
  };
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await act(async () => {
      connected('connected');
    });
    expect(h.projectGateway.list).not.toHaveBeenCalled();

    await act(async () => {
      pendingNow.resolve(await originalNow('alpha'));
    });
    await vi.waitFor(() => expect(h.projectGateway.list).toHaveBeenCalledTimes(2));
  } finally {
    await mounted.unmount();
  }
});

it('keeps saved project content visible while semantic repository analysis runs', async () => {
  const h = projectUiFixture();
  const workspace: WorkspaceSnapshot = {
    cwd: '/synthetic/alpha',
    root: '/synthetic/alpha',
    branch: 'main',
    commit: 'synthetic-commit',
    dirty: true,
    changedPaths: ['src/current.ts'],
    changedFiles: [{ path: 'src/current.ts', status: 'modified' }],
    changedFileCount: 1,
    additions: 3,
    deletions: 1,
    untrackedCount: 0,
    diffPreview: '+current change',
    recentCommits: [],
    status: 'checked',
    checkedAt: '2026-09-21T13:00:00Z',
    limitations: [],
    files: [],
  };
  h.rows.projects[0].analysis!.workspace = structuredClone(workspace);
  h.projectGateway.observe = vi.fn(async () => structuredClone(workspace));
  const pendingAnalysis = deferred<WorkspaceSnapshot>();
  h.projectGateway.analyzeWorkspace = vi.fn(() => pendingAnalysis.promise);
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await vi.waitFor(() => expect(h.projectGateway.analyzeWorkspace).toHaveBeenCalledTimes(1));
    expect(mounted.host.textContent).toContain('Analyzing repository changes…');
    expect(mounted.host.textContent).toContain('Ship the alpha export');
    expect(mounted.host.textContent).not.toContain('Saved project state is unavailable.');

    await act(async () => {
      pendingAnalysis.resolve({
        ...workspace,
        workingTreeAnalysis: { summary: 'One current change.', groups: [] },
      });
    });
    await vi.waitFor(() =>
      expect(mounted.host.textContent).not.toContain('Analyzing repository changes…'),
    );
    expect(mounted.host.textContent).toContain('Ship the alpha export');
  } finally {
    await mounted.unmount();
  }
});

it('does not turn passive observation failure into a global project error', async () => {
  const h = projectUiFixture();
  h.projectGateway.observe = vi.fn(async () => {
    throw new Error('synthetic observation failure');
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await vi.waitFor(() => expect(h.projectGateway.observe).toHaveBeenCalledTimes(1));
    expect(mounted.host.textContent).toContain('Ship the alpha export');
    expect(mounted.host.textContent).not.toContain('StateCarry could not complete that action.');
    expect(mounted.host.textContent).not.toContain('Saved project state is unavailable.');
  } finally {
    await mounted.unmount();
  }
});
