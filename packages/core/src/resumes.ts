import {
  DomainError,
  resumeResultSchema,
  resumeCorrectionSchema,
  workspaceSnapshotSchema,
  type ResumeWork,
  type ResumeCandidate,
  type WorkspaceSnapshot,
  type ResumeCoordination,
  type WorkspaceInspectionHints,
  type SourceRevision,
} from '@statecarry/contracts';
import type { StateCarry } from './service';
import { selectedRecords } from './goals';

const PROJECT_INSPECTION_THREAD = 'project-inspection';

export class Resumes {
  private running = new Set<string>();
  private errors = new Map<string, string>();
  constructor(private core: StateCarry) {}
  isRunning(id: string): boolean {
    return this.running.has(id);
  }
  forget(id: string): void {
    this.errors.delete(id);
  }
  /** Only explicit decisions on candidates still visible in the same scope count. */
  decisionKeys(id: string, candidates: ResumeCandidate[]) {
    const { work, scope } = this.context(id);
    const visible = new Set(candidates.map((candidate) => candidate.key));
    const decisions = (work.resumeOverrides ?? []).filter(
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
    const work = this.core.work(id),
      connection = this.core.repo.get('connection', work.projectId);
    if (!this.core.isConnectionActive(connection))
      throw new DomainError('NOT_FOUND', 'Connection not found', 404);
    const storedHints =
      hints ??
      work.resume?.workspaceAfter?.inspection?.hints ??
      work.resume?.workspaceBefore?.inspection?.hints;
    return this.core.inspectWorkspace(connection.cwd, storedHints);
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
      files: ((value.files?.length ? value.files : (value.fileObservations ?? value.files)) ?? [])
        .map((file) => ({ path: file.path, hash: file.hash, size: file.size ?? null }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    });
  }

  /** Extract bounded file/function clues from connected records before inspection. */
  private inspectionHints(id: string, sources: SourceRevision[]): WorkspaceInspectionHints {
    const work = this.core.work(id);
    const texts = [work.goal?.text ?? '', ...sources.map((source) => source.text)].filter(Boolean);
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
    return {
      paths: [...paths].slice(0, 120),
      symbols: [...symbols].slice(0, 120),
      terms: [...terms].slice(0, 120),
    };
  }
  /** Convert bounded project inspection into citable tool records for analysis. */
  private workspaceRecords(workspace: WorkspaceSnapshot | null) {
    const files = workspace?.files?.length
      ? workspace.files
      : (workspace?.fileObservations ?? workspace?.files ?? []);
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
    if (workspace.status === 'checked') {
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
    const work = this.core.work(id);
    for (const snapshot of [work.resume?.workspaceAfter, work.resume?.workspaceBefore]) {
      const record = this.workspaceRecords(snapshot ?? null).find(
        (item) => item.revisionId === revisionId,
      );
      if (record) return record.text;
    }
    return null;
  }
  private context(id: string) {
    const work = this.core.work(id),
      connection = this.core.connection(work.projectId);
    const links = this.core
      .links(id)
      .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification');
    const scope = this.core.ids.hash([
      connection.cwd,
      connection.startTurnIds,
      connection.recordRanges,
      connection.discoveryScope,
      links.map((l) => l.threadId).sort(),
      work.goal,
      ...(work.projectProfile?.purpose ? [work.projectProfile.purpose] : []),
    ]);
    return { work, connection, links, scope };
  }
  /** A temporary read failure does not revoke evidence already captured in
   * this exact goal/range. Only cited immutable revisions may be retained. */
  retainsEvidence(id: string, source: SourceRevision): boolean {
    const { work, connection, scope } = this.context(id);
    if (!work.resume || work.resume.scope !== scope) return false;
    const checkpoint = this.core.repo
      .list('checkpoint')
      .find((item) => item.workId === id && item.threadId === source.threadId);
    if (
      !checkpoint ||
      checkpoint.scopeVersion !== connection.revision ||
      !['partial', 'failed', 'reading'].includes(checkpoint.status)
    )
      return false;
    const parsed = resumeResultSchema.safeParse({ candidates: work.resume.candidates });
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
    const sources = links.flatMap((link) => {
      const records = this.core.sources(id).filter((source) => source.threadId === link.threadId);
      // An empty/failed checkpoint grants no new records. Preserve its failure
      // state in view() instead of throwing while trying to locate a boundary.
      return records.length ? selectedRecords(connection, link.threadId, records) : [];
    });
    const version = this.core.ids.hash([
      scope,
      work.goal,
      sources.map((s) => s.id),
      this.workspaceKey(observedWorkspace),
      'resume-v0-4',
    ]);
    return { work, connection, links, sources, scope, version, workspace: observedWorkspace };
  }
  private coordination(
    work: ReturnType<StateCarry['work']>,
    links: ReturnType<StateCarry['links']>,
    sources: ReturnType<StateCarry['sources']>,
  ): ResumeCoordination {
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
  list(): ResumeWork[] {
    return this.core.repo
      .list('work')
      .filter((w) => this.core.isConnectionActive(this.core.repo.get('connection', w.projectId)))
      .map((w) => {
        try {
          return this.view(w.id);
        } catch (e) {
          return {
            updatesAvailable: false,
            goalText: null,
            goalOrigin: 'inferred' as const,
            sessionCount: 0,
            workId: w.id,
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
  view(id: string): ResumeWork {
    const { work, connection, version, scope, sources, workspace } = this.input(id);
    const checkpoints = this.core.repo.list('checkpoint').filter((c) => c.workId === id);
    const unavailable = checkpoints.some((c) => c.status === 'failed');
    const partiallyUnavailable = checkpoints.some(
      (c) => c.status === 'partial' || c.status === 'reading',
    );
    const storedWorkspace = work.resume?.workspaceAfter;
    const storedWorkspaceBefore = work.resume?.workspaceBefore;
    const storedWorkspaceValid =
      !!storedWorkspace && workspaceSnapshotSchema.safeParse(storedWorkspace).success;
    const storedWorkspaceBeforeValid =
      !!storedWorkspaceBefore && workspaceSnapshotSchema.safeParse(storedWorkspaceBefore).success;
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
    const storedResult = work.resume
      ? resumeResultSchema.safeParse({ candidates: work.resume.candidates })
      : null;
    const scopeChanged = !!work.resume && work.resume.scope !== scope;
    const structurallyStale =
      !work.resume ||
      scopeChanged ||
      unavailable ||
      partiallyUnavailable ||
      workspaceUnavailable ||
      workspaceChanged ||
      storedResult?.success !== true;
    // Every quote that can explain progress or completion must still resolve
    // to an accessible record. Checking only the candidate's primary evidence
    // would leave an old verification quote visible after its source was
    // removed or its conversation was unlinked.
    const evidenceAccessible =
      !work.resume ||
      storedResult?.success !== true ||
      !work.resume.candidates.some((c) => {
        const evidence = [
          ...c.evidence,
          ...Object.values(c.progress ?? {}).flatMap((items) => items ?? []),
          ...Object.values(c.completion ?? {}).flatMap((items) => items ?? []),
        ];
        return evidence.some((e) => {
          const text =
            this.core.accessibleSource(id, e.revisionId)?.text ??
            this.storedWorkspaceEvidence(id, e.revisionId);
          return !text?.includes(e.quote);
        });
      });
    const stale = structurallyStale || !evidenceAccessible;
    const updatesAvailable = !stale && work.resume?.version !== version;
    const continuation =
      this.core.repo
        .list('continuation')
        .filter((item) => item.workId === id)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .at(-1) ?? null;
    const corrections = (work.resumeOverrides ?? []).filter((c) => c.scope === scope);
    // A failed check may retain a readable brief for this same goal and scope.
    // It never overrides a changed goal, revoked evidence or invalid stored data.
    const preserveLastKnown =
      !!work.resume &&
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
      ? work.resume!.candidates.map((original) => {
          const c = corrections.find((c) => c.candidateKey === original.key);
          // Resume briefs written before completion verification was introduced
          // must not be presented as finished work after a restart. Keep the
          // state unresolved until a fresh analysis supplies independent proof.
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
    const state: ResumeWork['state'] = this.running.has(id)
      ? 'checking'
      : partiallyUnavailable
        ? hasReadableBrief
          ? 'limited'
          : 'unavailable'
        : viewError
          ? hasReadableBrief
            ? 'limited'
            : 'failed'
          : workspaceUnavailable || unavailable
            ? hasReadableBrief
              ? 'limited'
              : 'unavailable'
            : !work.resume
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
          : work.resume && storedResult?.success !== true
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
                  : partiallyUnavailable
                    ? hasReadableBrief
                      ? 'Some connected records are only partially available. The last saved brief is shown for review.'
                      : 'Some connected records are only partially available. Review the connection before preparing a brief.'
                    : unavailable
                      ? hasReadableBrief
                        ? 'Some connected records are unavailable. The last saved brief is shown for review.'
                        : 'Some connected records are unavailable. Review the connection before preparing a brief.'
                      : state === 'empty'
                        ? 'No return brief is available yet.'
                        : state === 'limited'
                          ? 'This brief needs to be checked again before continuing.'
                          : 'This brief is ready to use.';
    const limitations = [
      ...new Set([...(workspace?.limitations ?? []), ...(viewError ? [viewError] : [])]),
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
      goalText: work.goal?.origin === 'user-input' ? work.goal.text : null,
      goalOrigin: work.goal?.origin === 'user-input' ? 'user-input' : 'inferred',
      sessionCount: this.core
        .links(id)
        .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification').length,
      workId: id,
      title:
        (work.goal && work.goal.origin !== 'user-input') ||
        /Referenced chats|## My request|<[^>]+>|\n/.test(connection.title)
          ? (connection.cwd.split('/').filter(Boolean).at(-1) ?? 'Connected work')
          : connection.title,
      cwd: connection.cwd,
      version,
      revision: work.revision,
      session: this.core.capabilities().session ?? null,
      navigation: this.core.capabilities().navigation,
      coordination: this.coordination(work, this.core.links(id), this.core.sources(id)),
      coordinationChoices: this.core
        .links(id)
        .filter((l) => l.status === 'linked' && l.role !== 'controlled-verification')
        .map((l) => ({ threadId: l.threadId, title: l.title })),
      continuation,
      candidates,
      stale,
      busy: this.running.has(id),
      error: viewError,
      generatedAt: work.resume?.generatedAt ?? null,
      correctedKeys: corrections.filter((c) => c.kind !== 'restore').map((c) => c.candidateKey),
      dismissedKeys: corrections.filter((c) => c.kind === 'wrong-work').map((c) => c.candidateKey),
      workspace,
      workspaceChanged,
    };
  }
  async refresh(id: string) {
    // Coalesce repeated explicit refresh requests. Route remounts and double
    // clicks must not queue a second model call for the same work snapshot.
    if (this.running.has(id)) return;
    this.running.add(id);
    this.errors.delete(id);
    this.core.events.changed(id);
    try {
      // Capture the workspace before any asynchronous reads or model calls.
      // A project change during analysis must never be published as current.
      await this.core.collect(id);
      // Collect first so path/function clues from the connected records can
      // select implementation files beyond the default directory sample.
      const inspectionHints = this.inspectionHints(id, this.core.sources(id));
      const workspaceBefore = this.workspace(id, inspectionHints);
      const input = this.input(id, workspaceBefore),
        { sources, work, connection, version, scope, links } = input;
      const checkpoints = this.core.repo
        .list('checkpoint')
        .filter((c) => c.workId === id && links.some((l) => l.threadId === c.threadId));
      // A partial read cannot support a new judgment. Keep the previous brief
      // visible as a last-known snapshot and require a complete recheck before
      // replacing it with a new candidate.
      if (
        (links.length > 0 && !sources.length) ||
        checkpoints.some((c) => ['failed', 'partial', 'reading'].includes(c.status))
      ) {
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'Connected records are only partially available. The last checked brief was kept.',
        );
      }
      if (!this.core.summary.generateResume)
        throw new DomainError('CAPABILITY_UNSUPPORTED', 'Resume analysis is unavailable');
      // Bound input per linked session; omissions are explicit and cannot prove completion.
      // Reserve room for bounded project-file observations in the provider input.
      const budget = Math.floor(60000 / Math.max(1, links.length));
      const sessionRecords = links.flatMap((l) => {
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
      const overrides = (work.resumeOverrides ?? []).filter((c) => c.scope === scope);
      const raw = await this.core.summary.generateResume({
        goal: work.goal?.origin === 'user-input' ? work.goal.text : null,
        purpose: work.projectProfile?.purpose ?? null,
        cwd: connection.cwd,
        workspace: workspaceBefore,
        sessions: [
          ...links.map((l) => ({ id: l.threadId, title: l.title })),
          ...(workspaceRecords.length
            ? [{ id: PROJECT_INSPECTION_THREAD, title: 'Project inspection' }]
            : []),
        ],
        records,
        coverage: {
          note: 'Bounded recent excerpts, not full history. Absence cannot prove done. Do not assume every linked session has the same goal.',
          limitations: checkpoints.flatMap((c) => c.limitations),
        },
        corrections: overrides,
        previousCandidates:
          work.resume?.candidates
            .filter((c) => overrides.some((o) => o.candidateKey === c.key))
            .map((c) => ({ key: c.key, goal: c.goal })) ?? [],
      });
      const parsed = resumeResultSchema.parse(raw);
      if (new Set(parsed.candidates.map((c) => c.key)).size !== parsed.candidates.length)
        throw new Error('Duplicate candidate keys');
      for (const c of parsed.candidates) {
        if (
          c.threadId !== PROJECT_INSPECTION_THREAD &&
          !links.some((l) => l.threadId === c.threadId)
        )
          throw new Error('Action location outside allowed sessions');
        const sourceById = new Map(records.map((record) => [record.revisionId, record]));
        // An implementation claim is useful only when the connected record
        // contains a file or tool observation.  User and agent messages are
        // retained as reported progress, but cannot be promoted to an
        // implementation fact merely because the model put them in that
        // bucket.
        if (c.progress?.implemented?.length) {
          const implementationNotice =
            'Implementation was reported, but no file or tool observation confirms it.';
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
        // Newer providers include the completion attribution object; retain
        // legacy candidates that predate it, while making an explicit,
        // report-only completion visibly uncertain instead of presenting it
        // as finished work.
        if (c.status === 'done' && !c.completion?.verified?.length) {
          c.status = 'unclear';
          c.reason = 'Completion was reported, but independent verification is not recorded.';
          if (c.currentState.length + 61 <= 240)
            c.currentState = `${c.currentState.replace(/[.!?]\s*$/, '')}. Independent verification is not recorded.`;
          else
            c.currentState =
              'Completion was reported, but independent verification is not recorded.';
        }
        if (c.status === 'active' && (!c.nextAction || !c.doneWhen || !c.actionSource))
          throw new Error('Active work needs an action, source and completion condition');
        if (checkpoints.some((p) => p.status === 'partial'))
          c.prerequisites.unshift(
            'Some source records are compressed or incomplete. Confirm this step against the available evidence.',
          );
        if (c.status !== 'active') {
          c.nextAction = null;
          c.doneWhen = null;
          c.actionSource = null;
        }
      }
      const workspaceAfter = this.workspace(id, inspectionHints);
      const currentConnection = this.core.repo.get('connection', work.projectId);
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
        this.core.ids.hash(this.core.work(id).resumeOverrides ?? []) !==
          this.core.ids.hash(work.resumeOverrides ?? [])
      )
        throw new Error('Records or corrections changed during analysis. Refresh again.');
      this.core.repo.put('work', {
        ...this.core.work(id),
        resume: {
          scope,
          version,
          candidates: parsed.candidates,
          generatedAt: this.core.clock.now(),
          workspaceBefore,
          workspaceAfter,
        },
      });
    } catch (e) {
      this.errors.set(id, e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(id);
      this.core.events.changed(id);
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
    this.core.repo.transaction(() => {
      // Older registrations acquire their independent project identity on this
      // explicit edit, never on a read. Preserve the legacy goal-intent endpoint.
      if (!work.projectProfile) {
        const connection = this.core.connection(work.projectId);
        this.core.repo.put('work', {
          ...work,
          projectProfile: { title: connection.title, purpose: '', focused: false },
        });
      }
      this.core.describeGoal(id, {
        requestId: this.core.ids.next(),
        expectedRevision: work.revision,
        payload: { text },
      });
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
    this.core.repo.put('work', {
      ...work,
      revision: work.revision + 1,
      coordinationThreadId: threadId,
      coordinationMode: mode,
    });
    this.core.events.changed(id);
    return this.view(id);
  }
  correct(id: string, raw: unknown) {
    const correction = resumeCorrectionSchema.parse(raw),
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
    const kept = (work.resumeOverrides ?? []).filter(
      (c) => c.candidateKey !== correction.candidateKey || c.scope !== scope,
    );
    // A correction changes the next action or candidate identity. Invalidate
    // prepared continuation requests that were based on the previous brief.
    this.core.repo.put('work', {
      ...work,
      revision: work.revision + 1,
      resumeOverrides: [...kept, { ...correction, scope, at: this.core.clock.now() }],
    });
    this.core.events.changed(id);
    return this.view(id);
  }
}
