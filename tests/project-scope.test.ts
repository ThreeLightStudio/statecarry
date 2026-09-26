import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectChangeScope } from '../apps/server/src/adapters/project-scope';
import { StateCarry } from '@statecarry/core';
import { harness } from './helpers';
import { registerProject } from './project-fixtures';

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'statecarry-scope-'));
  folders.push(cwd);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(
    join(cwd, 'shared.txt'),
    Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n',
  );
  git('add', 'shared.txt');
  git('commit', '-qm', 'baseline');
  return { cwd, git };
}
it('captures staged and unstaged sections in the same file without changing the index', () => {
  const { cwd, git } = repository();
  const content = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  content[1] = 'staged change';
  writeFileSync(join(cwd, 'shared.txt'), content.join('\n') + '\n');
  git('add', 'shared.txt');
  content[30] = 'unstaged change';
  writeFileSync(join(cwd, 'shared.txt'), content.join('\n') + '\n');
  const before = git('diff', '--cached');
  const result = inspectChangeScope(cwd);
  expect(result.complete).toBe(true);
  expect(result.scopes.map((s) => s.layer)).toEqual(['staged', 'unstaged']);
  expect(result.scopes[0].patch).toContain('staged change');
  expect(result.scopes[1].patch).toContain('unstaged change');
  expect(git('diff', '--cached')).toBe(before);
});
it('keeps existing scope IDs stable when another file changes and changes the overall basis', () => {
  const { cwd } = repository();
  writeFileSync(join(cwd, 'shared.txt'), 'new text');
  const first = inspectChangeScope(cwd);
  writeFileSync(join(cwd, 'other.txt'), 'another task');
  const second = inspectChangeScope(cwd);
  expect(second.scopes.find((s) => s.path === 'shared.txt')?.id).toBe(first.scopes[0].id);
  expect(second.basis).not.toBe(first.basis);
});
it('handles detached HEAD, filenames with spaces, binary files, and unborn repositories', () => {
  const { cwd, git } = repository();
  git('checkout', '--detach', '-q');
  writeFileSync(join(cwd, 'binary file.bin'), Buffer.from([0, 1, 2, 3]));
  expect(inspectChangeScope(cwd)).toMatchObject({
    complete: true,
    scopes: [expect.objectContaining({ path: 'binary file.bin', kind: 'file' })],
  });
  const empty = mkdtempSync(join(tmpdir(), 'statecarry-unborn-'));
  folders.push(empty);
  execFileSync('git', ['init', '-q', empty]);
  writeFileSync(join(empty, 'first.txt'), 'first');
  expect(inspectChangeScope(empty).complete).toBe(true);
});
it('never treats unreadable or over-limit scope as a clean repository', () => {
  const { cwd } = repository();
  writeFileSync(join(cwd, 'large.txt'), 'x'.repeat(90000));
  const result = inspectChangeScope(cwd);
  expect(result.complete).toBe(false);
  expect(result.limitations.length).toBeGreaterThan(0);
  expect(inspectChangeScope('/path/that/does/not/exist').complete).toBe(false);
});

it('keeps the inventory and small changes usable while a large tracked diff is read separately', () => {
  const { cwd, git } = repository();
  writeFileSync(join(cwd, 'large.txt'), 'baseline\n');
  git('add', 'large.txt');
  git('commit', '-qm', 'large file baseline');
  writeFileSync(join(cwd, 'large.txt'), 'x'.repeat(90000) + '\n');
  writeFileSync(join(cwd, 'shared.txt'), 'small unrelated change\n');
  const beforeIndex = git('ls-files', '--stage');
  const initial = inspectChangeScope(cwd);
  expect(initial).toMatchObject({ inventoryComplete: true, complete: false });
  expect(initial.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'large.txt', detail: 'unread' }),
      expect.objectContaining({ path: 'shared.txt', detail: 'ready' }),
    ]),
  );
  expect(initial.scopes.map((scope) => scope.path)).toEqual(['shared.txt']);
  const reread = inspectChangeScope(cwd);
  expect(reread.basis).toBe(initial.basis);
  const expanded = inspectChangeScope(cwd, [{ path: 'large.txt', layer: 'unstaged' }]);
  expect(expanded.complete).toBe(true);
  expect(expanded.basis).toBe(initial.basis);
  expect(expanded.scopes.find((scope) => scope.path === 'large.txt')!.patch.length).toBeGreaterThan(
    80000,
  );
  expect(git('ls-files', '--stage')).toBe(beforeIndex);
  writeFileSync(join(cwd, 'large.txt'), 'y'.repeat(90000) + '\n');
  expect(inspectChangeScope(cwd).basis).not.toBe(initial.basis);
});

