import { describe, expect, it, vi } from 'vitest';

vi.mock('electrobun/main', () => ({ Updater: {} }));

import { ElectrobunUpdater } from '../apps/desktop/src/updater';

describe('Electrobun updater bridge', () => {
  it('keeps restart two-phase so StateCarry can stop its runtime before Electrobun swaps the app', async () => {
    let status: ((entry: any) => void) | null = null;
    let resolveDownload!: () => void;
    let info = {
      version: '0.1.0',
      hash: 'old',
      updateAvailable: false,
      updateReady: false,
      error: '',
    };
    const client = {
      updateInfo: () => info,
      onStatusChange: (callback: typeof status) => {
        status = callback;
      },
      checkForUpdate: vi.fn(async () => {
        info = { ...info, version: '0.1.1', hash: 'new', updateAvailable: true };
        status?.({ status: 'update-available', message: 'available', timestamp: Date.now() });
      }),
      downloadUpdate: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDownload = () => {
              info = { ...info, updateReady: true };
              status?.({ status: 'download-complete', message: 'ready', timestamp: Date.now() });
              resolve();
            };
            status?.({
              status: 'download-progress',
              message: 'downloading',
              timestamp: Date.now(),
              details: { progress: 42 },
            });
          }),
      ),
      applyUpdate: vi.fn(async () => {
        status?.({ status: 'launching-new-version', message: 'restarting', timestamp: Date.now() });
      }),
      localInfo: { version: vi.fn(async () => '0.1.0'), channel: vi.fn(async () => 'stable') },
    };
    const requestQuit = vi.fn();
    const updater = new ElectrobunUpdater(requestQuit, client);

    await expect(updater.check()).resolves.toMatchObject({
      currentVersion: '0.1.0',
      latestVersion: '0.1.1',
      phase: 'available',
    });
    const downloading = updater.download();
    await expect(updater.state()).resolves.toMatchObject({ phase: 'downloading', progress: 42 });
    resolveDownload();
    await expect(downloading).resolves.toMatchObject({ phase: 'ready' });

    await expect(updater.restart()).resolves.toMatchObject({ phase: 'restarting' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(updater.hasRestartRequest()).toBe(true);
    expect(client.applyUpdate).not.toHaveBeenCalled();

    await expect(updater.applyPreparedUpdate()).resolves.toMatchObject({ handoffStarted: true });
    expect(client.applyUpdate).toHaveBeenCalledTimes(1);
    expect(updater.hasRestartRequest()).toBe(false);
  });

  it('keeps Electrobun diagnostics out of the user-facing update state', async () => {
    const client = {
      updateInfo: () => ({
        version: '',
        hash: '',
        updateAvailable: false,
        updateReady: false,
        error: 'Failed to check https://example.invalid/private/path with HTTP 500',
      }),
      onStatusChange: vi.fn(),
      checkForUpdate: vi.fn(async () => {}),
      downloadUpdate: vi.fn(async () => {}),
      applyUpdate: vi.fn(async () => {}),
      localInfo: { version: vi.fn(async () => '0.1.0'), channel: vi.fn(async () => 'stable') },
    };
    const updater = new ElectrobunUpdater(vi.fn(), client);

    const state = await updater.check();
    expect(state.error).toBe("StateCarry couldn't check for updates. Try again.");
    expect(JSON.stringify(state)).not.toContain('example.invalid');
    expect(JSON.stringify(state)).not.toContain('/private/path');
  });
});
