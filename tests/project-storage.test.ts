import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Entities } from '@statecarry/core';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { harness, source } from './helpers';
import { deletionCommand, registerProject } from './project-fixtures';

describe('project workspace production SQLite persistence', () => {
  it('preserves manual context and focus across restart and deletes owned rows without changing originals', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-project-storage-'));
    const data = join(directory, 'app-data');
    const originals = join(directory, 'original-project');
    mkdirSync(originals);
    const originalPath = join(originals, 'conversation-fixture.jsonl');
    const originalText = '{"text":"Original fixture stays unchanged"}\n';
    writeFileSync(originalPath, originalText);
    let repo = new SQLiteRepository(data);
    try {
      const h = harness(repo);
      const a = registerProject(h, {
        cwd: originals,
        threadIds: ['thread-a'],
        goal: 'Check the saved export.',
      });
      const b = registerProject(h, {
        title: 'Second project',
        cwd: join(directory, 'second-project'),
        threadIds: ['thread-a'],
      });
      h.core.projects.settings(
        a.receipt.workId,
        h.command(a.receipt.workId, {
          title: 'Named project',
          purpose: 'Carry useful export context.',
          focused: true,
        }),
      );
      await h.core.collect(a.receipt.workId);
      await h.core.collect(b.receipt.workId);
      h.core.describeGoal(
        a.receipt.workId,
        h.command(a.receipt.workId, { text: 'A new current goal.' }),
      );
      const before = h.core.projects.list();
      repo.close();
      repo = new SQLiteRepository(data);
      const restarted = harness(repo);
      expect(restarted.core.projects.list()).toEqual(before);
      const reused = registerProject(restarted, { cwd: `${originals}/./`, title: 'New title' });
      expect(reused.receipt).toMatchObject({
        command: 'project-reuse',
        workId: a.receipt.workId,
        resultId: a.receipt.resultId,
      });
      expect(restarted.core.projects.list()).toEqual(before);
      expect(before.projects[0]).toMatchObject({
        title: 'Named project',
        purpose: 'Carry useful export context.',
        focused: true,
        resume: { goalText: 'A new current goal.' },
      });
      const command = deletionCommand(restarted, a.receipt.workId);
      expect(restarted.core.projects.deletionPreview(a.receipt.workId)).toMatchObject({
        exclusiveSources: 0,
        sharedSources: 1,
        blocked: false,
      });
      const result = restarted.core.projects.delete(a.receipt.workId, command);
      expect(repo.get('source', source().id)).toEqual(source());
      expect(
        repo.db.prepare('SELECT id FROM work_owners WHERE id=?').get(a.receipt.workId),
      ).toBeUndefined();
      expect(
        repo.db.prepare('SELECT id FROM entities WHERE owner_id=?').all(a.receipt.workId),
      ).toEqual([]);
      expect(readFileSync(originalPath, 'utf8')).toBe(originalText);
      repo.close();
      repo = new SQLiteRepository(data);
      const again = harness(repo);
      expect(again.core.projects.delete(a.receipt.workId, command)).toEqual(result);
      expect(again.core.projects.create(a.command)).toEqual(a.receipt);
      expect(again.core.projects.list().projects.map((project) => project.workId)).toEqual([
        b.receipt.workId,
      ]);
      const finalDelete = deletionCommand(again, b.receipt.workId);
      expect(again.core.projects.deletionPreview(b.receipt.workId).exclusiveSources).toBe(1);
      again.core.projects.delete(b.receipt.workId, finalDelete);
      expect(repo.list('work')).toEqual([]);
      expect(repo.list('source')).toEqual([]);
      expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(readFileSync(originalPath, 'utf8')).toBe(originalText);
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back content and receipt ownership when the final deletion receipt cannot be saved', async () => {
    class FailingReceiptRepository extends SQLiteRepository {
      override put<K extends keyof Entities>(kind: K, entity: Entities[K]): void {
        if (kind === 'receipt' && 'command' in entity && entity.command === 'project-delete')
          throw new Error('injected final receipt failure');
        super.put(kind, entity);
      }
    }
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-project-rollback-'));
    const repo = new FailingReceiptRepository(directory);
    try {
      const h = harness(repo);
      const { receipt } = registerProject(h, { threadIds: ['thread-a'] });
      await h.core.collect(receipt.workId);
      const before = repo.db.prepare('SELECT * FROM entities ORDER BY kind,id').all();
      const command = deletionCommand(h, receipt.workId);
      expect(() => h.core.projects.delete(receipt.workId, command)).toThrow(
        'injected final receipt failure',
      );
      expect(repo.db.prepare('SELECT * FROM entities ORDER BY kind,id').all()).toEqual(before);
      expect(
        repo.db.prepare('SELECT id FROM work_owners WHERE id=?').get(receipt.workId),
      ).toBeDefined();
      expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(repo.get('source', source().id)).not.toBeNull();
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
