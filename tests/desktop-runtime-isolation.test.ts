import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  info: { channel: 'stable', identifier: 'com.threelightstudio.statecarry' },
  window: vi.fn(),
  updater: vi.fn(),
  createRuntime: vi.fn(),
  runtime: {
    host: '127.0.0.1',
    port: 53247,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
}));

vi.mock('electrobun/main', () => ({
  default: { app: { quit: vi.fn() }, events: { on: vi.fn() } },
  ApplicationMenu: { setApplicationMenu: vi.fn() },
  BrowserWindow: class {
    constructor(options: unknown) {
      native.window(options);
    }
    webview = { on: vi.fn() };
  },
  PATHS: { VIEWS_FOLDER: '/test/views' },
  Utils: { openFileDialog: vi.fn(), openExternal: vi.fn() },
  Updater: { getLocalInfo: async () => native.info },
}));
vi.mock('../apps/desktop/src/updater', () => ({
  ElectrobunUpdater: class {
    constructor() {
      native.updater();
    }
  },
}));
vi.mock('../apps/server/src/runtime', () => ({
  createServerRuntime: (options: unknown) => {
    native.createRuntime(options);
    return native.runtime;
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('desktop server selection', () => {
  it('opens the port returned by its own production server, regardless of shell flags', async () => {
    vi.stubEnv('STATECARRY_DESKTOP_ENV', 'dev');
    native.info = { channel: 'stable', identifier: 'com.threelightstudio.statecarry' };
    await import('../apps/desktop/src/main');
    expect(native.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production' }),
    );
    expect(native.runtime.start).toHaveBeenCalledOnce();
    expect(native.window).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'StateCarry', url: 'http://127.0.0.1:53247/' }),
    );
    expect(native.updater).toHaveBeenCalledOnce();
  });

  it('starts development without a production updater', async () => {
    native.info = { channel: 'dev', identifier: 'com.threelightstudio.statecarry.dev' };
    await import('../apps/desktop/src/main');
    expect(native.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'development', updater: undefined }),
    );
    expect(native.updater).not.toHaveBeenCalled();
    expect(native.window).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'StateCarry Dev' }),
    );
  });

  it('does not open another server when its own server fails to start', async () => {
    native.info = { channel: 'dev', identifier: 'com.threelightstudio.statecarry.dev' };
    native.runtime.start.mockRejectedValueOnce(new Error('Address in use'));
    await expect(import('../apps/desktop/src/main')).rejects.toThrow('Address in use');
    expect(native.window).not.toHaveBeenCalled();
  });
});
