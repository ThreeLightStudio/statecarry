import {
  DomainError,
  projectCreateSchema,
  projectProfileSchema,
  projectSourcesSchema,
  projectDeletionSchema,
  workspaceSnapshotSchema,
  type Command,
  type Connection,
  type ProjectObservation,
  type ProjectProfile,
  type ProjectRegistrations,
  type ProjectWorkspace,
  type ProjectWorkspaceEntry,
  type Receipt,
  type ResumeWork,
  type Work,
  type WorkingTreeAnalysis,
  type WorkingTreeAnalysisRecord,
  type WorkspaceInspectionHints,
  type WorkspaceProbe,
  type WorkspaceSnapshot,
} from '@statecarry/contracts';
import type { StateCarry } from './service';
import { projectDeletionPlan } from './project-deletion';
import { normalizeProjectFolder } from './project-folder';

export class Projects {
  private workingTreeAnalysisPending = new Map<string, { promise: Promise<WorkingTreeAnalysis> }>();
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
    const profile = work.projectProfile;
    return {
      title: profile?.title ?? this.connection(work).title,
      purpose: profile?.purpose ?? '',
      focused: profile?.focused ?? false,
      iconAsset: profile?.iconAsset ?? null,
      bannerAsset: profile?.bannerAsset ?? null,
    };
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
    topic?: 'profile' | 'sources' | 'observation' | 'working-tree-analysis' | 'overview',
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
    this.core.events.changed(workId, topic);
    return result;
  }

  private probeKey(probe: WorkspaceProbe): string {
    return this.core.ids.hash({
      cwd: probe.cwd,
      root: probe.root,
      branch: probe.branch,
      commit: probe.commit,
      statusFingerprint: probe.statusFingerprint,
      status: probe.status,
    });
  }

  private inspectionKey(snapshot: WorkspaceSnapshot): string {
    return this.core.ids.hash({
      cwd: snapshot.cwd,
      root: snapshot.root ?? null,
      branch: snapshot.branch,
      commit: snapshot.commit,
      dirty: snapshot.dirty,
      changedFiles: snapshot.changedFiles ?? [],
      changedFileCount: snapshot.changedFileCount ?? 0,
      additions: snapshot.additions ?? 0,
      deletions: snapshot.deletions ?? 0,
      untrackedCount: snapshot.untrackedCount ?? 0,
      diffPreview: snapshot.diffPreview ?? '',
      recentCommits: snapshot.recentCommits ?? [],
      fileFingerprint: snapshot.fileFingerprint ?? snapshot.fingerprint ?? null,
      inventoryFingerprint: snapshot.inventoryFingerprint ?? null,
      files: (snapshot.files ?? snapshot.fileObservations ?? []).map((file) => ({
        path: file.path,
        hash: file.hash,
        size: file.size ?? null,
      })),
      status: snapshot.status,
      limitations: snapshot.limitations,
    });
  }

  private semanticEvidenceKey(snapshot: WorkspaceSnapshot): string {
    return this.core.ids.hash({
      branch: snapshot.branch,
      commit: snapshot.commit,
      changedFiles: snapshot.changedFiles ?? [],
      changedFileCount: snapshot.changedFileCount ?? 0,
      additions: snapshot.additions ?? 0,
      deletions: snapshot.deletions ?? 0,
      untrackedCount: snapshot.untrackedCount ?? 0,
      diffPreview: snapshot.diffPreview ?? '',
      fileFingerprint: snapshot.fileFingerprint ?? snapshot.fingerprint ?? null,
      files: (snapshot.files ?? snapshot.fileObservations ?? []).map((file) => ({
        path: file.path,
        hash: file.hash,
      })),
    });
  }

  private semanticKey(
    work: Work,
    observation: ProjectObservation,
    outputLanguage: 'en' | 'ko',
  ): string {
    return this.core.ids.hash({
      evidence: observation.semanticKey,
      outputLanguage,
      projectTitle: this.profile(work).title,
      analysis: this.core.summary.configuration(),
    });
  }

  private analysisRecordId(workId: string, semanticKey: string): string {
    return this.core.ids.hash(['working-tree-analysis', workId, semanticKey]);
  }

  private withoutAnalysis(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    const { workingTreeAnalysis: _analysis, ...raw } = snapshot;
    return raw;
  }

  private unknownSnapshot(cwd: string): WorkspaceSnapshot {
    return {
      cwd,
      root: null,
      branch: null,
      commit: null,
      dirty: null,
      status: 'unknown',
      checkedAt: this.core.clock.now(),
      limitations: ['Project state has not been observed yet.'],
    };
  }

  latestObservation(workId: string): ProjectObservation | null {
    const stored = this.core.repo.get('projectObservation', workId);
    if (stored) return stored;
    const legacy = this.core.repo.get('work', workId)?.resume?.workspaceAfter;
    const parsed = workspaceSnapshotSchema.safeParse(legacy);
    if (!parsed.success) return null;
    const snapshot = this.withoutAnalysis(parsed.data);
    return {
      id: workId,
      workId,
      checkedAt: snapshot.checkedAt,
      probeKey: this.core.ids.hash(['legacy-project-observation', workId, snapshot.checkedAt]),
      inspectionKey: this.inspectionKey(snapshot),
      semanticKey: this.semanticEvidenceKey(snapshot),
      snapshot,
    };
  }

  latestSnapshot(workId: string, outputLanguage: 'en' | 'ko' = 'en'): WorkspaceSnapshot {
    const work = this.core.work(workId);
    const connection = this.connection(work);
    const observation = this.latestObservation(workId);
    if (!observation) return this.unknownSnapshot(connection.cwd);
    const snapshot = this.withoutAnalysis(observation.snapshot);
    if (!snapshot.dirty) return snapshot;
    const semanticKey = this.semanticKey(work, observation, outputLanguage);
    const record = this.core.repo.get(
      'workingTreeAnalysis',
      this.analysisRecordId(workId, semanticKey),
    );
    return record ? { ...snapshot, workingTreeAnalysis: record.result } : snapshot;
  }

  private async analyzeObservation(
    work: Work,
    observation: ProjectObservation,
    outputLanguage: 'en' | 'ko',
  ): Promise<WorkspaceSnapshot> {
    const snapshot = this.withoutAnalysis(observation.snapshot);
    if (!snapshot.dirty || !this.core.summary.analyzeWorkingTree) return snapshot;
    const semanticKey = this.semanticKey(work, observation, outputLanguage);
    const recordId = this.analysisRecordId(work.id, semanticKey);
    const stored = this.core.repo.get('workingTreeAnalysis', recordId);
    if (stored) return { ...snapshot, workingTreeAnalysis: stored.result };
    const pending = this.workingTreeAnalysisPending.get(recordId);
    if (pending) return { ...snapshot, workingTreeAnalysis: await pending.promise };
    try {
      const promise = this.core.summary.analyzeWorkingTree({
        projectTitle: this.profile(work).title,
        outputLanguage,
        snapshot,
      });
      this.workingTreeAnalysisPending.set(recordId, { promise });
      const result = await promise;
      const record: WorkingTreeAnalysisRecord = {
        id: recordId,
        workId: work.id,
        semanticKey,
        outputLanguage,
        result,
        generatedAt: this.core.clock.now(),
      };
      this.core.repo.put('workingTreeAnalysis', record);
      this.core.events.changed(work.id, 'working-tree-analysis');
      return { ...snapshot, workingTreeAnalysis: result };
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
      this.workingTreeAnalysisPending.delete(recordId);
    }
  }

  async analyzeLatest(
    workId: string,
    outputLanguage: 'en' | 'ko' = 'en',
  ): Promise<WorkspaceSnapshot> {
    const work = this.core.work(workId);
    const observation = this.latestObservation(workId);
    if (!observation) return this.latestSnapshot(workId, outputLanguage);
    return this.analyzeObservation(work, observation, outputLanguage);
  }

  async observe(
    workId: string,
    outputLanguage: 'en' | 'ko' = 'en',
    hints?: WorkspaceInspectionHints,
    analyze = true,
  ): Promise<WorkspaceSnapshot> {
    const work = this.core.work(workId);
    const connection = this.connection(work);
    const inspector = this.core.projectInspector;
    if (!inspector)
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'Project workspace inspection is unavailable.',
      );
    const previous = this.latestObservation(workId);
    let probeKey: string;
    let snapshot: WorkspaceSnapshot;
    if (inspector.probeAsync || inspector.probe) {
      const probe = inspector.probeAsync
        ? await inspector.probeAsync(connection.cwd)
        : inspector.probe!(connection.cwd);
      probeKey = this.probeKey(probe);
      if (previous?.probeKey === probeKey)
        return analyze
          ? this.analyzeObservation(work, previous, outputLanguage)
          : this.withoutAnalysis(previous.snapshot);
      snapshot = workspaceSnapshotSchema.parse(
        inspector.inspectAsync
          ? await inspector.inspectAsync(
              connection.cwd,
              hints ?? previous?.snapshot.inspection?.hints,
            )
          : inspector.inspect(connection.cwd, hints ?? previous?.snapshot.inspection?.hints),
      );
    } else {
      snapshot = workspaceSnapshotSchema.parse(
        inspector.inspectAsync
          ? await inspector.inspectAsync(connection.cwd, hints)
          : inspector.inspect(connection.cwd, hints),
      );
      probeKey = this.inspectionKey(snapshot);
      if (previous?.probeKey === probeKey)
        return analyze
          ? this.analyzeObservation(work, previous, outputLanguage)
          : this.withoutAnalysis(previous.snapshot);
    }
    snapshot = this.withoutAnalysis(snapshot);
    const observation: ProjectObservation = {
      id: workId,
      workId,
      checkedAt: snapshot.checkedAt,
      probeKey,
      inspectionKey: this.inspectionKey(snapshot),
      semanticKey: this.semanticEvidenceKey(snapshot),
      snapshot,
    };
    this.core.repo.put('projectObservation', observation);
    if (previous?.inspectionKey !== observation.inspectionKey)
      this.core.events.changed(workId, 'observation');
    return analyze
      ? this.analyzeObservation(work, observation, outputLanguage)
      : observation.snapshot;
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
    return this.latestSnapshot(workId, outputLanguage);
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
        projectProfile: {
          title: input.title,
          purpose: input.purpose,
          focused: false,
          iconAsset: null,
          bannerAsset: null,
        },
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
    return this.commit(
      workId,
      'project-settings',
      command,
      (work, connection) => {
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
      },
      'profile',
    );
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
