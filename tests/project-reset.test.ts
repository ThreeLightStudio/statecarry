import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import {
  previewProjectReset,
  resetProjectRegistrations,
} from '../scripts/reset-project-registrations';
import { harness } from './helpers';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'statecarry-fresh-projects-'));
  const directory = join(root, 'data');
  const original = join(root, 'original');
  mkdirSync(original);
  writeFileSync(join(original, 'conversation.jsonl'), 'ORIGINAL_KEEP');
  const repo = new SQLiteRepository(directory);
  const h = harness(repo);
  const command = {
    requestId: 'legacy-registration',
    expectedRevision: 0,
    payload: {
      title: 'OLD_GOAL_DO_NOT_REUSE',
      cwd: original,
      threadIds: ['thread-a'],
      discover: true,
    },
  };
  const first = h.core.connect(command);
  const next = h.core.connect({ ...command, requestId: 'legacy-registration-2' });
  mkdirSync(join(directory, 'analysis-cache'));
  writeFileSync(join(directory, 'analysis-cache', 'old.json'), 'OLD_CACHED_RECOMMENDATION');
  writeFileSync(join(directory, 'observations.jsonl'), 'OLD_ACTIVITY');
  writeFileSync(join(directory, 'navigation-verification.json'), 'CAPABILITY_KEEP');
  let closed = false;
  const close = () => {
    if (!closed) {
      repo.close();
      closed = true;
    }
  };
  return { root, directory, original, repo, h, command, first, next, close };
}

