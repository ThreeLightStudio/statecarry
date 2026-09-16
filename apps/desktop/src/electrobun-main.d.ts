/**
 * Electrobun 2.x projects receive the authoritative SDK types through the
 * generated `.hutch/devkit`. The npm `electrobun` package is a CLI bootstrap
 * and intentionally ships no `electrobun/main` declarations, so the root
 * repository TypeScript check needs this narrow declaration for the APIs used
 * by the desktop entrypoint.
 */
declare module 'electrobun/main' {
  export const PATHS: { VIEWS_FOLDER: string };
  export const Utils: {
    openFileDialog(options: {
      canChooseFiles: false;
      canChooseDirectory: true;
      allowsMultipleSelection: false;
    }): Promise<string[]>;
  };

  export class BrowserWindow {
    constructor(options: {
      title: string;
      url: string;
      frame?: { width: number; height: number; x?: number; y?: number };
    });
  }

  type BeforeQuitEvent = { response?: { allow: boolean } };

  const Electrobun: {
    app: { quit(): void };
    events: { on(name: 'before-quit', handler: (event: BeforeQuitEvent) => void): void };
  };

  export default Electrobun;
}
