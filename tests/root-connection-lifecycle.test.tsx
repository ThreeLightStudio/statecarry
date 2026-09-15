// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Controller, type Gateway, type ResumeGateway } from '@statecarry/presentation';
import type { Command, HandoffTarget, Receipt } from '@statecarry/contracts';
import { Root } from '../apps/web/src/Root';
import { harness } from './helpers';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');

describe('Root connection lifecycle routing', () => {
  it('leaves details for the list on disconnect and restores the same work from that list', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('scrollTo', () => {});
    const h = harness(),
      workId = h.connect(),
      connection = h.core.connection(h.core.work(workId).projectId);
    let resumeRefreshes = 0;
    const command = async (path: string, input: Command): Promise<Receipt | HandoffTarget> => {
      if (path === `/connections/${connection.id}/remove`)
        return h.core.removeConnection(connection.id, input);
      if (path === `/connections/${connection.id}/restore`)
        return h.core.restoreConnection(connection.id, input);
      throw new Error(`Unexpected command ${path}`);
    };
    const gateway: Gateway = {
      projects: async () => h.core.listProjects(),
      connections: async () => h.core.listConnections(),
      removedConnections: async () => h.core.listRemovedConnections(),
      snapshot: async (id) => h.core.snapshot(id),
      evidence: async (id, owner) => h.core.evidence(id, owner),
      discover: h.reader.discover,
      command,
      receipt: async () => {
        throw new Error('Unexpected receipt lookup');
      },
      subscribe: () => () => {},
    };
    const controller = new Controller(
      gateway,
      { read: () => null, write: () => {} },
      h.core.ids.next,
    );
    const resumeGateway: ResumeGateway = {
      list: async () => h.core.resumes.list(),
      setGoal: async () => {},
      refresh: async () => {
        resumeRefreshes++;
      },
      correct: async () => {},
      subscribe: () => () => {},
    };
    const host = document.createElement('div');
    document.body.append(host);
    window.location.hash = `#/details/${workId}`;
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(createElement(Root, { controller, resumeGateway }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(window.location.hash).toBe(`#/details/${workId}`);

      await act(async () => {
        window.location.hash = '#/resume';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        // A late legacy read must not pull the browser back into the detail route.
        await controller.navigate(`#/work/${workId}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(window.location.hash).toBe('#/resume');

      await act(async () => {
        window.location.hash = `#/details/${workId}`;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const disconnect = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Disconnect this work',
      );
      expect(disconnect).toBeTruthy();
      await act(async () => {
        disconnect!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(window.location.hash).toBe('#/connections');
      expect(host.textContent).toContain('Manage connected work');
      expect(host.textContent).toContain('Disconnected work');
      expect(h.core.listProjects()).toEqual([]);

      const reconnect = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Reconnect this work',
      );
      expect(reconnect).toBeTruthy();
      await act(async () => {
        reconnect!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(window.location.hash).toBe(`#/resume/${workId}`);
      expect(h.core.listProjects()).toEqual([expect.objectContaining({ workId })]);
      expect(h.core.connection(connection.id).workId).toBe(workId);
      expect(resumeRefreshes).toBe(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
