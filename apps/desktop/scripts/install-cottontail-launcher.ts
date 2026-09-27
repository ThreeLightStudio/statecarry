import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('Skipping the macOS Cottontail launcher shim on this platform.');
} else {
  const bundlePath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
  if (!bundlePath) {
    throw new Error('Electrobun did not provide the wrapped app bundle path.');
  }

  const executableDirectory = join(bundlePath, 'Contents', 'MacOS');
  const launcherPath = join(executableDirectory, 'launcher');
  const originalLauncherPath = join(executableDirectory, 'launcher-electrobun');
  const stagedLauncherPath = join(executableDirectory, 'launcher-statecarry-staged');

  if (!statSync(executableDirectory).isDirectory()) {
    throw new Error('The wrapped app bundle has no Contents/MacOS directory.');
  }
  if (!statSync(launcherPath).isFile()) {
    throw new Error('The wrapped Electrobun launcher is missing.');
  }
  if (existsSync(originalLauncherPath) || existsSync(stagedLauncherPath)) {
    throw new Error('The wrapped Electrobun launcher has already been modified.');
  }

  const architectureOutput = execFileSync('/usr/bin/lipo', ['-archs', launcherPath], {
    encoding: 'utf8',
  }).trim();
  const architectures = architectureOutput.split(/\s+/).filter(Boolean);
  if (architectures.length === 0) {
    throw new Error('Could not read the wrapped launcher architectures.');
  }

  const compiler = execFileSync('/usr/bin/xcrun', ['--find', 'clang'], { encoding: 'utf8' }).trim();
  const sdkPath = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  const helperSource = fileURLToPath(new URL('./cottontail-launcher.c', import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'statecarry-cottontail-launcher-'));
  const compiledLauncherPath = join(temporaryDirectory, 'launcher');
  const compiledArchitecturePaths = architectures.map((architecture) =>
    join(temporaryDirectory, `launcher-${architecture}`),
  );

  try {
    for (let index = 0; index < architectures.length; index += 1) {
      execFileSync(
        compiler,
        [
          '-isysroot',
          sdkPath,
          '-arch',
          architectures[index],
          '-std=c11',
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-mmacosx-version-min=11.0',
          helperSource,
          '-o',
          compiledArchitecturePaths[index],
        ],
        { stdio: 'inherit' },
      );
    }

    if (compiledArchitecturePaths.length === 1) {
      copyFileSync(compiledArchitecturePaths[0], compiledLauncherPath);
    } else {
      execFileSync(
        '/usr/bin/lipo',
        ['-create', ...compiledArchitecturePaths, '-output', compiledLauncherPath],
        { stdio: 'inherit' },
      );
    }

    chmodSync(compiledLauncherPath, 0o755);
    copyFileSync(compiledLauncherPath, stagedLauncherPath);
    chmodSync(stagedLauncherPath, 0o755);

    let originalMoved = false;
    try {
      renameSync(launcherPath, originalLauncherPath);
      originalMoved = true;
      renameSync(stagedLauncherPath, launcherPath);
    } catch (error) {
      if (originalMoved) {
        renameSync(originalLauncherPath, launcherPath);
      }
      throw error;
    }
  } finally {
    rmSync(stagedLauncherPath, { force: true });
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  console.log('Configured a private user-temp root for the packaged Cottontail runtime.');
}
