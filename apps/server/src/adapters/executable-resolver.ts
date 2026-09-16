import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const splitPath = (value: string | undefined) =>
  (value ?? '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);

function nvmBinDirectories(home: string): string[] {
  const root = join(home, '.nvm', 'versions', 'node');
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, 'bin'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export function executableDirectories(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  return [
    ...splitPath(env.PATH),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.headroom', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, 'bin'),
    ...nvmBinDirectories(home),
  ].filter((directory, index, all) => all.indexOf(directory) === index);
}

export function resolveExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  for (const directory of executableDirectories(env, home)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      return candidate;
    } catch {
      // Continue through known GUI-app and shell install locations.
    }
  }
  return null;
}

export function executableEnvironment(
  names: string[],
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): NodeJS.ProcessEnv {
  const directories = executableDirectories(env, home);
  for (const name of names) {
    const executable = resolveExecutable(name, env, home);
    if (executable) directories.unshift(dirname(executable));
  }
  return {
    ...env,
    PATH: directories.filter((directory, index, all) => all.indexOf(directory) === index).join(':'),
  };
}
