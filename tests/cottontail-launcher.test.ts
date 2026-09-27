import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('packaged Cottontail launcher', () => {
  it.skipIf(process.platform !== 'darwin')(
    'sets a private temp root before launch and preserves cwd and arguments',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'statecarry-cottontail-launcher-test-'));
      temporaryRoots.push(root);

      const macosDirectory = join(root, 'StateCarry.app', 'Contents', 'MacOS');
      mkdirSync(macosDirectory, { recursive: true });
      const probePath = join(root, 'launcher-probe.txt');
      const originalLauncherPath = join(macosDirectory, 'launcher-electrobun');
      writeFileSync(
        originalLauncherPath,
        '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$COTTONTAIL_TMP_DIR" "$@" > "$STATECARRY_LAUNCHER_PROBE"\n',
        { mode: 0o755 },
      );

      const compiler = execFileSync('/usr/bin/xcrun', ['--find', 'clang'], {
        encoding: 'utf8',
      }).trim();
      const sdkPath = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], {
        encoding: 'utf8',
      }).trim();
      const wrapperPath = join(macosDirectory, 'launcher');
      execFileSync(
        compiler,
        [
          '-isysroot',
          sdkPath,
          '-std=c11',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-mmacosx-version-min=11.0',
          resolve('apps/desktop/scripts/cottontail-launcher.c'),
          '-o',
          wrapperPath,
        ],
        { stdio: 'pipe' },
      );

      const userTempRoot = join(root, 'user-temp');
      mkdirSync(userTempRoot);
      const environment = {
        ...process.env,
        TMPDIR: userTempRoot,
        STATECARRY_LAUNCHER_PROBE: probePath,
      };
      const runtimeRoots: string[] = [];

      for (let attempt = 0; attempt < 2; attempt += 1) {
        execFileSync(wrapperPath, ['--launch-probe', 'kept-argument'], {
          cwd: macosDirectory,
          env: environment,
        });

        const [cwd, runtimeTempRoot, ...args] = readFileSync(probePath, 'utf8').trim().split('\n');
        runtimeRoots.push(runtimeTempRoot);
        expect(cwd).toBe(realpathSync(macosDirectory));
        expect(dirname(realpathSync(runtimeTempRoot))).toBe(realpathSync(userTempRoot));
        expect(runtimeTempRoot.split('/').at(-1)).toMatch(/^statecarry-cottontail-/);
        expect(statSync(runtimeTempRoot).mode & 0o777).toBe(0o700);
        expect(args).toEqual(['--launch-probe', 'kept-argument']);
        expect(runtimeTempRoot.startsWith(`${macosDirectory}/`)).toBe(false);
        expect(existsSync(join(macosDirectory, '.cottontail-tmp'))).toBe(false);
      }

      expect(runtimeRoots[0]).not.toBe(runtimeRoots[1]);
    },
  );

  it.skipIf(process.platform !== 'darwin')(
    'keeps the Electrobun launcher intact while installing the postWrap shim',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'statecarry-cottontail-postwrap-test-'));
      temporaryRoots.push(root);

      const bundlePath = join(root, 'StateCarry.app');
      const macosDirectory = join(bundlePath, 'Contents', 'MacOS');
      mkdirSync(macosDirectory, { recursive: true });
      const launcherPath = join(macosDirectory, 'launcher');
      const originalLauncherPath = join(macosDirectory, 'launcher-electrobun');
      const launcherSourcePath = join(root, 'launcher-probe.c');
      const probePath = join(root, 'launcher-probe.txt');
      writeFileSync(
        launcherSourcePath,
        `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char cwd[4096];
  if (getcwd(cwd, sizeof(cwd)) == NULL) return 1;
  FILE *probe = fopen(getenv("STATECARRY_LAUNCHER_PROBE"), "w");
  if (probe == NULL) return 2;
  fprintf(probe, "%s\\n%s\\n", cwd, getenv("COTTONTAIL_TMP_DIR"));
  for (int index = 1; index < argc; index += 1) fprintf(probe, "%s\\n", argv[index]);
  return fclose(probe) == 0 ? 0 : 3;
}
`,
      );

      const compiler = execFileSync('/usr/bin/xcrun', ['--find', 'clang'], {
        encoding: 'utf8',
      }).trim();
      const sdkPath = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], {
        encoding: 'utf8',
      }).trim();
      execFileSync(
        compiler,
        [
          '-isysroot',
          sdkPath,
          '-std=c11',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          launcherSourcePath,
          '-o',
          launcherPath,
        ],
        { stdio: 'pipe' },
      );
      const originalLauncher = readFileSync(launcherPath);

      const userTempRoot = join(root, 'user-temp');
      mkdirSync(userTempRoot);
      const environment = {
        ...process.env,
        ELECTROBUN_WRAPPER_BUNDLE_PATH: bundlePath,
        STATECARRY_LAUNCHER_PROBE: probePath,
        TMPDIR: userTempRoot,
      };
      const installerEnvironment = { ...environment, TMPDIR: tmpdir() };
      execFileSync(
        process.execPath,
        [
          resolve('node_modules/tsx/dist/cli.mjs'),
          resolve('apps/desktop/scripts/install-cottontail-launcher.ts'),
        ],
        { env: installerEnvironment, stdio: 'pipe' },
      );

      expect(readFileSync(originalLauncherPath)).toEqual(originalLauncher);
      expect(readFileSync(launcherPath)).not.toEqual(originalLauncher);

      execFileSync(launcherPath, ['--postwrap-probe', 'preserved'], {
        cwd: macosDirectory,
        env: environment,
      });
      const [cwd, runtimeTempRoot, ...args] = readFileSync(probePath, 'utf8').trim().split('\n');
      expect(cwd).toBe(realpathSync(macosDirectory));
      expect(dirname(realpathSync(runtimeTempRoot))).toBe(realpathSync(userTempRoot));
      expect(args).toEqual(['--postwrap-probe', 'preserved']);
    },
  );
});