describe('offline reset to fresh project registrations', () => {
  it('groups actual folders and removes old inputs, recommendations and caches without touching originals', async () => {
    const f = fixture();
    let reopened: SQLiteRepository | undefined;
    try {
      await f.h.core.collect(f.first.workId);
      f.h.core.describeGoal(
        f.first.workId,
        f.h.command(f.first.workId, { text: 'OLD_MANUAL_GOAL' }),
      );
      const old = f.h.core.work(f.first.workId);
      f.repo.put('work', {
        ...old,
        resumeOverrides: [
          {
            candidateKey: 'old',
            version: 'old',
            scope: 'old',
            kind: 'done',
            at: '2026-09-16T00:00:00Z',
          },
        ],
      });
      const alias = join(f.root, 'alias');
      symlinkSync(f.original, alias);
      f.h.core.connect({
        ...f.command,
        requestId: 'alias',
        payload: { ...f.command.payload, cwd: alias },
      });
      const second = join(f.root, 'another', 'original');
      mkdirSync(second, { recursive: true });
      f.h.core.connect({
        ...f.command,
        requestId: 'different-folder',
        payload: { ...f.command.payload, cwd: second },
      });
      const before = f.repo.db.prepare('SELECT * FROM entities ORDER BY kind,id').all();
      const plan = previewProjectReset(f.directory);
      expect(plan.registrations).toBe(4);
      expect(plan.projects).toHaveLength(2);
      expect(plan.projects.map((project) => project.previousWorkIds.length).sort()).toEqual([1, 3]);
      expect(f.repo.db.prepare('SELECT * FROM entities ORDER BY kind,id').all()).toEqual(before);
      expect(() => resetProjectRegistrations(f.directory, plan.token)).toThrow(
        'writer may be alive',
      );
      f.close();
      const result = resetProjectRegistrations(f.directory, plan.token);
      expect(result.projects).toHaveLength(2);
      reopened = new SQLiteRepository(f.directory);
      const h = harness(reopened);
      expect(h.core.projects.list().projects).toHaveLength(2);
      for (const project of h.core.projects.list().projects) {
        expect(project).toMatchObject({
          purpose: '',
          focused: false,
          acceptedKeys: [],
          pausedKeys: [],
          resume: {
            sessionCount: 0,
            goalText: null,
            candidates: [],
            generatedAt: null,
            correctedKeys: [],
            dismissedKeys: [],
          },
        });
        expect(project.workId).not.toBe(f.first.workId);
        expect(project.workId).not.toBe(f.next.workId);
      }
      expect(reopened.list('source')).toEqual([]);
      expect(reopened.list('job')).toEqual([]);
      expect(reopened.list('checkpoint')).toEqual([]);
      expect(reopened.list('summary')).toEqual([]);
      expect(reopened.list('link')).toEqual([]);
      expect(h.core.connect(f.command)).toEqual(f.first);
      expect(h.core.projects.list().projects).toHaveLength(2);
      expect(() => h.core.work(f.first.workId)).toThrow('Work not found');
      expect(readFileSync(join(f.original, 'conversation.jsonl'), 'utf8')).toBe('ORIGINAL_KEEP');
      expect(existsSync(join(f.directory, 'analysis-cache'))).toBe(false);
      expect(existsSync(join(f.directory, 'observations.jsonl'))).toBe(false);
      expect(
        readFileSync(join(result.backupDirectory!, 'analysis-cache', 'old.json'), 'utf8'),
      ).toBe('OLD_CACHED_RECOMMENDATION');
      expect(readFileSync(join(f.directory, 'navigation-verification.json'), 'utf8')).toBe(
        'CAPABILITY_KEEP',
      );
      expect(existsSync(join(result.backupDirectory!, 'statecarry.sqlite'))).toBe(true);
      expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(h.counts()).toEqual({ generationCalls: 0, checkCalls: 0, openCalls: 0 });
    } finally {
      reopened?.close();
      f.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses a stale preview before retiring any content', () => {
    const f = fixture();
    try {
      const plan = previewProjectReset(f.directory, 'Project');
      f.repo.put('work', { ...f.h.core.work(f.first.workId), revision: 2 });
      f.close();
      expect(() => resetProjectRegistrations(f.directory, plan.token, 'Project')).toThrow(
        'Saved data changed',
      );
      expect(existsSync(join(f.directory, 'analysis-cache', 'old.json'))).toBe(true);
      expect(existsSync(join(f.directory, 'backups'))).toBe(false);
      expect(previewProjectReset(f.directory).registrations).toBe(2);
    } finally {
      f.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('does not discard executions whose result is unknown', async () => {
    const f = fixture();
    try {
      await f.h.core.collect(f.first.workId);
      f.repo.put('job', {
        id: 'unresolved-job',
        workId: f.first.workId,
        inputVersion: 'old',
        extractorVersion: 'old',
        status: 'result-unknown',
        attempts: 1,
        attemptToken: 'old',
        remote: null,
        candidate: null,
        model: 'fixture',
        error: 'Unconfirmed result',
        retryable: false,
        updatedAt: '2026-09-16T00:00:00Z',
        resultId: null,
      });
      f.close();
      const plan = previewProjectReset(f.directory);
      expect(plan.unresolved).toEqual([{ kind: 'job', count: 1 }]);
      expect(() => resetProjectRegistrations(f.directory, plan.token)).toThrow(
        'Resolve unfinished executions',
      );
      expect(existsSync(join(f.directory, 'analysis-cache', 'old.json'))).toBe(true);
    } finally {
      f.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('rolls the database and active cache locations back if a replacement write fails', () => {
    const f = fixture();
    try {
      f.repo.db.exec(
        "CREATE TRIGGER fail_replacement BEFORE INSERT ON entities WHEN NEW.kind='work' BEGIN SELECT RAISE(ABORT, 'injected replacement failure'); END;",
      );
      f.close();
      const before = previewProjectReset(f.directory, 'Project');
      expect(() => resetProjectRegistrations(f.directory, before.token, 'Project')).toThrow(
        'injected replacement failure',
      );
      expect(previewProjectReset(f.directory, 'Project').token).toBe(before.token);
      expect(readFileSync(join(f.directory, 'analysis-cache', 'old.json'), 'utf8')).toBe(
        'OLD_CACHED_RECOMMENDATION',
      );
      expect(readFileSync(join(f.directory, 'observations.jsonl'), 'utf8')).toBe('OLD_ACTIVITY');
      expect(readFileSync(join(f.original, 'conversation.jsonl'), 'utf8')).toBe('ORIGINAL_KEEP');
    } finally {
      f.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('keeps a sent continuation tracked until its outcome can be resolved', () => {
    const f = fixture();
    try {
      f.repo.put('continuation', {
        id: 'sent-continuation',
        workId: f.first.workId,
        requestId: 'sent-request',
        state: 'sent',
        threadId: 'remote-thread',
        turnId: 'remote-turn',
        error: null,
        createdAt: '2026-09-16T00:00:00Z',
        updatedAt: '2026-09-16T00:00:00Z',
        target: {
          mode: 'new-session',
          threadId: null,
          title: 'Submitted work',
          workId: f.first.workId,
          expectedRevision: 1,
          payload: {
            goal: null,
            currentState: 'A task was sent.',
            nextAction: 'Review the output.',
            doneWhen: 'The result is reviewed.',
            constraints: [],
          },
        },
      });
      f.close();
      const plan = previewProjectReset(f.directory);
      expect(plan.unresolved).toEqual([{ kind: 'continuation', count: 1 }]);
      expect(() => resetProjectRegistrations(f.directory, plan.token)).toThrow(
        'Resolve unfinished executions',
      );
      expect(existsSync(join(f.directory, 'analysis-cache', 'old.json'))).toBe(true);
    } finally {
      f.close();
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
