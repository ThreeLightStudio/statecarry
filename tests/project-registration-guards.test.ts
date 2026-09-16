import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalProjectCommand } from '../apps/server/src/adapters/project-folder';
import { harness } from './helpers';

it('rejects relative and invalid folders through older connection routes before changing a registration', () => {
  const h = harness();
  const workId = h.connect();
  const connection = h.core.connection(h.core.work(workId).projectId);
  const before = structuredClone(h.repo.list('connection'));
  for (const cwd of ['.', '../project', '/invalid\0folder']) {
    const payload = {
      title: 'Project',
      cwd,
      threadIds: ['thread-a'],
      startTurnIds: {},
      discover: false,
    };
    expect(() =>
      h.core.connect({ requestId: h.core.ids.next(), expectedRevision: 0, payload }),
    ).toThrow('absolute project folder');
    expect(() => h.core.updateConnection(connection.id, h.command(workId, payload))).toThrow(
      'absolute project folder',
    );
  }
  expect(h.repo.list('connection')).toEqual(before);
  expect(h.repo.list('work')).toHaveLength(1);
});

it('keeps new project identity when older connection and goal routes are used', () => {
  const h = harness();
  const create = (cwd: string) =>
    h.core.projects.create({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: { title: 'Fresh project', cwd, purpose: '', threadIds: [], discover: false },
    });
  const project = create('/project/one');
  const other = create('/project/two');
  const before = structuredClone(h.repo.list('work'));
  expect(() =>
    h.core.connect({
      requestId: h.core.ids.next(),
      expectedRevision: 0,
      payload: {
        title: 'A new session',
        cwd: '/project/one/.',
        threadIds: ['old'],
        discover: false,
      },
    }),
  ).toThrow('already a project');
  expect(() =>
    h.core.chooseGoal(
      project.workId,
      h.command(project.workId, { candidateId: 'old', action: 'confirm' }),
    ),
  ).toThrow('A goal does not create another project');
  expect(() =>
    h.core.updateConnection(
      other.resultId,
      h.command(other.workId, {
        title: 'Moved session',
        cwd: '/project/one/',
        threadIds: ['other'],
        startTurnIds: {},
        discover: false,
      }),
    ),
  ).toThrow('already belongs');
  expect(h.repo.list('work')).toEqual(before);
  expect(h.repo.list('link')).toEqual([]);
  h.core.resumes.setGoal(project.workId, {
    text: 'A fresh goal',
    version: h.core.resumes.view(project.workId).version,
  });
  expect(h.core.projects.list().projects).toHaveLength(2);
  expect(h.core.projects.list().projects[0]).toMatchObject({
    workId: project.workId,
    title: 'Fresh project',
    resume: { goalText: 'A fresh goal' },
  });
});

it('resolves local symlinks before the project registration is compared without replacing saved context', () => {
  const root = mkdtempSync(join(tmpdir(), 'statecarry-folder-alias-'));
  try {
    const folder = join(root, 'project');
    const alias = join(root, 'alias');
    mkdirSync(folder);
    symlinkSync(folder, alias);
    const h = harness();
    const first = {
      requestId: 'folder',
      expectedRevision: 0,
      payload: {
        title: 'Saved project',
        cwd: folder,
        purpose: 'Saved purpose',
        threadIds: [],
        discover: false,
      },
    };
    const saved = h.core.projects.create(canonicalProjectCommand(first));
    const reused = h.core.projects.create(
      canonicalProjectCommand({
        ...first,
        requestId: 'alias',
        payload: { ...first.payload, title: 'Old session title', cwd: alias },
      }),
    );
    expect(reused).toMatchObject({
      command: 'project-reuse',
      workId: saved.workId,
      resultId: saved.resultId,
    });
    expect(h.core.projects.list().projects).toHaveLength(1);
    expect(h.core.projects.list().projects[0]).toMatchObject({
      title: 'Saved project',
      purpose: 'Saved purpose',
      cwd: realpathSync(folder),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
