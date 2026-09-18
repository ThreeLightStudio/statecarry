import { join } from 'node:path';
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Utils } from 'electrobun/main';
import { createServerRuntime } from '../../server/src/runtime';
import { ElectrobunFolderPicker } from './folder-picker';
import { ElectrobunProjectAssetPicker } from './project-asset-picker';
import { ElectrobunUpdater } from './updater';

const updater = new ElectrobunUpdater(() => Electrobun.app.quit());

const runtime = createServerRuntime({
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
  { label: 'StateCarry', submenu: [{ role: 'quit', accelerator: 'CommandOrControl+Q' }] },
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

  void runtime
    .stop()
    .catch((error) => {
      stopFailed = true;
      console.error(error);
    })
    .finally(async () => {
      stopped = true;
      if (updater.hasRestartRequest() && !stopFailed) {
        try {
          const result = await updater.applyPreparedUpdate();
          if (result.handoffStarted) return;
          if (result.state.error) console.error(result.state.error);
        } catch (error) {
          console.error(error);
        }
      }
      updater.cancelRestart();
      Electrobun.app.quit();
    });
});

let mainWindow: BrowserWindow;
try {
  mainWindow = new BrowserWindow({
    title: 'StateCarry',
    url: `http://${runtime.host}:${runtime.port}/`,
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