it('retains readable files when another file exceeds the detail limit and tracks an unread file changing', () => {
  const { cwd } = repository();
  writeFileSync(join(cwd, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024 + 1, 1));
  writeFileSync(join(cwd, 'shared.txt'), 'small change\n');
  const result = inspectChangeScope(cwd, [{ path: 'huge.bin', layer: 'untracked' }]);
  expect(result.inventoryComplete).toBe(true);
  expect(result.complete).toBe(false);
  expect(result.files!.find((file) => file.path === 'huge.bin')?.detail).toBe('unavailable');
  expect(result.scopes.some((scope) => scope.path === 'shared.txt')).toBe(true);
  expect(inspectChangeScope(cwd).basis).toBe(result.basis);
  writeFileSync(join(cwd, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024 + 1, 2));
  expect(inspectChangeScope(cwd).basis).not.toBe(result.basis);
});

it('does not make unavailable inventory appear clean or use the read time as its identity', () => {
  const one = inspectChangeScope('/path/that/does/not/exist');
  const two = inspectChangeScope('/path/that/does/not/exist');
  expect(one).toMatchObject({ inventoryComplete: false, complete: false, files: [], scopes: [] });
  expect(two.basis).toBe(one.basis);
});

it('loads a selected large file through Core, keeps its basis, and rechecks it before execution', async () => {
  const { cwd } = repository();
  writeFileSync(join(cwd, 'shared.txt'), 'x'.repeat(90000) + '\n');
  const h = harness();
  const id = registerProject(h, { cwd }).receipt.projectId;
  const core = new StateCarry(
    h.repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    h.core.ids,
    h.core.events,
    undefined,
    {
      scope: inspectChangeScope,
      inspect: () => ({
        cwd,
        branch: 'main',
        commit: 'head',
        dirty: true,
        status: 'checked',
        checkedAt: h.core.clock.now(),
        limitations: [],
        fileFingerprint: 'files',
      }),
    },
  );
  const command = (value: unknown) =>
    core.executions.command(id, value, core.executions.view(id).record.version);
  let view = await command({ action: 'observe', outputLanguage: 'en' });
  const basis = view.record.observation!.basis;
  expect(view.record.observation).toMatchObject({
    inventoryComplete: true,
    complete: false,
    scopes: [],
  });
  await expect(
    command({ action: 'read-scope-file', basis, path: 'outside.txt', layer: 'unstaged' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  view = await command({ action: 'read-scope-file', basis, path: 'shared.txt', layer: 'unstaged' });
  expect(view.record.observation).toMatchObject({ basis, complete: true });
  expect(h.repo.get('projectScope', id)?.expandedFiles).toEqual([
    { path: 'shared.txt', layer: 'unstaged' },
  ]);
  expect(h.repo.get('projectExecution', id)).not.toHaveProperty('expandedFiles');
  const selected = view.record.observation!.scopes[0].id;
  expect(
    core.executions.validate(id, { basis, scopeIds: [selected], operation: 'commit' }).basis,
  ).toBe(basis);
  writeFileSync(join(cwd, 'shared.txt'), 'y'.repeat(90000) + '\n');
  expect(() =>
    core.executions.validate(id, { basis, scopeIds: [selected], operation: 'commit' }),
  ).toThrow('scope is not current');
});

it('persists real kept scopes across Core reentry and reopens only changed or new scopes', async () => {
  const { cwd, git } = repository();
  const original = Array.from({ length: 40 }, (_, index) => `line ${index}`);
  original[1] = 'the kept change';
  const initialContent = `${original.join('\n')}\n`;
  writeFileSync(join(cwd, 'shared.txt'), initialContent);
  const indexBefore = git('diff', '--cached');
  const h = harness();
  const id = registerProject(h, { cwd }).receipt.projectId;
  const createCore = () =>
    new StateCarry(
      h.repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      h.core.ids,
      h.core.events,
      h.core.sessionExecutor,
      {
        scope: inspectChangeScope,
        inspect: () => ({
          cwd,
          root: cwd,
          branch: 'main',
          commit: 'head',
          dirty: true,
          status: 'checked',
          checkedAt: h.core.clock.now(),
          changedPaths: ['shared.txt'],
          limitations: [],
          fileFingerprint: 'files',
        }),
      },
    );
  const command = async (
    core: ReturnType<typeof createCore>,
    value:
      | { action: 'observe'; outputLanguage: 'en' }
      | { action: 'keep'; basis: string; scopeIds: string[] },
  ) => core.executions.command(id, value, core.executions.view(id).record.version);

  let core = createCore();
  core.projectModel.setDirection(id, 'Improve the project return experience.');
  core.projectModel.createWork(
    id,
    { title: 'Review project changes', completionCondition: 'The changes are checked.' },
    'scope-work',
  );
  const workItemId = core.projectModel.view(id).workItems[0]!.id;
  const observed = await command(core, { action: 'observe', outputLanguage: 'en' });
  const keptScope = observed.record.observation!.scopes.find(
    (scope) => scope.path === 'shared.txt',
  )!;
  expect(keptScope).toBeDefined();
  await command(core, {
    action: 'keep',
    basis: observed.record.observation!.basis,
    scopeIds: [keptScope.id],
  });
  expect(readFileSync(join(cwd, 'shared.txt'), 'utf8')).toBe(initialContent);
  expect(git('diff', '--cached')).toBe(indexBefore);

  core = createCore();
  expect(core.now.resolve(id)).toMatchObject({
    currentWorkId: workItemId,
    state: 'active',
    next: { kind: 'continue-work', workItemId },
  });
  expect(core.executions.view(id).record.kept[0]?.scopeIds).toEqual([keptScope.id]);

  writeFileSync(join(cwd, 'unrelated.txt'), 'an unrelated change\n');
  const withUnrelated = await command(core, { action: 'observe', outputLanguage: 'en' });
  const currentScopes = withUnrelated.record.observation!.scopes;
  expect(currentScopes.find((scope) => scope.path === 'shared.txt')?.id).toBe(keptScope.id);
  const unrelatedScope = currentScopes.find((scope) => scope.path === 'unrelated.txt')!;
  expect(unrelatedScope.id).not.toBe(keptScope.id);
  expect(withUnrelated.record.kept[0]?.scopeIds).toEqual([keptScope.id]);
  expect(core.now.resolve(id)).toMatchObject({
    currentWorkId: workItemId,
    state: 'active',
    next: { kind: 'continue-work', workItemId },
  });

  core.projectModel.stopWork(id, workItemId);
  expect(core.now.resolve(id).next?.kind).toBe('review-remaining-changes');

  const changedContent = [...original];
  changedContent[1] = 'the same scope changed again';
  writeFileSync(join(cwd, 'shared.txt'), `${changedContent.join('\n')}\n`);
  const reentered = createCore();
  const afterSameScopeChange = await command(reentered, {
    action: 'observe',
    outputLanguage: 'en',
  });
  const changedScope = afterSameScopeChange.record.observation!.scopes.find(
    (scope) => scope.path === 'shared.txt',
  )!;
  expect(changedScope.id).not.toBe(keptScope.id);
  expect(afterSameScopeChange.record.kept[0]?.scopeIds).toEqual([keptScope.id]);
  expect(reentered.now.resolve(id)).toMatchObject({
    currentWorkId: workItemId,
    state: 'stopped',
    next: { kind: 'review-remaining-changes' },
  });
  expect(git('diff', '--cached')).toBe(indexBefore);
});
