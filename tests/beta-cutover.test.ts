import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { harness } from './helpers';
const fault = vi.hoisted(() => ({ move: 0 }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (fault.move > 0 && --fault.move === 0) throw new Error('injected cache move failure');
      return fs.renameSync(...args);
    },
  };
});
const roots: string[] = [];
afterEach(() => {
  fault.move = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(version = 2) {
  const root = mkdtempSync(join(tmpdir(), 'statecarry-cutover-'));
  roots.push(root);
  const directory = join(root, 'app');
  mkdirSync(directory);
  const original = join(root, 'project');
  mkdirSync(original);
  writeFileSync(join(original, 'keep.txt'), 'SOURCE_KEEP');
  const db = new DatabaseSync(join(directory, 'statecarry.sqlite'));
  db.exec(
    `CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(${version}); CREATE TABLE work_owners(id TEXT PRIMARY KEY); CREATE TABLE entities(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT REFERENCES work_owners(id),body TEXT NOT NULL,PRIMARY KEY(kind,id));`,
  );
  const at = '2026-09-21T00:00:00Z';
  const put = (kind: string, id: string, body: unknown) =>
    db.prepare('INSERT INTO entities VALUES(?,?,NULL,?)').run(kind, id, JSON.stringify(body));
  put('work', 'project-a', {
    id: 'project-a',
    projectId: 'connection-a',
    title: 'Old title',
    projectProfile: {
      title: 'Registered project',
      purpose: 'Keep purpose',
      focused: true,
      iconAsset: 'icon.png',
      bannerAsset: 'banner.png',
    },
    revision: 7,
    createdAt: at,
    resume: { private: 'OLD_ANALYSIS' },
    goal: { text: 'OLD_GOAL' },
    coordinationMode: 'none',
  });
  put('connection', 'connection-a', {
    id: 'connection-a',
    workId: 'project-a',
    title: 'Registered project',
    cwd: original,
    threadIds: ['thread-a'],
    startTurnIds: { 'thread-a': 'turn-a' },
    recordRanges: { 'thread-a': { start: { turnId: 'turn-a', itemId: 'item-a' } } },
    discover: true,
    revision: 3,
    createdAt: at,
    removedAt: at,
  });
  put('workItem', 'old-work', { id: 'old-work', projectId: 'project-a', title: 'OLD_WORK' });
  put('releasePolicy', 'old-policy', { id: 'old-policy', projectId: 'project-a' });
  put('source', 'old-source', { id: 'old-source', text: 'OLD_SOURCE_COPY' });
  for (const name of ['analysis', 'analysis-cache']) {
    mkdirSync(join(directory, name));
    writeFileSync(join(directory, name, 'old.json'), 'OLD_CACHE');
  }
  writeFileSync(join(directory, 'isolation-verification.json'), 'AUTH_SETTINGS_KEEP');
  return { root, directory, original, db, put };
}
describe('Public Beta registration-only cutover', () => {
  it('clears terminal external execution records and preserves new data when committed cleanup resumes', () => {
    const f = fixture();
    f.put('continuation', 'terminal', { state: 'sent', execution: { status: 'completed' } });
    f.db.close();
    let repo = new SQLiteRepository(f.directory);
    const h = harness(repo);
    h.core.projectModel.createWork(
      'project-a',
      { title: 'New work after cutover' },
      'new-work-after-cutover',
    );
    expect(repo.get('project', 'project-a')?.coordinationMode).toBe('none');
    repo.close();
    mkdirSync(join(f.directory, '.beta-v3-transition'));
    writeFileSync(join(f.directory, '.beta-v3-transition', 'obsolete'), 'OLD_CONTENT');
    repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('workItem')[0].title).toBe('New work after cutover');
      expect(existsSync(join(f.directory, '.beta-v3-transition'))).toBe(false);
    } finally {
      repo.close();
    }
  });

  it.each([1, 2])(
    'imports only registration settings from version %i and keeps fresh state after restart',
    (version) => {
      const f = fixture(version);
      f.db.close();
      let repo = new SQLiteRepository(f.directory);
      try {
        expect(repo.db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 3 });
        expect(repo.list('project')).toHaveLength(1);
        expect(repo.get('project', 'project-a')).toMatchObject({
          id: 'project-a',
          connectionId: 'connection-a',
          title: 'Registered project',
          cwd: f.original,
          purposes: [{ text: 'Keep purpose', confirmed: true }],
          focused: true,
          iconAsset: 'icon.png',
          bannerAsset: 'banner.png',
          lifecycle: 'disconnected',
          revision: 8,
        });
        expect(repo.get('connection', 'connection-a')).toMatchObject({
          projectId: 'project-a',
          threadIds: ['thread-a'],
          startTurnIds: { 'thread-a': 'turn-a' },
          recordRanges: { 'thread-a': { start: { turnId: 'turn-a', itemId: 'item-a' } } },
          discover: true,
        });
        expect(
          repo.db
            .prepare("SELECT kind FROM entities WHERE kind NOT IN ('project','connection','link')")
            .all(),
        ).toEqual([]);
        expect(JSON.stringify(repo.db.prepare('SELECT body FROM entities').all())).not.toMatch(
          /OLD_ANALYSIS|OLD_WORK|OLD_SOURCE_COPY|OLD_GOAL/,
        );
        expect(existsSync(join(f.directory, 'analysis-cache'))).toBe(false);
        expect(existsSync(join(f.directory, '.beta-v3-transition'))).toBe(false);
        expect(readFileSync(join(f.original, 'keep.txt'), 'utf8')).toBe('SOURCE_KEEP');
        expect(readFileSync(join(f.directory, 'isolation-verification.json'), 'utf8')).toBe(
          'AUTH_SETTINGS_KEEP',
        );
        const h = harness(repo);
        h.core.projectModel.createWork('project-a', { title: 'New durable work' }, 'new-work');
        mkdirSync(join(f.directory, 'analysis-cache'));
        writeFileSync(join(f.directory, 'analysis-cache', 'new.json'), 'NEW_CACHE');
        repo.close();
        repo = new SQLiteRepository(f.directory);
        expect(repo.list('workItem').map((item) => item.title)).toEqual(['New durable work']);
        expect(readFileSync(join(f.directory, 'analysis-cache', 'new.json'), 'utf8')).toBe(
          'NEW_CACHE',
        );
        expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        repo.close();
      }
    },
  );
  it.each([
    ['job', { status: 'checking' }],
    ['explanationJob', { status: 'generating' }],
    ['questionExecution', { status: 'result-unknown' }],
    ['handoff', { state: 'dispatching' }],
    ['continuation', { state: 'sent' }],
    ['continuation', { state: 'result-unknown' }],
  ])('blocks unresolved %s before changing data or caches', (kind, body) => {
    const f = fixture();
    f.put(kind as string, 'pending', body);
    const before = f.db.prepare('SELECT * FROM entities').all();
    f.db.close();
    expect(() => new SQLiteRepository(f.directory)).toThrow(`${kind}:pending`);
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT * FROM entities').all()).toEqual(before);
      expect(read.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 2 });
    } finally {
      read.close();
    }
    expect(readFileSync(join(f.directory, 'analysis-cache', 'old.json'), 'utf8')).toBe('OLD_CACHE');
    expect(existsSync(join(f.directory, 'writer.lock'))).toBe(false);
  });
  it('rolls back the database and already moved cache when the next move fails', () => {
    const f = fixture();
    const before = f.db.prepare('SELECT * FROM entities').all();
    f.db.close();
    fault.move = 2;
    expect(() => new SQLiteRepository(f.directory)).toThrow('injected cache move failure');
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT * FROM entities').all()).toEqual(before);
    } finally {
      read.close();
    }
    for (const name of ['analysis', 'analysis-cache'])
      expect(readFileSync(join(f.directory, name, 'old.json'), 'utf8')).toBe('OLD_CACHE');
    const repo = new SQLiteRepository(f.directory);
    repo.close();
  });
  it('recovers cache movement interrupted before the database transaction committed', () => {
    const f = fixture();
    f.db.close();
    mkdirSync(join(f.directory, '.beta-v3-transition'));
    renameSync(join(f.directory, 'analysis'), join(f.directory, '.beta-v3-transition', 'analysis'));
    const repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('project')).toHaveLength(1);
      expect(existsSync(join(f.directory, '.beta-v3-transition'))).toBe(false);
    } finally {
      repo.close();
    }
  });
  it('keeps duplicate registrations and unavailable folders without re-registering or merging them', () => {
    const f = fixture();
    const at = '2026-09-21T00:00:00Z';
    f.put('work', 'project-b', {
      id: 'project-b',
      projectId: 'connection-b',
      title: 'Second',
      createdAt: at,
    });
    f.put('connection', 'connection-b', {
      id: 'connection-b',
      workId: 'project-b',
      title: 'Second',
      cwd: f.original,
      createdAt: at,
    });
    f.db.close();
    rmSync(f.original, { recursive: true });
    const repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('project').map((p) => p.id)).toEqual(['project-a', 'project-b']);
    } finally {
      repo.close();
    }
  });
});
