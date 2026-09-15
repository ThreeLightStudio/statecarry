import { useEffect, useRef, useState } from 'react';
import { continuationPayload, resumeHandoffText, presentResumeProgress, presentResumeWork, resumeStateLabel, resumeWorkStatus, type ResumeGateway, type ResumeWork, type ResumeCandidate, type ResumeCorrection, type Continuation } from '@statecarry/presentation';
import './resume.css';
import { AppSidebar } from './AppSidebar';

function EvidenceList({ workId, items }: { workId: string; items: { revisionId: string; quote: string }[] }) {
  return <>{items.map((item, index) => <blockquote key={`${item.revisionId}:${index}`}><p>{item.quote}</p><a href={`/api/v1/work-contexts/${encodeURIComponent(workId)}/evidence/${encodeURIComponent(item.revisionId)}`} target="_blank" rel="noreferrer">Read supporting record</a></blockquote>)}</>;
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
  return <details className="resume-progress"><summary>What has been completed so far</summary>{groups.map(([label, items]) => items.length ? <section key={label}><h3>{label}</h3><EvidenceList workId={workId} items={items} /></section> : null)}<p className="small muted">A report shows what was recorded. Verification is shown separately when a check was recorded.</p></details>;
}

function ProgressSummary({ candidate }: { candidate: ResumeCandidate }) {
  const summary = presentResumeProgress(candidate);
  return <><p className="resume-progress-summary-copy">{summary.completed}</p><p className="resume-progress-summary-copy resume-progress-remaining">{summary.remaining}</p></>;
}

function ObservedFiles({ workspace }: { workspace: NonNullable<ResumeWork['workspace']> }) {
  const files = workspace.files ?? workspace.fileObservations ?? [];
  if (!files.length) return null;
  return <details className="resume-file-details"><summary>Observed project files · {files.length}</summary><p className="small muted">Read-only bounded observations used to detect changes. Previews are intentionally short.</p><ul className="resume-file-list">{files.map(file => <li key={`${file.path}:${file.hash}`}><code>{file.path}</code><span className="small muted"> · {file.status === 'unavailable' ? 'Could not read' : 'Read'} · SHA-256 {file.hash.slice(0, 12)}</span>{file.preview ? <pre>{file.preview}</pre> : <p className="small uncertainty">{file.limitation ?? 'No preview available.'}</p>}</li>)}</ul></details>;
}

function friendlyLimitation(value: string): string {
  if (/failed to fetch|networkerror|network request failed|load failed|^typeerror\b/i.test(value)) return 'The local server could not be reached while checking this work.';
  if (/workspace state could not be checked|git\s+-C|not a git repository/i.test(value)) return 'The current project state could not be confirmed.';
  if (/file observation was limited|read limit|source files/i.test(value)) return 'Only part of the project files could be checked.';
  if (/could not read|unavailable|partial|incomplete|coverage/i.test(value)) return 'Some connected records or project files could not be fully checked.';
  return value.length > 180 ? 'Some connected records could not be fully checked.' : value;
}

function FriendlyLimitations({ values }: { values: string[] }) {
  return <>{[...new Set(values.map(friendlyLimitation))].map(value => <p className="small uncertainty" key={value}>{value}</p>)}</>;
}

function TechnicalLimitations({ values }: { values: string[] }) {
  if (!values.length) return null;
  return <details><summary>Project check details</summary>{values.map(value => <p className="small muted" key={value}>{value}</p>)}</details>;
}

function WorkspaceStatus({ work }: { work: ResumeWork }) {
  const workspace = work.workspace;
  if (!workspace || workspace.status !== 'checked') return <section className="resume-workspace changed" aria-label="Project state"><strong>Project state unavailable</strong><p>Branch, code version, and uncommitted changes could not be confirmed for this brief.</p><FriendlyLimitations values={workspace?.limitations ?? []} /><p className="small muted">Refresh the records before treating the next action as current.</p>{workspace ? <><TechnicalLimitations values={workspace.limitations} /><ObservedFiles workspace={workspace} /></> : null}</section>;
  const revision = workspace.commit?.trim() ? workspace.commit.slice(0, 12) : 'Unavailable';
  const branch = workspace.branch?.trim() || 'Unavailable';
  const changes = workspace.dirty === null ? 'Change status unknown' : workspace.dirty ? 'Uncommitted changes present' : 'No uncommitted changes reported';
  return <section className={`resume-workspace ${work.workspaceChanged ? 'changed' : ''}`} aria-label="Project state"><strong>{work.workspaceChanged ? 'Project changed since this brief' : 'Project state checked'}</strong><p>{work.workspaceChanged ? 'The folder changed while this brief was being prepared. Recheck it before acting.' : 'The connected project was checked while preparing this brief.'}</p><FriendlyLimitations values={workspace.limitations} /><details><summary>Project details</summary><p>Folder · {workspace.cwd}</p><p>Branch · {branch} · {changes}</p><p className="small muted">Checked {workspace.checkedAt}</p><p>Git root · {workspace.root ?? 'Unavailable'}</p><p>Commit reference · {revision}</p><TechnicalLimitations values={workspace.limitations} /><ObservedFiles workspace={workspace} /></details></section>;
}

