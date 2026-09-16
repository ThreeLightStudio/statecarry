import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectrobunFolderPicker } from '../apps/desktop/src/folder-picker';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Electrobun folder picker', () => {
  it('returns null on cancel and requests one directory', async () => {
    const open = vi.fn(async () => [] as string[]);
    const picker = new ElectrobunFolderPicker(open);

    await expect(picker.choose()).resolves.toBeNull();
    expect(open).toHaveBeenCalledWith({
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
  });

  it('returns the canonical selected directory and rejects invalid results', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-electrobun-folder-'));
    directories.push(directory);
    const picker = new ElectrobunFolderPicker(async () => [directory]);
    await expect(picker.choose()).resolves.toBe(realpathSync(directory));

    const relative = new ElectrobunFolderPicker(async () => ['relative/folder']);
    await expect(relative.choose()).rejects.toMatchObject({ code: 'RESULT_UNKNOWN', status: 500 });

    const missing = new ElectrobunFolderPicker(async () => [`${directory}-missing`]);
    await expect(missing.choose()).rejects.toMatchObject({ code: 'RESULT_UNKNOWN', status: 409 });
  });
});
