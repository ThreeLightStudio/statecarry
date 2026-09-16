import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from '@statecarry/contracts';

/** Existing local aliases resolve before Core compares project registrations.
 * Missing folders keep lexical identity so saved, temporarily unavailable
 * projects remain manageable. Payload validation remains in Core. */
export function canonicalProjectCommand(command: Command): Command {
  const cwd = command.payload.cwd;
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) return command;
  let folder: string;
  try {
    folder = realpathSync(cwd);
  } catch {
    folder = resolve(cwd);
  }
  return { ...command, payload: { ...command.payload, cwd: folder } };
}
