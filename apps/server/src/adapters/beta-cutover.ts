import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Connection, ProjectRecord } from '@statecarry/contracts';

export const DATABASE_VERSION = 3;
const contentCaches = [
  'analysis',
  'analysis-cache',
  'analysis-feedback',
  'explanation-candidates',
  'analysis-metrics.jsonl',
  'observations.jsonl',
] as const;
const transitionName = '.beta-v3-transition';
const tables = `CREATE TABLE IF NOT EXISTS project_owners(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT REFERENCES project_owners(id),body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS entities_owner ON entities(owner_id,kind);`;

type OldRow = { kind: string; id: string; body: string };
function unresolved(row: OldRow): boolean {
  const body = JSON.parse(row.body) as Record<string, unknown>;
  if (['job', 'explanationJob', 'questionExecution'].includes(row.kind))
    return ['summarizing', 'generating', 'repairing', 'checking', 'result-unknown'].includes(
      String(body.status),
    );
  if (!['handoff', 'continuation'].includes(row.kind)) return false;
  if (body.state === 'sent') {
    const execution = body.execution as { status?: string } | undefined;
    return (
      !body.externalReport &&
      !['completed', 'failed', 'interrupted'].includes(execution?.status ?? '')
    );
  }
  return ['dispatching', 'opening', 'result-unknown'].includes(String(body.state));
}

/** The only reader of pre-cutover data. It imports registration settings, never work content. */
function registrations(rows: OldRow[]): Array<{ project: ProjectRecord; connection: Connection }> {
  const connections = new Map(
    rows.filter((r) => r.kind === 'connection').map((r) => [r.id, JSON.parse(r.body)]),
  );
  return rows
    .filter((r) => r.kind === 'work')
    .map((row) => {
      const old = JSON.parse(row.body);
      const connection = connections.get(old.projectId);
      if (!connection || connection.workId !== row.id || typeof connection.cwd !== 'string')
        throw new Error(
          `Cannot preserve project registration ${row.id}: its connection is missing or inconsistent.`,
        );
      const profile = old.projectProfile;
      const title = profile?.title ?? connection.title ?? old.title;
      const purpose = profile?.purpose?.trim() ?? '';
      const project: ProjectRecord = {
        id: row.id,
        connectionId: connection.id,
        title,
        cwd: connection.cwd,
        purposes: purpose
          ? [
              {
                id: createHash('sha256').update(`project-purpose:${row.id}`).digest('hex'),
                text: purpose,
                origin: 'user',
                confirmed: true,
              },
            ]
          : [],
        focused: profile?.focused ?? false,
        iconAsset: profile?.iconAsset ?? null,
        bannerAsset: profile?.bannerAsset ?? null,
        lifecycle: connection.removedAt ? 'disconnected' : 'active',
        revision: (old.revision ?? 0) + 1,
        createdAt: old.createdAt,
        linkVersion: 1,
        inputVersion: '',
        latestSummaryId: null,
        coordinationMode: old.coordinationMode ?? 'auto',
        coordinationThreadId: old.coordinationThreadId ?? null,
      };
      return {
        project,
        connection: {
          id: connection.id,
          projectId: row.id,
          title,
          cwd: connection.cwd,
          threadIds: connection.threadIds ?? [],
          startTurnIds: connection.startTurnIds ?? {},
          recordRanges: connection.recordRanges ?? {},
          discover: connection.discover ?? false,
          ...(connection.discoveryScope ? { discoveryScope: connection.discoveryScope } : {}),
          revision: (connection.revision ?? 0) + 1,
          createdAt: connection.createdAt,
          removedAt: connection.removedAt ?? null,
        },
      };
    });
}

function recoverCaches(directory: string, committed: boolean) {
  const transition = join(directory, transitionName);
  if (!existsSync(transition)) return;
  if (!committed) {
    for (const name of contentCaches) {
      const saved = join(transition, name);
      if (!existsSync(saved)) continue;
      if (existsSync(join(directory, name)))
        throw new Error(`Cannot recover the Beta transition: ${name} exists in both locations.`);
      renameSync(saved, join(directory, name));
    }
  }
  rmSync(transition, { recursive: true, force: true });
}

export function initializeDatabase(db: DatabaseSync, directory: string) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  if (!exists) {
    db.exec(
      `BEGIN IMMEDIATE; CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(${DATABASE_VERSION}); ${tables} COMMIT;`,
    );
    return;
  }
  const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number })
    .version;
  if (![1, 2, DATABASE_VERSION].includes(version))
    throw new Error(`Unsupported database version ${version}`);
  recoverCaches(directory, version === DATABASE_VERSION);
  if (version === DATABASE_VERSION) return;
  const rows = db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all() as OldRow[];
  const pending = rows.filter(unresolved);
  if (pending.length)
    throw new Error(
      `Finish or resolve these external operations before updating StateCarry: ${pending.map((r) => `${r.kind}:${r.id}`).join(', ')}`,
    );
  const saved = registrations(rows);
  const transition = join(directory, transitionName);
  mkdirSync(transition, { mode: 0o700 });
  try {
    db.prepare('VACUUM INTO ?').run(join(transition, 'statecarry.sqlite'));
    db.exec('BEGIN IMMEDIATE');
    for (const name of contentCaches)
      if (existsSync(join(directory, name)))
        renameSync(join(directory, name), join(transition, name));
    db.exec(
      `DROP TABLE entities; DROP TABLE IF EXISTS work_owners; DROP TABLE IF EXISTS project_owners; ${tables}`,
    );
    const owner = db.prepare('INSERT INTO project_owners(id) VALUES(?)');
    const put = db.prepare('INSERT INTO entities(kind,id,owner_id,body) VALUES(?,?,?,?)');
    for (const { project, connection } of saved) {
      owner.run(project.id);
      put.run('project', project.id, null, JSON.stringify(project));
      put.run('connection', connection.id, project.id, JSON.stringify(connection));
      for (const threadId of connection.threadIds) {
        const id = createHash('sha256')
          .update(JSON.stringify([project.id, threadId]))
          .digest('hex');
        put.run(
          'link',
          id,
          project.id,
          JSON.stringify({
            id,
            projectId: project.id,
            threadId,
            title: threadId,
            status: 'linked',
            revision: 1,
            evidence: [],
            rationale: 'Registered project source',
            role: 'work',
            history: [],
          }),
        );
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Project registration ownership check failed.');
    db.prepare('UPDATE schema_version SET version=?').run(DATABASE_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* The transaction may not have started. */
    }
    recoverCaches(directory, false);
    throw error;
  }
  recoverCaches(directory, true);
}
