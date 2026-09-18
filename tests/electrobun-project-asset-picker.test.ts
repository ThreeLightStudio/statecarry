import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectrobunProjectAssetPicker } from '../apps/desktop/src/project-asset-picker';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Electrobun project asset picker', () => {
  it('requests one supported image file and returns its canonical path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-asset-picker-'));
    directories.push(directory);
    const image = join(directory, 'icon.png');
    writeFileSync(image, 'image');
    const open = vi.fn(async () => [image]);
    const picker = new ElectrobunProjectAssetPicker(open);

    await expect(picker.chooseImage('icon')).resolves.toBe(realpathSync(image));
    expect(open).toHaveBeenCalledWith({
      allowedFileTypes: 'png,jpg,jpeg,webp,gif',
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
    });
  });

  it('returns null when the picker is cancelled', async () => {
    const picker = new ElectrobunProjectAssetPicker(async () => []);
    await expect(picker.chooseImage('banner')).resolves.toBeNull();
  });
});
