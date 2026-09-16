import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  openSync,
  writeFileSync,
  readFileSync,
  closeSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Entities, StateRepository } from '@statecarry/core';
import { DomainError } from '@statecarry/contracts';

export class SQLiteRepository implements StateRepository {
  readonly db: DatabaseSync;
  private lockPath: string;
  private token = randomUUID();
  private inTransaction = false;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lockPath = join(directory, 'writer.lock');
    try {
      const fd = openSync(this.lockPath, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token }));
      closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner: { pid: number; token: string };
      try {
        owner = JSON.parse(readFileSync(this.lockPath, 'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error();
      } catch {
        throw new Error('Writer lock owner is unknown; refusing to remove it');
      }
      let dead = false;
      try {
        process.kill(owner.pid, 0);
      } catch (e) {
        dead = (e as NodeJS.ErrnoException).code === 'ESRCH';
      }
      if (!dead)
        throw new Error(
          'Another writer may be alive; refusing a second server for this data directory',
        );
      unlinkSync(this.lockPath);
      const fd = openSync(this.lockPath, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token }));
      closeSync(fd);
    }
    try {
      const file = join(directory, 'statecarry.sqlite');
      this.db = new DatabaseSync(file);
      chmodSync(file, 0o600);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
        INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
        CREATE TABLE IF NOT EXISTS work_owners(id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT REFERENCES work_owners(id), body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(kind,id));
        CREATE INDEX IF NOT EXISTS entities_owner ON entities(owner_id,kind);`);
      const schema = this.db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      if (schema.version !== 1) throw new Error(`Unsupported database version ${schema.version}`);
      const integrity = this.db.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
      if (Object.values(integrity)[0] !== 'ok') throw new Error('Database integrity check failed');
    } catch (e) {
      this.releaseLock();
      throw e;
    }
  }
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] | null {
    const row = this.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id) as
      | { body: string }
      | undefined;
    return row ? JSON.parse(row.body) : null;
  }
  list<K extends keyof Entities>(kind: K): Entities[K][] {
    return (
      this.db.prepare('SELECT body FROM entities WHERE kind=? ORDER BY rowid').all(kind) as {
        body: string;
      }[]
    ).map((r) => JSON.parse(r.body));
  }
  put<K extends keyof Entities>(kind: K, entity: Entities[K]): void {
    if (kind === 'source' || kind === 'summary' || kind === 'explanation') {
      const prior = this.get(kind, entity.id);
      if (prior) {
        if (
          kind === 'source' &&
          'contentHash' in prior &&
          'contentHash' in entity &&
          prior.contentHash === entity.contentHash &&
          prior.key === entity.key &&
          prior.threadId === entity.threadId &&
          prior.turnId === entity.turnId &&
          prior.itemId === entity.itemId &&
          prior.text === entity.text &&
          prior.actor === entity.actor &&
          prior.turnStatus === entity.turnStatus
        )
          return;
        if (JSON.stringify(prior) === JSON.stringify(entity)) return;
        throw new DomainError('STORAGE_UNAVAILABLE', 'Immutable revision cannot be replaced', 500);
      }
    }
    if (kind === 'work')
      this.db.prepare('INSERT OR IGNORE INTO work_owners(id) VALUES(?)').run(entity.id);
    const owner =
      [
        'explanation',
        'explanationJob',
        'questionExecution',
        'summary',
        'overlay',
        'draft',
        'visit',
        'job',
        'link',
        'checkpoint',
        'handoff',
        'continuation',
        'receipt',
      ].includes(kind) &&
      'workId' in entity &&
      // A deletion receipt is an idempotency record, not a live project owner.
      !(kind === 'receipt' && 'command' in entity && entity.command === 'project-delete')
        ? entity.workId
        : null;
    this.db
      .prepare(
        'INSERT INTO entities(kind,id,owner_id,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET owner_id=excluded.owner_id,body=excluded.body',
      )
      .run(kind, entity.id, owner, JSON.stringify(entity));
  }
  remove<K extends keyof Entities>(kind: K, id: string): void {
    this.transaction(() => {
      if (kind === 'work') {
        // Keep only the existing request ledger so old requests cannot recreate
        // the deleted registration. All content rows must already be removed.
        this.db
          .prepare("UPDATE entities SET owner_id=NULL WHERE kind='receipt' AND owner_id=?")
          .run(id);
      }
      this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id);
      if (kind === 'work') this.db.prepare('DELETE FROM work_owners WHERE id=?').run(id);
    });
  }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
  private releaseLock() {
    try {
      if (JSON.parse(readFileSync(this.lockPath, 'utf8')).token === this.token)
        unlinkSync(this.lockPath);
    } catch {}
  }
  close() {
    this.db.close();
    this.releaseLock();
  }
}
