import {
  DomainError,
  projectCreateSchema,
  projectProfileSchema,
  projectSourcesSchema,
  projectDeletionSchema,
  workspaceSnapshotSchema,
  workingTreeGroupKey,
  type Command,
  type Connection,
  type ProjectObservation,
  type ProjectProfile,
  type ProjectRegistrations,
  type ProjectWorkspace,
  type ProjectWorkspaceEntry,
  type Receipt,
  type AnalysisWork,
  type ProjectRecord,
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
  private workingTreeAnalysisPending = new Map<string, { promise: Promise<WorkspaceSnapshot> }>();
  /** A later check always wins over an earlier, slower inspection. */
  private observationRequests = new Map<string, number>();
  constructor(private core: StateCarry) {}

  private hash(action: string, projectId: string | null, command: Command) {
    return this.core.ids.hash({
      action,
      projectId,
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

  private connection(work: ProjectRecord): Connection {
    const connection = this.core.repo.get('connection', work.connectionId);
    if (!connection || connection.projectId !== work.id)
      throw new DomainError('NOT_FOUND', 'Project connection not found.', 404);
    return connection;
  }

  private profile(work: ProjectRecord): ProjectProfile {
    return {
      title: work.title,
      purpose: work.purposes.map((purpose) => purpose.text).join('\n'),
      focused: work.focused,
      responseLanguage: work.responseLanguage ?? 'en',
      iconAsset: work.iconAsset,
      bannerAsset: work.bannerAsset,
    };
  }

  private revision(work: ProjectRecord, command: Command) {
    if (work.revision !== command.expectedRevision)
      throw new DomainError(
        'REVISION_CONFLICT',
        'This project changed. Review it before saving.',
        409,
      );
  }

  private receipt(
    command: Command,
    hash: string,
    action: string,
    work: ProjectRecord,
    resultId: string,
  ) {
    const receipt: Receipt = {
      id: command.requestId,
      command: action,
      bodyHash: hash,
      projectId: work.id,
      committedRevision: work.revision,
      resultId,
      createdAt: this.core.clock.now(),
    };
    this.core.repo.put('receipt', receipt);
    return receipt;
  }

  private commit(
    projectId: string,
    action: string,
    command: Command,
    change: (work: ProjectRecord, connection: Connection) => void,
    topic?: 'profile' | 'sources' | 'observation' | 'working-tree-analysis' | 'overview',
  ): Receipt {
    const hash = this.hash(action, projectId, command);
    const result = this.core.repo.transaction(() => {
      const previous = this.replay(command, hash);
      if (previous) return previous;
      const work = this.core.project(projectId);
      this.revision(work, command);
      change(work, this.connection(work));
      return this.receipt(command, hash, action, this.core.project(projectId), work.connectionId);
    });
    this.core.events.changed(projectId, topic);
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
      files: (snapshot.files ?? []).map((file) => ({
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
      dirty: snapshot.dirty,
      changedFiles: snapshot.changedFiles ?? [],
      changedFileCount: snapshot.changedFileCount ?? 0,
      additions: snapshot.additions ?? 0,
      deletions: snapshot.deletions ?? 0,
      untrackedCount: snapshot.untrackedCount ?? 0,
      diffPreview: snapshot.diffPreview ?? '',
      fileFingerprint: snapshot.fileFingerprint ?? snapshot.fingerprint ?? null,
      files: (snapshot.files ?? []).map((file) => ({ path: file.path, hash: file.hash })),
    });
  }

  private executionResults(work: ProjectRecord, observation: ProjectObservation) {
    return (this.core.repo.get('projectExecution', work.id)?.requests ?? [])
      .slice(-5)
      .flatMap((id) => {
        const comparison = this.core.repo.get('projectExecution', work.id)?.comparisons[id];
        const request = this.core.repo.get('continuation', id);
        if (!comparison || !request) return [];
        return [
          {
            requestId: id,
            source: request.externalReport ? ('user-report' as const) : ('agent-report' as const),
            report: (request.externalReport ?? request.execution?.report ?? '').slice(0, 8000),
            doneWhen: request.target.payload.doneWhen,
            checks: request.execution?.checks ?? [],
            current:
              this.core.repo.get('projectScope', work.id)?.observedWorkspaceBasis ===
                observation.semanticKey &&
              this.core.repo.get('projectScope', work.id)?.observation?.basis === comparison.basis,
            accepted:
              this.core.repo.get('projectExecution', work.id)?.accepted.includes(id) ?? false,
          },
        ];
      });
  }

  private semanticKey(
    work: ProjectRecord,
    observation: ProjectObservation,
    outputLanguage: 'en' | 'ko',
  ): string {
    return this.core.ids.hash({
      evidence: observation.semanticKey,
      executionResults: this.executionResults(work, observation),
      outputLanguage,
      projectTitle: this.profile(work).title,
      analysis: this.core.summary.configuration(),
    });
  }

  private analysisRecordId(projectId: string, semanticKey: string): string {
    return this.core.ids.hash(['working-tree-analysis', projectId, semanticKey]);
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

  latestObservation(projectId: string): ProjectObservation | null {
    return this.core.repo.get('projectObservation', projectId);
  }

  latestSnapshot(projectId: string): WorkspaceSnapshot {
    const work = this.core.project(projectId);
    const connection = this.connection(work);
    const observation = this.latestObservation(projectId);
    if (!observation) return this.unknownSnapshot(connection.cwd);
    const snapshot = this.withoutAnalysis(observation.snapshot);
    if (!this.isConfirmedDirty(snapshot)) return snapshot;
    // Reading saved text never regenerates it to match a changed preference.
    const record = (['en', 'ko'] as const)
      .flatMap((language) => {
        const saved = this.core.repo.get(
          'workingTreeAnalysis',
          this.analysisRecordId(projectId, this.semanticKey(work, observation, language)),
        );
        return saved ? [saved] : [];
      })
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
    return record ? { ...snapshot, workingTreeAnalysis: record.result } : snapshot;
  }

  private isLatestObservation(observation: ProjectObservation): boolean {
    const latest = this.latestObservation(observation.projectId);
    // Analysis may safely finish across a metadata-only probe change, but not
    // across different repository evidence (especially dirty to clean).
    return latest?.semanticKey === observation.semanticKey;
  }

  private isConfirmedDirty(snapshot: WorkspaceSnapshot): boolean {
    return snapshot.status === 'checked' && snapshot.dirty === true;
  }

  private isConfirmedClean(snapshot: WorkspaceSnapshot): boolean {
    return snapshot.status === 'checked' && snapshot.dirty === false;
  }

  private publishWorkingTreeProposals(
    work: ProjectRecord,
    observation: ProjectObservation,
    analysis: WorkingTreeAnalysis | null,
    outputLanguage: 'en' | 'ko',
  ): boolean {
    return this.core.workMatcher.replaceProposals(
      work.id,
      'working-tree-group',
      (analysis?.groups ?? []).map((group) => ({
        key: workingTreeGroupKey(group),
        source: 'working-tree-group',
        title: group.title,
        state: 'active',
        currentState: group.currentState,
        uncertainty: group.openItems[0] ?? null,
        nextAction: group.suggestedNextStep,
        doneWhen: group.doneWhen,
        evidenceBasis: observation.semanticKey,
      })),
      outputLanguage,
    );
  }

  private async analyzeObservation(
    work: ProjectRecord,
    observation: ProjectObservation,
    outputLanguage: 'en' | 'ko',
  ): Promise<WorkspaceSnapshot> {
    const snapshot = this.withoutAnalysis(observation.snapshot);
    if (!this.isConfirmedDirty(snapshot) || !this.core.summary.analyzeWorkingTree) {
      if (
        this.isConfirmedClean(snapshot) &&
        this.isLatestObservation(observation) &&
        this.publishWorkingTreeProposals(work, observation, null, outputLanguage)
      )
        this.core.events.changed(work.id, 'working-tree-analysis');
      return snapshot;
    }
    const semanticKey = this.semanticKey(work, observation, outputLanguage);
    const recordId = this.analysisRecordId(work.id, semanticKey);
    const stored = this.core.repo.get('workingTreeAnalysis', recordId);
    if (stored) {
      if (!this.isLatestObservation(observation)) return this.latestSnapshot(work.id);
      if (this.publishWorkingTreeProposals(work, observation, stored.result, outputLanguage))
        this.core.events.changed(work.id, 'working-tree-analysis');
      return { ...snapshot, workingTreeAnalysis: stored.result };
    }
    const pending = this.workingTreeAnalysisPending.get(recordId);
    if (pending) return pending.promise;
    let promise!: Promise<WorkspaceSnapshot>;
    promise = (async () => {
      try {
        const rawResult = await this.core.summary.analyzeWorkingTree!({
          projectTitle: this.profile(work).title,
          outputLanguage,
          snapshot,
          executionResults: this.executionResults(work, observation),
        });
        // Never let an older inspection restore proposals after a newer check.
        if (!this.isLatestObservation(observation)) return this.latestSnapshot(work.id);
        const previous = this.core.repo
          .list('workingTreeAnalysis')
          .filter((item) => item.projectId === work.id)
          .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
        const pathKey = (files: string[]) => JSON.stringify([...files].sort());
        const result = {
          ...rawResult,
          groups: rawResult.groups.map((group) => {
            const matches =
              previous?.result.groups.filter(
                (old) => pathKey(old.files) === pathKey(group.files),
              ) ?? [];
            const unique =
              rawResult.groups.filter((other) => pathKey(other.files) === pathKey(group.files))
                .length === 1;
            return {
              ...group,
              id:
                unique && matches.length === 1 && matches[0].id
                  ? matches[0].id
                  : this.core.ids.next(),
            };
          }),
        };

        const record: WorkingTreeAnalysisRecord = {
          id: recordId,
          projectId: work.id,
          semanticKey,
          outputLanguage,
          result,
          generatedAt: this.core.clock.now(),
        };
        this.core.repo.put('workingTreeAnalysis', record);
        this.publishWorkingTreeProposals(work, observation, record.result, outputLanguage);
        this.core.events.changed(work.id, 'working-tree-analysis');
        return { ...snapshot, workingTreeAnalysis: result };
      } catch (error) {
        if (!this.isLatestObservation(observation)) return this.latestSnapshot(work.id);
        this.core.reportError(error, 'working-tree-analysis', work.id);
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
    })();
    this.workingTreeAnalysisPending.set(recordId, { promise });
    return promise;
  }

  async analyzeLatest(
    projectId: string,
    outputLanguage: 'en' | 'ko' = this.core.project(projectId).responseLanguage ?? 'en',
  ): Promise<WorkspaceSnapshot> {
    const work = this.core.project(projectId);
    const observation = this.latestObservation(projectId);
    if (!observation) return this.latestSnapshot(projectId);
    return this.analyzeObservation(work, observation, outputLanguage);
  }

  async observe(
    projectId: string,
    outputLanguage: 'en' | 'ko' = this.core.project(projectId).responseLanguage ?? 'en',
    hints?: WorkspaceInspectionHints,
    analyze = true,
  ): Promise<WorkspaceSnapshot> {
    const request = (this.observationRequests.get(projectId) ?? 0) + 1;
    this.observationRequests.set(projectId, request);
    const work = this.core.project(projectId);
    const connection = this.connection(work);
    const inspector = this.core.projectInspector;
    if (!inspector)
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        'Project workspace inspection is unavailable.',
      );
    const previous = this.latestObservation(projectId);
    let probeKey: string;
    let snapshot: WorkspaceSnapshot;
    if (inspector.probeAsync || inspector.probe) {
      const probe = inspector.probeAsync
        ? await inspector.probeAsync(connection.cwd)
        : inspector.probe!(connection.cwd);
      probeKey = this.probeKey(probe);
      if (previous?.probeKey === probeKey) {
        if (this.observationRequests.get(projectId) !== request)
          return this.latestSnapshot(projectId);
        return analyze
          ? this.analyzeObservation(work, previous, outputLanguage)
          : this.withoutAnalysis(previous.snapshot);
      }
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
      if (previous?.probeKey === probeKey) {
        if (this.observationRequests.get(projectId) !== request)
          return this.latestSnapshot(projectId);
        return analyze
          ? this.analyzeObservation(work, previous, outputLanguage)
          : this.withoutAnalysis(previous.snapshot);
      }
    }
    if (this.observationRequests.get(projectId) !== request) return this.latestSnapshot(projectId);
    snapshot = this.withoutAnalysis(snapshot);
    const observation: ProjectObservation = {
      id: projectId,
      projectId,
      checkedAt: snapshot.checkedAt,
      probeKey,
      inspectionKey: this.inspectionKey(snapshot),
      semanticKey: this.semanticEvidenceKey(snapshot),
      snapshot,
    };
    this.core.repo.put('projectObservation', observation);
    if (this.isConfirmedClean(snapshot))
      this.publishWorkingTreeProposals(work, observation, null, outputLanguage);
    if (previous?.inspectionKey !== observation.inspectionKey)
      this.core.events.changed(projectId, 'observation');
    return analyze
      ? this.analyzeObservation(work, observation, outputLanguage)
      : observation.snapshot;
  }

  registrations(): ProjectRegistrations {
    return {
      projects: this.core.repo.list('project').map((work) => {
        const connection = this.connection(work);
        const profile = this.profile(work);
        return {
          projectId: work.id,
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
      projects: this.core.repo.list('project').map((work): ProjectWorkspaceEntry => {
        const connection = this.connection(work);
        const profile = this.profile(work);
        let analysis: AnalysisWork | null = null;
        let decisions = { acceptedKeys: [] as string[], pausedKeys: [] as string[] };
        if (this.core.isConnectionActive(connection)) {
          try {
            analysis = this.core.analyses.view(work.id);
            decisions = this.core.analyses.decisionKeys(work.id, analysis.candidates);
          } catch {
            // Preparation/read failures never turn a raw error or model response
            // into the explanation, and never erase manually supplied context.
            analysis = {
              projectId: work.id,
              title: profile.title,
              cwd: connection.cwd,
              revision: work.revision,
              goalText:
                this.core.directionIntent(work.id)?.origin === 'user-input'
                  ? this.core.directionIntent(work.id)!.text
                  : null,
              goalOrigin:
                this.core.directionIntent(work.id)?.origin === 'user-input'
                  ? 'user-input'
                  : 'inferred',
              sessionCount: this.core.links(work.id).filter((link) => link.status === 'linked')
                .length,
              state: 'unavailable',
              stateDetail:
                'This project’s saved context could not be checked. Review its connected records and try again.',
              blockedActions: ['Check the connected records before continuing.'],
              version: '',
              candidates: [],
              busy: this.core.analyses.isRunning(work.id),
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
          projectId: work.id,
          connectionId: connection.id,
          ...profile,
          focused: profile.focused,
          responseLanguage: profile.responseLanguage,
          cwd: connection.cwd,
          revision: work.revision,
          disconnectedAt: connection.removedAt ?? null,
          ...decisions,
          collecting: this.core.isCollecting(work.id),
          analysis,
        };
      }),
    };
  }

  async workspace(projectId: string) {
    return this.latestSnapshot(projectId);
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
        const work = this.core.project(existing.projectId);
        if (work.connectionId !== existing.id)
          throw new DomainError('NOT_FOUND', 'Project connection not found.', 404);
        return {
          receipt: this.receipt(command, hash, 'project-reuse', work, existing.id),
          created: false,
        };
      }
      const projectId = this.core.ids.next();
      const connectionId = this.core.ids.next();
      const now = this.core.clock.now();
      const work: ProjectRecord = {
        id: projectId,
        connectionId: connectionId,
        title: input.title,
        cwd,
        purposes: input.purpose
          ? [
              {
                id: this.core.ids.hash(['project-purpose', projectId]),
                text: input.purpose,
                origin: 'user',
                confirmed: true,
              },
            ]
          : [],
        focused: false,
        responseLanguage: input.responseLanguage,
        iconAsset: null,
        bannerAsset: null,
        lifecycle: 'active',
        revision: 1,
        linkVersion: 1,
        inputVersion: '',
        latestSummaryId: null,
        createdAt: now,
      };
      this.core.repo.put('project', work);
      this.core.repo.put('connection', {
        id: connectionId,
        projectId,
        title: input.title,
        cwd,
        threadIds: [...new Set(input.threadIds)],
        startTurnIds: input.startTurnIds,
        recordRanges: input.recordRanges,
        discover: input.threadIds.length > 0 && input.discover,
        revision: 1,
        createdAt: now,
      });
      if (input.goal) this.core.projectModel.setDirection(projectId, input.goal, false, false);
      for (const threadId of new Set(input.threadIds))
        this.core.repo.put('link', {
          id: this.core.ids.hash([projectId, threadId]),
          projectId,
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
    if (result.created) this.core.events.changed(result.receipt.projectId);
    return result.receipt;
  }

  settings(projectId: string, command: Command): Receipt {
    const profile = projectProfileSchema.parse(command.payload);
    return this.commit(
      projectId,
      'project-settings',
      command,
      (work, connection) => {
        if (profile.focused && !this.profile(work).focused) {
          const focused = this.core.repo
            .list('project')
            .filter((other) => other.id !== projectId && other.focused);
          if (focused.length >= 3)
            throw new DomainError(
              'VALIDATION',
              'Home focus already contains three projects. Remove one before adding another.',
              409,
            );
        }
        this.core.repo.put('project', {
          ...work,
          title: profile.title,
          purposes: profile.purpose
            ? [{ id: 'primary-purpose', text: profile.purpose, origin: 'user', confirmed: true }]
            : [],
          focused: profile.focused,
          responseLanguage: profile.responseLanguage,
          iconAsset: profile.iconAsset ?? null,
          bannerAsset: profile.bannerAsset ?? null,
          revision: work.revision + 1,
        });
        this.core.repo.put('connection', { ...connection, title: profile.title });
      },
      'profile',
    );
  }

  sources(projectId: string, command: Command): Receipt {
    const input = projectSourcesSchema.parse(command.payload);
    const hash = this.hash('project-sources', projectId, command);
    const previous = this.replay(command, hash);
    if (previous) return previous;
    const work = this.core.project(projectId);
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
      projectId,
    );
    this.core.questions.forgetWork(projectId);
    return result;
  }

  disconnect(projectId: string, command: Command): Receipt {
    this.emptyPayload(command);
    const result = this.commit(projectId, 'project-disconnect', command, (work, connection) => {
      if (connection.removedAt)
        throw new DomainError('VALIDATION', 'This project is already disconnected.');
      this.core.repo.put('connection', {
        ...connection,
        removedAt: this.core.clock.now(),
        revision: connection.revision + 1,
      });
      this.core.repo.put('project', {
        ...work,
        lifecycle: 'disconnected',
        revision: work.revision + 1,
      });
    });
    this.core.questions.forgetWork(projectId);
    return result;
  }

  restore(projectId: string, command: Command): Receipt {
    this.emptyPayload(command);
    return this.commit(projectId, 'project-restore', command, (work, connection) => {
      if (!connection.removedAt)
        throw new DomainError('VALIDATION', 'This project is already connected.');
      this.core.repo.put('connection', {
        ...connection,
        removedAt: null,
        revision: connection.revision + 1,
      });
      this.core.repo.put('project', { ...work, lifecycle: 'active', revision: work.revision + 1 });
    });
  }

  private emptyPayload(command: Command): void {
    if (Object.keys(command.payload).length)
      throw new DomainError('VALIDATION', 'This action does not accept additional settings.');
  }

  deletionPreview(projectId: string) {
    return projectDeletionPlan(this.core, projectId).preview;
  }

  delete(projectId: string, command: Command): Receipt {
    const input = projectDeletionSchema.parse(command.payload);
    const hash = this.hash('project-delete', projectId, command);
    const result = this.core.repo.transaction(() => {
      const previous = this.replay(command, hash);
      if (previous) return previous;
      const work = this.core.project(projectId);
      this.revision(work, command);
      const plan = projectDeletionPlan(this.core, projectId);
      if (plan.preview.blocked)
        throw new DomainError('PROJECT_BUSY', plan.preview.explanation, 409);
      if (input.token !== plan.preview.token)
        throw new DomainError(
          'PROJECT_DELETION_CHANGED',
          'The saved data or shared sources changed. Review the deletion details again.',
          409,
        );
      for (const { kind, entity } of plan.rows)
        if (kind !== 'project') this.core.repo.remove(kind, entity.id);
      for (const source of plan.exclusive) this.core.repo.remove('source', source.id);
      this.core.repo.remove('project', projectId);
      return this.receipt(
        command,
        hash,
        'project-delete',
        { ...work, revision: work.revision + 1 },
        projectId,
      );
    });
    this.core.questions.forgetWork(projectId);
    this.core.analyses.forget(projectId);
    this.core.events.changed(projectId);
    return result;
  }
}
