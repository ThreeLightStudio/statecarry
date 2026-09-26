import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Updater, Utils } from 'electrobun/main';
import { createServerRuntime } from '../../server/src/runtime';
import { ElectrobunFolderPicker } from './folder-picker';
import { ElectrobunProjectAssetPicker } from './project-asset-picker';
import { ElectrobunUpdater } from './updater';
import { desktopRuntimeEnvironment } from '../build-profile';
import { browserStatePreload } from './browser-state-preload';

// The desktop webview does not resolve prefers-color-scheme to the system
// appearance, so the resolved theme is passed to the page as a preload hint.
function systemAppearance(): 'dark' | 'light' {
  try {
    return execFileSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf8',
    }).trim() === 'Dark'
      ? 'dark'
      : 'light';
  } catch {
    // The defaults key is absent while macOS uses light appearance.
    return 'light';
  }
}

// Read the packaged channel, never the launching shell's development flags.
const environment = desktopRuntimeEnvironment(await Updater.getLocalInfo());
const appName = environment === 'production' ? 'StateCarry' : 'StateCarry Dev';
const updater =
  environment === 'production' ? new ElectrobunUpdater(() => Electrobun.app.quit()) : undefined;

const runtime = createServerRuntime({
  environment,
  persistBrowserState: true,
  webDir: join(PATHS.VIEWS_FOLDER, 'statecarry'),
  folderPicker: new ElectrobunFolderPicker(Utils.openFileDialog),
  projectAssetPicker: new ElectrobunProjectAssetPicker(Utils.openFileDialog),
  updater,
  onServerError(error) {
    console.error(error);
  },
});

await runtime.start();

ApplicationMenu.setApplicationMenu([
  { label: appName, submenu: [{ role: 'quit', accelerator: 'CommandOrControl+Q' }] },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo', accelerator: 'CommandOrControl+Z' },
      { role: 'redo', accelerator: 'CommandOrControl+Shift+Z' },
      { type: 'divider' },
      { role: 'cut', accelerator: 'CommandOrControl+X' },
      { role: 'copy', accelerator: 'CommandOrControl+C' },
      { role: 'paste', accelerator: 'CommandOrControl+V' },
      { role: 'pasteAndMatchStyle', accelerator: 'CommandOrControl+Shift+V' },
      { type: 'divider' },
      { role: 'selectAll', accelerator: 'CommandOrControl+A' },
    ],
  },
]);

let stopping = false;
let stopped = false;

Electrobun.events.on('before-quit', (event) => {
  if (stopped) return;

  event.response = { allow: false };
  if (stopping) return;
  stopping = true;
  let stopFailed = false;

  void Promise.resolve()
    .then(() =>
      runtime.browserState?.flushBeforeQuit((token) => {
        mainWindow?.webview.executeJavascript(
          `window.dispatchEvent(new CustomEvent('statecarry:flush', { detail: ${JSON.stringify(token)} }));`,
        );
      }),
    )
    .then(() => runtime.stop())
    .catch((error) => {
      stopFailed = true;
      console.error(error);
    })
    .finally(async () => {
      stopped = true;
      if (updater?.hasRestartRequest() && !stopFailed) {
        try {
          const result = await updater.applyPreparedUpdate();
          if (result.handoffStarted) return;
          if (result.state.error) console.error(result.state.error);
        } catch (error) {
          console.error(error);
        }
      }
      updater?.cancelRestart();
      Electrobun.app.quit();
    });
});

let mainWindow: BrowserWindow;
try {
  mainWindow = new BrowserWindow({
    title: appName,
    url: `http://${runtime.host}:${runtime.port}/`,
    preload: browserStatePreload(
      runtime.browserState?.read() ?? {},
      `http://${runtime.host}:${runtime.port}`,
      systemAppearance(),
    ),
    frame: { width: 1280, height: 840, x: 120, y: 80 },
  });
  mainWindow.webview.on('new-window-open', (event) => {
    const detail = (event as { data?: { detail?: string | { url?: string } } }).data?.detail;
    const url = typeof detail === 'string' ? detail : detail?.url;
    if (url) Utils.openExternal(url);
  });
} catch (error) {
  await runtime.stop();
  throw error;
}

void mainWindow;
