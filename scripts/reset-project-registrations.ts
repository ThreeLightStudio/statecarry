import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { Connection, Work } from '@statecarry/contracts';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';

// Only application-owned, content-bearing caches are retired. Original project
// folders, provider conversations, login and capability settings are not reset.
const retiredFiles = [
  'analysis',
  'analysis-cache',
  'analysis-feedback',
  'explanation-candidates',
  'analysis-metrics.jsonl',
  'observations.jsonl',
];

type Registration = { workId: string; connectionId: string; cwd: string };
type ResetProject = { cwd: string; title: string; previousWorkIds: string[] };
export type ProjectResetPlan = {
  token: string;
  registrations: number;
  projects: ResetProject[];
  counts: { kind: string; count: number }[];
  unresolved: { kind: string; count: number }[];
  retireFiles: string[];
};

function currentPlan(db: DatabaseSync, directory: string, name?: string): ProjectResetPlan {
  const version = db.prepare('SELECT version FROM schema_version').get();
  if (version?.version !== 1) throw new Error('Unsupported StateCarry database schema.');
  const registrations = db
    .prepare(
      `SELECT w.id AS workId, c.id AS connectionId, json_extract(c.body, '$.cwd') AS cwd
       FROM entities w JOIN entities c
       ON c.kind='connection' AND c.id=json_extract(w.body, '$.projectId')
       AND json_extract(c.body, '$.workId')=w.id WHERE w.kind='work' ORDER BY w.id`,
    )
    .all() as Registration[];
  const workCount = db.prepare("SELECT COUNT(*) AS count FROM entities WHERE kind='work'").get();
  if (workCount?.count !== registrations.length)
    throw new Error('Some saved registrations have missing or mismatched connections.');
  const groups = new Map<string, ResetProject>();
  for (const row of registrations) {
    if (typeof row.cwd !== 'string' || !row.cwd.startsWith('/'))
      throw new Error('A registration has no absolute project folder.');
    // Resolve only folders already registered by the owner. No project scan,
    // conversation discovery or source-range widening is performed here.
    const cwd = realpathSync(row.cwd);
    if (!statSync(cwd).isDirectory()) throw new Error('A registered project is not a folder.');
    const group = groups.get(cwd) ?? {
      cwd,
      title: basename(cwd) || 'Project',
      previousWorkIds: [],
    };
    group.previousWorkIds.push(row.workId);
    groups.set(cwd, group);
  }
  const projects = [...groups.values()].sort((a, b) => a.cwd.localeCompare(b.cwd));
  if (name !== undefined) {
    if (projects.length !== 1 || !name.trim() || name.trim().length > 120)
      throw new Error('A name override requires exactly one project and 1–120 characters.');
    projects[0].title = name.trim();
  }
  // A stopped writer is required by apply. Queued, unstarted analysis is obsolete
  // under this explicit reset; executions that may have been sent need resolution.
  const unresolved = db
    .prepare(
      `SELECT kind, COUNT(*) AS count FROM entities
       WHERE (kind='job' AND json_extract(body,'$.status') IN ('summarizing','checking','result-unknown'))
       OR (kind='explanationJob' AND json_extract(body,'$.status') IN ('generating','repairing','checking','result-unknown'))
       OR (kind='questionExecution' AND json_extract(body,'$.status') IN ('generating','repairing','checking','result-unknown'))
       OR (kind IN ('handoff','continuation') AND json_extract(body,'$.state') IN ('dispatching','opening','result-unknown'))
       OR (kind='continuation' AND json_extract(body,'$.state')='sent')
       GROUP BY kind ORDER BY kind`,
    )
    .all() as ProjectResetPlan['unresolved'];
  const counts = db
    .prepare('SELECT kind, COUNT(*) AS count FROM entities GROUP BY kind ORDER BY kind')
    .all() as ProjectResetPlan['counts'];
  const retireFiles = retiredFiles.filter((file) => existsSync(join(directory, file)));
  const hash = createHash('sha256');
  for (const row of db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').iterate())
    hash.update(JSON.stringify(row));
  hash.update(JSON.stringify({ policy: 'fresh-projects-v1', projects, retireFiles }));
  return {
    token: hash.digest('hex'),
    registrations: registrations.length,
    projects,
    counts,
    unresolved,
    retireFiles,
  };
}

/** Preview is read-only, including when the normal application writer is live. */
export function previewProjectReset(directory: string, name?: string): ProjectResetPlan {
  const db = new DatabaseSync(join(directory, 'statecarry.sqlite'), { readOnly: true });
  try {
    return currentPlan(db, directory, name);
  } finally {
    db.close();
  }
}

/** Explicit offline administration: no source reader, model or background jobs. */
export function resetProjectRegistrations(directory: string, token: string, name?: string) {
  if (!existsSync(join(directory, 'statecarry.sqlite')))
    throw new Error('No existing StateCarry database was found.');
  const repo = new SQLiteRepository(directory);
  const moved: string[] = [];
  let backupDirectory: string | null = null;
  try {
    const plan = currentPlan(repo.db, directory, name);
    if (token !== plan.token) throw new Error('Saved data changed. Read a new reset preview.');
    if (plan.unresolved.length)
      throw new Error('Resolve unfinished executions before resetting saved records.');
    if (!plan.projects.length) throw new Error('No registered projects need resetting.');
    const backupRoot = join(directory, 'backups');
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    backupDirectory = mkdtempSync(join(backupRoot, 'before-project-reset-'));
    const databaseBackup = join(backupDirectory, 'statecarry.sqlite');
    repo.db.prepare('VACUUM INTO ?').run(databaseBackup);
    chmodSync(databaseBackup, 0o600);
    const at = new Date().toISOString();
    const replacements = plan.projects.map((project) => ({
      ...project,
      workId: randomUUID(),
      connectionId: randomUUID(),
    }));
    // Metadata-only record also supplies the retired IDs for troubleshooting.
    writeFileSync(
      join(backupDirectory, 'reset-plan.json'),
      JSON.stringify({ at, ...plan, replacements }, null, 2),
      { mode: 0o600 },
    );
    for (const file of plan.retireFiles) {
      renameSync(join(directory, file), join(backupDirectory, file));
      moved.push(file);
    }
    repo.transaction(() => {
      // Receipts stop late retries of old create/send requests from recreating
      // retired content. They contain IDs and hashes, never conversation bodies.
      repo.db.exec(
        "UPDATE entities SET owner_id=NULL WHERE kind='receipt'; DELETE FROM entities WHERE kind!='receipt'; DELETE FROM work_owners;",
      );
      for (const project of replacements) {
        const work: Work = {
          id: project.workId,
          projectId: project.connectionId,
          title: project.title,
          projectProfile: { title: project.title, purpose: '', focused: false },
          revision: 1,
          linkVersion: 1,
          inputVersion: '',
          latestSummaryId: null,
          createdAt: at,
        };
        const connection: Connection = {
          id: project.connectionId,
          workId: project.workId,
          title: project.title,
          cwd: project.cwd,
          threadIds: [],
          startTurnIds: {},
          recordRanges: {},
          discover: false,
          revision: 1,
          createdAt: at,
        };
        repo.put('work', work);
        repo.put('connection', connection);
      }
      if (repo.db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Project reset failed the ownership check.');
    });
    moved.length = 0;
    return {
      previousRegistrations: plan.registrations,
      projects: replacements,
      backupDirectory,
      recommendations: 0,
      linkedConversations: 0,
    };
  } catch (error) {
    // A database rollback also restores the cache locations. The private backup
    // is retained for diagnosis; no original folder is ever a mutation target.
    for (const file of moved.reverse())
      renameSync(join(backupDirectory!, file), join(directory, file));
    throw error;
  } finally {
    repo.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      'data-dir': { type: 'string' },
      apply: { type: 'boolean', default: false },
      token: { type: 'string' },
      name: { type: 'string' },
    },
  });
  if (!values['data-dir']) throw new Error('Provide the existing --data-dir explicitly.');
  const directory = realpathSync(resolve(values['data-dir']));
  const result = values.apply
    ? resetProjectRegistrations(directory, values.token ?? '', values.name)
    : previewProjectReset(directory, values.name);
  console.log(JSON.stringify(result, null, 2));
}
