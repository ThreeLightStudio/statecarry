import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DomainError } from '@statecarry/contracts';
import type { LocalFolderPicker } from '../../server/src/adapters/local-folder-picker';

export type OpenFolderDialog = (options: {
  canChooseFiles: false;
  canChooseDirectory: true;
  allowsMultipleSelection: false;
}) => Promise<string[]>;

export class ElectrobunFolderPicker implements LocalFolderPicker {
  constructor(private openDialog: OpenFolderDialog) {}

  async choose(): Promise<string | null> {
    const [selected] = await this.openDialog({
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    if (!selected) return null;
    if (!isAbsolute(selected))
      throw new DomainError(
        'RESULT_UNKNOWN',
        'The local folder picker returned an invalid folder.',
        500,
      );
    try {
      return await realpath(selected);
    } catch {
      throw new DomainError('RESULT_UNKNOWN', 'The selected folder is no longer available.', 409);
    }
  }
}
