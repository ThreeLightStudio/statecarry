import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type RuntimeEnvironment = 'development' | 'production';
export const DEVELOPMENT_PORT = 4310;
export const DEVELOPMENT_WEB_PORT = 4311;

export function developmentPort(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.STATECARRY_PORT ?? DEVELOPMENT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid STATECARRY_PORT');
  return port;
}

// Resolve existing ancestors too, so a new directory beneath a symlink cannot
// accidentally put development data inside the installed application's profile.
function physicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return resolve(physicalPath(parent), relative(parent, path));
}

function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

export function runtimeSettings(options: {
  environment: RuntimeEnvironment;
  env?: NodeJS.ProcessEnv;
  home?: string;
  dataDir?: string;
  port?: number;
}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const productionData = resolve(home, '.statecarry');
  const development = options.environment === 'development';
  const dataDir = resolve(
    options.dataDir ??
      (development ? (env.STATECARRY_DATA_DIR ?? join(home, '.statecarry-dev')) : productionData),
  );
  if (development) {
    const actual = physicalPath(dataDir);
    const production = physicalPath(productionData);
    if (contains(production, actual) || contains(actual, production))
      throw new Error(
        'Development data must be separate from the production .statecarry directory',
      );
  }
  // Packaged apps must not inherit a development shell's port or data override.
  const port = options.port ?? (development ? developmentPort(env) : 0);
  if (!Number.isInteger(port) || (port !== 0 && port < 1024) || port > 65535)
    throw new Error('Invalid server port');
  return { dataDir, port };
}
