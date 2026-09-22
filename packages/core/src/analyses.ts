import {
  DomainError,
  QuestionCandidateError,
  QUESTION_LIMITS,
  taskDiscussionRequestSchema,
  analysisResultSchema,
  analysisCorrectionSchema,
  workspaceSnapshotSchema,
  normalizeWorkspaceInspectionHints,
  type AnalysisWork,
  type AnalysisCandidate,
  type WorkspaceSnapshot,
  type AnalysisCoordination,
  type WorkspaceInspectionHints,
  type SourceRevision,
  type QuestionContext,
  type QuestionAnswer,
  type OutputLanguage,
} from '@statecarry/contracts';
import type { StateCarry } from './service';
import { selectedRecords } from './goals';
import { assessQuestionAnswer, validateQuestionAnswer } from './question-context';

const PROJECT_INSPECTION_THREAD = 'project-inspection';

export class ProjectAnalyses {
  private running = new Set<string>();
  private errors = new Map<string, string>();
  constructor(private core: StateCarry) {}
  isRunning(id: string): boolean {
    return this.running.has(id);
  }
  /** Analysis candidates are suggestions, not durable work. They may be used
   * only while the exact validated brief is current. */
  currentProposalBasis(id: string): string | null {
    const record = this.core.analysisRecord(id);
    if (!record) return null;
    // Early migration records did not have a comparable scope fingerprint.
    // Keep them available for explicit confirmation; their proposal never
    // becomes durable work unless the person selects it.
    if (!/^[a-f0-9]{64}$/i.test(record.result.scope)) return record.result.scope;
    const view = this.view(id);
    return view.state === 'ready' && !view.stale && !view.updatesAvailable
      ? record.result.scope
      : null;
  }
  forget(id: string): void {
    this.errors.delete(id);
  }
  /** Only explicit decisions on candidates still visible in the same scope count. */
  decisionKeys(id: string, candidates: AnalysisCandidate[]) {
    const { work, scope } = this.context(id);
    const visible = new Set(candidates.map((candidate) => candidate.key));
    const decisions = (this.core.analysisCorrections(work.id) ?? []).filter(
      (item) => item.scope === scope && visible.has(item.candidateKey),
    );
    return {
      acceptedKeys: decisions
        .filter((item) => item.kind === 'done')
        .map((item) => item.candidateKey),
      pausedKeys: decisions
        .filter((item) => item.kind === 'paused')
        .map((item) => item.candidateKey),
    };
  }
  private workspace(id: string, hints?: WorkspaceInspectionHints): WorkspaceSnapshot | null {
    const work = this.core.project(id),
      connection = this.core.repo.get('connection', work.connectionId);
    if (!this.core.isConnectionActive(connection))
      throw new DomainError('NOT_FOUND', 'Connection not found', 404);
    void hints;
    if (!this.core.projectInspector) return null;
    return this.core.projects.latestSnapshot(id);
  }
  private workspaceKey(value: WorkspaceSnapshot | null | undefined): string | null {
    if (!value) return null;
    return this.core.ids.hash({
      cwd: value.cwd,
      root: value.root ?? null,
      branch: value.branch,
      commit: value.commit,
      dirty: value.dirty,
      changedPaths: value.changedPaths ?? [],
      recentCommits: value.recentCommits ?? [],
      status: value.status,
      limitations: value.limitations ?? [],
      fileFingerprint: value.fileFingerprint ?? value.fingerprint ?? null,
      inventoryFingerprint: value.inventoryFingerprint ?? null,
      files: ((value.files?.length ? value.files : value.files) ?? [])
        .map((file) => ({ path: file.path, hash: file.hash, size: file.size ?? null }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    });
  }

  /** Extract bounded file/function clues from connected records before inspection. */
  private inspectionHints(id: string, sources: SourceRevision[]): WorkspaceInspectionHints {
    const work = this.core.project(id);
    const texts = [
      this.core.directionIntent(work.id)?.text ?? '',
      ...sources.map((source) => source.text),
    ].filter(Boolean);
    const paths = new Set<string>();
    const symbols = new Set<string>();
    const terms = new Set<string>();
    const pathPattern =
      /(?:^|[\s("'`])((?:(?:\.\.?(?:[\\/])|[A-Za-z0-9_.-]+[\\/])?)[A-Za-z0-9_./\\-]+\.(?:c|cc|cpp|css|go|h|hh|hpp|html|java|js|jsx|json|md|mjs|py|rb|rs|scss|sh|sql|swift|toml|ts|tsx|vue|yaml|yml|xml|txt|astro|svelte))(?:[:#](?:\d+))?/gi;
    const callPattern = /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\s*\(/g;
    for (const text of texts) {
      for (const match of text.matchAll(pathPattern)) paths.add(match[1].replace(/\\/g, '/'));
      for (const match of text.matchAll(callPattern)) symbols.add(match[1]);
      // Goal and explicit file/function context are useful terms; generic
      // prose words are omitted so matching remains explainable and bounded.
      for (const word of text
        .split(/[^A-Za-z0-9_$-]+/)
        .filter((value) => value.length >= 5)
        .slice(0, 80)) {
        if (
          /^(?:there|which|where|could|should|would|about|after|before|these|those|their|while|still|check|record|state|current|action|complete|completion|implementation|implemented|reported|verified)$/i.test(
            word,
          )
        )
          continue;
        terms.add(word);
      }
    }
    return normalizeWorkspaceInspectionHints({
      paths: [...paths],
      symbols: [...symbols],
      terms: [...terms],
    });
  }
  /** Convert bounded project inspection into citable tool records for analysis. */
  private workspaceRecords(workspace: WorkspaceSnapshot | null) {
    const files = workspace?.files?.length ? workspace.files : (workspace?.files ?? []);
    if (!workspace) return [];
    const threadId = PROJECT_INSPECTION_THREAD;
    const result: {
      revisionId: string;
      threadId: string;
      actor: 'tool';
      kind: string;
      at: string;
      text: string;
      limitations: string[];
    }[] = [];
    let remaining = 12000;
    const hasGitState =
      workspace.status === 'checked' &&
      (workspace.branch !== null || workspace.commit !== null || workspace.dirty !== null);
    if (hasGitState) {
      const gitText = [
        `Git workspace: branch ${workspace.branch ?? 'detached or unknown'}, commit ${workspace.commit ?? 'unknown'}, working tree ${workspace.dirty ? 'has changes' : 'is clean'}.`,
        workspace.changedPaths?.length
          ? `Changed paths:\n${workspace.changedPaths.map((path) => `- ${path}`).join('\n')}`
          : 'Changed paths: none recorded.',
        workspace.recentCommits?.length
          ? `Recent commits:\n${workspace.recentCommits
              .map(
                (commit) =>
                  `- ${commit.hash.slice(0, 12)} ${commit.committedAt} ${commit.subject}${commit.changedPaths.length ? `\n  Paths: ${commit.changedPaths.join(', ')}` : ''}`,
              )
              .join('\n')}`
          : 'Recent commits: none recorded.',
      ].join('\n');
      const text = gitText.slice(0, Math.min(6000, remaining));
      result.push({
        revisionId: `workspace-git:${this.core.ids.hash({
          branch: workspace.branch,
          commit: workspace.commit,
          dirty: workspace.dirty,
          changedPaths: workspace.changedPaths ?? [],
          recentCommits: workspace.recentCommits ?? [],
        })}`,
        threadId,
        actor: 'tool',
        kind: 'gitObservation',
        at: workspace.checkedAt,
        text,
        limitations: workspace.limitations ?? [],
      });
      remaining -= text.length;
    }
    const ordered = [...files].sort(
      (a, b) =>
        Number(b.selection === 'related') - Number(a.selection === 'related') ||
        a.path.localeCompare(b.path),
    );
    for (const file of ordered.filter(
      (file) => file.status !== 'unavailable' && file.hash !== 'unavailable',
    )) {
      if (remaining <= 0) break;
      const fullText = `File observation: ${file.path}${file.preview ? `\nContent preview:\n${file.preview}` : ''}`;
      const text = fullText.length <= remaining ? fullText : `File observation: ${file.path}`;
      if (text.length > remaining) break;
      result.push({
        revisionId:
          file.revisionId ??
          `workspace-file:${this.core.ids.hash([file.path, file.hash, file.size ?? null])}`,
        threadId,
        actor: 'tool' as const,
        kind: 'fileObservation',
        at: workspace.checkedAt,
        text,
        limitations: file.limitation ? [file.limitation] : [],
      });
      remaining -= text.length;
    }
    return result;
  }
  private storedWorkspaceEvidence(id: string, revisionId: string): string | null {
    const work = this.core.project(id);
    for (const snapshot of [
      this.core.analysisRecord(work.id)?.result?.workspaceAfter,
      this.core.analysisRecord(work.id)?.result?.workspaceBefore,
    ]) {
      const record = this.workspaceRecords(snapshot ?? null).find(
        (item) => item.revisionId === revisionId,
      );
      if (record) return record.text;
    }
    return null;
  }
  private context(id: string) {
    const work = this.core.project(id),
      connection = this.core.connection(work.connectionId);
    const links = this.core
      .links(id)
      .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification');
    const scope = this.core.ids.hash([
      connection.cwd,
      connection.startTurnIds,
      connection.recordRanges,
      connection.discoveryScope,
      links.map((l) => l.threadId).sort(),
      this.core.directionIntent(work.id),
      ...(work.purposes.map((purpose) => purpose.text).join('\n')
        ? [work.purposes.map((purpose) => purpose.text).join('\n')]
        : []),
    ]);
    return { work, connection, links, scope };
  }
  /** A temporary read failure does not revoke evidence already captured in
   * this exact goal/range. Only cited immutable revisions may be retained. */
  retainsEvidence(id: string, source: SourceRevision): boolean {
    const { work, connection, scope } = this.context(id);
    if (
      !this.core.analysisRecord(work.id)?.result ||
      this.core.analysisRecord(work.id)?.result.scope !== scope
    )
      return false;
    const checkpoint = this.core.repo
      .list('checkpoint')
      .find((item) => item.projectId === id && item.threadId === source.threadId);
    if (
      !checkpoint ||
      checkpoint.scopeVersion !== connection.revision ||
      !['partial', 'failed', 'reading'].includes(checkpoint.status)
    )
      return false;
    const parsed = analysisResultSchema.safeParse({
      candidates: this.core.analysisRecord(work.id)?.result.candidates,
    });
    if (!parsed.success) return false;
    return parsed.data.candidates.some((candidate) =>
      [
        ...candidate.evidence,
        ...Object.values(candidate.progress ?? {}).flatMap((items) => items ?? []),
        ...Object.values(candidate.completion ?? {}).flatMap((items) => items ?? []),
      ].some((item) => item.revisionId === source.id && source.text.includes(item.quote)),
    );
  }
  private input(id: string, observedWorkspace = this.workspace(id)) {
    const { work, connection, links, scope } = this.context(id);
    const availableSources = this.core.sources(id);
    const sources = links.flatMap((link) => {
      const records = availableSources.filter((source) => source.threadId === link.threadId);
      // An empty/failed checkpoint grants no new records. Preserve its failure
      // state in view() instead of throwing while trying to locate a boundary.
      return records.length ? selectedRecords(connection, link.threadId, records) : [];
    });
    const version = this.core.ids.hash([
      scope,
      this.core.directionIntent(work.id),
      sources.map((s) => s.id),
      this.workspaceKey(observedWorkspace),
      'resume-v0-4',
    ]);
    return {
      work,
      connection,
      links,
      sources,
      availableSources,
      scope,
      version,
      workspace: observedWorkspace,
    };
  }
  private coordination(
    work: ReturnType<StateCarry['project']>,
    links: ReturnType<StateCarry['links']>,
    sources: ReturnType<StateCarry['sources']>,
  ): AnalysisCoordination {
    const linked = links.filter(
      (link) => link.status === 'linked' && link.role !== 'controlled-verification',
    );
    const linkedIds = new Set(linked.map((link) => link.threadId));
    if (work.coordinationMode === 'none')
      return {
        state: 'none',
        threadId: null,
        title: null,
        detail: 'You chose not to assign a coordination conversation.',
        evidence: [],
      };
    if (work.coordinationThreadId) {
      const selected = linked.find((link) => link.threadId === work.coordinationThreadId);
      if (selected)
        return {
          state: 'recommended',
          threadId: selected.threadId,
          title: selected.title,
          detail: 'You selected this connected conversation to manage overall progress.',
          evidence: [],
        };
      if (work.coordinationMode === 'selected')
        return {
          state: 'unconfirmed',
          threadId: null,
          title: null,
          detail:
            'The selected coordination conversation is no longer connected. Choose another connected conversation before continuing overall progress.',
          evidence: [],
        };
    }
    if (work.coordinationMode === 'selected')
      return {
        state: 'unconfirmed',
        threadId: null,
        title: null,
        detail: 'A coordination conversation was selected, but it is no longer available.',
        evidence: [],
      };
    // A planning term by itself is not proof that a conversation owns
    // coordination. Require an explicit conversation/session subject and a
    // coordination action so ordinary questions such as “what are the
    // completion criteria?” do not redirect a person away from their work.
    // Treat only explicit assignment language as coordination evidence. A
    // question that merely mentions coordination or completion criteria must
    // not redirect the user away from the conversation they chose.
    const marker = [
      /\b(?:use|make|treat|designate|keep|let)\b[\s\S]{0,40}\b(?:this|that|one|the)\s+(?:conversation|thread|chat|session)\b[\s\S]{0,100}\b(?:coordinate|orchestrate|manage|track|own|source of truth|completion criteria|priority|progress)\b/i,
      /\b(?:this|that|one|the)\s+(?:conversation|thread|chat|session)\b[\s\S]{0,60}\b(?:is|will be|should be)\b[\s\S]{0,70}\b(?:the )?(?:source of truth|coordination|overall progress|priority|completion criteria)\b/i,
      /(?:이 대화를|이 세션을|조율 대화로)[\s\S]{0,80}(?:사용|지정|정해|삼아|관리|우선순위|완료 기준|진행)/i,
    ];
    const explicitAssignment = (text: string) => {
      const value = text.trim();
      // User quotations, questions, and negations describe a possibility or
      // someone else's words; they do not assign a coordination role.
      if (!value || /[?？]/.test(value) || /^(?:>|["'“‘])/.test(value)) return false;
      if (
        /\b(?:do not|don't|dont|never|stop|avoid|without)\b[\s\S]{0,100}\b(?:use|make|treat|designate|keep|let)\b/i.test(
          value,
        )
      )
        return false;
      if (/\b(?:agent|assistant|codex)\s+(?:said|suggested|asked|wrote)\b/i.test(value))
        return false;
      return marker.some((pattern) => pattern.test(value));
    };
    const evidence = sources
      .filter(
        (source) =>
          linkedIds.has(source.threadId) &&
          source.actor === 'user' &&
          explicitAssignment(source.text),
      )
      .slice(-6)
      .map((source) => ({ revisionId: source.id, quote: source.text.slice(0, 1200) }));
    const explicitThreads = [
      ...new Set(
        evidence
          .map((item) => sources.find((source) => source.id === item.revisionId)?.threadId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (explicitThreads.length === 1) {
      const threadId = explicitThreads[0];
      return {
        state: 'recommended',
        threadId,
        title: linked.find((link) => link.threadId === threadId)?.title ?? null,
        detail:
          'This connected conversation explicitly describes coordination, priority, or completion criteria for the work.',
        evidence,
      };
    }
    if (linked.length > 1)
      return {
        state: 'unconfirmed',
        threadId: null,
        title: null,
        detail:
          'No single coordination conversation is confirmed. Review the connected conversations before choosing where to continue overall progress.',
        evidence: [],
      };
    if (linked.length === 1)
      return {
        state: 'unconfirmed',
        threadId: null,
        title: null,
        detail: 'The role of the connected conversation is not confirmed by the available records.',
        evidence: [],
      };
    return {
      state: 'none',
      threadId: null,
      title: null,
      detail: 'No connected conversation is available to manage overall progress.',
      evidence: [],
    };
  }
  list(): AnalysisWork[] {
    return this.core.repo
      .list('project')
      .filter((w) => this.core.isConnectionActive(this.core.repo.get('connection', w.connectionId)))
      .map((w) => {
        try {
          return this.view(w.id);
        } catch (e) {
          return {
            updatesAvailable: false,
            goalText: null,
            goalOrigin: 'inferred' as const,
            sessionCount: 0,
            projectId: w.id,
            title: 'Connected work',
            cwd: '',
            version: '',
            candidates: [],
            busy: false,
            error: String(e),
            stale: true,
            generatedAt: null,
            correctedKeys: [],
            dismissedKeys: [],
            coordination: null,
            continuation: null,
          };
        }
      });
  }
  view(id: string): AnalysisWork {
    const { work, connection, version, scope, sources, availableSources, workspace } =
      this.input(id);
    const checkpoints = this.core.repo.list('checkpoint').filter((c) => c.projectId === id);
    const unavailable = checkpoints.some((c) => c.status === 'failed');
    const partiallyUnavailable = checkpoints.some(
      (c) => c.status === 'partial' || c.status === 'reading',
    );
    const storedWorkspace = this.core.analysisRecord(work.id)?.result?.workspaceAfter;
    const storedWorkspaceBefore = this.core.analysisRecord(work.id)?.result?.workspaceBefore;
    const storedWorkspaceValid =
      !!storedWorkspace && workspaceSnapshotSchema.safeParse(storedWorkspace).success;
    const storedWorkspaceBeforeValid =
      !!storedWorkspaceBefore && workspaceSnapshotSchema.safeParse(storedWorkspaceBefore).success;
    const hasCheckedProjectBasis =
      storedWorkspaceValid &&
      storedWorkspaceBeforeValid &&
      storedWorkspace!.status === 'checked' &&
      storedWorkspaceBefore!.status === 'checked';
    const workspaceSnapshotsDiffer =
      storedWorkspaceValid &&
      storedWorkspaceBeforeValid &&
      storedWorkspace!.status === 'checked' &&
      storedWorkspaceBefore!.status === 'checked' &&
      this.workspaceKey(storedWorkspace) !== this.workspaceKey(storedWorkspaceBefore);
    const workspaceChanged =
      !!this.core.projectInspector &&
      storedWorkspaceValid &&
      storedWorkspaceBeforeValid &&
      storedWorkspace!.status === 'checked' &&
      workspace?.status === 'checked' &&
      (workspaceSnapshotsDiffer ||
        this.workspaceKey(storedWorkspace) !== this.workspaceKey(workspace));
    const workspaceUnavailable =
      !!this.core.projectInspector &&
      (!storedWorkspaceValid ||
        !storedWorkspaceBeforeValid ||
        storedWorkspace!.status !== 'checked' ||
        storedWorkspaceBefore!.status !== 'checked' ||
        workspace?.status !== 'checked');
    const storedResult = this.core.analysisRecord(work.id)?.result
      ? analysisResultSchema.safeParse({
          candidates: this.core.analysisRecord(work.id)?.result.candidates,
        })
      : null;
    const scopeChanged =
      !!this.core.analysisRecord(work.id)?.result &&
      this.core.analysisRecord(work.id)?.result.scope !== scope;
    const sourceAvailabilityBlocks =
      !hasCheckedProjectBasis && (unavailable || partiallyUnavailable);
    const structurallyStale =
      !this.core.analysisRecord(work.id)?.result ||
      scopeChanged ||
      sourceAvailabilityBlocks ||
      workspaceUnavailable ||
      workspaceChanged ||
      storedResult?.success !== true;
    // Every quote that can explain progress or completion must still resolve
    // to an accessible record. Checking only the candidate's primary evidence
    // would leave an old verification quote visible after its source was
    // removed or its conversation was unlinked.
    const evidenceAccessible =
      !this.core.analysisRecord(work.id)?.result ||
      storedResult?.success !== true ||
      !this.core.analysisRecord(work.id)?.result.candidates.some((c) => {
        const evidence = [
          ...c.evidence,
          ...Object.values(c.progress ?? {}).flatMap((items) => items ?? []),
          ...Object.values(c.completion ?? {}).flatMap((items) => items ?? []),
        ];
        return evidence.some((e) => {
          const text =
            this.core.accessibleSource(id, e.revisionId, availableSources)?.text ??
            this.storedWorkspaceEvidence(id, e.revisionId);
          return !text?.includes(e.quote);
        });
      });
    const stale = structurallyStale || !evidenceAccessible || !!this.errors.get(id);
    const updatesAvailable =
      !stale && this.core.analysisRecord(work.id)?.result?.version !== version;
    const continuation =
      this.core.repo
        .list('continuation')
        .filter((item) => item.projectId === id)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .at(-1) ?? null;
    const corrections = (this.core.analysisCorrections(work.id) ?? []).filter(
      (c) => c.scope === scope,
    );
    // A failed check may retain a readable brief for this same goal and scope.
    // It never overrides a changed goal, revoked evidence or invalid stored data.
    const preserveLastKnown =
      !!this.core.analysisRecord(work.id)?.result &&
      (workspaceUnavailable ||
        workspaceChanged ||
        unavailable ||
        partiallyUnavailable ||
        !!this.errors.get(id));
    const safe =
      storedResult?.success === true &&
      !scopeChanged &&
      evidenceAccessible &&
      (!stale || preserveLastKnown);
    const candidates = safe
      ? this.core.analysisRecord(work.id)!.result.candidates.map((original) => {
          const c = corrections.find((c) => c.candidateKey === original.key);
          // A completion report cannot substitute for independent verification.
          const storedWithoutVerification =
            (!c || c.kind === 'restore') &&
            original.status === 'done' &&
            !original.completion?.verified?.length;
          const base = storedWithoutVerification
            ? {
                ...original,
                status: 'unclear' as const,
                nextAction: null,
                doneWhen: null,
                actionSource: null,
                reason: 'Completion was reported, but independent verification is not recorded.',
              }
            : original;
          const normalized =
            base.status === 'active'
              ? base
              : { ...base, nextAction: null, doneWhen: null, actionSource: null };
          if (!c || c.kind === 'restore' || c.kind === 'wrong-work') return normalized;
          if (c.kind === 'wrong-action')
            return {
              ...original,
              status: 'active' as const,
              nextAction: c.nextAction!,
              doneWhen: c.doneWhen!,
              actionSource: 'recorded' as const,
              reason: 'Next action corrected by you.',
            };
          return {
            ...original,
            status: c.kind,
            nextAction: null,
            doneWhen: null,
            actionSource: null,
            reason:
              c.kind === 'done'
                ? 'Marked complete by you.'
                : 'Paused by you. Restore when you want to resume.',
          };
        })
      : [];
    const viewError = this.errors.get(id) ?? null;
    const hasReadableBrief = candidates.length > 0;
    const state: AnalysisWork['state'] = this.running.has(id)
      ? 'checking'
      : viewError
        ? hasReadableBrief
          ? 'limited'
          : 'failed'
        : workspaceUnavailable || sourceAvailabilityBlocks
          ? hasReadableBrief
            ? 'limited'
            : 'unavailable'
          : !this.core.analysisRecord(work.id)?.result
            ? 'empty'
            : candidates.length
              ? stale
                ? 'limited'
                : 'ready'
              : 'empty';
    const stateDetail =
      state === 'checking'
        ? 'Checking the connected records and project.'
        : scopeChanged
          ? 'The goal or connected record scope changed. Check the selected records to prepare a brief for this goal; the previous action is no longer current.'
          : this.core.analysisRecord(work.id)?.result && storedResult?.success !== true
            ? 'The saved brief is incompatible. Check the selected records to prepare a current brief.'
            : !evidenceAccessible
              ? 'Some evidence in the saved brief is no longer accessible. Review the connected record scope before preparing a new brief.'
              : viewError
                ? hasReadableBrief
                  ? 'The latest connected records could not be checked. Your last confirmed brief is kept; try checking again or open the recorded conversation.'
                  : 'The latest connected records could not be checked. Review the connection and check again to prepare a current brief.'
                : workspaceUnavailable
                  ? hasReadableBrief
                    ? 'The project could not be checked. The last saved brief is shown, but continuing is blocked until it can be checked.'
                    : 'The project could not be checked yet. Connect a readable project before continuing.'
                  : partiallyUnavailable && !hasCheckedProjectBasis
                    ? hasReadableBrief
                      ? 'Some connected records are only partially available. The last saved brief is shown for review.'
                      : 'Some connected records are only partially available. Review the connection before preparing a brief.'
                    : unavailable && !hasCheckedProjectBasis
                      ? hasReadableBrief
                        ? 'Some connected records are unavailable. The last saved brief is shown for review.'
                        : 'Some connected records are unavailable. Review the connection before preparing a brief.'
                      : partiallyUnavailable || unavailable
                        ? 'This brief uses the checked project state. Some optional Codex context is incomplete or unavailable, so treat that context as a limitation rather than a blocker.'
                        : state === 'empty'
                          ? 'No return brief is available yet.'
                          : state === 'limited'
                            ? 'This brief needs to be checked again before continuing.'
                            : 'This brief is ready to use.';
    const limitations = [
      ...new Set([
        ...(workspace?.limitations ?? []),
        ...checkpoints.flatMap((checkpoint) => checkpoint.limitations),
        ...(partiallyUnavailable || unavailable
          ? ['Some optional Codex context is incomplete or unavailable.']
          : []),
        ...(viewError ? [viewError] : []),
      ]),
    ];
    const blockedActions =
      state === 'limited' || state === 'failed' || state === 'unavailable'
        ? ['Refresh the connected records before continuing.']
        : [];
    return {
      state,
      stateDetail,
      blockedActions,
      limitations,
      updatesAvailable,
      goalText:
        this.core.directionIntent(work.id)?.origin === 'user-input'
          ? this.core.directionIntent(work.id)!.text
          : null,
      goalOrigin:
        this.core.directionIntent(work.id)?.origin === 'user-input' ? 'user-input' : 'inferred',
      sessionCount: this.core
        .links(id)
        .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification').length,
      projectId: id,
      title:
        (this.core.directionIntent(work.id) &&
          this.core.directionIntent(work.id)!.origin !== 'user-input') ||
        /Referenced chats|## My request|<[^>]+>|\n/.test(connection.title)
          ? (connection.cwd.split('/').filter(Boolean).at(-1) ?? 'Connected work')
          : connection.title,
      cwd: connection.cwd,
      version,
      revision: work.revision,
      session: this.core.capabilities().session ?? null,
      navigation: this.core.capabilities().navigation,
      coordination: this.coordination(work, this.core.links(id), availableSources),
      coordinationChoices: this.core
        .links(id)
        .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification')
        .map((l) => ({ threadId: l.threadId, title: l.title })),
      continuation,
      candidates,
      stale,
      busy: this.running.has(id),
      error: viewError,
      generatedAt: this.core.analysisRecord(work.id)?.result?.generatedAt ?? null,
      outputLanguage: this.core.analysisRecord(work.id)?.result?.outputLanguage ?? 'en',
      correctedKeys: corrections.filter((c) => c.kind !== 'restore').map((c) => c.candidateKey),
      dismissedKeys: corrections.filter((c) => c.kind === 'wrong-work').map((c) => c.candidateKey),
      workspace,
      workspaceChanged,
    };
  }
  async discuss(id: string, value: unknown) {
    const input = taskDiscussionRequestSchema.parse(value);
    const view = this.view(id);
    if (input.version !== view.version)
      throw new DomainError(
        'REVISION_CONFLICT',
        'The project changed. Review the current task before continuing this discussion.',
        409,
      );
    const workspace = view.workspace ?? null;
    const workItem = this.core.repo.get('workItem', input.workItemId);
    if (!workItem || workItem.projectId !== id)
      throw new DomainError('NOT_FOUND', 'This task is no longer available in this project.', 404);
    const { work } = this.context(id);
    const nativeNow = this.core.now.resolve(id);
    const previousDiscussion = this.core.projectModel
      .view(id)
      .discussions.find((record) => record.workItemId === workItem.id);
    input.history = (previousDiscussion?.turns ?? [])
      .slice(-9)
      .map((turn) => ({
        question: turn.question,
        answer:
          turn.answer.items.map((item) => item.text).join('\n') ||
          turn.answer.unknowns.join('\n') ||
          'No answer was established.',
      }));
    const candidate: AnalysisCandidate = {
      key: workItem.id,
      goal: workItem.title,
      currentState:
        nativeNow.currentWorkId === workItem.id ? nativeNow.currentState : workItem.state,
      reason: 'Discuss the selected task without changing direction or accepting a result.',
      nextAction: nativeNow.currentWorkId === workItem.id ? (nativeNow.next?.text ?? null) : null,
      doneWhen: workItem.completionCondition ?? null,
      status: workItem.state === 'completed' ? 'done' : 'unclear',
      actionSource: null,
      threadId: PROJECT_INSPECTION_THREAD,
      prerequisites: [],
      evidence: [
        ...this.workspaceRecords(workspace).map((record) => ({
          revisionId: record.revisionId,
          quote: record.text.slice(0, 1200),
        })),
        ...this.core
          .sources(id)
          .map((record) => ({ revisionId: record.id, quote: record.text.slice(0, 1200) })),
      ],
    };
    if (!this.core.summary.answerQuestion || !this.core.summary.checkQuestion)
      throw new DomainError('CAPABILITY_UNSUPPORTED', 'Task discussion is unavailable.', 409);

    const candidateRefs = [
      ...candidate.evidence,
      ...Object.values(candidate.progress ?? {}).flatMap((items) => items ?? []),
      ...Object.values(candidate.completion ?? {}).flatMap((items) => items ?? []),
    ];
    const candidateRevisionIds = new Set(candidateRefs.map((item) => item.revisionId));
    const connected = this.core
      .sources(id)
      .filter(
        (source) => candidateRevisionIds.has(source.id) || source.threadId === candidate.threadId,
      );
    const workspaceRecords = this.workspaceRecords(view.workspace ?? null);
    const workspaceSources: SourceRevision[] = workspaceRecords.map((record) => ({
      id: record.revisionId,
      key: record.revisionId,
      provider: 'codex',
      host: 'local',
      threadId: record.threadId,
      turnId: record.revisionId,
      itemId: record.revisionId,
      kind: record.kind,
      actor: record.actor,
      text: record.text,
      contentHash: this.core.ids.hash(record.text),
      eventAt: record.at,
      observedAt: record.at,
      locator: { path: null, line: null, aliases: [] },
      turnStatus: 'observed',
      sourceStatus: null,
      pathKind: 'api',
      limitations: record.limitations,
    }));
    const byId = new Map<string, SourceRevision>();
    const ordered = [
      ...connected.filter((source) => candidateRevisionIds.has(source.id)),
      ...workspaceSources.filter((source) => candidateRevisionIds.has(source.id)),
      ...[...connected].reverse(),
      ...workspaceSources,
    ];
    for (const source of ordered) if (!byId.has(source.id)) byId.set(source.id, source);

    const sources: SourceRevision[] = [];
    const excerpts: QuestionContext['excerpts'] = [];
    let remaining = QUESTION_LIMITS.context;
    for (const source of byId.values()) {
      if (remaining <= 0) break;
      const text = source.text.slice(0, remaining);
      if (!text) continue;
      sources.push(source);
      excerpts.push({
        revisionId: source.id,
        threadId: source.threadId,
        turnId: source.turnId,
        itemId: source.itemId,
        actor: source.actor,
        kind: source.kind,
        eventAt: source.eventAt,
        start: 0,
        text,
      });
      remaining -= text.length;
    }
    if (!sources.length)
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'No current project records are available to answer this task question.',
        409,
      );

    const priorDiscussion = input.history.length
      ? [
          'Earlier discussion for reference only; it is not evidence:',
          ...input.history.flatMap((turn) => [
            `Question: ${turn.question}`,
            `Answer: ${turn.answer}`,
          ]),
        ].join('\n')
      : '';
    const anchor = [
      `Task: ${candidate.goal}`,
      `Current situation: ${candidate.currentState}`,
      `Why this work exists: ${candidate.reason}`,
      ...(candidate.nextAction ? [`Recorded next step: ${candidate.nextAction}`] : []),
      ...(candidate.doneWhen ? [`Completion condition: ${candidate.doneWhen}`] : []),
      ...candidate.prerequisites.map((item) => `Still uncertain: ${item}`),
      ...(priorDiscussion ? ['', priorDiscussion] : []),
    ].join('\n');
    const includedIds = new Set(sources.map((source) => source.id));
    const availableCandidateEvidenceCount = [...candidateRevisionIds].filter((revisionId) =>
      includedIds.has(revisionId),
    ).length;
    const context: QuestionContext = {
      responseLanguage: work.responseLanguage ?? 'en',
      anchorSourceRevisionIds: [...candidateRevisionIds].filter((revisionId) =>
        includedIds.has(revisionId),
      ),
      recordOrder: sources.map((source) => source.id),
      ...(candidate.doneWhen ? { anchorCondition: candidate.doneWhen } : {}),
      anchor,
      question: input.question,
      history: [],
      excerpts,
      limitations: [
        ...new Set([
          ...(view.workspace?.limitations ?? []),
          ...sources.flatMap((source) => source.limitations),
          ...(candidateRevisionIds.size > availableCandidateEvidenceCount
            ? ['Some records cited by the task are not available in the current discussion scope.']
            : []),
        ]),
      ].slice(0, 8),
    };
    const expectedVersion = view.version;
    const validate = () => {
      if (
        this.view(id).version !== expectedVersion ||
        (workItem && this.core.repo.get('workItem', workItem.id)?.updatedAt !== workItem.updatedAt)
      )
        throw new DomainError(
          'REVISION_CONFLICT',
          'The project changed while this answer was being prepared.',
          409,
        );
    };
    const generate = async (repair?: {
      candidate: unknown;
      diagnostic: QuestionCandidateError['diagnostic'];
      reason: string;
    }): Promise<QuestionAnswer> => {
      const raw = await this.core.summary.answerQuestion!(context, () => {}, validate, repair);
      return validateQuestionAnswer(raw, context, sources);
    };
    let answer: QuestionAnswer;
    try {
      answer = await generate();
    } catch (error) {
      if (!(error instanceof QuestionCandidateError)) throw error;
      answer = await generate({
        candidate: error.candidate,
        diagnostic: { ...error.diagnostic, repairs: 1 },
        reason: error.message,
      });
    }
    const assessment = await this.core.summary.checkQuestion!(context, answer, () => {}, validate);
    const checked = assessQuestionAnswer(answer, assessment, input.question);
    validate();
    if (workItem) {
      const basis = this.core.projects.latestObservation(id)?.semanticKey ?? expectedVersion;
      this.core.projectModel.syncDiscussion(id, {
        workItemId: workItem.id,
        basis,
        turns: [
          ...(previousDiscussion?.turns ?? []),
          {
            question: input.question,
            basis,
            answer: {
              items: checked.answer.items.map((item) => ({
                ...item,
                evidence: item.evidence.map((reference) => reference.revisionId),
              })),
              unknowns: checked.answer.unknowns,
              limitations: context.limitations,
            },
          },
        ].slice(-10),
      });
    }
    return { answer: checked.answer, limitations: context.limitations };
  }
  async refresh(
    id: string,
    outputLanguage: OutputLanguage = this.core.project(id).responseLanguage ?? 'en',
  ) {
    // Coalesce repeated explicit refresh requests. Route remounts and double
    // clicks must not queue a second model call for the same work snapshot.
    if (this.running.has(id)) return;
    const correctionBasis = this.core.ids.hash(this.core.analysisCorrections(id));
    this.running.add(id);
    this.errors.delete(id);
    this.core.events.changed(id, 'overview');
    try {
      // Capture the workspace before any asynchronous reads or model calls.
      // A project change during analysis must never be published as current.
      await this.core.collect(id);
      // Collect first so path/function clues from the connected records can
      // select implementation files beyond the default directory sample.
      const inspectionHints = this.inspectionHints(id, this.core.sources(id));
      const workspaceBefore = this.core.projectInspector
        ? await this.core.projects.observe(id, outputLanguage, inspectionHints, false)
        : null;
      const input = this.input(id, workspaceBefore),
        { sources, work, connection, version, scope, links } = input;
      const checkpoints = this.core.repo
        .list('checkpoint')
        .filter((c) => c.projectId === id && links.some((l) => l.threadId === c.threadId));
      if (!this.core.summary.generateAnalysis)
        throw new DomainError('CAPABILITY_UNSUPPORTED', 'Resume analysis is unavailable');
      // Codex is optional project context. A partial or failed conversation read
      // must not block an overview when checked project evidence is available.
      // Exclude failed/in-flight conversations from model input; partial reads
      // may contribute only the records that were actually collected.
      const readableThreadIds = new Set(
        checkpoints
          .filter((checkpoint) => ['checked', 'partial'].includes(checkpoint.status))
          .map((checkpoint) => checkpoint.threadId),
      );
      const readableLinks = links.filter((link) => readableThreadIds.has(link.threadId));
      // Bound input per linked session; omissions are explicit and cannot prove completion.
      // Reserve room for bounded project-file observations in the provider input.
      const budget = Math.floor(60000 / Math.max(1, readableLinks.length));
      const sessionRecords = readableLinks.flatMap((l) => {
        const rows = sources.filter((s) => s.threadId === l.threadId && s.actor !== 'system');
        const selected = new Map<string, (typeof rows)[number]>();
        const take = (items: typeof rows, allowance: number) => {
          let left = allowance;
          for (const s of [...items].reverse()) {
            if (left <= 0) break;
            const text = s.text.slice(-Math.min(6000, left));
            left -= text.length;
            selected.set(s.id, { ...s, text });
          }
        };
        // Keep actual requests and progress reports even when verbose tool output
        // fills the recent log. Reading StateCarry's own predictions is not work evidence.
        take(
          rows.filter((s) => s.actor === 'user' || s.actor === 'agent'),
          Math.floor(budget * 0.75),
        );
        take(
          rows.filter(
            (s) =>
              s.actor === 'tool' &&
              !/\/api\/v1\/resume|"(?:currentState|goalOrigin|updatesAvailable)"\s*:/.test(s.text),
          ),
          Math.floor(budget * 0.25),
        );
        return rows
          .filter((s) => selected.has(s.id))
          .map((s) => selected.get(s.id)!)
          .map((s) => ({
            revisionId: s.id,
            threadId: s.threadId,
            actor: s.actor,
            kind: s.kind,
            at: s.eventAt,
            text: s.text,
            limitations: s.limitations,
          }));
      });
      const workspaceRecords = this.workspaceRecords(workspaceBefore);
      const records = [...sessionRecords, ...workspaceRecords];
      if (!records.length)
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'No readable project or connected-record evidence is available for this overview.',
        );
      const overrides = (this.core.analysisCorrections(work.id) ?? []).filter(
        (c) => c.scope === scope,
      );
      const raw = await this.core.summary.generateAnalysis({
        outputLanguage,
        goal:
          this.core.directionIntent(work.id)?.origin === 'user-input'
            ? this.core.directionIntent(work.id)!.text
            : null,
        purpose: work.purposes.map((purpose) => purpose.text).join('\n') ?? null,
        cwd: connection.cwd,
        workspace: workspaceBefore,
        sessions: [
          ...readableLinks.map((l) => ({ id: l.threadId, title: l.title })),
          ...(workspaceRecords.length
            ? [{ id: PROJECT_INSPECTION_THREAD, title: 'Project inspection' }]
            : []),
        ],
        records,
        coverage: {
          note: 'Bounded recent excerpts, not full history. Absence cannot prove done. Do not assume every linked session has the same goal.',
          limitations: [
            ...checkpoints.flatMap((c) => c.limitations),
            ...checkpoints
              .filter((checkpoint) => checkpoint.status !== 'checked')
              .map(
                (checkpoint) =>
                  `Codex context ${checkpoint.threadId} is ${checkpoint.status}; only available project evidence may be used.`,
              ),
          ],
        },
        corrections: overrides,
        previousCandidates:
          this.core
            .analysisRecord(work.id)
            ?.result?.candidates.filter((c) => overrides.some((o) => o.candidateKey === c.key))
            .map((c) => ({ key: c.key, goal: c.goal })) ?? [],
      });
      const parsed = analysisResultSchema.parse(raw);
      if (new Set(parsed.candidates.map((c) => c.key)).size !== parsed.candidates.length)
        throw new Error('Duplicate candidate keys');
      for (const c of parsed.candidates) {
        const allowedThreadIds = new Set(records.map((record) => record.threadId));
        if (c.threadId !== PROJECT_INSPECTION_THREAD && !allowedThreadIds.has(c.threadId))
          throw new Error('Action location outside allowed sessions');
        const sourceById = new Map(records.map((record) => [record.revisionId, record]));
        // An implementation claim is useful only when the connected record
        // contains a file or tool observation.  User and agent messages are
        // retained as reported progress, but cannot be promoted to an
        // implementation fact merely because the model put them in that
        // bucket.
        if (c.progress?.implemented?.length) {
          const implementationNotice =
            outputLanguage === 'ko'
              ? '구현되었다는 보고는 있지만 파일 또는 도구 관찰로 확인되지 않았습니다.'
              : 'Implementation was reported, but no file or tool observation confirms it.';
          const implemented: typeof c.progress.implemented = [];
          const reported = [...(c.progress.reported ?? [])];
          for (const item of c.progress.implemented) {
            const record = sourceById.get(item.revisionId);
            if (record?.actor === 'tool') implemented.push(item);
            else if (
              !reported.some(
                (existing) =>
                  existing.revisionId === item.revisionId && existing.quote === item.quote,
              )
            )
              reported.push(item);
          }
          if (implemented.length !== c.progress.implemented.length) {
            c.progress = { ...c.progress, implemented, reported };
            if (!c.prerequisites.includes(implementationNotice))
              c.prerequisites = [implementationNotice, ...c.prerequisites].slice(0, 5);
          }
        }
        const evidence = [
          ...c.evidence,
          ...Object.values(c.progress ?? {}).flatMap((items) => items ?? []),
          ...Object.values(c.completion ?? {}).flatMap((items) => items ?? []),
        ];
        if (
          evidence.some(
            (e) => !records.some((s) => s.revisionId === e.revisionId && s.text.includes(e.quote)),
          )
        )
          throw new Error('Resume evidence does not match supplied records');
        // An independently verified result must come from an execution/tool
        // record. A user or agent report remains a report, even when phrased
        // as a confirmation.
        const verified = [...(c.progress?.verified ?? []), ...(c.completion?.verified ?? [])];
        if (
          verified.some((e) => {
            const record = records.find((s) => s.revisionId === e.revisionId);
            return record?.actor !== 'tool' || record.kind === 'fileObservation';
          })
        )
          throw new Error('Resume verification evidence must be a tool result');
        // A completion report is not an independently checked completion.
        // A report-only completion remains uncertain until independent evidence is available.
        if (c.status === 'done' && !c.completion?.verified?.length) {
          c.status = 'unclear';
          const completionReason =
            outputLanguage === 'ko'
              ? '완료되었다는 보고는 있지만 독립 검증 기록은 없습니다.'
              : 'Completion was reported, but independent verification is not recorded.';
          const completionSuffix =
            outputLanguage === 'ko'
              ? '독립 검증 기록은 아직 없습니다.'
              : 'Independent verification is not recorded.';
          c.reason = completionReason;
          if (c.currentState.length + completionSuffix.length + 1 <= 240)
            c.currentState = `${c.currentState.replace(/[.!?]\s*$/, '')}. ${completionSuffix}`;
          else c.currentState = completionReason;
        }
        if (c.status === 'active' && (!c.nextAction || !c.doneWhen || !c.actionSource))
          throw new Error('Active work needs an action, source and completion condition');
        if (c.status !== 'active') {
          c.nextAction = null;
          c.doneWhen = null;
          c.actionSource = null;
        }
      }
      const workspaceAfter = this.core.projectInspector
        ? await this.core.projects.observe(id, outputLanguage, inspectionHints, false)
        : null;
      const currentConnection = this.core.repo.get('connection', work.connectionId);
      if (
        !this.core.isConnectionActive(currentConnection) ||
        currentConnection.revision !== connection.revision
      )
        throw new Error('Connection changed while analysis was running. Refresh again.');
      if (
        this.core.projectInspector &&
        workspaceBefore?.status === 'checked' &&
        workspaceAfter?.status === 'checked' &&
        this.workspaceKey(workspaceBefore) !== this.workspaceKey(workspaceAfter)
      )
        throw new Error('Project changed while analysis was running. Refresh again.');
      if (
        this.input(id, workspaceAfter).scope !== scope ||
        this.core.ids.hash(this.core.analysisCorrections(this.core.project(id).id) ?? []) !==
          correctionBasis
      )
        throw new Error('Records or corrections changed during analysis. Refresh again.');
      this.core.storeAnalysis({
        id,
        projectId: id,
        result: {
          scope,
          version,
          outputLanguage,
          candidates: parsed.candidates,
          generatedAt: this.core.clock.now(),
          workspaceBefore,
          workspaceAfter,
        },
      });
    } catch (e) {
      this.errors.set(id, e instanceof Error ? e.message : String(e));
      this.core.reportError(e, 'project-analysis', id);
    } finally {
      this.running.delete(id);
      this.core.events.changed(id, 'overview');
    }
  }
  setGoal(id: string, raw: unknown) {
    const input = raw as { text?: unknown; version?: unknown };
    const { work, version } = this.input(id);
    if (input?.version !== version)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Records changed. Review the current work before editing its goal.',
        409,
      );
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 400)
      throw new DomainError('VALIDATION', 'Describe the intended result in 1–400 characters.');
    const nativeDirection = this.core.projectModel
      .directions(id)
      .find((direction) => direction.state === 'active' && direction.primary);
    if (nativeDirection?.text === text) return this.view(id);
    this.core.describeGoal(id, {
      requestId: this.core.ids.next(),
      expectedRevision: work.revision,
      payload: { text },
    });
    return this.view(id);
  }
  setCoordination(id: string, raw: unknown) {
    const input = raw as { threadId?: unknown; version?: unknown };
    const { work, version } = this.input(id);
    if (input?.version !== version)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Records changed. Review the current work before choosing a coordination conversation.',
        409,
      );
    const threadId =
      input.threadId === null || input.threadId === undefined
        ? null
        : typeof input.threadId === 'string'
          ? input.threadId.trim()
          : '';
    if (
      threadId &&
      !this.core
        .links(id)
        .some(
          (link) =>
            link.status === 'linked' &&
            link.role !== 'controlled-verification' &&
            link.threadId === threadId,
        )
    ) {
      throw new DomainError(
        'VALIDATION',
        'Choose a connected conversation before assigning overall progress.',
        400,
      );
    }
    // Repeated clicks with the same choice are idempotent and should not
    // invalidate an otherwise valid continuation.
    const mode = threadId ? ('selected' as const) : ('none' as const);
    if (work.coordinationThreadId === threadId && work.coordinationMode === mode)
      return this.view(id);
    // Coordination is part of the handoff context. Bump the work revision so
    // a continuation prepared before this choice cannot be sent afterward.
    this.core.repo.put('project', {
      ...work,
      revision: work.revision + 1,
      coordinationThreadId: threadId,
      coordinationMode: mode,
    });
    this.core.events.changed(id);
    return this.view(id);
  }
  correct(id: string, raw: unknown) {
    const correction = analysisCorrectionSchema.parse(raw),
      { work, version, scope } = this.input(id);
    const visible = this.view(id).candidates.some((c) => c.key === correction.candidateKey);
    // Dismissed candidates remain in the Core view for Presentation to hide.
    // Restoring must use that same validity gate, not arbitrary stored history.
    if (correction.version !== version || !visible)
      throw new DomainError(
        'REVISION_CONFLICT',
        'The candidate changed. Refresh before correcting.',
        409,
      );
    const kept = (this.core.analysisCorrections(work.id) ?? []).filter(
      (c) => c.candidateKey !== correction.candidateKey || c.scope !== scope,
    );
    // A correction changes the next action or candidate identity. Invalidate
    // prepared continuation requests that were based on the previous brief.
    this.core.repo.put('projectAnalysisControl', {
      id,
      projectId: id,
      corrections: [...kept, { ...correction, scope, at: this.core.clock.now() }],
    });
    this.core.repo.put('project', { ...work, revision: work.revision + 1 });
    const analysis = this.core.analysisRecord(id);
    if (analysis) this.core.storeAnalysis(analysis);
    this.core.events.changed(id);
    return this.view(id);
  }
}
