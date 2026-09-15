import { GoalChoices, ProjectGoals } from './Goals';
import { RecordRanges } from './RecordRanges';
import { HandoffExplanation } from './HandoffExplanation';
import { ContextQuestions } from './ContextQuestions';
import { HandoffPanel } from './HandoffPanel';
import { useEffect, useRef, useState } from 'react';
import { userNatureLabel, userRelationLabel, userRoleLabel, type AppViewModel, type ClaimView, type UIAction, type ReturnContextViewModel } from '@statecarry/presentation';
import './styles.css';
import { ConversationFlow, FlowEntry } from './ConversationFlow';
import { AppSidebar } from './AppSidebar';

type Props = { onListTurns?: (id: string) => Promise<{ turns: { id: string; at: string | null }[] }>;  state: AppViewModel; onAction: (action: UIAction) => void; onConnect: (input: { title: string; cwd: string; threadIds: string[]; startTurnIds: Record<string, string>; discover: boolean }) => Promise<string | undefined>; onDiscover: (cwd: string) => Promise<{ threads: { id: string; title: string; cwd: string }[]; complete: boolean; limitations: string[] }> };
function friendlyUiError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  if (/failed to fetch|networkerror|network request failed|load failed|econnrefused|^typeerror\b/i.test(raw)) return 'StateCarry could not reach the local server. Check that it is running, then try again.';
  return raw.trim() && raw.length <= 240 ? raw : 'The request could not be completed. Try again or review the connection.';
}
function Claims({ claims, state, onAction }: { claims: ClaimView[] } & Pick<Props, 'state' | 'onAction'>) {
  return <>{claims.map(c => <div className="claim" key={c.id}>
    <p className="claim-text">{c.text}</p>
    <div className="claim-meta"><span>{userNatureLabel(c.nature)}</span>{c.edited ? <span>Display edit</span> : null}</div>
    {c.condition ? <p className="condition">Condition · {c.condition}</p> : null}
    {c.uncertainty ? <p className="uncertainty">{c.uncertainty}</p> : null}
    {c.overlayChanged ? <p className="uncertainty">New evidence arrived after this edit. Compare your edit with the latest summary.</p> : null}
    <div className="evidence-actions"><FlowEntry flow={c.flow} onAction={onAction} /></div>
    {c.uncertainty ? <details><summary>Why this was flagged</summary><p>{c.checkReason}</p></details> : null}
  </div>)}</>;
}
function SummaryReading({ state, onAction }: Pick<Props, 'state' | 'onAction'>) {
  const d = state.detail!;
  const sections = [
    ['Purpose of this work', d.purpose], ['How the work got here', d.milestones],
    ['Current status', d.current], ['Next action', d.next], ['Reasons and remaining conditions', d.reason],
    ['Direction and verification status', d.other],
  ] as const;
  return <section className="card summary-reading" aria-label="Validated summary">
    <h2>Validated summary</h2>
    <p className="small muted">Checked against the collected records. Reports and proposals do not establish independent completion.</p>
    {sections.map(([title, claims]) => claims.length ? <section className="summary-section" aria-label={title} key={title}><h3>{title}</h3><Claims claims={claims} state={state} onAction={onAction} /></section> : null)}
  </section>;
}
function Connect({ state, onConnect, onDiscover, onListTurns }: Pick<Props, 'state' | 'onConnect' | 'onDiscover' | 'onListTurns'>) {
  const [cwd, setCwd] = useState(''), [title, setTitle] = useState(''), [threads, setThreads] = useState<{ id: string; title: string; cwd: string }[]>([]), [selected, setSelected] = useState<string[]>([]), [extra, setExtra] = useState(''), [discover, setDiscover] = useState(true), [error, setError] = useState(''), [reading, setReading] = useState(false), [searched, setSearched] = useState(false);
  const searchGeneration = useRef(0);
  const [starts, setStarts] = useState<Record<string, string>>({});
  const threadIds = [...new Set([...selected, ...extra.split(',').map(t => t.trim()).filter(Boolean)])];
  return <section className="connect card"><p className="eyebrow">Choose which records to read</p><h1>Connect your work</h1><p className="muted">Read selected local Codex records to understand where you left off and what to do next.</p><p>Choose a project folder and the Codex conversations you want to read.</p><h2 className="connect-step-title">1. Choose a project folder</h2>
    <label>Project name <span className="muted">Optional</span><input name="project-name" autoComplete="off" value={title} onChange={e => setTitle(e.target.value)} placeholder="Uses the folder name if left blank" /></label>
    <label>Project folder<input name="project-folder" autoComplete="off" value={cwd} onChange={e => { const value = e.target.value; setCwd(value); if (!title.trim()) setTitle(value.split('/').filter(Boolean).at(-1) ?? 'Connected work'); searchGeneration.current++; setThreads([]); setSelected([]); setStarts({}); setSearched(false); setReading(false); setError(''); }} placeholder="Absolute path to your project" /></label>
    <button type="button" disabled={!cwd || reading} onClick={async () => { const generation = ++searchGeneration.current; setReading(true); setError(''); try { const result = await onDiscover(cwd); if (generation !== searchGeneration.current) return; setSearched(true); setThreads(result.threads); if (!result.complete) setError(result.limitations.map(friendlyUiError).join(' · ')); } catch (e) { if (generation === searchGeneration.current) setError(friendlyUiError(e)); } finally { if (generation === searchGeneration.current) setReading(false); } }}>{reading ? 'Finding conversations…' : 'Find conversations in this folder'}</button>
    <h2 className="connect-step-title">2. Choose conversations</h2><fieldset><legend>Conversations to connect</legend>{threads.length ? threads.map(t => <label className="thread-choice" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(e.target.checked ? [...selected, t.id] : selected.filter(id => id !== t.id))} /><span>{t.title}{threads.some(other => other.id !== t.id && other.title === t.title) ? <small>{t.id}</small> : null}</span></label>) : <p className="muted" role="status">{reading ? 'Looking for accessible conversations…' : searched ? 'No accessible conversations were found in this folder. Check the folder path, choose another folder, or enter a known conversation ID below. Archived conversations may need to be unarchived in Codex first.' : 'Choose a folder to find accessible conversations.'}</p>}</fieldset>
    <details><summary>Connect by conversation ID</summary><label>Conversation IDs continued from another folder <span className="muted">Optional</span><input name="conversation-ids" autoComplete="off" value={extra} onChange={e => setExtra(e.target.value)} placeholder="Separate multiple IDs with commas" /></label></details>
    <h2 className="connect-step-title">3. Confirm what StateCarry will read</h2><details><summary>What lookup reads</summary><p>Conversation discovery reads titles and IDs. Turn lookup reads local turn IDs and timestamps, without collecting source bodies or sending them to a model. Confirm the range below before collection and model preparation begin.</p></details>
    {threadIds.map(id => <InitialRange key={`${cwd}:${id}`} id={id} title={threads.find(t => t.id === id)?.title ?? id} value={starts[id] ?? ''} onChange={value => setStarts(previous => ({ ...previous, [id]: value }))} onListTurns={onListTurns} />)}
    <label className="inline-check"><input type="checkbox" checked={discover} onChange={e => setDiscover(e.target.checked)} /> Also connect explicitly continued conversations in this folder (all accessible turns of newly discovered conversations)</label>
    <p className="small">Connecting starts collection and AI preparation. Relevant records are sent through Codex to a model and use your account allowance. You can read collected sources while it works.</p>
    {error ? <p role="alert" className="error">{error}</p> : null}
    <button className="primary" type="button" disabled={state.busy || !cwd || !selected.length && !extra.trim()} onClick={async () => { const derivedTitle = title.trim() || cwd.split('/').filter(Boolean).at(-1) || 'Connected work'; const id = await onConnect({ title: derivedTitle, cwd, threadIds, discover, startTurnIds: Object.fromEntries(threadIds.filter(id => starts[id]?.trim()).map(id => [id, starts[id].trim()])) }); if (id) location.hash = `#/work/${id}`; }}>Connect selected records</button>
  </section>;
}
function InitialRange({ id, title, value, onChange, onListTurns }: { id: string; title: string; value: string; onChange: (value: string) => void; onListTurns: Props['onListTurns'] }) {
  const [turns, setTurns] = useState<{ id: string; at: string | null }[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  return <fieldset><legend>First collection range · {title}</legend>
    <label>Starting turn · {id}<input name={`starting-turn-${id}`} autoComplete="off" value={value} onChange={e => onChange(e.target.value)} placeholder="Leave blank to read all accessible turns" /></label>
    <button type="button" onClick={() => onChange('')}>Use all accessible turns</button>
    {onListTurns ? <button type="button" disabled={loading} onClick={async () => { setLoading(true); setError(''); try { const result = await onListTurns(id); setTurns(result.turns); if (!result.turns.length) setError('No local turn IDs available. Enter a known starting turn or explicitly choose all accessible turns.'); } catch (e) { setError(friendlyUiError(e)); } finally { setLoading(false); } }}> {loading ? 'Finding turn IDs…' : 'Find starting turns'}</button> : null}
    {turns.length ? <label>Choose a starting turn<select value={value} onChange={e => onChange(e.target.value)}><option value="">All accessible turns</option>{value && !turns.some(t => t.id === value) ? <option value={value}>{value} · entered manually</option> : null}{turns.map(t => <option key={t.id} value={t.id}>{t.at ?? 'Time unavailable'} · {t.id}</option>)}</select></label> : null}
    <p className="small">{value.trim() ? 'Collect this turn and later turns. A missing starting turn stops collection; it never expands to all turns. Local source coverage may be partial.' : 'All accessible turns will be collected.'}</p>
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}
function Scope({ detail, busy, onAction }: { detail: ReturnContextViewModel; busy: boolean; onAction: Props['onAction'] }) {
  const [ranges, setRanges] = useState(detail.scope.recordRanges ?? {});
  const [ids, setIds] = useState(detail.scope.threadIds.join('\n')), [starts, setStarts] = useState(detail.scope.startTurnIds), [discover, setDiscover] = useState(detail.scope.discover);
  const threadIds = [...new Set(ids.split(/[\n,]/).map(id => id.trim()).filter(Boolean))];
  return <details><summary>Review scope · Change collection scope</summary><p className="muted">Saving the scope checks it again automatically. Existing sources and drafts are preserved.</p><label>Conversation IDs to connect<textarea name="scope-conversation-ids" autoComplete="off" rows={4} value={ids} onChange={e => setIds(e.target.value)} /></label>{threadIds.map(id => <label key={id}>Starting turn · {id}<input name={`scope-starting-turn-${id}`} autoComplete="off" value={starts[id] ?? ''} placeholder="Leave blank to read all accessible turns" onChange={e => setStarts({ ...starts, [id]: e.target.value })} /></label>)}<RecordRanges records={detail.scope.records ?? []} threadIds={threadIds} ranges={ranges} onChange={setRanges} /><label className="inline-check"><input type="checkbox" checked={discover} onChange={e => setDiscover(e.target.checked)} /> Discover explicitly continued conversations</label><button type="button" disabled={busy || !threadIds.length} onClick={() => onAction({ type: 'scope', recordRanges: Object.fromEntries(threadIds.filter(id => ranges[id]).map(id => [id, { start: ranges[id].start, ...(ranges[id].end?.turnId || ranges[id].end?.itemId ? { end: ranges[id].end } : {}) }])), threadIds, startTurnIds: Object.fromEntries(threadIds.filter(id => starts[id]?.trim()).map(id => [id, starts[id].trim()])), discover })}>Save collection scope</button><button type="button" onClick={e => { setIds(detail.scope.threadIds.join("\n")); setStarts(detail.scope.startTurnIds); setRanges(detail.scope.recordRanges ?? {}); setDiscover(detail.scope.discover); const panel = e.currentTarget.closest("details"); if (panel) panel.open = false; }}>Cancel scope changes</button></details>;
}
export function App({ state, onAction, onConnect, onDiscover, onListTurns }: Props) {
  const d = state.detail, focusEvidence = useRef<HTMLDetailsElement>(null), lastEvidence = state.evidenceFocusId;
  useEffect(() => { if (lastEvidence && focusEvidence.current) { focusEvidence.current.open = true; focusEvidence.current.focus(); } }, [lastEvidence]);
  useEffect(() => { if (d) window.scrollTo(0, state.local.scroll); }, [d?.workId]);
  useEffect(() => {
    if (!d?.summaryId) return;
    const displayed = () => { if (document.visibilityState === 'visible') onAction({ type: 'displayed', summaryId: d.summaryId! }); };
    const frame = requestAnimationFrame(displayed); document.addEventListener('visibilitychange', displayed);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', displayed); };
  }, [d?.summaryId, state.evidence, onAction]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, lastScroll: number | undefined;
    const workId = d?.workId;
    const flush = () => { if (workId && lastScroll !== undefined) { onAction({ type: 'scroll', workId, value: lastScroll }); lastScroll = undefined; } };
    const scroll = () => { lastScroll = window.scrollY; clearTimeout(timer); timer = setTimeout(flush, 180); };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { window.removeEventListener('scroll', scroll); clearTimeout(timer); flush(); };
  }, [onAction, d?.workId]);
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a><AppSidebar activeWorkId={d?.workId} activeDetails={!!d} activeConnect={state.route.startsWith('#/connect')} works={state.projects.map(p => ({ workId: p.workId, title: p.title, sessionCount: 1 }))} />
    <main id="main-content" tabIndex={-1}><header className="topbar"><span>{d ? 'Project / Return' : 'My projects'}</span><span className="local-badge">{state.transport === 'connected' ? 'Connected locally' : state.transport === 'disconnected' ? 'Disconnected · freshness unknown' : 'Checking connection'}</span></header>
      {state.error ? <div className="banner error" role="alert">{friendlyUiError(state.error)}<p className="small">Your saved work remains available. Try again or review the connection settings.</p>{friendlyUiError(state.error) !== state.error ? <details><summary>Technical details</summary><p className="small">{state.error}</p></details> : null}</div> : null}{state.message ? <div className="banner" role="status">{state.message}</div> : null}
      {state.route.startsWith('#/connect') ? <Connect state={state} onConnect={onConnect} onDiscover={onDiscover} onListTurns={onListTurns} /> : d ? <>
        <a href="#/projects">Change goal</a><section className="work-heading"><p className="eyebrow">Where should you pick up?</p><h1>{d.title}</h1><div className="heading-meta">{d.hasNewSummary ? <span className="new-pill">New summary since your last visit</span> : null}</div></section>
        <section className="notice reading-status" aria-label="Latest checked scope">
          <p><strong>{d.freshnessLabel}</strong></p>
          {d.scopeNotice ? <p>{d.scopeNotice}</p> : d.stale ? <p>This summary uses earlier input or settings. Check unreflected sources before acting.</p> : null}
          {d.jobLabel !== 'Summary applied' ? <p role="status">{d.jobLabel}{d.error ? '. Sources and the last validated summary are preserved.' : ''}</p> : null}
          <details><summary>Collection status and coverage</summary>
            <p>Summary generated {d.summarizedAt} · Input captured {d.inputCapturedAt}</p><p>{d.jobLabel}{d.refreshTiming ? ` · ${d.refreshTiming}` : ''}</p>
            {d.pendingLabel ? <p role="status">{d.pendingLabel}</p> : null}
            {d.ranges.filter(r => r.items.length).map(r => <details key={r.label}><summary>{r.label} · {r.items.length} items</summary><div className="raw-list">{r.items.map(item => item.accessible ? <button type="button" key={item.id} onClick={() => onAction({ type: 'evidence', id: item.id })}>{item.label}</button> : <p key={item.id}>{item.label} · Outside the current access scope</p>)}</div></details>)}
            <p>Last successful collection · {d.lastCollectedAt}</p>{d.freshnessReasons.map(reason => <p key={reason}>{reason}</p>)}
            {d.error ? <details><summary>Failure details</summary><p>{d.error}</p>{d.retryJobId ? <button type="button" disabled={state.busy} onClick={() => onAction({ type: 'retry', jobId: d.retryJobId! })}>Retry summary</button> : null}</details> : null}
            {d.priorAttemptError ? <details><summary>Previous summary error</summary><p>{d.priorAttemptError}</p></details> : null}
          </details>
        </section>
        <nav className="reading-actions" aria-label="Work actions"><a href="#continue" onClick={e => { e.preventDefault(); const panel = document.getElementById("continue"); if (panel instanceof HTMLDetailsElement) panel.open = true; panel?.focus(); }}>Prepare to continue in Codex</a><a href="#connections" onClick={e => { e.preventDefault(); const panel = document.getElementById("connections"); if (panel instanceof HTMLDetailsElement) panel.open = true; panel?.focus(); }}>Review scope / Manage connections</a></nav>

        <HandoffExplanation state={state} onAction={onAction} />
        {state.question?.open && (state.question.anchorType !== 'explanation' && !state.openedFlow) ? <ContextQuestions sourceTitles={Object.fromEntries((state.detail?.links ?? []).map(link => [link.threadId, link.title]))} state={state.question} onAction={onAction} /> : null}
        {d.summaryId ? state.explanation?.revision ? <details className="legacy-context"><summary>Summary and supporting detail</summary><SummaryReading state={state} onAction={onAction} /></details> : <SummaryReading state={state} onAction={onAction} /> : null}
        <HandoffPanel state={state} onAction={onAction} />
        <details className="card evidence-panel" ref={focusEvidence} tabIndex={-1} aria-label="Selected source"><summary>Sources and attribution</summary><p className="muted">Recorded and collected times are shown separately. Opening a record does not approve or review it.</p>{Object.values(state.evidence).length ? Object.values(state.evidence).map(e => <details open={e.id === lastEvidence} key={e.id}><summary>{d.links.find(l => e.source.includes(l.threadId))?.title ?? 'Collected source'} · {e.actor}</summary><p className="small">Recorded at {e.recordedAt}</p><details><summary>Source location and collection details</summary><dl className="source-info"><dt>Source</dt><dd>{e.source}</dd><dt>Original item aliases</dt><dd>{e.aliases.length ? e.aliases.join(" · ") : "API  item or no aliases"}</dd><dt>Location</dt><dd>{e.locator}</dd><dt>Recorded at</dt><dd>{e.recordedAt}</dd><dt>Collected at</dt><dd>{e.observedAt}</dd></dl></details><pre>{e.text}</pre>{e.limitations.map(x => <p className="uncertainty" key={x}>{x}</p>)}<label className="inline-check"><input type="checkbox" checked={state.local.evidenceIds.includes(e.id)} onChange={x => onAction({ type: 'selectEvidence', id: e.id, selected: x.target.checked })} /> Select this source for continuing</label></details>) : <p>Open conversation context below a judgment, then select Read quote and source.</p>}<details><summary>Browse collected sources</summary><div className="raw-list">{d.sourceIndex.map(item => <button type="button" key={item.id} onClick={() => onAction({ type: "evidence", id: item.id })}>{item.label}<small>{item.summarized ? "Input to the displayed summary" : "Not yet reflected in this summary"}</small></button>)}</div></details><details><summary>Browse recently collected sources</summary><div className="raw-list">{d.recentEvidenceIds.map((id, i) => <button key={id} type="button" onClick={() => onAction({ type: 'evidence', id })}>Source {i + 1} · {id.slice(0, 10)}</button>)}</div></details></details>
        <details className="card"><summary>Direction, observations and display edits</summary><div className="secondary-grid"><section className="card"><h2>Verification observations</h2><h3>Recent external turn observations</h3>{d.execution.map(e => <div className="execution" key={e.id}><span>{e.text}</span><button type="button" className="text-button" onClick={() => onAction({ type: 'evidence', id: e.evidenceId })}>Source status</button></div>)}</section><section className="card"><h2>Edit displayed information</h2><p className="muted small">Edits change the displayed text and persist across summaries. They do not alter sources, external actions or approvals.</p><label>Information to edit<select value={state.local.correctionSlot} onChange={e => onAction({ type: 'correction', value: state.local.correction, slot: e.target.value as 'current' | 'next' | 'reason' })}><option value="current">Current status</option><option value="next">Next action</option><option value="reason">Reason</option></select></label><label>Your correction<textarea value={state.local.correction} onChange={e => onAction({ type: 'correction', value: e.target.value, slot: state.local.correctionSlot })} rows={4} /></label><div className="button-row"><button type="button" disabled={state.busy || !d.summaryId} onClick={() => onAction({ type: 'saveCorrection' })}>Save display edit</button><button type="button" disabled={state.busy || !d.summaryId} onClick={() => onAction({ type: 'saveCorrection', undo: true })}>Restore automatic summary</button></div></section></div></details>
        <details className="card" id="connections" tabIndex={-1}><summary>Connections and collection scope</summary><p className="muted small">{d.scope.discoveryLabel}</p><Scope key={d.workId} detail={d} busy={state.busy} onAction={onAction} /><div className="connection-lifecycle"><h3>Stop showing this connected work</h3><p className="small">Remove this connection from StateCarry. The original Codex conversations and project files stay unchanged, and you can reconnect them later.</p><button type="button" disabled={state.busy} onClick={() => onAction({ type: "removeConnection" })}>Disconnect this work</button></div><p className="muted small">Source {d.sourceCount} items · versions used in the summary {d.inputCount} items · {d.model} · {d.effortLabel} · {d.processingLabel}</p><p className="muted small">Last viewed summary {d.viewedSummaryId?.slice(0, 10) ?? "None"} · Sources opened for that summary {d.viewedEvidenceCount} items · {d.viewedAt}. Opening a record does not establish review or completion.</p>{d.links.map(l => <div className="link-row" key={l.id}><div><strong>{l.title}</strong><small>{userRoleLabel(l.role)} · {l.statusLabel}</small>{l.rationale ? <p className="small">{l.relation ? `${userRelationLabel(l.relation)} · ` : ""}{l.rationale}</p> : null}{l.status !== 'linked' ? <small>This conversation is excluded from the current summary.</small> : null}{l.evidenceIds.map(id => <button className="text-button" type="button" key={id} onClick={() => onAction({ type: 'evidence', id })}>Check connection evidence</button>)}</div><div className="button-row">{l.status !== 'separate' ? <button type="button" disabled={state.busy} onClick={() => onAction({ type: 'link', id: l.id, status: 'separate' })}>Keep separate</button> : null}{l.status !== 'linked' ? <button type="button" disabled={state.busy} onClick={() => onAction({ type: 'link', id: l.id, status: 'linked' })}>Connect to this work</button> : null}<button type="button" disabled={state.busy} onClick={() => onAction({ type: 'link', id: l.id, status: 'deferred' })}>Review later</button>{l.canUndo ? <button type="button" disabled={state.busy} onClick={() => onAction({ type: 'link', id: l.id, status: 'linked', undo: true })}>Undo</button> : null}</div></div>)}<details><summary>Last checked scope by source</summary>{d.checkpoints.map(c => <div key={c.id}><h3>{c.title}</h3><p>{c.label} · {c.count} items · {c.at}</p>{c.limitations.map(l => <p className="small muted" key={l}>{l}</p>)}</div>)}</details>{d.limitations.length ? <details><summary>Missing or unknown · {d.limitations.length} items</summary>{d.limitations.map(l => <p className="small" key={l}>{l}</p>)}</details> : null}</details>
      </> : <ProjectGoals state={state} />}
      {d && state.openedFlow ? <ConversationFlow key={state.openedFlow.id} flow={state.openedFlow} state={state} onAction={onAction} /> : null}
      <footer>StateCarry · Based on the last checked records.</footer>
    </main></div>;
}
