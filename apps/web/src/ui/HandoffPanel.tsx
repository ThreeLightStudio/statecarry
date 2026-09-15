import { useEffect, useRef } from 'react';
import { userRoleLabel, type AppViewModel, type UIAction } from '@statecarry/presentation';

export function HandoffPanel({ state, onAction }: { state: AppViewModel; onAction: (action: UIAction) => void }) {
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.handoff) confirmation.current?.focus(); }, [state.handoff]);
  const d = state.detail;
  if (!d) return null;
  const h = state.handoff, request = state.local.openRequest;
  const linked = d.links.filter(link => link.status === 'linked');
  const targetLinked = linked.some(link => link.threadId === state.local.targetThreadId);
  const basisChanged = !!state.local.basisSummaryId && state.local.basisSummaryId !== d.summaryId;
  const blocked = state.busy || state.transport === 'disconnected';
  return <details className="card continue-panel" id="continue" tabIndex={-1}><summary>Prepare to continue in Codex</summary><section>
    <p className="eyebrow">Same work · same evidence</p><h2>Continue in the original conversation</h2>
    <p className="muted">{state.local.evidenceIds.length} selected sources and your draft are preserved. Nothing is automatically copied, entered or sent.</p>
    <details><summary>Draft basis</summary><p className="small muted">Draft summary basis · {state.local.basisSummaryId ?? d.summaryId ?? 'Not summarized yet'}</p></details>
    {basisChanged ? <div className="banner warning">Your draft and evidence use a different summary basis. Review the basis below before opening Codex.
      <button type="button" disabled={!d.summaryId} onClick={() => onAction({ type: 'adoptSummary' })}>Keep evidence and use the current summary</button></div> : null}
    <label>Codex conversation to continue<select value={state.local.targetThreadId} onChange={e => onAction({ type: 'target', threadId: e.target.value })}>
      <option value="">Select a conversation</option>
      {!targetLinked && state.local.targetThreadId ? <option value={state.local.targetThreadId}>Previous selection · no longer connected</option> : null}
      {linked.map(link => <option key={link.id} value={link.threadId}>{link.title} · {userRoleLabel(link.role)}</option>)}
    </select></label>
    {!targetLinked && state.local.targetThreadId ? <p role="status">The selected conversation is no longer connected. Choose a currently connected Codex conversation.</p> : null}
    {state.local.draftRevision !== d.serverDraft.revision ? <div className="banner warning">A draft saved in another window has changed.
      <details><summary>View the server draft</summary><pre>{d.serverDraft.text}</pre></details>
      <button type="button" onClick={() => onAction({ type: 'adoptDraftVersion' })}>Keep my input and update the save revision</button></div> : null}
    <label>Draft your next request<textarea rows={5} value={state.local.draft} onChange={e => onAction({ type: 'draft', value: e.target.value })} placeholder="Write the request you want to continue with in Codex, using your selected evidence." /></label>
    <details><summary>Selected evidence · {state.local.evidenceIds.length} items</summary>
      {state.local.evidenceIds.map(id => {
        const source = d.sourceIndex.find(item => item.id === id);
        const reflected = source?.summarized;
        return <div className="handoff-evidence" key={id}><p>{source?.label ?? id}{!source ? ' · Outside the current access scope' : !reflected ? ' · Outside the current summary input' : ''}</p>
          {source ? <button type="button" onClick={() => onAction({ type: 'evidence', id })}>Read selected source</button> : null}
          <button type="button" onClick={() => onAction({ type: 'selectEvidence', id, selected: false })}>Remove this evidence</button></div>;
      })}
    </details>
    <div className="button-row">
      <button type="button" disabled={blocked || !d.summaryId} onClick={() => onAction({ type: 'saveDraft' })}>Save draft{state.local.dirty ? ' · Changed' : ''}</button>
      <button type="button" disabled={blocked || basisChanged || !!request || !d.summaryId || !state.local.evidenceIds.length || !targetLinked} onClick={() => onAction({ type: 'prepareHandoff' })}>Review target and evidence</button>
    </div>
    <p className="small muted">If the conversation is archived, Codex may require you to unarchive it before opening its original record. StateCarry does not unarchive conversations.</p><details><summary>Opening availability</summary><p className="small muted">{d.navigationDetail}</p></details>
    {!d.navigationEnabled ? <details><summary>Set up opening in Codex</summary>
      <p>In an interactive terminal in your StateCarry source folder, run the command below for the selected connected conversation.</p>
      {targetLinked ? <><p>Target: {linked.find(link => link.threadId === state.local.targetThreadId)?.title}</p><code>{state.local.targetThreadId}</code><pre>{`rtk proxy node dist/verify-connection.mjs --verify-navigation '${state.local.targetThreadId.replaceAll("'", "'\\''")}'`}</pre></> : <p>Select a connected conversation above to show its verification command.</p>}
      <p>Inspect the title and contents in Codex. Only after arriving at the correct conversation, type the exact arrived response requested by the terminal. Press Enter without confirmation for a blank or wrong view. An accepted open request does not confirm arrival.</p>
      <p>If the server uses STATECARRY_DATA_DIR, use that same value for the CLI. Existing observation files are preserved. After successful setup, reload StateCarry and review the target and evidence again. Unarchive in Codex yourself if needed.</p>
    </details> : null}
    {state.transport === 'disconnected' ? <p role="status">The server is disconnected. Review the target and evidence once the connection returns. Use Check open request to look up an existing request.</p> : null}
    {h ? <div className="handoff-confirm" ref={confirmation} tabIndex={-1} aria-label="Review target and evidence">
      <h3>{h.title}</h3><p>{userRoleLabel(h.role)}</p>
      <details><summary>Conversation ID</summary><code>{h.threadId}</code></details>
      <p>Selected evidence {h.evidenceIds.length} selected sources and the draft below are preserved. Opening targets the conversation; the draft is not sent.</p>
      <ul>{h.evidenceIds.map(id => <li key={id}>{d.sourceIndex.find(item => item.id === id)?.label ?? id}</li>)}</ul>
      <pre>{h.draft || 'No draft written'}</pre>
      <button type="button" className="primary" disabled={blocked || basisChanged || !!request || !d.navigationEnabled} onClick={() => onAction({ type: 'openHandoff' })}>Open conversation in Codex ↗</button>
    </div> : null}
    {request ? <div className="handoff-confirm" aria-label="Open request status">
      <strong>{request.title}</strong>
      <p role="status">{request.state === 'dispatched' ? 'Open request sent. Check your arrival in Codex.' : request.state === 'failed' ? 'The open request failed.' : request.state === 'dispatching' ? 'The open request is processing. It will not run again automatically.' : 'The open request result is unknown. It will not run again automatically.'}</p>
      {request.error ? <p>{request.error}</p> : null}
      <details><summary>Request ID</summary><code>{request.requestId}</code></details>
      <div className="button-row"><button type="button" disabled={state.busy} onClick={() => onAction({ type: 'checkHandoff' })}>Check open request</button>
        {request.state === 'failed' ? <button type="button" disabled={blocked || basisChanged} onClick={() => onAction({ type: 'retryHandoff' })}>Prepare to open again</button> : null}
        {request.state === 'dispatched' ? <button type="button" disabled={blocked || basisChanged} onClick={() => onAction({ type: 'newHandoff' })}>Prepare a new open request</button> : null}</div>
      {request.state === 'failed' ? <p className="small muted">After checking the failure, prepare again to recheck the latest target and evidence. A new request is sent only when you press Open again.</p> : null}
    </div> : null}
    <p className="small muted">{d.reviewLabel}</p>
  </section></details>;
}
