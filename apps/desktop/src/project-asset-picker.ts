import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DomainError } from '@statecarry/contracts';
import type {
  LocalProjectAssetPicker,
  ProjectAssetKind,
} from '../../server/src/adapters/local-project-assets';

export type OpenImageDialog = (options: {
  allowedFileTypes: string;
  canChooseFiles: true;
  canChooseDirectory: false;
  allowsMultipleSelection: false;
}) => Promise<string[]>;

export class ElectrobunProjectAssetPicker implements LocalProjectAssetPicker {
  constructor(private openDialog: OpenImageDialog) {}

  async chooseImage(_kind: ProjectAssetKind): Promise<string | null> {
    const [selected] = await this.openDialog({
      allowedFileTypes: 'png,jpg,jpeg,webp,gif',
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
    });
    if (!selected) return null;
    if (!isAbsolute(selected))
      throw new DomainError(
        'RESULT_UNKNOWN',
        'The local image picker returned an invalid file.',
        500,
      );
    try {
      return await realpath(selected);
    } catch {
      throw new DomainError('RESULT_UNKNOWN', 'The selected image is no longer available.', 409);
    }
  }
}
