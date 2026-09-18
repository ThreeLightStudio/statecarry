// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { harness } from './helpers';
import {
  act,
  deferred,
  follow,
  go,
  installBrowser,
  mountProjectRoot,
  press,
  projectUiFixture,
  settle,
} from './project-ui-fixtures';
import type { ProjectWorkspace } from '@statecarry/presentation';

beforeEach(installBrowser);
afterEach(() => vi.unstubAllGlobals());

it('uses the real Root and Core to disconnect, restore the same registration, and reject navigation from a late read', async () => {
  const core = harness();
  const id = core.connect();
  const connectionId = core.core.work(id).projectId;
  const h = projectUiFixture([]);
  h.projectGateway.list = vi.fn(async () => core.core.projects.list());
  h.projectGateway.connections = vi.fn(async () => core.core.listConnections());
  h.projectGateway.disconnect = vi.fn(async (workId, revision) =>
    core.core.projects.disconnect(workId, {
      ...core.command(workId, {}),
      expectedRevision: revision,
    }),
  );
  h.projectGateway.restore = vi.fn(async (workId, revision) =>
    core.core.projects.restore(workId, { ...core.command(workId, {}), expectedRevision: revision }),
  );
  window.history.replaceState(null, '', `#/details/${id}`);
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(window.location.hash).toBe(`#/project/${id}`);
    await follow(mounted.host, `#/project/${id}/settings`);
    expect(h.projectGateway.connections).toHaveBeenCalled();
    await press(mounted.host, 'Disconnect project');
    expect(window.location.hash).toBe('#/home');
    await go('#/projects');
    expect(mounted.host.textContent).toContain('Disconnected');
    expect(core.core.projects.list().projects).toEqual([
      expect.objectContaining({ workId: id, disconnectedAt: expect.any(String) }),
    ]);
    expect(core.core.listProjects()).toEqual([]);
    expect(h.projectGateway.delete).not.toHaveBeenCalled();

    await press(mounted.host, 'Reconnect project');
    expect(window.location.hash).toBe('#/projects');
    expect(core.core.projects.list().projects).toEqual([
      expect.objectContaining({ workId: id, disconnectedAt: null, connectionId }),
    ]);
    expect(core.core.connection(connectionId).workId).toBe(id);
    expect(core.core.listProjects()).toEqual([expect.objectContaining({ workId: id })]);

    const pending = deferred<ProjectWorkspace>();
    vi.mocked(h.projectGateway.list).mockImplementationOnce(() => pending.promise);
    await follow(mounted.host, `#/project/${id}`);
    await go('#/home');
    await act(async () => {
      pending.resolve(core.core.projects.list());
    });
    await settle();
    expect(window.location.hash).toBe('#/home');
    expect(mounted.host.querySelector('h1')?.textContent).toBe('Where will you pick up?');
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(h.resumeGateway.setGoal).not.toHaveBeenCalled();
    expect(h.resumeGateway.correct).not.toHaveBeenCalled();
    expect(core.counts().generationCalls).toBe(0);
    expect(core.counts().checkCalls).toBe(0);
  } finally {
    await mounted.unmount();
  }
});
