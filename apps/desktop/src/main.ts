import { join } from 'node:path';
import Electrobun, { BrowserWindow, PATHS, Utils } from 'electrobun/main';
import { createServerRuntime } from '../../server/src/runtime';
import { ElectrobunFolderPicker } from './folder-picker';

const runtime = createServerRuntime({
  webDir: join(PATHS.VIEWS_FOLDER, 'statecarry'),
  folderPicker: new ElectrobunFolderPicker(Utils.openFileDialog),
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

  void runtime
    .stop()
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      stopped = true;
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
} catch (error) {
  await runtime.stop();
  throw error;
}

void mainWindow;
