import { useEffect, useRef, useState } from 'react';
import {
  continuationPayload,
  resumeHandoffText,
  presentResumeWork,
  resumeStateLabel,
  resumeWorkStatus,
  type ResumeGateway,
  type ResumeWork,
  type ResumeCandidate,
  type ResumeCorrection,
  type Continuation,
  type ResumeMemory,
  type SavedResumeEdits,
} from '@statecarry/presentation';
import './resume.css';
import { AppSidebar } from './AppSidebar';
import { ResumeBrief } from './ResumeBrief';

function EvidenceList({
  workId,
  items,
}: {
  workId: string;
  items: { revisionId: string; quote: string }[];
}) {
  return (
    <>
      {items.map((item, index) => (
        <blockquote key={`${item.revisionId}:${index}`}>
          <p>{item.quote}</p>
          <a
            href={`/api/v1/work-contexts/${encodeURIComponent(workId)}/evidence/${encodeURIComponent(item.revisionId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Read supporting record
          </a>
        </blockquote>
      ))}
    </>
  );
}

function ProgressDetails({ workId, candidate }: { workId: string; candidate: ResumeCandidate }) {
  const progress = candidate.progress;
  const completion = candidate.completion;
  const groups = [
    ['Reported progress', progress?.reported ?? []],
    ['Implementation progress', progress?.implemented ?? []],
    ['Verified progress', progress?.verified ?? []],
    ['Reported completion', completion?.reported ?? []],
    ['Verified completion', completion?.verified ?? []],
  ] as const;
  if (!groups.some(([, items]) => items.length)) return null;
  return (
    <details className="resume-progress">
      <summary>What has been completed so far</summary>
      {groups.map(([label, items]) =>
        items.length ? (
          <section key={label}>
            <h3>{label}</h3>
            <EvidenceList workId={workId} items={items} />
          </section>
        ) : null,
      )}
      <p className="small muted">
        A report shows what was recorded. Verification is shown separately when a check was
        recorded.
      </p>
    </details>
  );
}

function ObservedFiles({ workspace }: { workspace: NonNullable<ResumeWork['workspace']> }) {
  const files = workspace.files ?? workspace.fileObservations ?? [];
  if (!files.length) return null;
  return (
    <details className="resume-file-details">
      <summary>Observed project files · {files.length}</summary>
      <p className="small muted">
        Read-only bounded observations used to detect changes. Previews are intentionally short.
      </p>
      <ul className="resume-file-list">
        {files.map((file) => (
          <li key={`${file.path}:${file.hash}`}>
            <code>{file.path}</code>
            <span className="small muted">
              {' '}
              · {file.status === 'unavailable' ? 'Could not read' : 'Read'} · SHA-256{' '}
              {file.hash.slice(0, 12)}
            </span>
            {file.preview ? (
              <pre>{file.preview}</pre>
            ) : (
              <p className="small uncertainty">{file.limitation ?? 'No preview available.'}</p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function friendlyLimitation(value: string): string {
  if (/failed to fetch|networkerror|network request failed|load failed|^typeerror\b/i.test(value))
    return 'The local server could not be reached while checking this work.';
  if (/workspace state could not be checked|git\s+-C|not a git repository/i.test(value))
    return 'The current project state could not be confirmed.';
  if (/file observation was limited|read limit|source files/i.test(value))
    return 'Only part of the project files could be checked.';
  if (/could not read|unavailable|partial|incomplete|coverage/i.test(value))
    return 'Some connected records or project files could not be fully checked.';
  return value.length > 180 ? 'Some connected records could not be fully checked.' : value;
}

function FriendlyLimitations({ values }: { values: string[] }) {
  return (
    <>
      {[...new Set(values.map(friendlyLimitation))].map((value) => (
        <p className="small uncertainty" key={value}>
          {value}
        </p>
      ))}
    </>
  );
}

function TechnicalLimitations({ values }: { values: string[] }) {
  if (!values.length) return null;
  return (
    <details>
      <summary>Project check details</summary>
      {values.map((value) => (
        <p className="small muted" key={value}>
          {value}
        </p>
      ))}
    </details>
  );
}

function WorkspaceStatus({ work }: { work: ResumeWork }) {
  const workspace = work.workspace;
  if (!workspace || workspace.status !== 'checked')
    return (
      <section className="resume-workspace changed" aria-label="Project state">
        <strong>Project state unavailable</strong>
        <p>Branch, code version, and uncommitted changes could not be confirmed for this brief.</p>
        <FriendlyLimitations values={workspace?.limitations ?? []} />
        <p className="small muted">
          Refresh the records before treating the next action as current.
        </p>
        {workspace ? (
          <>
            <TechnicalLimitations values={workspace.limitations} />
            <ObservedFiles workspace={workspace} />
          </>
        ) : null}
      </section>
    );
  const revision = workspace.commit?.trim() ? workspace.commit.slice(0, 12) : 'Unavailable';
  const branch = workspace.branch?.trim() || 'Unavailable';
  const changes =
    workspace.dirty === null
      ? 'Change status unknown'
      : workspace.dirty
        ? 'Uncommitted changes present'
        : 'No uncommitted changes reported';
  return (
    <section
      className={`resume-workspace ${work.workspaceChanged ? 'changed' : ''}`}
      aria-label="Project state"
    >
      <strong>
        {work.workspaceChanged ? 'Project changed since this brief' : 'Project state checked'}
      </strong>
      <p>
        {work.workspaceChanged
          ? 'The folder changed while this brief was being prepared. Recheck it before acting.'
          : 'The connected project was checked while preparing this brief.'}
      </p>
      <FriendlyLimitations values={workspace.limitations} />
      <details>
        <summary>Project details</summary>
        <p>Folder · {workspace.cwd}</p>
        <p>
          Branch · {branch} · {changes}
        </p>
        <p className="small muted">Checked {workspace.checkedAt}</p>
        <p>Git root · {workspace.root ?? 'Unavailable'}</p>
        <p>Commit reference · {revision}</p>
        <TechnicalLimitations values={workspace.limitations} />
        <ObservedFiles workspace={workspace} />
      </details>
    </section>
  );
}

type ResumeState = 'ready' | 'checking' | 'limited' | 'empty' | 'unavailable' | 'failed';

function friendlyError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  if (
    /failed to fetch|networkerror|network request failed|load failed|econnrefused|^typeerror\b/i.test(
      raw,
    )
  ) {
    return 'StateCarry could not reach the local server. Check that it is running, then try again.';
  }
  if (!raw.trim() || raw.length > 240)
    return 'The latest request could not be completed. Try again or review the connection.';
  return raw;
}

function stateFor(work: ResumeWork, candidateCount = work.candidates.length): ResumeState {
  const state = resumeWorkStatus(work).state;
  return state === 'ready' && candidateCount === 0 ? 'empty' : state;
}

function stateLabel(state: ResumeState): string {
  return resumeStateLabel(state);
}

function stateDescriptionFor(work: ResumeWork): string {
  return friendlyError(resumeWorkStatus(work).description);
}

function stateSituationFor(work: ResumeWork, state: ResumeState): string | null {
  // Core may already provide a complete explanation for an unavailable
  // workspace. Keep one clear sentence in that case and leave the action
  // buttons to carry the recovery path.
  if (
    work.stateDetail?.trim() &&
    !work.busy &&
    !work.error &&
    !work.workspaceChanged &&
    !work.updatesAvailable &&
    work.workspace?.status !== 'checked'
  )
    return null;
  return work.busy
    ? 'Checking the connected records. You can leave this page open.'
    : work.error
      ? friendlyError(work.error)
      : work.workspaceChanged
        ? 'The project changed since this brief. Check the current workspace before acting.'
        : work.updatesAvailable
          ? 'New records arrived after this brief. Recheck before you act.'
          : work.workspace && work.workspace.status !== 'checked'
            ? 'The project could not be fully checked. The last brief is preserved, but confirm the current folder before acting.'
            : state === 'empty'
              ? 'No candidate is available yet. Recheck the connected records or review the connection scope.'
              : 'The latest records need a fresh check before acting.';
}

function continuationStatusLabel(continuation: Continuation): string {
  switch (continuation.state) {
    case 'prepared':
      return 'Context is ready to send. Review the current step before sending it.';
    case 'dispatching':
      return 'Sending the context to the new Codex session…';
    case 'sent':
      return 'Context sent. Check the new Codex session before continuing.';
    case 'opening':
      return 'Opening the new Codex session…';
    case 'opened':
      return 'New Codex session opened. Confirm its context before acting.';
    case 'result-unknown':
      return 'The send result is unknown. Check the request before trying again.';
    case 'failed':
      return `The send failed: ${friendlyError(continuation.error ?? 'unknown error')}`;
  }
}

type ResumeError = { message: string; detail: string };
type GoalDraft = { text: string; version: string };
type ActionDraft = { action: string; done: string; version: string };
type WorkEdits = {
  selectedKey?: string;
  goalDraft: GoalDraft | null;
  actionDrafts: Map<string, ActionDraft>;
  saving: boolean;
  error: ResumeError | null;
  correctionMessage: string;
  copyMessage: string;
  coordinationMessage: string;
  coordinationBusy: boolean;
  expanded: string[];
  scroll: number;
};

function emptyWorkEdits(): WorkEdits {
  return {
    goalDraft: null,
    actionDrafts: new Map(),
    saving: false,
    error: null,
    correctionMessage: '',
    copyMessage: '',
    coordinationMessage: '',
    coordinationBusy: false,
    expanded: [],
    scroll: 0,
  };
}

function resumeError(value: unknown): ResumeError {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  const message = friendlyError(value);
  return { message, detail: raw && message !== raw ? raw : '' };
}

export function Resume({
  gateway,
  workId,
  memory,
  viewCache,
}: {
  gateway: ResumeGateway;
  workId?: string;
  memory?: ResumeMemory;
  /** Last displayed server rows for this tab only; never persisted as authority. */
  viewCache?: { works: ResumeWork[] };
}) {
  const [works, setWorks] = useState<ResumeWork[]>(() => viewCache?.works ?? []),
    [loaded, setLoaded] = useState(() => !!viewCache?.works.length),
    [listError, setListError] = useState<ResumeError | null>(null);
  useEffect(() => {
    if (viewCache) viewCache.works = works;
  }, [viewCache, works]);
  const [transport, setTransport] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  );
  const [storageError, setStorageError] = useState(false);
  const initialEdits = useRef(new Map<string, WorkEdits>());
  const storageReadFailed = useRef(false);
  const readEdits = (id: string) => {
    if (!initialEdits.current.has(id)) {
      let saved: SavedResumeEdits | null = null;
      try {
        saved = memory?.read(id) ?? null;
      } catch {
        storageReadFailed.current = true;
      }
      initialEdits.current.set(
        id,
        saved
          ? { ...emptyWorkEdits(), ...saved, actionDrafts: new Map(saved.actionDrafts) }
          : emptyWorkEdits(),
      );
    }
    return initialEdits.current.get(id)!;
  };
  // Keep edits above the candidate card: switching work must not move or discard input.
  const [workEdits, setWorkEdits] = useState(() => new Map<string, WorkEdits>());
  const updateEdits = (id: string | undefined, update: (previous: WorkEdits) => WorkEdits) => {
    if (!id) return;
    setWorkEdits((previous) => {
      const edits = previous.get(id) ?? readEdits(id);
      const next = update(edits);
      return next === edits ? previous : new Map(previous).set(id, next);
    });
  };
  // A return page must not silently pick the first connected work. One work is
  // safe to open directly; multiple works require an explicit choice.
  const storedWork =
    works.find((w) => w.workId === workId) ??
    (!workId && works.length === 1 ? works[0] : undefined);
  // Connection status never upgrades a saved brief's authority. Keep the text
  // readable while a reconnect GET confirms current scope and action validity.
  const focusedWork =
    storedWork && (transport !== 'connected' || listError)
      ? {
          ...storedWork,
          busy: false,
          state: 'limited' as const,
          blockedActions: ['Confirm the local connection and current records before continuing.'],
          stateDetail:
            'The saved brief is available for review. Its current state is not confirmed while the local server is disconnected or reconnecting.',
        }
      : storedWork;
  const focusedId = focusedWork?.workId ?? workId;
  const edits = focusedId ? (workEdits.get(focusedId) ?? readEdits(focusedId)) : emptyWorkEdits();
  const editsRef = useRef(workEdits);
  editsRef.current = workEdits;
  const storedValues = useRef(new Map<string, string>());
  const persist = (id: string, value: WorkEdits) => {
    if (!memory) return;
    const saved: SavedResumeEdits = {
      selectedKey: value.selectedKey,
      goalDraft: value.goalDraft,
      actionDrafts: [...value.actionDrafts],
      expanded: value.expanded,
      scroll: value.scroll,
    };
    const serialized = JSON.stringify(saved);
    if (storedValues.current.get(id) === serialized) return;
    try {
      memory.write(id, saved);
      storedValues.current.set(id, serialized);
    } catch {
      setStorageError(true);
    }
  };
  useEffect(() => {
    if (storageReadFailed.current) setStorageError(true);
    for (const [id, value] of workEdits) persist(id, value);
  }, [workEdits, memory, focusedId]);
  useEffect(() => {
    if (!memory || !focusedId || !loaded) return;
    const id = focusedId;
    const saved = editsRef.current.get(id) ?? readEdits(id);
    window.scrollTo(0, saved.scroll);
    let scroll: number | undefined;
    const record = () => {
      scroll = window.scrollY;
      updateEdits(id, (previous) =>
        previous.scroll === scroll ? previous : { ...previous, scroll: scroll! },
      );
    };
    const flush = () => {
      if (scroll === undefined) return;
      const value = editsRef.current.get(id) ?? readEdits(id);
      const next = { ...value, scroll };
      initialEdits.current.set(id, next);
      persist(id, next);
    };
    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('scroll', record);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [memory, focusedId, loaded]);
  const { saving, correctionMessage, copyMessage, coordinationMessage, coordinationBusy } = edits;
  const goalEditing = !!edits.goalDraft;
  const goalText = edits.goalDraft?.text ?? '';
  const panelProps = (key: string, forceOpen = false) => ({
    open: forceOpen || edits.expanded.includes(key),
    onToggle: (event: import('react').SyntheticEvent<HTMLDetailsElement>) => {
      if (event.target !== event.currentTarget) return;
      const open = event.currentTarget.open;
      updateEdits(focusedId, (previous) =>
        previous.expanded.includes(key) === open
          ? previous
          : {
              ...previous,
              expanded: open
                ? [...previous.expanded, key]
                : previous.expanded.filter((item) => item !== key),
            },
      );
    },
  });
  const visibleError = edits.error ?? listError;
  const error = visibleError?.message ?? '';
  const errorDetail = visibleError?.detail ?? '';
  const reportError = (value: unknown, id = focusedId) => {
    if (id) updateEdits(id, (previous) => ({ ...previous, error: resumeError(value) }));
    else setListError(resumeError(value));
  };
  const setError = (message: string) => reportError(message);
  const clearError = () => {
    updateEdits(focusedId, (previous) => ({ ...previous, error: null }));
    setListError(null);
  };
  const setCopyMessage = (message: string) =>
    updateEdits(focusedId, (previous) => ({ ...previous, copyMessage: message }));
  const setCoordinationMessage = (message: string) =>
    updateEdits(focusedId, (previous) => ({ ...previous, coordinationMessage: message }));
  const setCoordinationBusy = (busy: boolean) =>
    updateEdits(focusedId, (previous) => ({ ...previous, coordinationBusy: busy }));
  const refreshInFlight = useRef(new Set<string>());
  const saveInFlight = useRef(new Set<string>());
  const currentIdRef = useRef<string | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null),
    [continuationBusy, setContinuationBusy] = useState(false);
  const readSequence = useRef(0);
  // Seed restored IDs so the first authoritative full list can remove them.
  const appliedReads = useRef(
    new Map<string, number>((viewCache?.works ?? []).map((row) => [row.workId, 0])),
  );
  const applyRows = (rows: ResumeWork[], sequence: number, ownerId?: string) => {
    const incoming = new Map(rows.map((row) => [row.workId, row]));
    const ids = ownerId
      ? [ownerId]
      : [...new Set([...appliedReads.current.keys(), ...incoming.keys()])];
    const accepted = ids.filter((id) => sequence > (appliedReads.current.get(id) ?? 0));
    for (const id of accepted) appliedReads.current.set(id, sequence);
    setWorks((previous) => {
      const next = new Map(previous.map((row) => [row.workId, row]));
      for (const id of accepted) {
        const row = incoming.get(id);
        if (row) next.set(id, row);
        else next.delete(id);
      }
      return [...next.values()];
    });
  };
  // A mutation's follow-up read may finish on another work. Only update its owner,
  // and never roll a row back over a newer read from the change stream.
  const reloadWork = async (id: string) => {
    const sequence = ++readSequence.current;
    const rows = await gateway.list();
    applyRows(rows, sequence, id);
  };
  useEffect(() => {
    let alive = true,
      pending = false,
      queued = false,
      disconnected = false;
    const load = async () => {
      if (!alive) return;
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      const sequence = ++readSequence.current;
      try {
        const rows = await gateway.list();
        if (alive) {
          applyRows(rows, sequence);
          setLoaded(true);
          setListError(null);
          if (!queued && !disconnected) setTransport('connected');
        }
      } catch (e) {
        if (alive) {
          setListError(resumeError(e));
          setTransport('disconnected');
        }
      } finally {
        pending = false;
        if (alive && queued) {
          queued = false;
          void load();
        }
      }
    };
    void load();
    const stop = gateway.subscribe?.(
      () => {
        void load();
      },
      (state) => {
        if (!alive) return;
        disconnected = state === 'disconnected';
        setTransport(disconnected ? 'disconnected' : 'connecting');
      },
    );
    return () => {
      alive = false;
      stop?.();
    };
  }, [gateway]);
  const retryList = async () => {
    clearError();
    const sequence = ++readSequence.current;
    try {
      applyRows(await gateway.list(), sequence);
      setLoaded(true);
      setTransport('connected');
    } catch (e) {
      reportError(e);
    }
  };
  const selectedKey = edits.selectedKey;
  const focusedView = focusedWork ? presentResumeWork(focusedWork, selectedKey) : undefined;
  const candidates = focusedView
    ? focusedView.candidates.map((c) => ({
        w: focusedWork!,
        c,
        id: `${focusedWork!.workId}:${c.key}`,
      }))
    : [];
  const dismissed = focusedView
    ? focusedView.dismissed.map((c) => ({
        w: focusedWork!,
        c,
        id: `${focusedWork!.workId}:${c.key}`,
      }))
    : [];
  const current =
    focusedView?.selected && focusedWork
      ? {
          w: focusedWork,
          c: focusedView.selected,
          id: `${focusedWork.workId}:${focusedView.selected.key}`,
        }
      : undefined;
  const focusedState: ResumeState = focusedWork
    ? stateFor(focusedWork, focusedView?.candidates.length ?? 0)
    : 'unavailable';
  const actionDraft = current ? edits.actionDrafts.get(current.c.key) : undefined;
  const editing = !!actionDraft;
  const action = actionDraft?.action ?? '';
  const done = actionDraft?.done ?? '';
  useEffect(() => {
    if (selectedKey === undefined && current)
      updateEdits(current.w.workId, (previous) =>
        previous.selectedKey === undefined ? { ...previous, selectedKey: current.c.key } : previous,
      );
  }, [selectedKey, current?.id]);
  useEffect(() => {
    currentIdRef.current = current?.id ?? null;
    setContinuationBusy(false);
    setCopyMessage('');
    setCoordinationMessage('');
    return () => {
      currentIdRef.current = null;
    };
  }, [current?.id]);
  // Keep the durable request visible after a refresh or candidate change so
  // a lost response can be checked without creating another request.
  useEffect(() => {
    const persisted = focusedWork?.continuation;
    const matchesCandidate =
      !!persisted &&
      !!current &&
      persisted.target.payload.previousThreadId === current.c.threadId &&
      persisted.target.payload.goal === (focusedWork.goalText ?? current.c.goal) &&
      persisted.target.payload.currentState === current.c.currentState &&
      persisted.target.payload.nextAction === current.c.nextAction &&
      persisted.target.payload.doneWhen === current.c.doneWhen &&
      // A prepared request is bound to the revision it was analyzed against.
      // Keep it only while that revision is still current; otherwise a new
      // prepare must include the latest records and corrections.
      (typeof focusedWork.revision !== 'number' ||
        persisted.target.expectedRevision === focusedWork.revision);
    setContinuation(matchesCandidate ? persisted : null);
  }, [
    current?.id,
    current?.c.threadId,
    current?.c.goal,
    current?.c.currentState,
    current?.c.nextAction,
    current?.c.doneWhen,
    current?.c.status,
    current?.c.actionAvailable,
    focusedWork?.goalText,
    focusedWork?.workId,
    focusedWork?.version,
    focusedWork?.revision,
    focusedWork?.state,
    focusedWork?.stateDetail,
    focusedWork?.continuation?.id,
    focusedWork?.continuation?.updatedAt,
  ]);
  const refresh = async (w: ResumeWork) => {
    if (refreshInFlight.current.has(w.workId)) return;
    refreshInFlight.current.add(w.workId);
    updateEdits(w.workId, (previous) => ({ ...previous, error: null }));
    // Set the optimistic flag before dispatch: a late acceptance must not replace
    // a completed brief that arrived through the change stream in the meantime.
    setWorks((rows) =>
      rows.map((r) => (r.workId === w.workId ? { ...r, busy: true, error: null } : r)),
    );
    try {
      await gateway.refresh(w.workId);
    } catch (e) {
      reportError(e, w.workId);
      setWorks((rows) =>
        rows.map((r) =>
          r.workId === w.workId && r.generatedAt === w.generatedAt ? { ...r, busy: false } : r,
        ),
      );
    } finally {
      refreshInFlight.current.delete(w.workId);
    }
  };
  const editGoal = (w: ResumeWork, text: string) => {
    updateEdits(w.workId, (previous) => ({
      ...previous,
      goalDraft: previous.goalDraft ?? { text, version: w.version },
    }));
  };
  const setGoalText = (text: string) => {
    updateEdits(focusedId, (previous) =>
      previous.goalDraft ? { ...previous, goalDraft: { ...previous.goalDraft, text } } : previous,
    );
  };
  const cancelGoal = () => updateEdits(focusedId, (previous) => ({ ...previous, goalDraft: null }));
  const reviewDraftVersion = (kind: 'goal' | 'action') => {
    if (!focusedWork || transport !== 'connected') return;
    updateEdits(focusedWork.workId, (previous) => {
      if (kind === 'goal')
        return previous.goalDraft
          ? {
              ...previous,
              error: null,
              goalDraft: { ...previous.goalDraft, version: focusedWork.version },
            }
          : previous;
      const draft = current && previous.actionDrafts.get(current.c.key);
      return draft && current
        ? {
            ...previous,
            error: null,
            actionDrafts: new Map(previous.actionDrafts).set(current.c.key, {
              ...draft,
              version: focusedWork.version,
            }),
          }
        : previous;
    });
  };
  const draftReview = (kind: 'goal' | 'action') => {
    const draft = kind === 'goal' ? edits.goalDraft : actionDraft;
    if (!draft || !focusedWork || draft.version === focusedWork.version) return null;
    return (
      <div className="resume-notice" role="status">
        <p>
          This draft was written against earlier records. Compare it with the current brief before
          saving.
        </p>
        <button
          type="button"
          disabled={saving || transport !== 'connected'}
          onClick={() => reviewDraftVersion(kind)}
        >
          Use current records for this edit
        </button>
      </div>
    );
  };
  const editAction = (w: ResumeWork, c: ResumeCandidate) => {
    updateEdits(w.workId, (previous) =>
      previous.actionDrafts.has(c.key)
        ? previous
        : {
            ...previous,
            actionDrafts: new Map(previous.actionDrafts).set(c.key, {
              action: c.nextAction ?? '',
              done: c.doneWhen ?? '',
              version: w.version,
            }),
          },
    );
  };
  const changeActionDraft = (patch: Partial<Pick<ActionDraft, 'action' | 'done'>>) => {
    if (!current) return;
    updateEdits(current.w.workId, (previous) => {
      const draft = previous.actionDrafts.get(current.c.key);
      return draft
        ? {
            ...previous,
            actionDrafts: new Map(previous.actionDrafts).set(current.c.key, { ...draft, ...patch }),
          }
        : previous;
    });
  };
  const saveGoal = async () => {
    const draft = edits.goalDraft;
    if (!focusedWork || !draft?.text.trim() || saveInFlight.current.has(focusedWork.workId)) return;
    const id = focusedWork.workId;
    saveInFlight.current.add(id);
    updateEdits(id, (previous) => ({ ...previous, saving: true, error: null }));
    try {
      await gateway.setGoal(id, draft.text.trim(), draft.version);
      await reloadWork(id);
      // A user may have returned and edited again while this save was pending.
      updateEdits(id, (previous) =>
        previous.goalDraft === draft ? { ...previous, goalDraft: null } : previous,
      );
      await refresh(focusedWork);
    } catch (e) {
      reportError(e, id);
    } finally {
      saveInFlight.current.delete(id);
      updateEdits(id, (previous) => ({ ...previous, saving: false }));
    }
  };
  const correct = async (w: ResumeWork, c: ResumeCandidate, kind: ResumeCorrection['kind']) => {
    const draft = edits.actionDrafts.get(c.key);
    if (saveInFlight.current.has(w.workId)) return;
    if (kind === 'wrong-action' && (!draft?.action.trim() || !draft.done.trim())) return;
    saveInFlight.current.add(w.workId);
    updateEdits(w.workId, (previous) => ({
      ...previous,
      saving: true,
      error: null,
      correctionMessage: '',
    }));
    try {
      await gateway.correct(w.workId, {
        candidateKey: c.key,
        version: kind === 'wrong-action' ? draft!.version : w.version,
        kind,
        ...(kind === 'wrong-action'
          ? { nextAction: draft!.action.trim(), doneWhen: draft!.done.trim() }
          : {}),
      });
      await reloadWork(w.workId);
      updateEdits(w.workId, (previous) => {
        const actionDrafts = new Map(previous.actionDrafts);
        if (kind === 'wrong-action' && actionDrafts.get(c.key) === draft)
          actionDrafts.delete(c.key);
        return {
          ...previous,
          actionDrafts,
          correctionMessage:
            kind === 'restore'
              ? 'The inferred candidate was restored.'
              : 'Your correction was saved. The brief will use it on the next check.',
        };
      });
    } catch (e) {
      reportError(e, w.workId);
      updateEdits(w.workId, (previous) => ({
        ...previous,
        correctionMessage:
          'The correction could not be saved. Try again when the connection is available.',
      }));
    } finally {
      saveInFlight.current.delete(w.workId);
      updateEdits(w.workId, (previous) => ({ ...previous, saving: false }));
    }
  };

  const copyHandoff = async (candidate: ResumeCandidate, work: ResumeWork) => {
    const text = resumeHandoffText(candidate as Parameters<typeof resumeHandoffText>[0], work);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand?.('copy') ?? false;
        area.remove();
        if (!copied) throw new Error('Copy command was not accepted');
      }
      setCopyMessage(
        'Handoff instructions copied. Paste them into the conversation you want to continue.',
      );
    } catch {
      setCopyMessage(
        'Copying is unavailable here. Select the instructions below and copy them manually.',
      );
    }
  };
  const chooseCoordination = async (work: ResumeWork, threadId: string | null) => {
    if (!gateway.setCoordination || typeof work.revision !== 'number') return;
    if (coordinationBusy) return;
    setCoordinationBusy(true);
    setCoordinationMessage('');
    try {
      await gateway.setCoordination(work.workId, threadId, work.version);
      await reloadWork(work.workId);
      setCoordinationMessage(
        threadId
          ? 'This conversation is now marked as the place to track overall progress.'
          : 'No conversation is marked as the overall progress conversation.',
      );
    } catch (e) {
      setCoordinationMessage(friendlyError(e));
    } finally {
      setCoordinationBusy(false);
    }
  };
  /**
   * A POST can commit at the provider before its response reaches the browser.
   * Read the durable continuation record before showing an error or allowing a
   * retry. This keeps a lost response from creating a second session/message.
   */
  const readContinuationStatus = async (workId: string, id: string, operationId?: string) => {
    if (!gateway.continuation) return null;
    try {
      const status = await gateway.continuation(workId, id);
      if (!operationId || currentIdRef.current === operationId) setContinuation(status);
      return status;
    } catch {
      return null;
    }
  };
  const checkContinuationStatus = async () => {
    if (!continuation || !current?.w.workId || !gateway.continuation) return;
    const operationId = current.id;
    setContinuationBusy(true);
    clearError();
    try {
      const status = await readContinuationStatus(current.w.workId, continuation.id, operationId);
      if (!status && currentIdRef.current === operationId)
        reportError('The request status could not be read. No new request was sent.');
    } catch (e) {
      if (currentIdRef.current === operationId) reportError(e);
    } finally {
      if (currentIdRef.current === operationId) setContinuationBusy(false);
    }
  };
  const startNewSession = async () => {
    if (
      !current ||
      !current.c.actionAvailable ||
      !gateway.prepareContinuation ||
      !gateway.sendContinuation ||
      !gateway.continuation ||
      typeof current.w.revision !== 'number'
    )
      return;
    const operationId = current.id;
    const payload = continuationPayload(current.c, current.w);
    if (!payload) return;
    setContinuationBusy(true);
    clearError();
    let preparedId: string | null = null;
    try {
      const prepared =
        continuation?.state === 'prepared'
          ? continuation
          : await gateway.prepareContinuation(current.w.workId, current.w.revision, {
              targetMode: 'new-session',
              threadId: null,
              payload,
            });
      preparedId = prepared.id;
      if (currentIdRef.current !== operationId) return;
      setContinuation(prepared);
      await gateway.sendContinuation(current.w.workId, current.w.revision, prepared.id);
      const sent = await gateway.continuation(current.w.workId, prepared.id);
      if (currentIdRef.current !== operationId) return;
      setContinuation(sent);
    } catch (e) {
      if (currentIdRef.current !== operationId) return;
      const status = preparedId
        ? await readContinuationStatus(current.w.workId, preparedId, operationId)
        : null;
      if (currentIdRef.current !== operationId) return;
      if (status) {
        if (status.state === 'result-unknown')
          setError('The send result is unknown. Check request status before trying again.');
        else if (status.state === 'failed')
          setError(friendlyError(status.error ?? 'The new session could not be started.'));
        else if (status.state === 'sent' || status.state === 'opened')
          setError('The new session request completed. Check its status before continuing.');
        else reportError(e);
      } else {
        if (preparedId)
          setContinuation((previous) =>
            previous
              ? {
                  ...previous,
                  state: 'result-unknown',
                  error: 'The send result could not be confirmed.',
                }
              : previous,
          );
        if (preparedId)
          setError(
            'The send result could not be confirmed. Check request status before trying again.',
          );
        else reportError(e);
      }
    } finally {
      setContinuationBusy(false);
    }
  };
  const openNewSession = async () => {
    // A confirmed send failure can happen before a provider returns a session
    // id. In that case there is no destination to open; keep the request visible
    // for its error/status details and let the user prepare a fresh request.
    if (
      !continuation ||
      !continuation.threadId ||
      !gateway.openContinuation ||
      !gateway.continuation ||
      typeof current?.w.revision !== 'number'
    )
      return;
    const operationId = current.id;
    setContinuationBusy(true);
    clearError();
    try {
      await gateway.openContinuation(current.w.workId, current.w.revision, continuation.id);
      const opened = await gateway.continuation(current.w.workId, continuation.id);
      if (currentIdRef.current !== operationId) return;
      setContinuation(opened);
    } catch (e) {
      const currentOperation = currentIdRef.current === operationId;
      if (!currentOperation) return;
      const status = await readContinuationStatus(current.w.workId, continuation.id, operationId);
      if (currentIdRef.current !== operationId) return;
      if (status) {
        if (status.state === 'result-unknown')
          setError('Opening result is unknown. Check the request status before trying again.');
        else if (status.state === 'failed')
          setError(friendlyError(status.error ?? 'The new session could not be opened.'));
        else if (status.state === 'opened')
          setError('The new session is open. Confirm its context before continuing.');
        else reportError(e);
      } else {
        setContinuation((previous) =>
          previous
            ? {
                ...previous,
                state: 'result-unknown',
                error: 'The opening result could not be confirmed.',
              }
            : previous,
        );
        setError(
          'The opening result could not be confirmed. Check the request status before trying again.',
        );
      }
    } finally {
      setContinuationBusy(false);
    }
  };
  const canPrepareContinuation =
    typeof gateway.prepareContinuation === 'function' &&
    typeof gateway.sendContinuation === 'function' &&
    typeof gateway.continuation === 'function';
  const canOpenContinuation =
    typeof gateway.openContinuation === 'function' && typeof gateway.continuation === 'function';
  const automaticContinuationUnsupported =
    !!current &&
    (!canPrepareContinuation ||
      !current.w.session ||
      current.w.session.create !== 'supported' ||
      current.w.session.send !== 'supported');
  return (
    <div className="app-shell resume-app-shell">
      <AppSidebar works={works} activeWorkId={workId} />
      <div className="resume-shell">
        <a
          className="resume-skip"
          href="#resume-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('resume-content')?.focus();
          }}
        >
          Skip to main content
        </a>
        <header>
          <strong className="resume-page-title">Resume</strong>
          <span className="local-badge" role="status">
            {transport === 'connected'
              ? 'Connected locally'
              : transport === 'disconnected'
                ? 'Connection lost · saved brief kept'
                : 'Checking local connection'}
          </span>
        </header>
        <main id="resume-content" tabIndex={-1}>
          <p className="resume-intro">
            Pick up interrupted Codex work. Confirm the next step, then open it in Codex.
          </p>
          {storageError && (
            <p className="resume-notice" role="alert">
              Browser storage is unavailable. Your input remains on this screen, but cannot be
              restored after leaving. Saved server records are unchanged.
            </p>
          )}
          {error && (
            <section role="alert" className="resume-error">
              <p>{error}</p>
              <p>
                StateCarry kept any work it already loaded. You can try again or review the
                connection settings.
              </p>
              {errorDetail ? (
                <details>
                  <summary>Technical details</summary>
                  <p className="small muted">{errorDetail}</p>
                </details>
              ) : null}
              <div className="resume-state-actions">
                <button type="button" onClick={() => void retryList()}>
                  Try again
                </button>
                <a href="#/connect">Review connection</a>
              </div>
            </section>
          )}
          {!loaded && !error && <p role="status">Reading your connected work…</p>}
          {correctionMessage && (
            <p className="resume-correction-status" role="status" aria-live="polite">
              {correctionMessage}
            </p>
          )}
          {loaded && !works.length && !workId && (
            <section>
              <h1>Where did you leave off?</h1>
              <p>
                Connect a project’s Codex records to find work you can resume. You choose which
                records StateCarry can read.
              </p>
              <a className="resume-primary" href="#/connect">
                Connect Codex records
              </a>
              <p>
                Runs locally. Uses your signed-in Codex for analysis. Nothing runs on your behalf.
              </p>
            </section>
          )}
          {loaded && works.length > 1 && !workId && (
            <section className="resume-work-chooser" aria-labelledby="choose-work-heading">
              <p className="resume-label">Choose where to continue</p>
              <h1 id="choose-work-heading">Which work were you returning to?</h1>
              <p>
                StateCarry found several connected records. Choose one to see its purpose, progress,
                and next action.
              </p>
              <div className="work-chooser-list">
                {works.map((w) => (
                  <a
                    className="work-chooser-item"
                    key={w.workId}
                    href={`#/resume/${encodeURIComponent(w.workId)}`}
                  >
                    <span>
                      <strong>{w.title}</strong>
                      <small>
                        {w.sessionCount} connected conversation{w.sessionCount === 1 ? '' : 's'}
                      </small>
                    </span>
                    <span className={`work-state ${stateFor(w)}`}>{stateLabel(stateFor(w))}</span>
                    <span aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
              <a href="#/connect">Connect another project</a>
            </section>
          )}
          {works.length > 1 && workId && (
            <details className="resume-work-switch">
              <summary>Change connected work · {focusedWork?.title ?? 'Choose work'}</summary>
              <p>Choose existing records. This does not create a project or Codex session.</p>
              {works.map((w) => (
                <p key={w.workId}>
                  <a href={`#/resume/${encodeURIComponent(w.workId)}`}>{w.title}</a>{' '}
                  <small>{w.sessionCount} connected sessions</small>
                </p>
              ))}
            </details>
          )}
          {loaded && workId && !focusedWork && (
            <section className="resume-error" role="alert">
              <h1>This connected work is no longer available</h1>
              <p>
                It may have been disconnected, or the local server could not find it. StateCarry
                kept the original records unchanged; this old link will not start a new analysis.
              </p>
              <div className="resume-state-actions">
                <a className="resume-primary" href="#/resume">
                  Return to resume list
                </a>
                <a className="resume-secondary" href="#/connections">
                  Restore disconnected work
                </a>
              </div>
            </section>
          )}
          {focusedWork && !current && (
            <section className="resume-goal-editor">
              <p className="resume-label">Goal</p>
              {focusedWork.goalText ? (
                <>
                  <p>{focusedWork.goalText}</p>
                  <small>Written by you</small>
                </>
              ) : (
                <small>
                  No goal confirmed yet. You can state the intended result while records are
                  analyzed.
                </small>
              )}{' '}
              <button
                type="button"
                onClick={() => editGoal(focusedWork, focusedWork.goalText ?? '')}
              >
                {focusedWork.goalText ? 'Edit goal' : 'Set goal'}
              </button>
              {goalEditing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveGoal();
                  }}
                >
                  <label>
                    Intended result
                    <textarea
                      name="goal"
                      autoComplete="off"
                      required
                      maxLength={400}
                      value={goalText}
                      onChange={(e) => setGoalText(e.target.value)}
                    />
                  </label>
                  {draftReview('goal')}
                  <p>
                    This updates this work. It creates no new project or session and does not expand
                    record access.
                  </p>
                  <button disabled={saving || !goalText.trim()}>Save goal</button>{' '}
                  <button type="button" onClick={cancelGoal}>
                    Cancel
                  </button>
                </form>
              )}
            </section>
          )}
          {focusedWork &&
            (focusedState !== 'ready' ||
              focusedWork.stale ||
              focusedWork.updatesAvailable ||
              focusedWork.workspaceChanged) && (
              <section
                className={`resume-notice resume-state-${focusedState}`}
                aria-live="polite"
                aria-busy={focusedWork.busy}
              >
                <strong>{stateLabel(focusedState)}</strong>
                {(() => {
                  const description = stateDescriptionFor(focusedWork);
                  const situation = stateSituationFor(focusedWork, focusedState);
                  return (
                    <>
                      {<p>{description}</p>}
                      {situation && situation !== description ? (
                        <p role={focusedState === 'failed' ? 'alert' : 'status'}>{situation}</p>
                      ) : null}
                    </>
                  );
                })()}
                <FriendlyLimitations values={focusedView?.limitations ?? []} />
                <div className="resume-state-actions">
                  <button disabled={focusedWork.busy} onClick={() => void refresh(focusedWork)}>
                    {focusedWork.busy ? 'Checking…' : 'Check records again'}
                  </button>
                  {focusedState === 'empty' && dismissed[0] ? (
                    <button
                      disabled={saving}
                      onClick={() => void correct(focusedWork, dismissed[0].c, 'restore')}
                    >
                      Restore a dismissed suggestion
                    </button>
                  ) : null}
                  <a href={`#/details/${focusedWork.workId}`}>Review connection</a>
                </div>
              </section>
            )}
          {focusedView?.selectionNeedsReview && (
            <p role="status">
              The selected candidate needs a recheck. Choose another candidate below or refresh its
              records.
            </p>
          )}
          {current && (
            <section className="resume-card" key={current.id}>
              <p className="resume-label">Purpose</p>
              <h1>{current.w.goalText ?? current.c.purpose}</h1>
              <div className="resume-goal-tools">
                <small>
                  {current.w.goalText
                    ? 'Written by you'
                    : 'Inferred from connected records · confirm before acting'}
                </small>
                <button
                  type="button"
                  onClick={() => editGoal(current.w, current.w.goalText ?? current.c.purpose)}
                >
                  {current.w.goalText ? 'Edit goal' : 'Confirm or edit goal'}
                </button>
                {goalEditing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveGoal();
                    }}
                  >
                    <label>
                      Intended result
                      <textarea
                        name="goal"
                        autoComplete="off"
                        required
                        maxLength={400}
                        value={goalText}
                        onChange={(e) => setGoalText(e.target.value)}
                      />
                    </label>
                    {draftReview('goal')}
                    <p>
                      This updates this work. It creates no new project or session and does not
                      expand record access.
                    </p>
                    <button type="submit" disabled={saving || !goalText.trim()}>
                      Save goal
                    </button>{' '}
                    <button type="button" onClick={cancelGoal}>
                      Cancel
                    </button>
                  </form>
                )}
              </div>
              <p className={`resume-status ${current.c.status}`}>{current.c.statusLabel}</p>
              {current.w.correctedKeys.includes(current.c.key) && (
                <button
                  type="button"
                  className="resume-restore"
                  disabled={saving}
                  onClick={() => void correct(current.w, current.c, 'restore')}
                >
                  Restore the suggested step
                </button>
              )}
              <ResumeBrief candidate={current.c} work={current.w} />
              {current.c.prerequisites.length > 0 && (
                <div>
                  <h2>Before you start</h2>
                  <ul>
                    {current.c.prerequisites.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {focusedState === 'ready' ? (
                <FriendlyLimitations values={focusedView?.limitations ?? []} />
              ) : null}
              <div className="resume-primary-actions">
                <p className="resume-label">Where to continue</p>
                {current.c.target.existing.available && current.c.target.existing.url ? (
                  <a className="resume-primary" href={current.c.target.existing.url}>
                    {current.c.actionAvailable ? 'Confirm & open in Codex' : 'Open in Codex'}
                  </a>
                ) : null}
                <button
                  type="button"
                  className={
                    current.c.target.existing.available ? 'resume-secondary' : 'resume-primary'
                  }
                  onClick={() => void copyHandoff(current.c, current.w)}
                >
                  Copy handoff instructions
                </button>
                <button disabled={current.w.busy} onClick={() => void refresh(current.w)}>
                  Recheck records
                </button>
              </div>
              <p className="resume-hint">
                {current.c.target.existing.available
                  ? 'Opening the recorded conversation does not send or execute this action.'
                  : 'Paste the instructions into your existing Codex conversation. The previous conversation ID is included.'}
              </p>
              {copyMessage ? (
                <p role="status" aria-live="polite">
                  {copyMessage}
                </p>
              ) : null}
              <details className="resume-manual-handoff" {...panelProps('handoff')}>
                <summary>Review handoff instructions</summary>
                {!current.c.actionAvailable ? (
                  <p className="small uncertainty">
                    This is a review note. Confirm the current state before changing files.
                  </p>
                ) : null}
                <textarea
                  readOnly
                  aria-label="Handoff instructions"
                  value={resumeHandoffText(current.c, current.w)}
                  rows={9}
                />
                <p className="small">
                  Previous conversation: <code>{current.c.threadId}</code>
                </p>
              </details>
              <details {...panelProps('workspace')}>
                <summary>Project checks and limits</summary>
                <WorkspaceStatus work={current.w} />
              </details>
              <ProgressDetails workId={current.w.workId} candidate={current.c} />
              <details {...panelProps('continuation', !!continuation)}>
                <summary>Other ways to continue</summary>
                <p className="resume-session-note">
                  <strong>New session:</strong> {current.c.target.newSession.detail}
                </p>
                <p className="resume-session-note">
                  <strong>Overall progress:</strong> {current.c.target.coordination.detail}
                </p>
                {current.c.target.coordination.available && current.c.target.coordination.url ? (
                  <a className="resume-secondary" href={current.c.target.coordination.url}>
                    {current.c.target.coordination.label}
                  </a>
                ) : null}
                {current.w.coordinationChoices?.length && gateway.setCoordination ? (
                  <details className="resume-coordination">
                    <summary>Choose the conversation that tracks overall progress</summary>
                    <p className="small muted">
                      StateCarry only assigns this role when the records support it or you choose it
                      here.
                    </p>
                    <label>
                      Overall progress conversation
                      <select
                        name="coordination-thread"
                        autoComplete="off"
                        value={current.w.coordination?.threadId ?? ''}
                        onChange={(e) => void chooseCoordination(current.w, e.target.value || null)}
                        disabled={saving || coordinationBusy}
                      >
                        <option value="">No conversation selected</option>
                        {current.w.coordinationChoices.map((choice) => (
                          <option key={choice.threadId} value={choice.threadId}>
                            {choice.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {coordinationBusy ? (
                      <p role="status" className="small">
                        Saving this choice…
                      </p>
                    ) : null}
                    {coordinationMessage ? (
                      <p role="status" className="resume-correction-status">
                        {coordinationMessage}
                      </p>
                    ) : null}
                  </details>
                ) : null}
                {current.w.coordination?.evidence.length ? (
                  <details>
                    <summary>Why this coordination conversation is suggested</summary>
                    {current.w.coordination.evidence.map((e, i) => (
                      <blockquote key={`${e.revisionId}:${i}`}>
                        <p>{e.quote}</p>
                        <a
                          href={`/api/v1/work-contexts/${encodeURIComponent(current.w.workId)}/evidence/${encodeURIComponent(e.revisionId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Read supporting record
                        </a>
                      </blockquote>
                    ))}
                  </details>
                ) : null}
                {(continuation && typeof gateway.continuation === 'function') ||
                (!current.w.updatesAvailable &&
                  current.c.target.newSession.available &&
                  current.c.actionAvailable &&
                  canPrepareContinuation) ? (
                  <div className="resume-session-actions">
                    {current.c.actionAvailable &&
                    current.c.target.newSession.available &&
                    !current.w.updatesAvailable &&
                    canPrepareContinuation ? (
                      <button
                        type="button"
                        disabled={
                          continuationBusy ||
                          (!!continuation &&
                            ['dispatching', 'sent', 'opening', 'opened', 'result-unknown'].includes(
                              continuation.state,
                            ))
                        }
                        onClick={() => void startNewSession()}
                      >
                        {continuation?.state === 'prepared'
                          ? 'Send the prepared context'
                          : continuation?.state === 'failed'
                            ? 'Prepare a new request and try again'
                            : 'Prepare and send to a new session'}
                      </button>
                    ) : null}
                    {continuation && (
                      <p role="status">
                        {!current.c.actionAvailable || !current.c.target.newSession.available
                          ? 'This saved request is retained, but the brief needs a fresh check before another action.'
                          : continuationStatusLabel(continuation)}
                      </p>
                    )}
                    {continuation &&
                    ['result-unknown', 'dispatching', 'opening'].includes(continuation.state) &&
                    typeof gateway.continuation === 'function' ? (
                      <button
                        type="button"
                        disabled={continuationBusy}
                        onClick={() => void checkContinuationStatus()}
                      >
                        Check request status
                      </button>
                    ) : null}
                    {continuation &&
                    ['sent', 'failed'].includes(continuation.state) &&
                    !!continuation.threadId &&
                    current.c.actionAvailable &&
                    current.c.target.newSession.available &&
                    canOpenContinuation ? (
                      <button
                        type="button"
                        disabled={continuationBusy}
                        onClick={() => void openNewSession()}
                      >
                        {continuation.state === 'failed'
                          ? 'Try opening the new Codex session again'
                          : 'Open the new Codex session'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {automaticContinuationUnsupported ? (
                  <p className="small">
                    Automatic continuation is unavailable. Use the recorded conversation or copy the
                    handoff above.
                  </p>
                ) : null}
              </details>
              <details {...panelProps('evidence')}>
                <summary>Why this recommendation</summary>
                <p>
                  Likely next step from connected records; it is not a statement of your current
                  priority.
                </p>
                <p className="small muted">
                  {current.c.roleLabel} · {current.c.actorLabel} · {current.c.utteranceTypeLabel}
                </p>
                {current.c.evidence.map((e, i) => (
                  <blockquote key={i}>
                    <p>{e.quote}</p>
                    <a
                      href={`/api/v1/work-contexts/${encodeURIComponent(current.w.workId)}/evidence/${encodeURIComponent(e.revisionId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original record
                    </a>
                  </blockquote>
                ))}
                <p>
                  Analyzed{' '}
                  {current.w.generatedAt ? new Date(current.w.generatedAt).toLocaleString() : '—'}
                </p>
                <p>
                  If the app link does not open, use this session ID in Codex:{' '}
                  <code>{current.c.threadId}</code>
                </p>
                <a href={`#/details/${current.w.workId}`}>More context / connection settings</a>
              </details>
              <details {...panelProps('correction', editing)}>
                <summary>Not This</summary>
                <div className="resume-buttons">
                  <button
                    disabled={saving}
                    onClick={() => void correct(current.w, current.c, 'wrong-work')}
                  >
                    Wrong work
                  </button>
                  <button disabled={saving} onClick={() => editAction(current.w, current.c)}>
                    Right work, wrong next step
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => void correct(current.w, current.c, 'done')}
                  >
                    Already done
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => void correct(current.w, current.c, 'paused')}
                  >
                    Paused
                  </button>
                  {current.w.correctedKeys.includes(current.c.key) && (
                    <button
                      disabled={saving}
                      onClick={() => void correct(current.w, current.c, 'restore')}
                    >
                      Restore inferred candidate
                    </button>
                  )}
                </div>
                {editing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void correct(current.w, current.c, 'wrong-action');
                    }}
                  >
                    <label>
                      First action
                      <textarea
                        name="next-action"
                        autoComplete="off"
                        required
                        maxLength={1200}
                        value={action}
                        onChange={(e) => changeActionDraft({ action: e.target.value })}
                      />
                    </label>
                    <label>
                      Done when
                      <textarea
                        name="done-when"
                        autoComplete="off"
                        required
                        maxLength={1200}
                        value={done}
                        onChange={(e) => changeActionDraft({ done: e.target.value })}
                      />
                    </label>
                    {draftReview('action')}
                    <button disabled={saving || !action.trim() || !done.trim()}>
                      Save correction
                    </button>
                  </form>
                )}
                <p>Corrections stay on this device and inform future analysis for this work.</p>
              </details>
            </section>
          )}
          {(candidates.length > 1 || (!current && candidates.length > 0)) && (
            <details
              className="resume-choices"
              {...panelProps('choices', !!focusedView?.selectionNeedsReview)}
            >
              <summary>
                {current
                  ? `Resume something else · ${candidates.length} options`
                  : 'Review updated brief'}
              </summary>
              {candidates.map(({ w, c, id }) => (
                <button
                  key={id}
                  onClick={() => {
                    updateEdits(w.workId, (previous) => ({
                      ...previous,
                      correctionMessage: '',
                      selectedKey: c.key,
                    }));
                  }}
                  aria-pressed={current?.id === id}
                >
                  {c.purpose}
                  <small>
                    {c.statusLabel} · {w.title}
                  </small>
                </button>
              ))}
            </details>
          )}
          {dismissed.length > 0 && (
            <section className="resume-dismissed-restore" aria-label="Restore dismissed work">
              <strong>Dismissed suggestions</strong>
              <p className="small">If you dismissed the wrong work, restore it here.</p>
              {dismissed.map(({ w, c }) => (
                <p key={`${w.workId}:${c.key}`}>
                  <span>{c.purpose}</span>{' '}
                  <button disabled={saving} onClick={() => void correct(w, c, 'restore')}>
                    Restore suggestion
                  </button>
                </p>
              ))}
            </section>
          )}
        </main>
        <footer>Local Codex records · Resume → Confirm → Act</footer>
      </div>
    </div>
  );
}
