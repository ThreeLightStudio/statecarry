import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  executableDirectories,
  executableEnvironment,
  resolveExecutable,
} from '../apps/server/src/adapters/executable-resolver';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
}

describe('GUI executable discovery', () => {
  it('finds user-installed RTK and Codex even when the inherited PATH is minimal', () => {
    const home = mkdtempSync(join(tmpdir(), 'statecarry-tools-'));
    roots.push(home);
    executable(join(home, '.headroom', 'bin', 'rtk'));
    executable(join(home, '.nvm', 'versions', 'node', 'v24.14.1', 'bin', 'codex'));

    const env = { PATH: '/usr/bin:/bin' };
    expect(resolveExecutable('rtk', env, home)).toBe(join(home, '.headroom', 'bin', 'rtk'));
    expect(resolveExecutable('codex', env, home)).toBe(
      join(home, '.nvm', 'versions', 'node', 'v24.14.1', 'bin', 'codex'),
    );
    expect(executableEnvironment(['rtk', 'codex'], env, home).PATH).toContain(
      join(home, '.nvm', 'versions', 'node', 'v24.14.1', 'bin'),
    );
  });

  it('preserves inherited PATH entries while adding common GUI app install locations', () => {
    const home = '/Users/example';
    const directories = executableDirectories({ PATH: '/custom/bin:/usr/bin' }, home);
    expect(directories.slice(0, 2)).toEqual(['/custom/bin', '/usr/bin']);
    expect(directories).toContain('/opt/homebrew/bin');
    expect(directories).toContain('/Users/example/.headroom/bin');
    expect(directories).toContain('/Users/example/.local/bin');
    expect(directories).toContain('/Users/example/.volta/bin');
    expect(directories).toContain('/Users/example/.asdf/shims');
  });

  it('ignores executable directories and returns null when the executable is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'statecarry-tools-'));
    roots.push(home);
    const misleading = join(home, '.headroom', 'bin', 'rtk');
    mkdirSync(misleading, { recursive: true });
    chmodSync(misleading, 0o755);

    expect(resolveExecutable('rtk', { PATH: '' }, home)).toBeNull();
  });
});
