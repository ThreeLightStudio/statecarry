import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { resolveExecutable } from './executable-resolver';
import type { ProjectInspector } from '@statecarry/core';
import type {
  WorkspaceFileObservation,
  WorkspaceInspectionHints,
  WorkspaceSnapshot,
} from '@statecarry/contracts';

/**
 * The project scan is bounded, but the bound applies to selected observations
 * rather than directory order. A record may name a file after the first 120
 * entries; related paths are still discovered, ranked, and read.
 */
const MAX_FILES = 120;
const MAX_DISCOVERED_FILES = 6000;
const MAX_FILE_BYTES = 96 * 1024;
const MAX_PREVIEW = 4000;
const MAX_HINT_SCAN_FILES = 600;
const MAX_RECENT_COMMITS = 8;
const MAX_GIT_PATHS = 120;
const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.hh',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
  '.xml',
  '.txt',
  '.astro',
  '.svelte',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.cache',
  '.statecarry',
  '.turbo',
  '.next',
  'coverage',
  'vendor',
]);

type FileCandidate = { absolute: string; path: string; size: number; mtimeMs: number };
type Discovered = { files: FileCandidate[]; limitations: string[] };

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalized(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function cleanHints(hints?: WorkspaceInspectionHints): WorkspaceInspectionHints {
  const unique = (values: string[] | undefined, limit: number) =>
    [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, limit);
  return {
    paths: unique(hints?.paths, 120),
    symbols: unique(hints?.symbols, 120),
    terms: unique(hints?.terms, 120),
  };
}

function sourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SOURCE_EXTENSIONS.has(lower.includes('.') ? `.${lower.split('.').pop()!}` : '') ||
    /^readme(?:\.|$)|license(?:\.|$)|dockerfile$/i.test(name)
  );
}

