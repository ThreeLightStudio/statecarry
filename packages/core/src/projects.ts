import {
  DomainError,
  projectCreateSchema,
  projectProfileSchema,
  projectSourcesSchema,
  projectDeletionSchema,
  type Command,
  type Connection,
  type ProjectProfile,
  type ProjectRegistrations,
  type ProjectWorkspace,
  type ProjectWorkspaceEntry,
  type Receipt,
  type ResumeWork,
  type Work,
  type WorkingTreeAnalysis,
} from '@statecarry/contracts';
import type { StateCarry } from './service';
import { projectDeletionPlan } from './project-deletion';
import { normalizeProjectFolder } from './project-folder';

export class Projects {
  private workingTreeAnalysisCache = new Map<
    string,
    { signature: string; analysis: WorkingTreeAnalysis }
  >();
  private workingTreeAnalysisPending = new Map<
    string,
    { signature: string; promise: Promise<WorkingTreeAnalysis> }
  >();
  constructor(private core: StateCarry) {}

  private hash(action: string, workId: string | null, command: Command) {
    return this.core.ids.hash({
      action,
      workId,
      expectedRevision: command.expectedRevision,
      payload: command.payload,
    });
  }

  private replay(command: Command, hash: string): Receipt | null {
    const previous = this.core.repo.get('receipt', command.requestId);
    if (previous && previous.bodyHash !== hash)
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'This request was used for another action.',
        409,
      );
    return previous;
  }

  private connection(work: Work): Connection {
    const connection = this.core.repo.get('connection', work.projectId);
    if (!connection || connection.workId !== work.id)
      throw new DomainError('NOT_FOUND', 'Project connection not found.', 404);
    return connection;
  }

  private profile(work: Work): ProjectProfile {
    return (
      work.projectProfile ?? { title: this.connection(work).title, purpose: '', focused: false }
    );
  }

  private revision(work: Work, command: Command) {
    if (work.revision !== command.expectedRevision)
      throw new DomainError(
        'REVISION_CONFLICT',
        'This project changed. Review it before saving.',
        409,
      );
  }

  private receipt(command: Command, hash: string, action: string, work: Work, resultId: string) {
    const receipt: Receipt = {
      id: command.requestId,
      command: action,
      bodyHash: hash,
      workId: work.id,
      committedRevision: work.revision,
      resultId,
      createdAt: this.core.clock.now(),
    };
    this.core.repo.put('receipt', receipt);
    return receipt;
  }

  private commit(
    workId: string,
    action: string,
    command: Command,
    change: (work: Work, connection: Connection) => void,
  ): Receipt {
    const hash = this.hash(action, workId, command);
    const result = this.core.repo.transaction(() => {
      const previous = this.replay(command, hash);
      if (previous) return previous;
      const work = this.core.work(workId);
      this.revision(work, command);
      change(work, this.connection(work));
      return this.receipt(command, hash, action, this.core.work(workId), work.projectId);
    });
    this.core.events.changed(workId);
    return result;
  }

  registrations(): ProjectRegistrations {
    return {
      projects: this.core.repo.list('work').map((work) => {
        const connection = this.connection(work);
        const profile = this.profile(work);
        return {
          workId: work.id,
          connectionId: connection.id,
          ...profile,
          cwd: connection.cwd,
          revision: work.revision,
          disconnectedAt: connection.removedAt ?? null,
        };
      }),
    };
  }

  list(): ProjectWorkspace {
    return {
      // Registration order is stable. Only the user's explicit focus is stored;
      // this service does not invent an attention score or a priority ranking.
      projects: this.core.repo.list('work').map((work): ProjectWorkspaceEntry => {
        const connection = this.connection(work);
        const profile = this.profile(work);
        let resume: ResumeWork | null = null;
        let decisions = { acceptedKeys: [] as string[], pausedKeys: [] as string[] };
        if (this.core.isConnectionActive(connection)) {
          try {
            resume = this.core.resumes.view(work.id);
            decisions = this.core.resumes.decisionKeys(work.id, resume.candidates);
          } catch {
            // Preparation/read failures never turn a raw error or model response
            // into the explanation, and never erase manually supplied context.
            resume = {
              workId: work.id,
              title: profile.title,
              cwd: connection.cwd,
              revision: work.revision,
              goalText: work.goal?.origin === 'user-input' ? work.goal.text : null,
              goalOrigin: work.goal?.origin === 'user-input' ? 'user-input' : 'inferred',
              sessionCount: this.core.links(work.id).filter((link) => link.status === 'linked')
                .length,
              state: 'unavailable',
              stateDetail:
                'This project’s saved context could not be checked. Review its connected records and try again.',
              blockedActions: ['Check the connected records before continuing.'],
              version: '',
              candidates: [],
              busy: this.core.resumes.isRunning(work.id),
              error: 'The saved context could not be checked.',
              stale: true,
              updatesAvailable: false,
              generatedAt: null,
              correctedKeys: [],
              dismissedKeys: [],
            };
          }
        }
        return {
          workId: work.id,
          connectionId: connection.id,
          ...profile,
          focused: profile.focused,
          cwd: connection.cwd,
          revision: work.revision,
          disconnectedAt: connection.removedAt ?? null,
          ...decisions,
          collecting: this.core.isCollecting(work.id),
          resume,
        };
      }),
    };
  }

  async workspace(workId: string, outputLanguage: 'en' | 'ko' = 'en') {
    const work = this.core.work(workId);
    const connection = this.connection(work);
    const inspector = this.core.projectInspector;
    if (!inspector)
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'Project workspace inspection is unavailable.',
      );
    const snapshot = inspector.inspect(connection.cwd);
    if (!snapshot.dirty || !this.core.summary.analyzeWorkingTree) return snapshot;
    const cacheKey = `${workId}:${outputLanguage}`;
    const signature = this.core.ids.hash({
      outputLanguage,
      branch: snapshot.branch,
      commit: snapshot.commit,
      changedFiles: snapshot.changedFiles,
      changedFileCount: snapshot.changedFileCount,
      additions: snapshot.additions,
      deletions: snapshot.deletions,
      untrackedCount: snapshot.untrackedCount,
      diffPreview: snapshot.diffPreview,
      fileFingerprint: snapshot.fileFingerprint,
      inventoryFingerprint: snapshot.inventoryFingerprint,
    });
    const cached = this.workingTreeAnalysisCache.get(cacheKey);
    if (cached?.signature === signature)
      return { ...snapshot, workingTreeAnalysis: cached.analysis };
    const pending = this.workingTreeAnalysisPending.get(cacheKey);
    if (pending?.signature === signature)
      return { ...snapshot, workingTreeAnalysis: await pending.promise };
    try {
      const promise = this.core.summary.analyzeWorkingTree({
        projectTitle: this.profile(work).title,
        outputLanguage,
        snapshot,
      });
      this.workingTreeAnalysisPending.set(cacheKey, { signature, promise });
      const workingTreeAnalysis = await promise;
      this.workingTreeAnalysisCache.set(cacheKey, { signature, analysis: workingTreeAnalysis });
      return { ...snapshot, workingTreeAnalysis };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ...snapshot,
        limitations: [
          ...snapshot.limitations,
          `Working-tree semantic analysis unavailable: ${detail.slice(0, 500)}`,
        ].slice(0, 20),
      };
    } finally {
      const current = this.workingTreeAnalysisPending.get(cacheKey);
      if (current?.signature === signature) this.workingTreeAnalysisPending.delete(cacheKey);
    }
  }

  create(command: Command): Receipt {
    const input = projectCreateSchema.parse(command.payload);
    const cwd = normalizeProjectFolder(input.cwd);
    if (cwd === null) throw new DomainError('VALIDATION', 'Use an absolute project folder path.');
    if (
      [...Object.keys(input.startTurnIds), ...Object.keys(input.recordRanges ?? {})].some(
        (id) => !input.threadIds.includes(id),
      )
    )
      throw new DomainError('VALIDATION', 'A record range belongs to an unselected conversation.');
    const hash = this.hash('project-create', null, command);
    const result = this.core.repo.transaction(() => {
      const previous = this.replay(command, hash);
      if (previous) return { receipt: previous, created: false };
      if (command.expectedRevision !== 0)
        throw new DomainError('REVISION_CONFLICT', 'A new project starts at revision zero.', 409);
      // Disconnected registrations still own their folder. A repeated create
      // selects that registration without changing context or granting source access.
      const matches = this.core.repo
        .list('connection')
        .filter((connection) => normalizeProjectFolder(connection.cwd) === cwd);
      if (matches.length > 1)
        throw new DomainError(
          'VALIDATION',
          'Multiple projects are registered for this folder. Clean up the existing registrations before adding this folder again.',
          409,
        );
      const existing = matches[0];
      if (existing) {
        const work = this.core.work(existing.workId);
        if (work.projectId !== existing.id)
          throw new DomainError('NOT_FOUND', 'Project connection not found.', 404);
        return {
          receipt: this.receipt(command, hash, 'project-reuse', work, existing.id),
          created: false,
        };
      }
      const workId = this.core.ids.next();
      const connectionId = this.core.ids.next();
      const now = this.core.clock.now();
      const work: Work = {
        id: workId,
        projectId: connectionId,
        title: input.title,
        projectProfile: { title: input.title, purpose: input.purpose, focused: false },
        ...(input.goal
          ? { goal: { text: input.goal, origin: 'user-input' as const, confirmedAt: now } }
          : {}),
        revision: 1,
        linkVersion: 1,
        inputVersion: '',
        latestSummaryId: null,
        createdAt: now,
      };
      this.core.repo.put('work', work);
      this.core.repo.put('connection', {
        id: connectionId,
        workId,
        title: input.title,
        cwd,
        threadIds: [...new Set(input.threadIds)],
        startTurnIds: input.startTurnIds,
        recordRanges: input.recordRanges,
        discover: input.threadIds.length > 0 && input.discover,
        revision: 1,
        createdAt: now,
      });
      for (const threadId of new Set(input.threadIds))
        this.core.repo.put('link', {
          id: this.core.ids.hash([workId, threadId]),
          workId,
          threadId,
          title: threadId,
          status: 'linked',
          revision: 1,
          evidence: [],
          rationale: 'Explicitly selected when registering this project',
          role: 'work',
          history: [],
        });
      return {
        receipt: this.receipt(command, hash, 'project-create', work, connectionId),
        created: true,
      };
    });
    if (result.created) this.core.events.changed(result.receipt.workId);
    return result.receipt;
  }

  settings(workId: string, command: Command): Receipt {
    const profile = projectProfileSchema.parse(command.payload);
    const result = this.commit(workId, 'project-settings', command, (work, connection) => {
      if (profile.focused && !this.profile(work).focused) {
        const focused = this.core.repo
          .list('work')
          .filter((other) => other.id !== workId && other.projectProfile?.focused);
        if (focused.length >= 3)
          throw new DomainError(
            'VALIDATION',
            'Home focus already contains three projects. Remove one before adding another.',
            409,
          );
      }
      this.core.repo.put('work', {
        ...work,
        title: profile.title,
        projectProfile: profile,
        revision: work.revision + 1,
      });
      this.core.repo.put('connection', { ...connection, title: profile.title });
    });
    this.core.events.changed(workId);
    return result;
  }

  sources(workId: string, command: Command): Receipt {
    const input = projectSourcesSchema.parse(command.payload);
    const hash = this.hash('project-sources', workId, command);
    const previous = this.replay(command, hash);
    if (previous) return previous;
    const work = this.core.work(workId);
    const connection = this.connection(work);
    const result = this.core.updateConnectionScope(
      connection.id,
      command,
      {
        ...input,
        title: this.profile(work).title,
        cwd: connection.cwd,
        discover: input.threadIds.length > 0 && input.discover,
        recordRanges:
          input.recordRanges ??
          Object.fromEntries(
            Object.entries({
              ...connection.discoveryScope?.recordRanges,
              ...connection.recordRanges,
            }).filter(([id]) => input.threadIds.includes(id)),
          ),
      },
      workId,
    );
    this.core.questions.forgetWork(workId);
    return result;
  }

  disconnect(workId: string, command: Command): Receipt {
    this.emptyPayload(command);
    const result = this.commit(workId, 'project-disconnect', command, (work, connection) => {
      if (connection.removedAt)
        throw new DomainError('VALIDATION', 'This project is already disconnected.');
      this.core.repo.put('connection', {
        ...connection,
        removedAt: this.core.clock.now(),
        revision: connection.revision + 1,
      });
      this.core.repo.put('work', {
        ...work,
        projectProfile: { ...this.profile(work) },
        revision: work.revision + 1,
      });
    });
    this.core.questions.forgetWork(workId);
    return result;
  }

  restore(workId: string, command: Command): Receipt {
    this.emptyPayload(command);
    return this.commit(workId, 'project-restore', command, (work, connection) => {
      if (!connection.removedAt)
        throw new DomainError('VALIDATION', 'This project is already connected.');
      this.core.repo.put('connection', {
        ...connection,
        removedAt: null,
        revision: connection.revision + 1,
      });
      this.core.repo.put('work', {
        ...work,
        projectProfile: { ...this.profile(work) },
        revision: work.revision + 1,
      });
    });
  }

  private emptyPayload(command: Command): void {
    if (Object.keys(command.payload).length)
      throw new DomainError('VALIDATION', 'This action does not accept additional settings.');
  }

  deletionPreview(workId: string) {
    return projectDeletionPlan(this.core, workId).preview;
  }

  delete(workId: string, command: Command): Receipt {
    const input = projectDeletionSchema.parse(command.payload);
    const hash = this.hash('project-delete', workId, command);
    const result = this.core.repo.transaction(() => {
      const previous = this.replay(command, hash);
      if (previous) return previous;
      const work = this.core.work(workId);
      this.revision(work, command);
      const plan = projectDeletionPlan(this.core, workId);
      if (plan.preview.blocked)
        throw new DomainError('PROJECT_BUSY', plan.preview.explanation, 409);
      if (input.token !== plan.preview.token)
        throw new DomainError(
          'PROJECT_DELETION_CHANGED',
          'The saved data or shared sources changed. Review the deletion details again.',
          409,
        );
      for (const { kind, entity } of plan.rows)
        if (kind !== 'work') this.core.repo.remove(kind, entity.id);
      for (const source of plan.exclusive) this.core.repo.remove('source', source.id);
      this.core.repo.remove('work', workId);
      return this.receipt(
        command,
        hash,
        'project-delete',
        { ...work, revision: work.revision + 1 },
        workId,
      );
    });
    this.core.questions.forgetWork(workId);
    this.core.resumes.forget(workId);
    this.core.events.changed(workId);
    return result;
  }
}