type ResumeState = 'ready' | 'checking' | 'limited' | 'empty' | 'unavailable' | 'failed';

function friendlyError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  if (/failed to fetch|networkerror|network request failed|load failed|econnrefused|^typeerror\b/i.test(raw)) {
    return 'StateCarry could not reach the local server. Check that it is running, then try again.';
  }
  if (!raw.trim() || raw.length > 240) return 'The latest request could not be completed. Try again or review the connection.';
  return raw;
}

function stateFor(work: ResumeWork, candidateCount = work.candidates.length): ResumeState {
  const state = resumeWorkStatus(work).state;
  return state === 'ready' && candidateCount === 0 ? 'empty' : state;
}

function stateLabel(state: ResumeState): string { return resumeStateLabel(state); }

function stateDescriptionFor(work: ResumeWork): string { return friendlyError(resumeWorkStatus(work).description); }

function stateSituationFor(work: ResumeWork, state: ResumeState): string | null {
  // Core may already provide a complete explanation for an unavailable
  // workspace. Keep one clear sentence in that case and leave the action
  // buttons to carry the recovery path.
  if (work.stateDetail?.trim() && !work.busy && !work.error && !work.workspaceChanged && !work.updatesAvailable && work.workspace?.status !== 'checked') return null;
  return work.busy
    ? 'Checking the connected records. You can leave this page open.'
    : work.error
      ? friendlyError(work.error)
      : work.workspaceChanged
        ? 'The project changed since this brief. Check the current workspace before acting.'
        : work.workspace?.status !== 'checked'
          ? 'The project could not be fully checked. The last brief is preserved, but confirm the current folder before acting.'
          : work.updatesAvailable
            ? 'New records arrived after this brief. Recheck before you act.'
            : state === 'empty'
              ? 'No candidate is available yet. Recheck the connected records or review the connection scope.'
              : 'The latest records need a fresh check before acting.';
}

function continuationStatusLabel(continuation: Continuation): string {
  switch (continuation.state) {
    case 'prepared': return 'Context is ready to send. Review the current step before sending it.';
    case 'dispatching': return 'Sending the context to the new Codex session…';
    case 'sent': return 'Context sent. Check the new Codex session before continuing.';
    case 'opening': return 'Opening the new Codex session…';
    case 'opened': return 'New Codex session opened. Confirm its context before acting.';
    case 'result-unknown': return 'The send result is unknown. Check the request before trying again.';
    case 'failed': return `The send failed: ${friendlyError(continuation.error ?? 'unknown error')}`;
  }
}

