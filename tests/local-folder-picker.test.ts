import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MacLocalFolderPicker } from '../apps/server/src/adapters/local-folder-picker';

describe('macOS local folder picker', () => {
  it('returns the canonical absolute folder selected by osascript', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'statecarry-picker-'));
    const run = vi.fn((_file, _args, _options, callback) => {
      callback(null, folder + '/\n', '');
    });
    try {
      const picker = new MacLocalFolderPicker('darwin', run);
      await expect(picker.choose()).resolves.toBe(realpathSync(folder));
      expect(run).toHaveBeenCalledWith(
        '/usr/bin/osascript',
        expect.arrayContaining(['-e', expect.stringContaining('choose folder')]),
        { encoding: 'utf8' },
        expect.any(Function),
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('treats the macOS cancel result as a normal empty selection', async () => {
    const run = vi.fn((_file, _args, _options, callback) => {
      const error = Object.assign(new Error('cancelled'), { code: 1 });
      callback(error, '', 'execution error: User canceled. (-128)');
    });
    const picker = new MacLocalFolderPicker('darwin', run);
    await expect(picker.choose()).resolves.toBeNull();
  });

  it('reports unsupported platforms without starting an OS process', async () => {
    const run = vi.fn();
    const picker = new MacLocalFolderPicker('linux', run);
    await expect(picker.choose()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a native dialog launch failure as an unavailable capability', async () => {
    const run = vi.fn((_file, _args, _options, callback) => {
      callback(Object.assign(new Error('no GUI session'), { code: 1 }), '', 'not authorized');
    });
    const picker = new MacLocalFolderPicker('darwin', run);
    await expect(picker.choose()).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED',
      status: 503,
    });
  });
});
