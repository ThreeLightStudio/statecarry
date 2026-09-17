// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '@statecarry/presentation';
import {
  installBrowser,
  mountProjectRoot,
  press,
  projectUiFixture,
  settle,
} from './project-ui-fixtures';

describe('desktop update UI', () => {
  beforeEach(() => {
    installBrowser();
    window.history.replaceState(null, '', '#/home');
  });
  afterEach(() => vi.restoreAllMocks());

  it('offers an available update beside Settings, then changes to restart after download', async () => {
    const fixture = projectUiFixture();
    let state: AppUpdateState = {
      supported: true,
      currentVersion: '0.1.0',
      latestVersion: '0.1.1',
      phase: 'available',
      progress: null,
      error: null,
    };
    fixture.projectGateway.appUpdate = vi.fn(async () => state);
    fixture.projectGateway.checkAppUpdate = vi.fn(async () => state);
    fixture.projectGateway.downloadAppUpdate = vi.fn(async () => {
      state = { ...state, phase: 'ready' };
      return state;
    });
    fixture.projectGateway.restartAppUpdate = vi.fn(async () => {
      state = { ...state, phase: 'restarting' };
      return state;
    });

    const mounted = await mountProjectRoot(fixture.projectGateway, fixture.resumeGateway);
    try {
      await settle();
      expect(mounted.host.textContent).toContain('Settings');
      expect(mounted.host.textContent).toContain('Download update');

      await press(mounted.host, 'Download update');
      await settle();
      expect(fixture.projectGateway.downloadAppUpdate).toHaveBeenCalledTimes(1);
      expect(mounted.host.textContent).toContain('Restart');

      await press(mounted.host, 'Restart');
      expect(fixture.projectGateway.restartAppUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
  });
});
