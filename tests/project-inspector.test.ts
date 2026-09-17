import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspaceSnapshotSchema } from '@statecarry/contracts';
import { GitProjectInspector } from '../apps/server/src/adapters/project-inspector';

describe('related project inspection', () => {
  it('captures bounded recent commits and current changed paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-git-inspector-'));
    try {
      execFileSync('git', ['init', root]);
      execFileSync('git', ['-C', root, 'config', 'user.email', 'statecarry@example.test']);
      execFileSync('git', ['-C', root, 'config', 'user.name', 'StateCarry Test']);
      writeFileSync(join(root, 'first.ts'), 'export const first = 1;\n');
      execFileSync('git', ['-C', root, 'add', 'first.ts']);
      execFileSync('git', ['-C', root, 'commit', '-m', 'add first']);
      writeFileSync(join(root, 'second.ts'), 'export const second = 2;\n');
      execFileSync('git', ['-C', root, 'add', 'second.ts']);
      execFileSync('git', ['-C', root, 'commit', '-m', 'add second']);
      writeFileSync(join(root, 'first.ts'), 'export const first = 3;\n');
      writeFileSync(join(root, 'untracked.ts'), 'export const untracked = true;\n');

      const snapshot = new GitProjectInspector().inspect(root);
      expect(() => workspaceSnapshotSchema.parse(snapshot)).not.toThrow();
      expect(snapshot.changedPaths).toContain('first.ts');
      expect(snapshot.changedPaths).toContain('untracked.ts');
      expect(snapshot.changedFileCount).toBe(2);
      expect(snapshot.changedFiles).toEqual(
        expect.arrayContaining([
          { path: 'first.ts', status: 'modified' },
          { path: 'untracked.ts', status: 'untracked' },
        ]),
      );
      expect(snapshot.additions).toBe(1);
      expect(snapshot.deletions).toBe(1);
      expect(snapshot.untrackedCount).toBe(1);
      expect(snapshot.diffPreview).toContain('export const first = 3;');
      expect(snapshot.files?.some((file) => file.path === 'first.ts')).toBe(true);
      expect(snapshot.files?.some((file) => file.path === 'untracked.ts')).toBe(true);
      expect(snapshot.recentCommits?.slice(0, 2).map((commit) => commit.subject)).toEqual([
        'add second',
        'add first',
      ]);
      expect(snapshot.recentCommits?.[0].changedPaths).toContain('second.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps an initialized repository without commits Git-aware', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-empty-git-inspector-'));
    try {
      execFileSync('git', ['init', root]);
      writeFileSync(join(root, 'first.ts'), 'export const first = 1;\n');

      const snapshot = new GitProjectInspector().inspect(root);

      expect(snapshot).toMatchObject({
        status: 'checked',
        commit: null,
        dirty: true,
        changedFileCount: 1,
        untrackedCount: 1,
      });
      expect(snapshot.changedFiles).toContainEqual({ path: 'first.ts', status: 'untracked' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a readable non-Git folder checked while reporting Git as unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-non-git-inspector-'));
    try {
      writeFileSync(join(root, 'main.ts'), 'export const ready = true;\n');

      const snapshot = new GitProjectInspector().inspect(root);

      expect(snapshot).toMatchObject({
        status: 'checked',
        root,
        branch: null,
        commit: null,
        dirty: null,
      });
      expect(snapshot.files).toEqual([
        expect.objectContaining({ path: 'main.ts', status: 'checked' }),
      ]);
      expect(snapshot.limitations.some((item) => item.startsWith('Git state unavailable:'))).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a missing project folder unavailable and blocking', () => {
    const root = join(tmpdir(), `statecarry-missing-inspector-${Date.now()}`);
    const snapshot = new GitProjectInspector().inspect(root);

    expect(snapshot).toMatchObject({
      status: 'unknown',
      root: null,
      branch: null,
      commit: null,
      dirty: null,
      files: [],
    });
    expect(
      snapshot.limitations.some((item) => item.startsWith('Project folder could not be read:')),
    ).toBe(true);
  });

  it('selects a connected file beyond the first directory sample and reads its implementation excerpt', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-inspector-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 130; i++)
        writeFileSync(
          join(root, 'src', `file-${String(i).padStart(3, '0')}.ts`),
          `export const file${i} = ${i};\n`,
        );
      const target = `${'// context\n'.repeat(180)}\nexport function importantFunction() { return 'related'; }\n`;
      writeFileSync(join(root, 'src', 'target.ts'), target);

      const snapshot = new GitProjectInspector().inspect(root, {
        paths: ['src/target.ts'],
        symbols: ['importantFunction'],
        terms: [],
      });
      const file = snapshot.files?.find((item) => item.path === 'src/target.ts');
      expect(file).toMatchObject({ selection: 'related', status: 'checked' });
      expect(file?.preview).toContain('importantFunction');
      expect(snapshot.inspection).toMatchObject({
        strategy: 'related',
        relatedPaths: ['src/target.ts'],
      });
      expect(snapshot.inspection?.omittedCount).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records an inventory fingerprint independently of selected file contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-inventory-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'main.ts'), 'export const main = true;\n');
      for (let i = 0; i < 130; i++)
        writeFileSync(
          join(root, 'src', `sample-${String(i).padStart(3, '0')}.ts`),
          `export const sample${i} = ${i};\n`,
        );
      writeFileSync(join(root, 'src', 'zzz.ts'), 'export const zzz = true;\n');
      const inspector = new GitProjectInspector();
      const first = inspector.inspect(root, { paths: ['src/main.ts'], symbols: [], terms: [] });
      writeFileSync(join(root, 'src', 'zzz.ts'), 'export const zzz = false;\n');
      const second = inspector.inspect(root, { paths: ['src/main.ts'], symbols: [], terms: [] });
      expect(second.inventoryFingerprint).not.toBe(first.inventoryFingerprint);
      expect(second.fileFingerprint).toBe(first.fileFingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes generated project caches from codebase evidence and inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-generated-cache-'));
    try {
      mkdirSync(join(root, '.turbo', 'cache'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 180; i++)
        writeFileSync(join(root, '.turbo', 'cache', `entry-${i}.json`), `{"value":${i}}\n`);
      writeFileSync(join(root, 'src', 'main.ts'), 'export const main = true;\n');

      const inspector = new GitProjectInspector();
      const first = inspector.inspect(root);
      expect(first.files?.some((file) => file.path === 'src/main.ts')).toBe(true);
      expect(first.files?.some((file) => file.path.startsWith('.turbo/'))).toBe(false);
      const inventory = first.inventoryFingerprint;

      writeFileSync(join(root, '.turbo', 'cache', 'entry-0.json'), '{"value":"changed"}\n');
      const second = inspector.inspect(root);
      expect(second.inventoryFingerprint).toBe(inventory);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
