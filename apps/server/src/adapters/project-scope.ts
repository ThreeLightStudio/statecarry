import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type {
  ChangeScope,
  ScopeObservation,
  ScopeFile,
  ScopeFileSelection,
} from '@statecarry/contracts';
import { executableEnvironment, resolveExecutable } from './executable-resolver';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previewLimit = 80000;
const detailLimit = 2 * 1024 * 1024;
const sameFile = (a: ScopeFileSelection, b: ScopeFileSelection) =>
  a.path === b.path && a.layer === b.layer;
function fileFingerprint(path: string, mode: number) {
  const digest = createHash('sha256').update(String(mode));
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      digest.update(buffer.subarray(0, count));
    return digest.digest('hex');
  } finally {
    closeSync(fd);
  }
}

/** Read a complete inventory independently of bounded, individually expandable diff details. */
export function inspectChangeScope(
  cwd: string,
  expandedFiles: ScopeFileSelection[] = [],
): ScopeObservation {
  const checkedAt = new Date().toISOString();
  const scopes: ChangeScope[] = [];
  const files: ScopeFile[] = [];
  const gitExecutable = resolveExecutable('git');
  const git = (...args: string[]) => {
    if (!gitExecutable) throw new Error('Git is unavailable.');
    return execFileSync(gitExecutable, ['-c', 'core.quotePath=false', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: detailLimit,
      env: { ...executableEnvironment(['git']), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  const inventory = () => {
    const root = git('rev-parse', '--show-toplevel').trim();
    let branch = '',
      head = '';
    try {
      branch = git('symbolic-ref', '-q', 'HEAD').trim();
    } catch {
      /* Detached HEAD. */
    }
    try {
      head = git('rev-parse', '--verify', 'HEAD').trim();
    } catch {
      /* Unborn repository. */
    }
    const index = git('ls-files', '--stage', '-z');
    const entries: Array<ScopeFileSelection & { fingerprint: string; absolute: string }> = [];
    for (const layer of ['staged', 'unstaged', 'untracked'] as const) {
      const paths = (
        layer === 'untracked'
          ? git('ls-files', '--others', '--exclude-standard', '-z')
          : git(
              'diff',
              ...(layer === 'staged' ? ['--cached'] : []),
              '--no-renames',
              '--name-only',
              '-z',
            )
      )
        .split('\0')
        .filter(Boolean)
        .sort();
      if (entries.length + paths.length > 5000)
        throw new Error('The changed-file inventory is too large to check.');
      for (const path of paths) {
        const absolute = resolve(root, path),
          local = relative(realpathSync(cwd), absolute);
        if (local === '..' || local.startsWith('../') || isAbsolute(local))
          throw new Error('A changed path is outside this project.');
        let fingerprint: string;
        try {
          const stat = lstatSync(absolute);
          fingerprint = stat.isSymbolicLink()
            ? hash(['symlink', readlinkSync(absolute)])
            : stat.isFile()
              ? fileFingerprint(absolute, stat.mode)
              : hash(['directory', git('status', '--porcelain=v1', '--', path)]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          fingerprint = 'absent';
        }
        entries.push({ path, layer, fingerprint, absolute });
      }
    }
    return {
      entries,
      basis: hash([
        root,
        branch,
        head,
        index,
        entries.map(({ path, layer, fingerprint }) => [path, layer, fingerprint]),
      ]),
    };
  };
  try {
    const before = inventory();
    for (const entry of before.entries) {
      const { path, layer, absolute } = entry;
      const file: ScopeFile = {
        id: hash([path, layer, entry.fingerprint]),
        path,
        layer,
        detail: 'unread',
        limitation: null,
      };
      files.push(file);
      const expanded = expandedFiles.some((selected) => sameFile(selected, file));
      if (!expanded && (scopes.length >= 300 || files.length > 120)) {
        file.limitation = 'Read this file’s changes to include them in the request.';
        continue;
      }
      try {
        let patch: string;
        if (layer === 'untracked') {
          const stat = lstatSync(absolute);
          if (!stat.isFile() && !stat.isSymbolicLink())
            throw new Error('This file cannot be inspected.');
          if (stat.size > (expanded ? detailLimit : previewLimit)) {
            file.limitation = expanded
              ? 'This file exceeds the detailed review limit.'
              : 'This file is too large for the initial preview. Read its changes separately.';
            if (expanded) file.detail = 'unavailable';
            continue;
          }
          const content = stat.isSymbolicLink()
            ? Buffer.from(readlinkSync(absolute))
            : readFileSync(absolute);
          patch = content.includes(0)
            ? `Binary untracked file, ${content.length} bytes, SHA256 ${hash(content.toString('base64'))}`
            : content.toString('utf8');
        } else {
          patch = git(
            'diff',
            ...(layer === 'staged' ? ['--cached'] : []),
            '--no-ext-diff',
            '--no-textconv',
            '--no-renames',
            '--binary',
            '--',
            path,
          );
          if (!expanded && patch.length > previewLimit) {
            file.limitation =
              'This diff is too large for the initial preview. Read this file’s changes separately.';
            continue;
          }
        }
        const chunks = layer === 'untracked' ? [patch] : patch.split(/(?=^@@ )/m);
        const header = chunks.length > 1 ? chunks.shift()! : '';
        if (scopes.length + chunks.length > (expanded ? 2000 : 300)) {
          file.limitation = expanded
            ? 'This file has too many sections for a complete detailed review.'
            : 'Read this file’s changes to review its remaining sections.';
          if (expanded) file.detail = 'unavailable';
          continue;
        }
        for (const chunk of chunks) {
          const value = header + chunk;
          scopes.push({
            id: hash([path, layer, value]),
            path,
            layer,
            kind: chunk.startsWith('@@ ') ? 'hunk' : 'file',
            description: chunk.startsWith('@@ ') ? chunk.split('\n')[0] : 'Whole-file change',
            patch: value,
          });
        }
        file.detail = 'ready';
      } catch {
        file.detail = 'unavailable';
        file.limitation =
          'The full changes could not be read within the review limits. Leave this file outside the request or reduce its change size.';
      }
    }
    if (inventory().basis !== before.basis)
      throw new Error(
        'The project changed while its file inventory was being read. Read it again.',
      );
    return {
      basis: before.basis,
      checkedAt,
      inventoryComplete: true,
      complete: files.every((file) => file.detail === 'ready'),
      files,
      scopes,
      limitations: files.flatMap((file) =>
        file.limitation ? [`${file.path} (${file.layer}): ${file.limitation}`] : [],
      ),
    };
  } catch (error) {
    return {
      basis: hash(['unavailable', resolve(cwd)]),
      checkedAt,
      inventoryComplete: false,
      complete: false,
      files: [],
      scopes: [],
      limitations: [
        error instanceof Error && !('stderr' in error)
          ? error.message
          : 'The changed-file inventory could not be read. Check the project folder and try again.',
      ],
    };
  }
}
