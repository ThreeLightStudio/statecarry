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
import { registerProject } from './project-fixtures';

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
  const ownersTable = version === 3 ? 'project_owners' : 'work_owners';
  db.exec(
    `CREATE TABLE schema_version(version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES(${version});
    CREATE TABLE ${ownersTable}(id TEXT PRIMARY KEY);
    CREATE TABLE entities(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT REFERENCES ${ownersTable}(id),body TEXT NOT NULL,PRIMARY KEY(kind,id));`,
  );
  const at = '2026-09-21T00:00:00Z';
  const put = (kind: string, id: string, body: unknown) =>
    db.prepare('INSERT INTO entities VALUES(?,?,NULL,?)').run(kind, id, JSON.stringify(body));
  put('work', 'project-a', {
    id: 'project-a',
    projectId: 'connection-a',
    title: 'Old title',
    projectProfile: { title: 'Registered project', purpose: 'Old purpose' },
    createdAt: at,
  });
  put('connection', 'connection-a', { id: 'connection-a', workId: 'project-a', cwd: original });
  put('projectAnalysis', 'analysis-a', {
    id: 'analysis-a',
    projectId: 'project-a',
    text: 'OLD_ANALYSIS',
  });
  put('direction', 'direction-a', {
    id: 'direction-a',
    projectId: 'project-a',
    text: 'OLD_DIRECTION',
  });
  put('workItem', 'task-a', { id: 'task-a', projectId: 'project-a', title: 'OLD_TASK' });
  put('workDiscussion', 'discussion-a', {
    id: 'discussion-a',
    projectId: 'project-a',
    text: 'OLD_DISCUSSION',
  });
  put('projectExecution', 'project-a', {
    id: 'project-a',
    projectId: 'project-a',
    version: 1,
    requests: ['execution-a'],
    accepted: [],
    comparisons: {},
  });
  put('continuation', 'execution-a', {
    id: 'execution-a',
    projectId: 'project-a',
    requestId: 'request-a',
    state: 'sent',
    externalReport: 'OLD_EXTERNAL_REPORT',
    execution: { status: 'completed', report: 'OLD_EXECUTION_OUTPUT' },
  });
  const authSetting = {
    id: 'global',
    settings: {
      provider: 'openrouter',
      openrouterApiKey: 'DUMMY_CREDENTIAL_SENTINEL',
      openrouterModel: 'test/model',
    },
  };
  put('agentSettings', 'global', authSetting);

  for (const name of [
    'analysis',
    'analysis-cache',
    'analysis-feedback',
    'explanation-candidates',
  ]) {
    mkdirSync(join(directory, name));
    writeFileSync(join(directory, name, 'old.json'), 'OLD_CACHE');
  }
  for (const name of ['analysis-metrics.jsonl', 'observations.jsonl'])
    writeFileSync(join(directory, name), 'OLD_LOG');
  mkdirSync(join(directory, 'assets', 'projects'), { recursive: true });
  writeFileSync(join(directory, 'assets', 'projects', 'old-image.png'), 'OLD_PROJECT_ASSET');
  writeFileSync(
    join(directory, 'browser-state.json'),
    JSON.stringify({
      entries: {
        'statecarry.appearance.theme.v1': 'dark',
        'statecarry.project-drafts.v3.project-a': 'OLD_DRAFT',
        'statecarry.project-action.v3.project-a': 'OLD_ACTION',
      },
    }),
  );
  writeFileSync(join(directory, 'keep-settings.json'), 'APP_SETTINGS_KEEP');
  return { root, directory, original, db, put, authSetting };
}

