import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DomainError } from '@statecarry/contracts';

export interface LocalFolderPicker {
  choose(): Promise<string | null>;
}

type RunAppleScript = (
  file: string,
  args: string[],
  options: { encoding: 'utf8' },
  callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
) => void;

export class MacLocalFolderPicker implements LocalFolderPicker {
  constructor(
    private platform = process.platform,
    private run: RunAppleScript = execFile as RunAppleScript,
  ) {}

  async choose(): Promise<string | null> {
    if (this.platform !== 'darwin')
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'The local folder picker is currently available on macOS.',
        501,
      );
    return new Promise((resolve, reject) => {
      this.run(
        '/usr/bin/osascript',
        [
          '-e',
          'try\nPOSIX path of (choose folder with prompt "Choose a project folder for StateCarry")\non error number -128\nreturn ""\nend try',
        ],
        { encoding: 'utf8' },
        async (error, stdout, stderr) => {
          if (error) {
            if (stderr.includes('User canceled') || stderr.includes('(-128)')) {
              resolve(null);
              return;
            }
            reject(
              new DomainError(
                'CAPABILITY_UNSUPPORTED',
                'The local folder picker could not return a folder.',
                503,
              ),
            );
            return;
          }
          const selected = stdout.trim();
          if (!selected) {
            resolve(null);
            return;
          }
          if (!isAbsolute(selected)) {
            reject(
              new DomainError(
                'RESULT_UNKNOWN',
                'The local folder picker returned an invalid folder.',
                500,
              ),
            );
            return;
          }
          try {
            resolve(await realpath(selected));
          } catch {
            reject(
              new DomainError('RESULT_UNKNOWN', 'The selected folder is no longer available.', 409),
            );
          }
        },
      );
    });
  }
}
