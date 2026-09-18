import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DomainError } from '@statecarry/contracts';

export type ProjectAssetKind = 'icon' | 'banner';

export interface LocalProjectAssetPicker {
  chooseImage(kind: ProjectAssetKind): Promise<string | null>;
}

const contentTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const assetRefPattern = /^[0-9a-f-]+\.(?:png|jpe?g|webp|gif)$/i;
const maxAssetBytes = 10 * 1024 * 1024;

export class ProjectAssetStore {
  private readonly assetDir: string;

  constructor(
    dataDir: string,
    private picker?: LocalProjectAssetPicker,
  ) {
    this.assetDir = join(dataDir, 'assets', 'projects');
  }

  async select(kind: ProjectAssetKind): Promise<string | null> {
    if (!this.picker)
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'The local image picker is unavailable in this environment.',
        501,
      );
    const selected = await this.picker.chooseImage(kind);
    if (!selected) return null;
    const extension = extname(selected).toLowerCase();
    if (!contentTypes[extension])
      throw new DomainError('VALIDATION', 'Choose a PNG, JPEG, WebP, or GIF image.', 400);
    const info = await stat(selected).catch(() => null);
    if (!info?.isFile())
      throw new DomainError('RESULT_UNKNOWN', 'The selected image is no longer available.', 409);
    if (info.size > maxAssetBytes)
      throw new DomainError('VALIDATION', 'Choose an image smaller than 10 MB.', 400);
    await mkdir(this.assetDir, { recursive: true });
    const ref = `${randomUUID()}${extension === '.jpeg' ? '.jpg' : extension}`;
    await copyFile(selected, join(this.assetDir, ref));
    return ref;
  }

  async read(ref: string): Promise<{ contents: Buffer; contentType: string }> {
    if (!assetRefPattern.test(ref))
      throw new DomainError('NOT_FOUND', 'Project image not found.', 404);
    const extension = extname(ref).toLowerCase();
    try {
      return {
        contents: await readFile(join(this.assetDir, ref)),
        contentType: contentTypes[extension] ?? 'application/octet-stream',
      };
    } catch {
      throw new DomainError('NOT_FOUND', 'Project image not found.', 404);
    }
  }
}
