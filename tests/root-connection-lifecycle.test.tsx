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
  const connectionId = core.core.project(id).connectionId;
  const h = projectUiFixture([]);
  h.projectGateway.registrations = vi.fn(async () => core.core.projects.registrations());
  h.projectGateway.list = vi.fn(async () => core.core.projects.list());
  h.projectGateway.now = vi.fn(async (projectId) => ({
    initialized: true,
    model: core.core.projectModel.view(projectId),
    now: core.core.now.resolve(projectId),
  }));
  h.projectGateway.connections = vi.fn(async () => core.core.listConnections());
  h.projectGateway.disconnect = vi.fn(async (projectId, revision) =>
    core.core.projects.disconnect(projectId, {
      ...core.command(projectId, {}),
      expectedRevision: revision,
    }),
  );
  h.projectGateway.restore = vi.fn(async (projectId, revision) =>
    core.core.projects.restore(projectId, {
      ...core.command(projectId, {}),
      expectedRevision: revision,
    }),
  );
  window.history.replaceState(null, '', `#/project/${id}`);
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(window.location.hash).toBe(`#/project/${id}`);
    await follow(mounted.host, `#/project/${id}/settings`);
    expect(h.projectGateway.connections).toHaveBeenCalled();
    await press(mounted.host, 'Disconnect project');
    expect(window.location.hash).toBe('#/home');
    await go('#/projects');
    expect(mounted.host.textContent).toContain('Disconnected');
    expect(core.core.projects.list().projects).toEqual([
      expect.objectContaining({ projectId: id, disconnectedAt: expect.any(String) }),
    ]);
    expect(core.core.listProjects()).toEqual([]);
    expect(h.projectGateway.delete).not.toHaveBeenCalled();

    await press(mounted.host, 'Reconnect project');
    expect(window.location.hash).toBe('#/projects');
    expect(core.core.projects.list().projects).toEqual([
      expect.objectContaining({ projectId: id, disconnectedAt: null, connectionId }),
    ]);
    expect(core.core.connection(connectionId).projectId).toBe(id);
    expect(core.core.listProjects()).toEqual([expect.objectContaining({ projectId: id })]);

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
    expect(h.analysisGateway.refresh).not.toHaveBeenCalled();
    expect(h.analysisGateway.setGoal).not.toHaveBeenCalled();
    expect(h.analysisGateway.correct).not.toHaveBeenCalled();
    expect(core.counts().generationCalls).toBe(0);
    expect(core.counts().checkCalls).toBe(0);
  } finally {
    await mounted.unmount();
  }
});
