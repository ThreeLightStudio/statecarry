import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectAssetStore } from '../apps/server/src/adapters/local-project-assets';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('project asset store', () => {
  it('copies a selected image into StateCarry-managed storage and reads it back', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'statecarry-project-assets-'));
    directories.push(dataDir);
    const selected = join(dataDir, 'selected.png');
    writeFileSync(selected, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const store = new ProjectAssetStore(dataDir, { chooseImage: async () => selected });

    const ref = await store.select('icon');
    expect(ref).toMatch(/\.png$/);
    const asset = await store.read(ref!);
    expect(asset.contentType).toBe('image/png');
    expect([...asset.contents]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('rejects unsupported image types and unsafe asset references', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'statecarry-project-assets-'));
    directories.push(dataDir);
    const selected = join(dataDir, 'selected.txt');
    writeFileSync(selected, 'not an image');
    const store = new ProjectAssetStore(dataDir, { chooseImage: async () => selected });

    await expect(store.select('banner')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.read('../outside.png')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