export function Resume({ gateway, workId }: { gateway: ResumeGateway; workId?: string }) {
 const [works, setWorks] = useState<ResumeWork[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [errorDetail, setErrorDetail] = useState('');
 const reportError = (value: unknown) => {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  setError(friendlyError(value));
  setErrorDetail(raw && friendlyError(value) !== raw ? raw : '');
 };
 const clearError = () => { setError(''); setErrorDetail(''); };
  const [goalEditing, setGoalEditing] = useState(false), [goalText, setGoalText] = useState('');
  const refreshInFlight = useRef(new Set<string>());
  const refreshStartedFrom = useRef(new Map<string, string | null>());
  const currentIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState(''), [editing, setEditing] = useState(false), [action, setAction] = useState(''), [done, setDone] = useState(''), [saving, setSaving] = useState(false);
  const [continuation, setContinuation] = useState<Continuation | null>(null), [continuationBusy, setContinuationBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [coordinationMessage, setCoordinationMessage] = useState(''), [coordinationBusy, setCoordinationBusy] = useState(false);
  useEffect(() => {
    let alive = true, pending = false;
 const load = async () => { if (pending) return; pending = true; try { const rows = await gateway.list(); if (alive) { setWorks(rows); setLoaded(true); clearError(); } } catch (e) { if (alive) reportError(e); } finally { pending = false; } };
    void load();
    const subscribe = (gateway as ResumeGateway & { subscribe?: (listener: () => void) => () => void }).subscribe;
    const stop = subscribe ? subscribe(() => { void load(); }) : undefined;
    return () => { alive = false; stop?.(); };
  }, [gateway]);
 const retryList = async () => {
    clearError();
    try { setWorks(await gateway.list()); setLoaded(true); }
    catch (e) { reportError(e); }
  };
  // A return page must not silently pick the first connected work. One work is
  // safe to open directly; multiple works require an explicit choice.
  const focusedWork = works.find(w => w.workId === workId) ?? (!workId && works.length === 1 ? works[0] : undefined);
  const selectedKey = focusedWork && selected.startsWith(`${focusedWork.workId}:`) ? selected.slice(focusedWork.workId.length + 1) : undefined;
  const focusedView = focusedWork ? presentResumeWork(focusedWork, selectedKey) : undefined;
  const candidates = focusedView ? focusedView.candidates.map(c => ({ w: focusedWork!, c, id: `${focusedWork!.workId}:${c.key}` })) : [];
  const dismissed = focusedView ? focusedView.dismissed.map(c => ({ w: focusedWork!, c, id: `${focusedWork!.workId}:${c.key}` })) : [];
  const current = focusedView?.selected && focusedWork ? { w: focusedWork, c: focusedView.selected, id: `${focusedWork.workId}:${focusedView.selected.key}` } : undefined;
  const focusedState: ResumeState = focusedWork ? stateFor(focusedWork, focusedView?.candidates.length ?? 0) : 'unavailable';
  useEffect(() => { if (!selected && current) setSelected(current.id); }, [selected, current?.id]);
  useEffect(() => { currentIdRef.current = current?.id ?? null; setEditing(false); setAction(''); setDone(''); setCopyMessage(''); setCoordinationMessage(''); }, [current?.id]);
  // Keep the durable request visible after a refresh or candidate change so
  // a lost response can be checked without creating another request.
  useEffect(() => {
    const persisted = focusedWork?.continuation;
 const matchesCandidate = !!persisted && !!current
  && persisted.target.payload.previousThreadId === current.c.threadId
  && persisted.target.payload.goal === (focusedWork.goalText ?? current.c.goal)
  && persisted.target.payload.currentState === current.c.currentState
  && persisted.target.payload.nextAction === current.c.nextAction
  && persisted.target.payload.doneWhen === current.c.doneWhen
  // A prepared request is bound to the revision it was analyzed against.
  // Keep it only while that revision is still current; otherwise a new
  // prepare must include the latest records and corrections.
  && (typeof focusedWork.revision !== 'number' || persisted.target.expectedRevision === focusedWork.revision);
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
  refreshStartedFrom.current.set(w.workId, w.generatedAt);
  try {
   await gateway.refresh(w.workId);
   setWorks(rows => rows.map(r => r.workId === w.workId ? { ...r, busy: true, error: null } : r));
  } catch (e) { reportError(e); refreshStartedFrom.current.delete(w.workId); }
  finally { refreshInFlight.current.delete(w.workId); }
 };
  useEffect(() => {
    if (!focusedWork || focusedWork.busy) return;
    const previous = refreshStartedFrom.current.get(focusedWork.workId);
    if (previous !== undefined && focusedWork.generatedAt !== previous) {
      refreshStartedFrom.current.delete(focusedWork.workId);
      setSelected('');
    }
  }, [focusedWork?.workId, focusedWork?.busy, focusedWork?.generatedAt]);
  const saveGoal = async () => {
    if (!focusedWork) return;
    setSaving(true);
    try { await gateway.setGoal(focusedWork.workId, goalText.trim(), focusedWork.version); setWorks(await gateway.list()); setSelected(''); setGoalEditing(false); await refresh(focusedWork); }
    catch (e) { reportError(e); } finally { setSaving(false); }
  };
  const correct = async (w: ResumeWork, c: ResumeCandidate, kind: ResumeCorrection['kind']) => {
    setSaving(true);
    setCorrectionMessage('');
    try { await gateway.correct(w.workId, { candidateKey: c.key, version: w.version, kind, ...(kind === 'wrong-action' ? { nextAction: action.trim(), doneWhen: done.trim() } : {}) }); setWorks(await gateway.list()); setEditing(false); if (kind === 'wrong-work') setSelected(''); setCorrectionMessage(kind === 'restore' ? 'The inferred candidate was restored.' : 'Your correction was saved. The brief will use it on the next check.'); }
    catch (e) { reportError(e); setCorrectionMessage('The correction could not be saved. Try again when the connection is available.'); } finally { setSaving(false); }
  };

  const copyHandoff = async (candidate: ResumeCandidate, work: ResumeWork) => {
    const text = resumeHandoffText(candidate as Parameters<typeof resumeHandoffText>[0], work);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); const copied = document.execCommand?.('copy') ?? false; area.remove(); if (!copied) throw new Error('Copy command was not accepted');
      }
      setCopyMessage('Handoff instructions copied. Paste them into the conversation you want to continue.');
    } catch { setCopyMessage('Copying is unavailable here. Select the instructions below and copy them manually.'); }
  };
  const chooseCoordination = async (work: ResumeWork, threadId: string | null) => {
    if (!gateway.setCoordination || typeof work.revision !== 'number') return;
    if (coordinationBusy) return;
    setCoordinationBusy(true);
    setCoordinationMessage('');
    try {
      await gateway.setCoordination(work.workId, threadId, work.version);
      setWorks(await gateway.list());
      setCoordinationMessage(threadId ? 'This conversation is now marked as the place to track overall progress.' : 'No conversation is marked as the overall progress conversation.');
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
 } catch { return null; }
 };
 const checkContinuationStatus = async () => {
 if (!continuation || !current?.w.workId || !gateway.continuation) return;
 setContinuationBusy(true); clearError();
 try { setContinuation(await gateway.continuation(current.w.workId, continuation.id)); }
 catch (e) { reportError(e); }
 finally { setContinuationBusy(false); }
 };
 const startNewSession = async () => {
 if (!current || !current.c.actionAvailable || !gateway.prepareContinuation || !gateway.sendContinuation || !gateway.continuation || typeof current.w.revision !== 'number') return;
 const operationId = current.id;
 const payload = continuationPayload(current.c, current.w);
 if (!payload) return;
 setContinuationBusy(true); clearError();
 let preparedId: string | null = null;
 try {
   const prepared = continuation?.state === 'prepared' ? continuation : await gateway.prepareContinuation(current.w.workId, current.w.revision, { targetMode: 'new-session', threadId: null, payload });
   preparedId = prepared.id;
   if (currentIdRef.current !== operationId) return;
   setContinuation(prepared);
   await gateway.sendContinuation(current.w.workId, current.w.revision, prepared.id);
   const sent = await gateway.continuation(current.w.workId, prepared.id);
   if (currentIdRef.current !== operationId) return;
   setContinuation(sent);
 } catch (e) {
   if (currentIdRef.current !== operationId) return;
   const status = preparedId ? await readContinuationStatus(current.w.workId, preparedId, operationId) : null;
   if (currentIdRef.current !== operationId) return;
   if (status) {
     if (status.state === 'result-unknown') setError('The send result is unknown. Check request status before trying again.');
   else if (status.state === 'failed') setError(friendlyError(status.error ?? 'The new session could not be started.'));
     else if (status.state === 'sent' || status.state === 'opened') setError('The new session request completed. Check its status before continuing.');
     else reportError(e);
   } else {
     if (preparedId) setContinuation(previous => previous ? { ...previous, state: 'result-unknown', error: 'The send result could not be confirmed.' } : previous);
     if (preparedId) setError('The send result could not be confirmed. Check request status before trying again.');
     else reportError(e);
   }
 } finally { setContinuationBusy(false); }
 };
 const openNewSession = async () => {
 // A confirmed send failure can happen before a provider returns a session
 // id. In that case there is no destination to open; keep the request visible
 // for its error/status details and let the user prepare a fresh request.
 if (!continuation || !continuation.threadId || !gateway.openContinuation || !gateway.continuation || typeof current?.w.revision !== 'number') return;
 const operationId = current.id;
 setContinuationBusy(true); clearError();
 try { await gateway.openContinuation(current.w.workId, current.w.revision, continuation.id); const opened = await gateway.continuation(current.w.workId, continuation.id); if (currentIdRef.current !== operationId) return; setContinuation(opened); }
 catch (e) {
 const currentOperation = currentIdRef.current === operationId;
 if (!currentOperation) return;
 const status = await readContinuationStatus(current.w.workId, continuation.id, operationId);
   if (currentIdRef.current !== operationId) return;
 if (status) {
 if (status.state === 'result-unknown') setError('Opening result is unknown. Check the request status before trying again.');
 else if (status.state === 'failed') setError(friendlyError(status.error ?? 'The new session could not be opened.'));
 else if (status.state === 'opened') setError('The new session is open. Confirm its context before continuing.');
 else reportError(e);
 } else {
 setContinuation(previous => previous ? { ...previous, state: 'result-unknown', error: 'The opening result could not be confirmed.' } : previous);
 setError('The opening result could not be confirmed. Check the request status before trying again.');
 }
 }
 finally { setContinuationBusy(false); }
 };
 const canPrepareContinuation = typeof gateway.prepareContinuation === 'function'
   && typeof gateway.sendContinuation === 'function'
   && typeof gateway.continuation === 'function';
 const canOpenContinuation = typeof gateway.openContinuation === 'function'
   && typeof gateway.continuation === 'function';
  const automaticContinuationUnsupported = !!current && (!canPrepareContinuation
    || !current.w.session
    || current.w.session.create !== 'supported'
    || current.w.session.send !== 'supported');
  return <div className="app-shell resume-app-shell"><AppSidebar works={works} activeWorkId={workId} /><div className="resume-shell"><a className="resume-skip" href="#resume-content" onClick={event => { event.preventDefault(); document.getElementById('resume-content')?.focus(); }}>Skip to main content</a><header><strong className="resume-page-title">Resume</strong><a href="#/connect">Connect records</a></header>
    <main id="resume-content" tabIndex={-1}><p className="resume-intro">Pick up interrupted Codex work. Confirm the next step, then open it in Codex.</p>
      {error && <section role="alert" className="resume-error"><p>{error}</p><p>StateCarry kept any work it already loaded. You can try again or review the connection settings.</p>{errorDetail ? <details><summary>Technical details</summary><p className="small muted">{errorDetail}</p></details> : null}<div className="resume-state-actions"><button type="button" onClick={() => void retryList()}>Try again</button><a href="#/connect">Review connection</a></div></section>}
      {!loaded && !error && <p role="status">Reading your connected work…</p>}
      {correctionMessage && <p className="resume-correction-status" role="status" aria-live="polite">{correctionMessage}</p>}
      {loaded && !works.length && <section><h1>Where did you leave off?</h1><p>Connect a project’s Codex records to find work you can resume. You choose which records StateCarry can read.</p><a className="resume-primary" href="#/connect">Connect Codex records</a><p>Runs locally. Uses your signed-in Codex for analysis. Nothing runs on your behalf.</p></section>}
      {loaded && works.length > 1 && !workId && <section className="resume-work-chooser" aria-labelledby="choose-work-heading"><p className="resume-label">Choose where to continue</p><h1 id="choose-work-heading">Which work were you returning to?</h1><p>StateCarry found several connected records. Choose one to see its purpose, progress, and next action.</p><div className="work-chooser-list">{works.map(w => <a className="work-chooser-item" key={w.workId} href={`#/resume/${encodeURIComponent(w.workId)}`}><span><strong>{w.title}</strong><small>{w.sessionCount} connected conversation{w.sessionCount === 1 ? '' : 's'}</small></span><span className={`work-state ${stateFor(w)}`}>{stateLabel(stateFor(w))}</span><span aria-hidden="true">→</span></a>)}</div><a href="#/connect">Connect another project</a></section>}
      {works.length > 1 && workId && <details className="resume-work-switch"><summary>Change connected work · {focusedWork?.title ?? 'Choose work'}</summary><p>Choose existing records. This does not create a project or Codex session.</p>{works.map(w => <p key={w.workId}><a href={`#/resume/${encodeURIComponent(w.workId)}`}>{w.title}</a> <small>{w.sessionCount} connected sessions</small></p>)}</details>}
      {loaded && workId && !focusedWork && <section className="resume-error" role="alert"><h1>This connected work is no longer available</h1><p>It may have been disconnected, or the local server could not find it. StateCarry kept the original records unchanged; this old link will not start a new analysis.</p><div className="resume-state-actions"><a className="resume-primary" href="#/resume">Return to resume list</a><a className="resume-secondary" href="#/connect">Reconnect records</a></div></section>}
      {focusedWork && !current && <section className="resume-goal-editor"><p className="resume-label">Goal</p>{focusedWork.goalText ? <><p>{focusedWork.goalText}</p><small>Written by you</small></> : <small>No goal confirmed yet. You can state the intended result while records are analyzed.</small>} <button type="button" onClick={() => { setGoalText(focusedWork.goalText ?? ''); setGoalEditing(true); }}>{focusedWork.goalText ? 'Edit goal' : 'Set goal'}</button>
        {goalEditing && <form onSubmit={e => { e.preventDefault(); void saveGoal(); }}><label>Intended result<textarea name="goal" autoComplete="off" required maxLength={400} value={goalText} onChange={e => setGoalText(e.target.value)} /></label><p>This updates this work. It creates no new project or session and does not expand record access.</p><button disabled={saving || !goalText.trim()}>Save goal</button> <button type="button" onClick={() => setGoalEditing(false)}>Cancel</button></form>}</section>}
      {focusedWork && (focusedState !== 'ready' || focusedWork.stale || focusedWork.updatesAvailable || focusedWork.workspaceChanged) && <section className={`resume-notice resume-state-${focusedState}`} aria-live="polite" aria-busy={focusedWork.busy}><strong>{stateLabel(focusedState)}</strong>{(() => { const description = stateDescriptionFor(focusedWork); const situation = stateSituationFor(focusedWork, focusedState); return <>{<p>{description}</p>}{situation && situation !== description ? <p role={focusedState === 'failed' ? 'alert' : 'status'}>{situation}</p> : null}</>; })()}<FriendlyLimitations values={focusedView?.limitations ?? []} /><div className="resume-state-actions"><button disabled={focusedWork.busy} onClick={() => void refresh(focusedWork)}>{focusedWork.busy ? 'Checking…' : 'Check records again'}</button>{focusedState === 'empty' && dismissed[0] ? <button disabled={saving} onClick={() => void correct(focusedWork, dismissed[0].c, 'restore')}>Restore a dismissed suggestion</button> : null}<a href={`#/details/${focusedWork.workId}`}>Review connection</a></div></section>}
      {focusedView?.selectionNeedsReview && <p role="status">The selected candidate needs a recheck. Choose another candidate below or refresh its records.</p>}
      {current && <section className="resume-card" key={current.id}>
        {current.w.updatesAvailable && <p className="resume-notice" role="status">New records arrived after this snapshot. Confirm the step is still relevant, or <button disabled={current.w.busy} onClick={() => void refresh(current.w)}>Recheck records</button>.</p>}
        <p className="resume-label">Purpose</p><h1>{current.w.goalText ?? current.c.purpose}</h1><div className="resume-goal-tools"><small>{current.w.goalText ? 'Written by you' : 'Inferred from connected records · confirm before acting'}</small><button type="button" onClick={() => { setGoalText(current.w.goalText ?? current.c.purpose); setGoalEditing(true); }}>{current.w.goalText ? 'Edit goal' : 'Confirm or edit goal'}</button>{goalEditing && <form onSubmit={e => { e.preventDefault(); void saveGoal(); }}><label>Intended result<textarea name="goal" autoComplete="off" required maxLength={400} value={goalText} onChange={e => setGoalText(e.target.value)} /></label><p>This updates this work. It creates no new project or session and does not expand record access.</p><button type="submit" disabled={saving || !goalText.trim()}>Save goal</button> <button type="button" onClick={() => setGoalEditing(false)}>Cancel</button></form>}</div><p className={`resume-status ${current.c.status}`}>{current.c.statusLabel}</p>
        {current.w.correctedKeys.includes(current.c.key) && <button type="button" className="resume-restore" disabled={saving} onClick={() => void correct(current.w, current.c, 'restore')}>Restore the suggested step</button>}
        <p className="resume-hint">Based on the last checked records. Recheck before acting if the project or conversations changed.</p>
        <h2>Where you left off</h2><p>{current.c.currentState}</p><h2>Completed so far</h2><ProgressSummary candidate={current.c} /><WorkspaceStatus work={current.w} /><ProgressDetails workId={current.w.workId} candidate={current.c} />
        {current.c.actionAvailable ? <><h2>{current.c.statusHeading}</h2><p className="resume-action">{current.c.nextAction}</p><small>{current.w.correctedKeys.includes(current.c.key) ? 'Corrected by you' : current.c.actionSourceLabel}</small><p className="resume-done-when"><strong>Complete when:</strong> {current.c.doneWhen}</p></> : <><h2>{current.c.statusHeading}</h2><p>{current.c.reason}</p></>}
        {current.c.prerequisites.length > 0 && <div><h2>Before you start</h2><ul>{current.c.prerequisites.map(p => <li key={p}>{p}</li>)}</ul></div>}
        <section className="resume-brief-summary" aria-labelledby="brief-summary-heading"><h2 id="brief-summary-heading">Carry this brief forward</h2><dl><div><dt>Goal</dt><dd>{current.w.goalText ?? current.c.goal}</dd></div><div><dt>Current state</dt><dd>{current.c.currentState}</dd></div><div><dt>Next action</dt><dd>{current.c.nextAction ?? 'Confirm the current state before choosing an action.'}</dd></div><div><dt>Complete when</dt><dd>{current.c.doneWhen ?? 'A completion condition has not been confirmed.'}</dd></div><div><dt>Limits</dt><dd>{current.c.prerequisites.length ? current.c.prerequisites.join(' ') : 'No additional limits were recorded.'}</dd></div><div><dt>Supporting records</dt><dd>{current.c.evidence.length} connected record{current.c.evidence.length === 1 ? '' : 's'} support this brief. Open the detailed reason below to read them.</dd></div><div><dt>Previous conversation</dt><dd>The connected Codex conversation is available above when navigation is supported; the conversation ID is in the manual details.</dd></div></dl></section><p className="resume-location">The exact folder and collection scope are available under Review connection.</p>
        <div className="resume-primary-actions"><p className="resume-label">Where to continue</p>{current.c.target.existing.available && current.c.target.existing.url
          ? <a className="resume-primary" href={current.c.target.existing.url}>{current.c.actionAvailable ? 'Confirm & open in Codex' : 'Open in Codex'}</a>
          : <p className="resume-hint">Opening this conversation is unavailable in the current Codex connection. {current.c.nextAction && current.c.doneWhen ? 'Use the handoff instructions below.' : 'Review the saved brief and previous conversation after checking the records again.'}</p>}</div>
        <p className="resume-hint">{current.c.target.existing.detail}</p>
        <p className="resume-session-note"><strong>New session:</strong> {current.c.target.newSession.detail}</p>
        <p className="resume-session-note"><strong>Overall progress:</strong> {current.c.target.coordination.detail}</p>
        {current.c.target.coordination.available && current.c.target.coordination.url ? <a className="resume-secondary" href={current.c.target.coordination.url}>{current.c.target.coordination.label}</a> : null}
        {current.w.coordinationChoices?.length && gateway.setCoordination ? <details className="resume-coordination"><summary>Choose the conversation that tracks overall progress</summary><p className="small muted">StateCarry only assigns this role when the records support it or you choose it here.</p><label>Overall progress conversation<select name="coordination-thread" autoComplete="off" value={current.w.coordination?.threadId ?? ''} onChange={e => void chooseCoordination(current.w, e.target.value || null)} disabled={saving || coordinationBusy}><option value="">No conversation selected</option>{current.w.coordinationChoices.map(choice => <option key={choice.threadId} value={choice.threadId}>{choice.title}</option>)}</select></label>{coordinationBusy ? <p role="status" className="small">Saving this choice…</p> : null}{coordinationMessage ? <p role="status" className="resume-correction-status">{coordinationMessage}</p> : null}</details> : null}
        {current.w.coordination?.evidence.length ? <details><summary>Why this coordination conversation is suggested</summary>{current.w.coordination.evidence.map((e, i) => <blockquote key={`${e.revisionId}:${i}`}><p>{e.quote}</p><a href={`/api/v1/work-contexts/${encodeURIComponent(current.w.workId)}/evidence/${encodeURIComponent(e.revisionId)}`} target="_blank" rel="noreferrer">Read supporting record</a></blockquote>)}</details> : null}
        {(continuation && typeof gateway.continuation === 'function' || (!current.w.updatesAvailable && current.c.target.newSession.available && current.c.actionAvailable && canPrepareContinuation)) ? <div className="resume-session-actions">{current.c.actionAvailable && current.c.target.newSession.available && !current.w.updatesAvailable && canPrepareContinuation ? <button type="button" disabled={continuationBusy || !!continuation && ['dispatching', 'sent', 'opening', 'opened', 'result-unknown'].includes(continuation.state)} onClick={() => void startNewSession()}>{continuation?.state === 'prepared' ? 'Send the prepared context' : continuation?.state === 'failed' ? 'Prepare a new request and try again' : 'Prepare and send to a new session'}</button> : null}{continuation && <p role="status">{!current.c.actionAvailable || !current.c.target.newSession.available ? 'This saved request is retained, but the brief needs a fresh check before another action.' : continuationStatusLabel(continuation)}</p>}{continuation && ['result-unknown', 'dispatching', 'opening'].includes(continuation.state) && typeof gateway.continuation === 'function' ? <button type="button" disabled={continuationBusy} onClick={() => void checkContinuationStatus()}>Check request status</button> : null}{continuation && ['sent', 'failed'].includes(continuation.state) && !!continuation.threadId && current.c.actionAvailable && current.c.target.newSession.available && canOpenContinuation ? <button type="button" disabled={continuationBusy} onClick={() => void openNewSession()}>{continuation.state === 'failed' ? 'Try opening the new Codex session again' : 'Open the new Codex session'}</button> : null}</div> : null}
 {automaticContinuationUnsupported && <section className="resume-manual-handoff" aria-labelledby="manual-handoff-heading"><h2 id="manual-handoff-heading">Continue manually</h2><p><strong>Automatic continuation is unavailable.</strong> {current.c.actionAvailable && current.c.nextAction && current.c.doneWhen ? 'Copy these instructions into the conversation you want to continue.' : 'Use this review note after checking the latest records; it does not approve a file change.'}</p>{!current.c.actionAvailable ? <p className="small uncertainty">The brief still needs a fresh project or record check. Confirm the current state before changing files.</p> : null}<details className="resume-session-id"><summary>Use a conversation ID manually</summary><p className="small">If the conversation link does not open, copy this ID into Codex:</p><code>{current.c.threadId}</code></details><textarea readOnly aria-label="Handoff instructions" value={resumeHandoffText(current.c, current.w)} rows={9} /><div className="resume-manual-actions"><button className="resume-primary" type="button" onClick={() => void copyHandoff(current.c, current.w)}>Copy handoff instructions</button><span className="resume-hint">You can also use the previous conversation link above.</span></div>{copyMessage && <p role="status" aria-live="polite">{copyMessage}</p>}</section>}
        <details><summary>Why this recommendation</summary><p>{current.c.reason}</p><p>Likely next step from connected records; it is not a statement of your current priority.</p><p className="small muted">{current.c.roleLabel} · {current.c.actorLabel} · {current.c.utteranceTypeLabel}</p>{current.c.evidence.map((e, i) => <blockquote key={i}><p>{e.quote}</p><a href={`/api/v1/work-contexts/${encodeURIComponent(current.w.workId)}/evidence/${encodeURIComponent(e.revisionId)}`} target="_blank" rel="noreferrer">Original record</a></blockquote>)}<p>Analyzed {current.w.generatedAt ? new Date(current.w.generatedAt).toLocaleString() : '—'}</p><button disabled={current.w.busy} onClick={() => void refresh(current.w)}>Recheck records</button><p>If the app link does not open, use this session ID in Codex: <code>{current.c.threadId}</code></p><a href={`#/details/${current.w.workId}`}>More context / connection settings</a></details>
        <details><summary>Not This</summary><div className="resume-buttons"><button disabled={saving} onClick={() => void correct(current.w, current.c, 'wrong-work')}>Wrong work</button><button disabled={saving} onClick={() => { setEditing(true); setAction(current.c.nextAction ?? ''); setDone(current.c.doneWhen ?? ''); }}>Right work, wrong next step</button><button disabled={saving} onClick={() => void correct(current.w, current.c, 'done')}>Already done</button><button disabled={saving} onClick={() => void correct(current.w, current.c, 'paused')}>Paused</button>{current.w.correctedKeys.includes(current.c.key) && <button disabled={saving} onClick={() => void correct(current.w, current.c, 'restore')}>Restore inferred candidate</button>}</div>
        {editing && <form onSubmit={e => { e.preventDefault(); void correct(current.w, current.c, 'wrong-action'); }}><label>First action<textarea name="next-action" autoComplete="off" required maxLength={1200} value={action} onChange={e => setAction(e.target.value)} /></label><label>Done when<textarea name="done-when" autoComplete="off" required maxLength={1200} value={done} onChange={e => setDone(e.target.value)} /></label><button disabled={saving || !action.trim() || !done.trim()}>Save correction</button></form>}<p>Corrections stay on this device and inform future analysis for this work.</p></details>
      </section>}
      {(candidates.length > 1 || (!current && candidates.length > 0)) && <details className="resume-choices"><summary>{current ? `Resume something else · ${candidates.length} options` : 'Review updated brief'}</summary>{candidates.map(({ w, c, id }) => <button key={id} onClick={() => { setCorrectionMessage(''); setSelected(id); }} aria-pressed={current?.id === id}>{c.purpose}<small>{c.statusLabel} · {w.title}</small></button>)}</details>}
      {dismissed.length > 0 && <section className="resume-dismissed-restore" aria-label="Restore dismissed work"><strong>Dismissed suggestions</strong><p className="small">If you dismissed the wrong work, restore it here.</p>{dismissed.map(({ w, c }) => <p key={`${w.workId}:${c.key}`}><span>{c.purpose}</span> <button disabled={saving} onClick={() => void correct(w, c, 'restore')}>Restore suggestion</button></p>)}</section>}
    </main><footer>Local Codex records · Resume → Confirm → Act</footer></div></div>;
}