/** Discover paths and metadata without making directory order the selection rule. */
function discoverFiles(cwd: string, root: string): Discovered {
  const files: FileCandidate[] = [];
  const limitations: string[] = [];
  const base = resolve(root || cwd);
  const pending = [base];
  while (pending.length && files.length < MAX_DISCOVERED_FILES) {
    const folder = pending.shift()!;
    let entries: import('node:fs').Dirent<string>[];
    try {
      entries = readdirSync(folder, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      limitations.push(
        `Could not read ${relative(base, folder) || '.'}: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`,
      );
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(absolute);
        continue;
      }
      if (!entry.isFile() || !sourceFile(entry.name)) continue;
      const path = relative(base, absolute) || entry.name;
      try {
        const stat = statSync(absolute);
        files.push({ absolute, path, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) {
        limitations.push(
          `Could not inspect ${path}: ${error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)}`,
        );
      }
      if (files.length >= MAX_DISCOVERED_FILES) break;
    }
  }
  if (pending.length)
    limitations.push(`Project file inventory was limited to ${MAX_DISCOVERED_FILES} source files.`);
  return { files, limitations };
}

function pathScore(path: string, hints: WorkspaceInspectionHints): number {
  const value = normalized(path);
  let score = 0;
  for (const hint of hints.paths) {
    const wanted = normalized(hint);
    if (!wanted) continue;
    if (value === wanted || value.endsWith(`/${wanted}`)) score = Math.max(score, 100);
    else if (value.endsWith(`/${wanted.split('/').at(-1)}`)) score = Math.max(score, 80);
    else if (value.includes(wanted)) score = Math.max(score, 50);
  }
  for (const term of hints.terms) if (value.includes(normalized(term))) score = Math.max(score, 20);
  return score;
}

function symbolMatches(text: string, hints: WorkspaceInspectionHints): boolean {
  return hints.symbols.some((symbol) => {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
  });
}

function scoreContent(text: string, hints: WorkspaceInspectionHints): number {
  let score = symbolMatches(text, hints) ? 70 : 0;
  if (hints.terms.some((term) => text.toLowerCase().includes(term.toLowerCase())))
    score = Math.max(score, 10);
  return score;
}

function excerpt(text: string, hints: WorkspaceInspectionHints, related: boolean): string {
  if (!related || (!hints.symbols.length && !hints.terms.length)) return text.slice(0, MAX_PREVIEW);
  const points = [0];
  for (const clue of [...hints.symbols, ...hints.terms].slice(0, 40)) {
    const index = text.toLowerCase().indexOf(clue.toLowerCase());
    if (index >= 0) points.push(Math.max(0, index - 700));
  }
  const chunks: string[] = [];
  let used = 0;
  for (const point of [...new Set(points)].sort((a, b) => a - b)) {
    if (used >= MAX_PREVIEW) break;
    const chunk = text.slice(point, point + Math.min(1200, MAX_PREVIEW - used));
    if (!chunk) continue;
    chunks.push(point > 0 ? `…\n${chunk}` : chunk);
    used += chunk.length;
  }
  return chunks.join('\n').slice(0, MAX_PREVIEW);
}

function sampleFiles(
  cwd: string,
  root: string,
  rawHints?: WorkspaceInspectionHints,
): {
  files: WorkspaceFileObservation[];
  limitations: string[];
  fingerprint: string;
  inventoryFingerprint: string;
  inspection: NonNullable<WorkspaceSnapshot['inspection']>;
} {
  const hints = cleanHints(rawHints);
  const discovered = discoverFiles(cwd, root);
  const limitations = [...discovered.limitations];
  const scores = new Map<string, number>();
  let hintScans = 0;
  for (const file of discovered.files) {
    let score = pathScore(file.path, hints);
    if (
      score < 100 &&
      hints.symbols.length &&
      hintScans < MAX_HINT_SCAN_FILES &&
      file.size <= MAX_FILE_BYTES
    ) {
      try {
        score = Math.max(
          score,
          scoreContent(readFileSync(file.absolute, { encoding: 'utf8' }), hints),
        );
      } catch {
        /* recorded if selected */
      }
      hintScans++;
    }
    scores.set(file.path, score);
  }
  if (
    hints.symbols.length &&
    hintScans >= MAX_HINT_SCAN_FILES &&
    discovered.files.length > MAX_HINT_SCAN_FILES
  ) {
    limitations.push(
      `Related-file matching was limited to ${MAX_HINT_SCAN_FILES} readable files; unmatched files were not treated as absent.`,
    );
  }
  const related = discovered.files
    .filter((file) => (scores.get(file.path) ?? 0) > 0)
    .sort((a, b) => scores.get(b.path)! - scores.get(a.path)! || a.path.localeCompare(b.path));
  const selected = [
    ...related,
    ...discovered.files
      .filter((file) => !related.includes(file))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ].slice(0, MAX_FILES);
  const relatedSelected = new Set(related.slice(0, MAX_FILES).map((file) => file.path));
  const omitted = discovered.files.filter((file) => !selected.includes(file));
  if (omitted.length)
    limitations.push(
      `File observations were limited to ${MAX_FILES} selected files; ${omitted.length} discovered files were not read.`,
    );
  if (hints.paths.length && !related.length)
    limitations.push(
      'No connected-record file path matched; the bounded sample is shown and absence does not prove the implementation is missing.',
    );
  if (related.length > MAX_FILES)
    limitations.push(`Some related files were outside the ${MAX_FILES} file observation limit.`);

  const files: WorkspaceFileObservation[] = [];
  const unreadablePaths: string[] = [];
  for (const file of selected) {
    const isRelated = relatedSelected.has(file.path);
    const selection = isRelated ? ('related' as const) : ('sampled' as const);
    if (file.size > MAX_FILE_BYTES) {
      limitations.push(
        `Skipped ${file.path}: file is larger than the ${MAX_FILE_BYTES} byte read limit.`,
      );
      unreadablePaths.push(file.path);
      files.push({
        revisionId: `workspace-file:${digest(`${file.path}:${file.size}`)}`,
        path: file.path,
        hash: `size:${file.size}`,
        size: file.size,
        preview: null,
        status: 'unavailable',
        selection,
        limitation: 'File exceeds the read limit.',
      });
      continue;
    }
    try {
      const content = readFileSync(file.absolute);
      const text = content.toString('utf8');
      const hash = digest(content);
      files.push({
        revisionId: `workspace-file:${digest(`${file.path}:${hash}`)}`,
        path: file.path,
        hash,
        size: file.size,
        preview: excerpt(text, hints, isRelated),
        status: 'checked',
        selection,
        limitation: null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      limitations.push(`Could not read ${file.path}: ${detail.slice(0, 180)}`);
      unreadablePaths.push(file.path);
      files.push({
        revisionId: `workspace-file:${digest(`${file.path}:unavailable`)}`,
        path: file.path,
        hash: 'unavailable',
        size: null,
        preview: null,
        status: 'unavailable',
        selection,
        limitation: detail.slice(0, 1500),
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = digest(
    JSON.stringify(files.map((file) => [file.path, file.hash, file.size ?? null])),
  );
  const inventoryFingerprint = digest(
    JSON.stringify(
      discovered.files
        .map((file) => [file.path, file.size, file.mtimeMs])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  );
  return {
    files,
    limitations: [...new Set(limitations)].slice(0, 20),
    fingerprint,
    inventoryFingerprint,
    inspection: {
      strategy: related.length ? 'related' : 'sampled',
      hints,
      selectedPaths: files.map((file) => file.path),
      relatedPaths: selected
        .filter((file) => relatedSelected.has(file.path))
        .map((file) => file.path),
      omittedPaths: omitted.slice(0, 120).map((file) => file.path),
      omittedCount: omitted.length,
      unreadablePaths: [...new Set(unreadablePaths)].slice(0, 120),
      limits: { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxPreview: MAX_PREVIEW },
    },
  };
}

/** Read-only Git metadata and bounded, clue-aware source-file observations. */
export class GitProjectInspector implements ProjectInspector {
  inspect(cwd: string, hints?: WorkspaceInspectionHints): WorkspaceSnapshot {
    const checkedAt = new Date().toISOString();
    let root = resolve(cwd);
    let branch: string | null = null;
    let commit: string | null = null;
    let dirty: boolean | null = null;
    let changedPaths: string[] = [];
    let recentCommits: NonNullable<WorkspaceSnapshot['recentCommits']> = [];
    const limitations: string[] = [];
    let status: WorkspaceSnapshot['status'] = 'checked';
    let folderReadable = true;
    try {
      const info = statSync(root);
      if (!info.isDirectory()) throw new Error('Project path is not a directory');
      readdirSync(root, { withFileTypes: true, encoding: 'utf8' });
    } catch (error) {
      folderReadable = false;
      status = 'unknown';
      const detail = error instanceof Error ? error.message : String(error);
      limitations.push(`Project folder could not be read: ${detail.slice(0, 500)}`);
    }
    if (folderReadable) {
      try {
        const git = resolveExecutable('git');
        if (!git) throw new Error('Git executable was not found on this machine');
        const runRaw = (args: string[]) =>
          execFileSync(git, ['-C', cwd, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
            windowsHide: true,
          });
        const run = (args: string[]) => runRaw(args).trim();
        root = run(['rev-parse', '--show-toplevel']) || root;
        branch = run(['branch', '--show-current']) || null;
        commit = run(['rev-parse', 'HEAD']) || null;
        const statusOutput = runRaw(['status', '--porcelain=v1', '--untracked-files=all']);
        dirty = statusOutput.trim().length > 0;
        changedPaths = statusOutput
          .replace(/\n$/, '')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.slice(3).trim())
          .map((path) => (path.includes(' -> ') ? path.split(' -> ').at(-1)! : path))
          .filter(Boolean)
          .slice(0, MAX_GIT_PATHS);
        const recentHashes = run(['log', `-${MAX_RECENT_COMMITS}`, '--pretty=format:%H'])
          .split('\n')
          .map((hash) => hash.trim())
          .filter(Boolean);
        recentCommits = recentHashes.map((hash) => {
          const detail = run([
            'show',
            '--no-renames',
            '--date=iso-strict',
            '--pretty=format:%H%x1f%cI%x1f%s',
            '--name-only',
            hash,
          ]);
          const [header = '', ...pathLines] = detail.split('\n');
          const [resolvedHash = hash, committedAt = '', subject = ''] = header.split('\x1f');
          return {
            hash: resolvedHash,
            committedAt,
            subject,
            changedPaths: pathLines
              .map((path) => path.trim())
              .filter(Boolean)
              .slice(0, MAX_GIT_PATHS),
          };
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        limitations.push(`Git state unavailable: ${detail.slice(0, 500)}`);
      }
    }
    const sampled = sampleFiles(cwd, root, hints);
    limitations.push(...sampled.limitations);
    return {
      cwd,
      root: status === 'checked' ? root : null,
      branch,
      commit,
      dirty,
      changedPaths,
      recentCommits,
      status,
      checkedAt,
      limitations: [...new Set(limitations)].slice(0, 20),
      fileFingerprint: sampled.fingerprint,
      inventoryFingerprint: sampled.inventoryFingerprint,
      files: sampled.files,
      inspection: sampled.inspection,
    };
  }
}
