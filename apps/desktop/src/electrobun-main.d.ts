/**
 * Electrobun 2.x projects receive the authoritative SDK types through the
 * generated `.hutch/devkit`. The npm `electrobun` package is a CLI bootstrap
 * and intentionally ships no `electrobun/main` declarations, so the root
 * repository TypeScript check needs this narrow declaration for the APIs used
 * by the desktop entrypoint.
 */
declare module 'electrobun/main' {
  export const PATHS: { VIEWS_FOLDER: string };
  export type ApplicationMenuItemConfig =
    | { type: 'divider' | 'separator' }
    | {
        type?: 'normal';
        label?: string;
        role?: string;
        accelerator?: string;
        submenu?: ApplicationMenuItemConfig[];
        enabled?: boolean;
        checked?: boolean;
        hidden?: boolean;
      };
  export const ApplicationMenu: { setApplicationMenu(menu: ApplicationMenuItemConfig[]): void };
  export const Utils: {
    openFileDialog(options: {
      canChooseFiles: false;
      canChooseDirectory: true;
      allowsMultipleSelection: false;
    }): Promise<string[]>;
    openExternal(url: string): boolean;
  };

  export const Updater: {
    updateInfo(): {
      version: string;
      hash: string;
      updateAvailable: boolean;
      updateReady: boolean;
      error: string;
    };
    onStatusChange(
      callback:
        | ((entry: {
            status: string;
            message: string;
            timestamp: number;
            details?: { progress?: number };
          }) => void)
        | null,
    ): void;
    checkForUpdate(): Promise<unknown>;
    downloadUpdate(): Promise<void>;
    applyUpdate(): Promise<void>;
    localInfo: { version(): Promise<string>; channel(): Promise<string> };
  };

  export class BrowserWindow {
    constructor(options: {
      title: string;
      url: string;
      frame?: { width: number; height: number; x?: number; y?: number };
    });
    readonly webview: {
      on(
        name: 'new-window-open',
        handler: (event: {
          data: {
            detail:
              | string
              | {
                  url: string;
                  isCmdClick: boolean;
                  modifierFlags?: number;
                  targetDisposition?: number;
                  userGesture?: boolean;
                };
          };
        }) => void,
      ): void;
    };
  }

  type BeforeQuitEvent = { response?: { allow: boolean } };

  const Electrobun: {
    app: { quit(): void };
    events: { on(name: 'before-quit', handler: (event: BeforeQuitEvent) => void): void };
  };

  export default Electrobun;
}
