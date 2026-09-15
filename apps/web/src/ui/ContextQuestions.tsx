import { useId, useRef, useEffect, useState } from 'react';
import { userActorLabel, type QuestionView, type UIAction } from '@statecarry/presentation';
import './questions.css';

export function ContextQuestions({ state, onAction, sourceTitles = {}, focusOnOpen = true }: { focusOnOpen?: boolean; sourceTitles?: Record<string, string>; state: QuestionView; onAction: (action: UIAction) => void }) {
  const title = useId(), input = useRef<HTMLTextAreaElement>(null);
  const [rawOpen, setRawOpen] = useState<string[]>([]);
  useEffect(() => {
    if (!focusOnOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (state.open) input.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [state.open, focusOnOpen]);
  if (!state.open) return null;
  const session = state.session, pending = session?.turns.some(t => ['queued', 'generating', 'repairing', 'checking', 'result-unknown'].includes(t.status));
  const disabled = state.busy || pending || state.uncertain || session?.invalidated;
  const statuses: Record<string, string> = { queued: 'Waiting for the model', generating: 'Preparing an answer from related records', repairing: 'Revising against sources', checking: 'Checking the answer against its evidence', completed: 'Answer ready', failed: 'Answer failed', 'result-unknown': 'Run completion unknown · automatic retry stopped', invalidated: 'Stopped after the connection scope changed' };
  return <section className="context-questions" aria-labelledby={title}>
    <div className="section-top"><h3 id={title}>Ask about this judgment</h3><button type="button" onClick={() => onAction({ type: 'questionClose' })}>Close question</button></div>
    <p className="small muted">Question input is saved for this goal and explanation version, including after switching goals or reloading. Earlier answers are checked again before display. Sessions expire after 30 minutes of inactivity.</p>
    {session?.stale ? <p className="banner warning">This question uses an earlier summary. Close the detail and ask from the new summary to use its basis.</p> : null}
    {session ? <p className="question-anchor">Question about · {session.anchor}</p> : null}
    {(state.savedTargets?.length ?? 0) > 1 ? <details><summary>Saved questions about other sentences</summary><div className="button-row">{state.savedTargets?.map(t => <button type="button" key={t.key} disabled={t.key === state.targetKey} onClick={() => onAction({ type: 'questionSelect', key: t.key })}>{t.label}</button>)}</div></details> : null}
    <div className="question-transcript" aria-live="polite" aria-relevant="additions text">
      {session?.turns.map(turn => <article key={turn.id} className="question-turn">
        <h4>Question · {turn.text}</h4><p className="small muted" role="status">{session?.invalidated ? 'Answer withdrawn · source scope changed' : statuses[turn.status]}</p>
        {turn.answer && !session?.invalidated ? <>
          {(['record', 'interpretation'] as const).map(kind => {
            const items = turn.answer!.items.filter(i => i.kind === kind);
            return items.length ? <div key={kind}><h4>{kind === 'record' ? 'What the records say' : 'AI interpretation'}</h4>{items.map(item => <div key={item.id}>
              <p>{item.text}</p>{item.uncertainty ? <p className="uncertainty">{item.uncertainty}</p> : null}
              {item.evidence.map((ref, index) => {
                const key = `${turn.id}:${item.id}:${index}`, raw = state.raw[ref.revisionId], opened = rawOpen.includes(key);
                return <div className="question-citation" key={key}>
                  <button type="button" className="text-button" aria-expanded={opened} onClick={() => {
                    setRawOpen(old => opened ? old.filter(k => k !== key) : [...old, key]);
                    if (!opened) onAction({ type: 'questionEvidence', turnId: turn.id, revisionId: ref.revisionId });
                  }}>Source {index + 1} · {item.kind === 'interpretation' ? 'Interpretation evidence' : 'Record evidence'} · {opened ? 'Collapse' : 'Read quote and source'}</button>
                  {opened ? <div className="question-raw"><blockquote>{ref.quote}</blockquote>{raw ? <><p className="small muted">{sourceTitles[raw.threadId] ?? 'Conversation source'} · {userActorLabel(raw.actor)} · {raw.eventAt ?? 'Send time unknown'}</p>{raw.locator.path?.includes('/archived_sessions/') ? <p className="uncertainty">This source is in archived records. You may need to unarchive the conversation in Codex to open its original view.</p> : null}<details><summary>Read the full source</summary><pre>{raw.text}</pre><details><summary>Citation details</summary><p>{raw.threadId} / {raw.turnId} · {ref.revisionId} · Quote offset {ref.start}</p></details></details></> : <p role="status">{state.error ? 'Source lookup failed. Collapse and reopen to try again.' : 'Loading the source.'}</p>}</div> : null}
                </div>;
              })}
            </div>)}</div> : null;
          })}
          {turn.answer.unknowns.length ? <div><h4>What remains unknown</h4>{turn.answer.unknowns.map((text, i) => <p key={i} className="uncertainty">{text}</p>)}</div> : null}
          {turn.limitations.map((text, i) => <p className="small muted" key={i}>{text}</p>)}
        </> : null}
        {turn.error ? <p role="alert" className="error">{turn.error}</p> : null}
        {turn.retryable ? <button type="button" disabled={!!disabled} onClick={() => onAction({ type: 'questionRetry', turnId: turn.id })}>Retry this question once</button> : null}
      </article>)}
    </div>
    {state.error ? <p role="alert" className="error">{state.error}</p> : null}
    <div className="button-row">
      {['Why is this action needed?', 'What discussions led here?', 'Please explain that in more detail.'].map(text => <button type="button" key={text} onClick={() => { onAction({ type: 'questionInput', value: text }); input.current?.focus(); }}>{text}</button>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); if (!disabled) onAction({ type: 'questionSubmit' }); }}>
      <label htmlFor={`${title}-input`}>Your question</label>
      <textarea id={`${title}-input`} ref={input} maxLength={2000} value={state.input} onChange={event => onAction({ type: 'questionInput', value: event.target.value })} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!disabled) onAction({ type: 'questionSubmit' }); }
      }} />
      <p className="small muted">Enter to submit · Shift+Enter for a new line · {state.input.length}/2,000 characters · Up to 10 exchanges. Questions stay here and are not sent to external conversations or added to your draft.</p>
      <div className="button-row"><button type="submit" disabled={!!disabled || !state.input.trim()}>Ask question</button><button type="button" onClick={() => onAction({ type: 'questionRefresh' })}>Check status</button><button type="button" disabled={state.busy} onClick={() => { setRawOpen([]); onAction({ type: 'questionNew' }); }}>Start a new question with this context</button></div>
    </form>
  </section>;
}