describe('Public Beta one-time project-data reset', () => {
  it.each([1, 2, 3])(
    'resets schema version %i while preserving app settings and source data',
    (version) => {
      const f = fixture(version);
      f.db.close();

      let repo = new SQLiteRepository(f.directory);
      try {
        expect(repo.db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 4 });
        expect(repo.db.prepare('SELECT kind,id,body FROM entities').all()).toEqual([
          { kind: 'agentSettings', id: 'global', body: JSON.stringify(f.authSetting) },
        ]);
        expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        for (const name of [
          'analysis',
          'analysis-cache',
          'analysis-feedback',
          'explanation-candidates',
          'analysis-metrics.jsonl',
          'observations.jsonl',
          'assets/projects',
        ])
          expect(existsSync(join(f.directory, name))).toBe(false);
        expect(JSON.parse(readFileSync(join(f.directory, 'browser-state.json'), 'utf8'))).toEqual({
          entries: { 'statecarry.appearance.theme.v1': 'dark' },
        });
        expect(readFileSync(join(f.directory, 'keep-settings.json'), 'utf8')).toBe(
          'APP_SETTINGS_KEEP',
        );
        expect(readFileSync(join(f.original, 'keep.txt'), 'utf8')).toBe('SOURCE_KEEP');
        expect(existsSync(join(f.directory, '.beta-v4-transition'))).toBe(false);

        const h = harness(repo);
        const project = registerProject(h, { cwd: f.original });
        h.core.projectModel.createWork(
          project.receipt.projectId,
          { title: 'Fresh work after reset' },
          'fresh-work',
        );
      } finally {
        repo.close();
      }

      repo = new SQLiteRepository(f.directory);
      try {
        expect(repo.list('workItem').map((item) => item.title)).toEqual(['Fresh work after reset']);
        expect(repo.get('agentSettings', 'global')).toEqual(f.authSetting);
        expect(readFileSync(join(f.original, 'keep.txt'), 'utf8')).toBe('SOURCE_KEEP');
      } finally {
        repo.close();
      }
    },
  );

  it.each(['completed', 'failed', 'interrupted'])(
    'allows known terminal external execution state %s to reset',
    (status) => {
      const f = fixture();
      f.put('continuation', 'terminal', { state: 'sent', execution: { status } });
      f.db.close();
      const repo = new SQLiteRepository(f.directory);
      try {
        expect(repo.list('project')).toEqual([]);
        expect(repo.get('agentSettings', 'global')).toEqual(f.authSetting);
      } finally {
        repo.close();
      }
    },
  );

  it.each([
    ['job', 'queued'],
    ['explanationJob', 'waiting'],
    ['explanationJob', 'queued'],
    ['questionExecution', 'queued'],
  ])('resets safely before %s state %s is dispatched', (kind, state) => {
    const f = fixture();
    f.put(kind, 'not-dispatched', { status: state });
    f.db.close();

    const repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('project')).toEqual([]);
      expect(repo.get('agentSettings', 'global')).toEqual(f.authSetting);
    } finally {
      repo.close();
    }
  });

  it.each([
    ['job', 'summarizing'],
    ['job', 'checking'],
    ['job', 'result-unknown'],
    ['explanationJob', 'generating'],
    ['explanationJob', 'repairing'],
    ['explanationJob', 'checking'],
    ['explanationJob', 'result-unknown'],
    ['questionExecution', 'generating'],
    ['questionExecution', 'repairing'],
    ['questionExecution', 'checking'],
    ['questionExecution', 'result-unknown'],
    ['handoff', 'dispatching'],
    ['handoff', 'result-unknown'],
    ['continuation', 'dispatching'],
    ['continuation', 'opening'],
    ['continuation', 'result-unknown'],
  ])('blocks reset for unresolved %s state %s', (kind, state) => {
    const f = fixture();
    f.put(
      kind,
      'pending',
      kind === 'handoff' || kind === 'continuation' ? { state } : { status: state },
    );
    const before = f.db.prepare('SELECT * FROM entities ORDER BY kind,id').all();
    f.db.close();

    expect(() => new SQLiteRepository(f.directory)).toThrow(`${kind}:pending`);
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT * FROM entities ORDER BY kind,id').all()).toEqual(before);
      expect(read.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 2 });
    } finally {
      read.close();
    }
    expect(readFileSync(join(f.directory, 'analysis-cache', 'old.json'), 'utf8')).toBe('OLD_CACHE');
    expect(existsSync(join(f.directory, 'assets', 'projects', 'old-image.png'))).toBe(true);
    expect(existsSync(join(f.directory, 'writer.lock'))).toBe(false);
  });

  it.each([undefined, 'running', 'waiting', 'unknown'])(
    'blocks a sent continuation with execution status %s even if it has a report',
    (status) => {
      const f = fixture();
      f.put('continuation', 'pending', {
        state: 'sent',
        execution: status ? { status } : {},
        externalReport: 'A report alone does not prove execution ended.',
      });
      f.db.close();

      expect(() => new SQLiteRepository(f.directory)).toThrow('continuation:pending');
      expect(readFileSync(join(f.directory, 'analysis-cache', 'old.json'), 'utf8')).toBe(
        'OLD_CACHE',
      );
      expect(existsSync(join(f.directory, 'assets', 'projects', 'old-image.png'))).toBe(true);
    },
  );

  it.each([1, 2])('restores a pre-commit v3 cache quarantine from schema %i first', (version) => {
    const f = fixture(version);
    f.put('job', 'pending', { status: 'summarizing' });
    f.db.close();
    const legacy = join(f.directory, '.beta-v3-transition');
    mkdirSync(legacy);
    renameSync(join(f.directory, 'analysis'), join(legacy, 'analysis'));
    writeFileSync(join(legacy, 'statecarry.sqlite'), 'OLD_DATABASE_SNAPSHOT');

    expect(() => new SQLiteRepository(f.directory)).toThrow('job:pending');
    expect(readFileSync(join(f.directory, 'analysis', 'old.json'), 'utf8')).toBe('OLD_CACHE');
    expect(existsSync(join(f.directory, '.beta-v3-transition'))).toBe(false);
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT version FROM schema_version').get()).toEqual({ version });
    } finally {
      read.close();
    }
  });

  it('discards a committed v3 quarantine before checking pending execution state', () => {
    const f = fixture(3);
    f.put('job', 'pending', { status: 'summarizing' });
    f.db.close();
    const legacy = join(f.directory, '.beta-v3-transition');
    mkdirSync(legacy);
    renameSync(join(f.directory, 'analysis'), join(legacy, 'analysis'));
    writeFileSync(join(legacy, 'statecarry.sqlite'), 'OLD_DATABASE_SNAPSHOT');

    expect(() => new SQLiteRepository(f.directory)).toThrow('job:pending');
    expect(existsSync(join(f.directory, 'analysis'))).toBe(false);
    expect(existsSync(join(f.directory, '.beta-v3-transition'))).toBe(false);
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 3 });
    } finally {
      read.close();
    }
  });

  it('rolls back the reset and restores moved content if quarantine fails', () => {
    const f = fixture();
    const before = f.db.prepare('SELECT * FROM entities ORDER BY kind,id').all();
    f.db.close();
    fault.move = 2;

    expect(() => new SQLiteRepository(f.directory)).toThrow('injected cache move failure');
    const read = new DatabaseSync(join(f.directory, 'statecarry.sqlite'), { readOnly: true });
    try {
      expect(read.prepare('SELECT * FROM entities ORDER BY kind,id').all()).toEqual(before);
      expect(read.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 2 });
    } finally {
      read.close();
    }
    expect(readFileSync(join(f.directory, 'analysis', 'old.json'), 'utf8')).toBe('OLD_CACHE');
    expect(readFileSync(join(f.directory, 'analysis-cache', 'old.json'), 'utf8')).toBe('OLD_CACHE');
    expect(existsSync(join(f.directory, 'assets', 'projects', 'old-image.png'))).toBe(true);
    const repo = new SQLiteRepository(f.directory);
    repo.close();
  });

  it('completes cleanup after commit without losing data created after reset', () => {
    const f = fixture();
    f.db.close();
    let repo = new SQLiteRepository(f.directory);
    const h = harness(repo);
    const project = registerProject(h, { cwd: f.original });
    h.core.projectModel.createWork(
      project.receipt.projectId,
      { title: 'Fresh work' },
      'fresh-work',
    );
    repo.close();

    mkdirSync(join(f.directory, '.beta-v4-transition'));
    writeFileSync(join(f.directory, '.beta-v4-transition', 'obsolete'), 'OLD_CONTENT');
    const state = join(f.directory, '.beta-v4-transition', 'browser-state.next');
    writeFileSync(
      state,
      JSON.stringify({ entries: { 'statecarry.appearance.theme.v1': 'light' } }),
    );
    repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('workItem').map((item) => item.title)).toEqual(['Fresh work']);
      expect(JSON.parse(readFileSync(join(f.directory, 'browser-state.json'), 'utf8'))).toEqual({
        entries: { 'statecarry.appearance.theme.v1': 'light' },
      });
      expect(existsSync(join(f.directory, '.beta-v4-transition'))).toBe(false);
    } finally {
      repo.close();
    }
  });

  it('recovers a pre-commit moved cache before attempting the one-time reset', () => {
    const f = fixture();
    f.db.close();
    mkdirSync(join(f.directory, '.beta-v4-transition'));
    renameSync(join(f.directory, 'analysis'), join(f.directory, '.beta-v4-transition', 'analysis'));
    const repo = new SQLiteRepository(f.directory);
    try {
      expect(repo.list('project')).toEqual([]);
      expect(existsSync(join(f.directory, 'analysis'))).toBe(false);
      expect(existsSync(join(f.directory, '.beta-v4-transition'))).toBe(false);
    } finally {
      repo.close();
    }
  });
});
