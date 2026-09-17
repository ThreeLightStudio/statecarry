export type LocalUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'error';

export type LocalUpdateState = {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  phase: LocalUpdatePhase;
  progress: number | null;
  error: string | null;
};

export interface LocalUpdater {
  state(): Promise<LocalUpdateState>;
  check(): Promise<LocalUpdateState>;
  download(): Promise<LocalUpdateState>;
  restart(): Promise<LocalUpdateState>;
}
