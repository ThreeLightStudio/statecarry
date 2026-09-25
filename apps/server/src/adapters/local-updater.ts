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

/** State for environments without a desktop updater (dev, source runs). The
 * automatic state and check polls must get this instead of an error so a
 * normal startup stays quiet in the server log. */
export function unsupportedUpdateState(): LocalUpdateState {
  return {
    supported: false,
    currentVersion: '',
    latestVersion: null,
    phase: 'idle',
    progress: null,
    error: null,
  };
}
