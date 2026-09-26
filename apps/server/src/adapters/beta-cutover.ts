import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DATABASE_VERSION = 4;

// These paths are owned by StateCarry and contain only project data or copies.
const resetPaths = [
  'analysis',
  'analysis-cache',
  'analysis-feedback',
  'explanation-candidates',
  'analysis-metrics.jsonl',
  'observations.jsonl',
  'assets/projects',
  'browser-state.json',
] as const;
const transitionName = '.beta-v4-transition';
const previousTransitionName = '.beta-v3-transition';
const previousTransitionCaches = [
  'analysis',
  'analysis-cache',
  'analysis-feedback',
  'explanation-candidates',
  'analysis-metrics.jsonl',
  'observations.jsonl',
] as const;
const globalBrowserKeys = new Set(['statecarry.appearance.theme.v1']);

type OldRow = { kind: string; id: string; body: string };

function unresolved(row: OldRow): boolean {
  const body = JSON.parse(row.body) as Record<string, unknown>;
  // queued/waiting are durable internal work queues; the corresponding remote
  // request has not started. Keep only states that may already have dispatched.
  if (['job', 'explanationJob', 'questionExecution'].includes(row.kind))
    return ['summarizing', 'generating', 'repairing', 'checking', 'result-unknown'].includes(
      String(body.status),
    );
  if (!['handoff', 'continuation'].includes(row.kind)) return false;
  if (body.state === 'sent') {
    const execution = body.execution as { status?: string } | undefined;
    return !['completed', 'failed', 'interrupted'].includes(execution?.status ?? '');
  }
  return ['dispatching', 'opening', 'result-unknown'].includes(String(body.state));
}

function filteredBrowserState(directory: string): string | undefined {
  const path = join(directory, 'browser-state.json');
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || !('entries' in value))
    throw new Error('Cannot reset Beta project data: browser state is invalid.');
  const entries = (value as { entries: unknown }).entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries))
    throw new Error('Cannot reset Beta project data: browser state is invalid.');
  const retained = Object.fromEntries(
    Object.entries(entries).filter(([key]) => globalBrowserKeys.has(key)),
  );
  return JSON.stringify({ entries: retained });
}

/** Restore pre-commit content or finish post-commit cleanup after an interrupted reset. */
function recoverTransition(directory: string, committed: boolean): void {
  const transition = join(directory, transitionName);
  if (!existsSync(transition)) return;

  if (committed) {
    const nextBrowserState = join(transition, 'browser-state.next');
    if (existsSync(nextBrowserState))
      renameSync(nextBrowserState, join(directory, 'browser-state.json'));
    rmSync(transition, { recursive: true, force: true });
    return;
  }

  for (const name of resetPaths) {
    const saved = join(transition, name);
    if (!existsSync(saved)) continue;
    const destination = join(directory, name);
    if (existsSync(destination))
      throw new Error(`Cannot recover Beta reset: ${name} exists in both locations.`);
    mkdirSync(join(destination, '..'), { recursive: true });
    renameSync(saved, destination);
  }
  rmSync(transition, { recursive: true, force: true });
}

/** Recover the prior v3 cache quarantine before applying the v4 reset. */
function recoverPreviousTransition(directory: string, committed: boolean): void {
  const transition = join(directory, previousTransitionName);
  if (!existsSync(transition)) return;
  if (committed) {
    rmSync(transition, { recursive: true, force: true });
    return;
  }

  for (const name of previousTransitionCaches) {
    const saved = join(transition, name);
    if (!existsSync(saved)) continue;
    const destination = join(directory, name);
    if (existsSync(destination))
      throw new Error(
        `Cannot recover the previous Beta transition: ${name} exists in both locations.`,
      );
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    renameSync(saved, destination);
  }
  rmSync(transition, { recursive: true, force: true });
}

export function initializeDatabase(db: DatabaseSync, directory: string): void {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const hasVersion = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!hasVersion) {
    db.exec(
      `BEGIN IMMEDIATE;
      CREATE TABLE schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES(${DATABASE_VERSION});
      CREATE TABLE IF NOT EXISTS project_owners(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT REFERENCES project_owners(id),body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS entities_owner ON entities(owner_id,kind);
      COMMIT;`,
    );
    return;
  }

  const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number })
    .version;
  if (![1, 2, 3, DATABASE_VERSION].includes(version))
    throw new Error(`Unsupported database version ${version}`);

  recoverTransition(directory, version === DATABASE_VERSION);
  recoverPreviousTransition(directory, version >= 3);
  if (version === DATABASE_VERSION) return;

  const rows = db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all() as OldRow[];
  const pending = rows.filter(unresolved);
  if (pending.length)
    throw new Error(
      `Finish or resolve StateCarry: ${pending.map((r) => `${r.kind}:${r.id}`).join(', ')}`,
    );

  const nextBrowserState = filteredBrowserState(directory);
  const transition = join(directory, transitionName);
  mkdirSync(transition, { recursive: true, mode: 0o700 });
  try {
    for (const name of resetPaths) {
      const source = join(directory, name);
      if (existsSync(source)) {
        const saved = join(transition, name);
        mkdirSync(dirname(saved), { recursive: true, mode: 0o700 });
        renameSync(source, saved);
      }
    }
    if (nextBrowserState !== undefined)
      writeFileSync(join(transition, 'browser-state.next'), nextBrowserState, { mode: 0o600 });

    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE entities_beta_reset(
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_id TEXT,
        body TEXT NOT NULL CHECK(json_valid(body)),
        PRIMARY KEY(kind,id)
      );
      INSERT INTO entities_beta_reset(kind,id,owner_id,body)
        SELECT kind,id,NULL,body FROM entities WHERE kind='agentSettings';
      DROP TABLE entities;
      DROP TABLE IF EXISTS work_owners;
      DROP TABLE IF EXISTS project_owners;
      CREATE TABLE IF NOT EXISTS project_owners(id TEXT PRIMARY KEY);
      CREATE TABLE entities(
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        owner_id TEXT REFERENCES project_owners(id),
        body TEXT NOT NULL CHECK(json_valid(body)),
        PRIMARY KEY(kind,id)
      );
      INSERT INTO entities(kind,id,owner_id,body)
        SELECT kind,id,owner_id,body FROM entities_beta_reset;
      DROP TABLE entities_beta_reset;
      CREATE INDEX IF NOT EXISTS entities_owner ON entities(owner_id,kind);
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Project reset ownership check failed.');
    db.prepare('UPDATE schema_version SET version=?').run(DATABASE_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* The transaction may not have started or may already have rolled back. */
    }
    recoverTransition(directory, false);
    throw error;
  }

  recoverTransition(directory, true);
}
