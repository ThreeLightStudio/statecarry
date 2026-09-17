import { join } from 'node:path';
import Electrobun, { BrowserWindow, PATHS, Utils } from 'electrobun/main';
import { createServerRuntime } from '../../server/src/runtime';
import { ElectrobunFolderPicker } from './folder-picker';
import { ElectrobunUpdater } from './updater';

const updater = new ElectrobunUpdater(() => Electrobun.app.quit());

const runtime = createServerRuntime({
  webDir: join(PATHS.VIEWS_FOLDER, 'statecarry'),
  folderPicker: new ElectrobunFolderPicker(Utils.openFileDialog),
  updater,
  onServerError(error) {
    console.error(error);
  },
});

await runtime.start();

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
