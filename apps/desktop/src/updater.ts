import { DomainError } from '@statecarry/contracts';
import { Updater } from 'electrobun/main';
import type { LocalUpdateState, LocalUpdater } from '../../server/src/adapters/local-updater';

type UpdateStatusEntry = {
  status: string;
  message: string;
  timestamp: number;
  details?: { progress?: number };
};

type UpdateClient = {
  updateInfo(): {
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
  };
  onStatusChange(callback: ((entry: UpdateStatusEntry) => void) | null): void;
  checkForUpdate(): Promise<unknown>;
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
  localInfo: { version(): Promise<string>; channel(): Promise<string> };
};

function phaseFor(status: string | null, state: ReturnType<UpdateClient['updateInfo']>) {
  if (state.error) return 'error' as const;
  if (state.updateReady) return 'ready' as const;
  if (
    status &&
    [
      'download-starting',
      'checking-local-tar',
      'local-tar-found',
      'local-tar-missing',
      'fetching-patch',
      'patch-found',
      'patch-not-found',
      'downloading-patch',
      'applying-patch',
      'patch-applied',
      'extracting-version',
      'patch-chain-complete',
      'downloading-full-bundle',
      'downloading',
      'download-progress',
      'decompressing',
    ].includes(status)
  )
    return 'downloading' as const;
  if (status === 'checking') return 'checking' as const;
  if (state.updateAvailable) return 'available' as const;
  return 'idle' as const;
}

export class ElectrobunUpdater implements LocalUpdater {
  private latestStatus: UpdateStatusEntry | null = null;
  private currentVersion = '';
  private channel = '';
  private restartRequested = false;
  private action: 'check' | 'download' | 'apply' | null = null;

  constructor(
    private requestQuit: () => void,
    private client: UpdateClient = Updater,
  ) {
    this.client.onStatusChange((entry) => {
      this.latestStatus = entry;
      if (entry.status === 'error') console.error(entry.message);
    });
  }

  private async local() {
    if (!this.currentVersion) this.currentVersion = await this.client.localInfo.version();
    if (!this.channel) this.channel = await this.client.localInfo.channel();
  }

  private snapshot(): LocalUpdateState {
    const info = this.client.updateInfo();
    const error = info.error
      ? this.action === 'download'
        ? "StateCarry couldn't download the update. Try again."
        : this.action === 'apply'
          ? "StateCarry couldn't finish the update. Reopen the app and try again."
          : "StateCarry couldn't check for updates. Try again."
      : null;
    return {
      supported: this.channel === 'stable' || this.channel === 'canary',
      currentVersion: this.currentVersion,
      latestVersion: info.version || null,
      phase: this.restartRequested
        ? 'restarting'
        : phaseFor(this.latestStatus?.status ?? null, info),
      progress:
        this.latestStatus?.status === 'download-progress'
          ? (this.latestStatus.details?.progress ?? null)
          : null,
      error,
    };
  }

  async state() {
    await this.local();
    return this.snapshot();
  }

  async check() {
    await this.local();
    this.action = 'check';
    await this.client.checkForUpdate();
    return this.snapshot();
  }

  async download() {
    await this.local();
    this.action = 'download';
    await this.client.downloadUpdate();
    return this.snapshot();
  }

  async restart() {
    await this.local();
    const info = this.client.updateInfo();
    if (!info.updateReady)
      throw new DomainError('VALIDATION', 'Download the update before restarting.', 409);
    this.restartRequested = true;
    setTimeout(this.requestQuit, 0);
    return this.snapshot();
  }

  hasRestartRequest() {
    return this.restartRequested;
  }

  cancelRestart() {
    this.restartRequested = false;
  }

  async applyPreparedUpdate() {
    if (!this.restartRequested) return { state: this.snapshot(), handoffStarted: false };
    this.restartRequested = false;
    this.action = 'apply';
    await this.client.applyUpdate();
    return {
      state: this.snapshot(),
      handoffStarted: this.latestStatus?.status === 'launching-new-version',
    };
  }
}
