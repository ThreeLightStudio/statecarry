import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  userActorLabel,
  type AppViewModel,
  type FlowView,
  type UIAction,
} from '@statecarry/presentation';
import './flow-graph.css';
import { ContextQuestions } from './ContextQuestions';

const Graph = lazy(() => import('./FlowGraph').catch(() => ({ default: GraphLoadFailure })));
function GraphLoadFailure({ onFallback }: { onFallback: (message: string) => void }) {
  useEffect(() => {
    onFallback('The graph could not be loaded. The same information is available as text.');
  }, [onFallback]);
  return null;
}
type Action = (action: UIAction) => void;
export function FlowEntry({ flow, onAction }: { flow: FlowView; onAction: Action }) {
  const tooltipId = useId(),
    [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="flow-entry"
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDismissed(true);
      }}
    >
      <button
        type="button"
        className="text-button flow-trigger"
        aria-haspopup="dialog"
        aria-describedby={dismissed ? undefined : tooltipId}
        onClick={() => {
          setDismissed(true);
          onAction({ type: 'openFlow', id: flow.id });
        }}
      >
        {flow.edited ? 'Evidence for original summary' : 'Conversation context'}
      </button>
      {!dismissed ? (
        <span className="flow-preview" id={tooltipId} role="tooltip">
          {flow.preview}
        </span>
      ) : null}
    </span>
  );
}

export function ConversationFlow({
  flow,
  state,
  onAction,
}: {
  flow: FlowView;
  state: AppViewModel;
  onAction: Action;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  const detailsHeading = useRef<HTMLHeadingElement>(null),
    detailsId = useId();
  const [rawIds, setRawIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'text' | 'graph'>('text'),
    [requested, setRequested] = useState(false);
  const [fallback, setFallback] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    flow.items.filter((item) => item.claimId === flow.claimId).map((item) => item.id),
  );
  const selectionReturnTarget = useRef<HTMLButtonElement | null>(null),
    revealSelection = useRef(false);
  const selectItems = (ids: string[], returnTarget: HTMLButtonElement) => {
    selectionReturnTarget.current = returnTarget;
    revealSelection.current = true;
    // A fresh selection also reveals an already-selected item after returning to the graph.
    setSelectedIds([...ids]);
  };
  useLayoutEffect(() => {
    if (!revealSelection.current) return;
    revealSelection.current = false;
    if (mode !== 'graph' || fallback) return;
    // Run after the selected details have committed, never against the previous item's layout.
    detailsHeading.current?.focus({ preventScroll: true });
    detailsHeading.current?.scrollIntoView({ block: 'start' });
  }, [selectedIds, mode, fallback]);
  const onFallback = useCallback((message: string) => setFallback(message), []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      if (opener?.isConnected) opener.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  const current = state.detail;
  const edited =
    flow.edited ||
    !!(
      current?.summaryId === flow.summaryId &&
      [
        ...current.current,
        ...current.next,
        ...current.reason,
        ...current.purpose,
        ...current.milestones,
        ...current.other,
      ].some((c) => c.id === flow.claimId && c.edited)
    );
  return (
    <dialog
      className="flow-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onAction({ type: 'closeFlow' });
      }}
    >
      <div className="section-top">
        <h2 id={titleId}>Conversation context · {flow.title}</h2>
        <button type="button" onClick={() => onAction({ type: 'closeFlow' })}>
          Close
        </button>
      </div>
      {current?.summaryId !== flow.summaryId ? (
        <p className="banner warning">
          A new summary is available. This detail still uses the summary you opened.
        </p>
      ) : null}
      {edited ? (
        <p className="uncertainty">
          This evidence supports the original summary. Your edited text has not been validated
          against this context.
        </p>
      ) : null}
      <p className="small muted">
        Related discussions cite the same source as this judgment. Their order does not establish
        chronology or causality; missing stages are not reconstructed.
      </p>
      {flow.limitations.map((text, i) => (
        <p className="uncertainty" key={i}>
          {text}
        </p>
      ))}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div
        className="button-row flow-view-controls"
        role="group"
        aria-label="Read conversation context"
      >
        <button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')}>
          Text
        </button>
        <button
          type="button"
          aria-pressed={mode === 'graph'}
          onClick={() => {
            setRequested(true);
            setMode('graph');
          }}
        >
          Graph
        </button>
        {mode === 'graph' && !fallback && selectionReturnTarget.current ? (
          <button
            type="button"
            onClick={() => {
              selectionReturnTarget.current?.focus({ preventScroll: true });
              selectionReturnTarget.current?.scrollIntoView({ block: 'center' });
            }}
          >
            Back to item selection
          </button>
        ) : null}
      </div>
      {requested ? (
        <div hidden={mode !== 'graph' || !!fallback}>
          <Suspense fallback={<p role="status">Loading the graph.</p>}>
            <Graph
              flow={flow}
              onSelect={selectItems}
              onFallback={onFallback}
              detailsId={detailsId}
            />
          </Suspense>
        </div>
      ) : null}
      {mode === 'graph' && fallback ? (
        <p role="status" className="uncertainty">
          {fallback}
        </p>
      ) : null}
      {mode === 'graph' && !fallback ? (
        <h3 ref={detailsHeading} className="flow-details-heading" tabIndex={-1}>
          {selectedIds.length > 1
            ? `Items linked to shared source ${selectedIds.length} items`
            : 'Selected item details'}
        </h3>
      ) : null}
      <ul id={detailsId} className="flow-items">
        {flow.items.map((item) => (
          <li
            key={item.id}
            hidden={mode === 'graph' && !fallback && !selectedIds.includes(item.id)}
          >
            <p className="flow-kind">
              {item.claimId === flow.claimId ? 'This judgment' : 'Related discussion'} ·{' '}
              {item.typeLabel} · {item.statusLabel}
            </p>
            <p className="flow-text">{item.summary}</p>
            {item.condition ? <p className="condition">Condition · {item.condition}</p> : null}
            {item.limitations.map((text, i) => (
              <p className="small muted" key={i}>
                {text}
              </p>
            ))}
            <details>
              <summary>Claim check reason</summary>
              <p>{item.checkReason}</p>
            </details>
            {item.sources.map((source, index) => {
              const raw = state.evidence[source.revisionId],
                opened = rawIds.includes(source.revisionId);
              return (
                <div className="flow-source" key={`${source.revisionId}:${index}`}>
                  <p className="small muted">
                    {state.detail?.links.find((link) => link.threadId === source.threadId)?.title ??
                      'Conversation source'}{' '}
                    · {userActorLabel(source.actor)} ·{' '}
                    {source.eventAt ? `Sent ${source.eventAt}` : 'Send time unknown'}
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={!source.available}
                      aria-expanded={opened}
                      onClick={() => {
                        setRawIds((ids) =>
                          opened
                            ? ids.filter((id) => id !== source.revisionId)
                            : [...ids, source.revisionId],
                        );
                        if (!opened)
                          onAction({ type: 'evidence', id: source.revisionId, withinFlow: true });
                      }}
                    >
                      {opened
                        ? 'Hide source'
                        : source.available
                          ? 'Read quote and source'
                          : 'Source access unknown'}
                    </button>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={state.local.evidenceIds.includes(source.revisionId)}
                        onChange={(event) =>
                          onAction({
                            type: 'selectEvidence',
                            id: source.revisionId,
                            selected: event.target.checked,
                          })
                        }
                      />{' '}
                      Select this source for continuing
                    </label>
                  </div>
                  {opened ? (
                    <div className="flow-raw">
                      <p>Quote · {source.quote}</p>
                      <details>
                        <summary>Citation details</summary>
                        <p className="small muted">
                          Source version · {source.revisionId}
                          <br />
                          Conversation / turn / item · {source.threadId} / {source.turnId} /{' '}
                          {source.itemId}
                          <br />
                          Quote offset (zero-based UTF-16) ·{' '}
                          {source.quoteStarts.length ? source.quoteStarts.join(', ') : 'Unknown'}
                          <br />
                          Collection · {source.observedAt ?? 'Unknown'}
                        </p>
                      </details>
                      {raw ? (
                        <>
                          <details>
                            <summary>Read the full source</summary>
                            <pre>{raw.text}</pre>
                            <details>
                              <summary>Source location</summary>
                              <p>{raw.locator}</p>
                            </details>
                          </details>
                          {raw.limitations.map((text, i) => (
                            <p className="uncertainty" key={i}>
                              {text}
                            </p>
                          ))}
                        </>
                      ) : (
                        <p role="status">
                          {state.error
                            ? 'The source could not be loaded. Collapse and reopen to try again.'
                            : 'Loading the source.'}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      <details>
        <summary>Fixed scope of this context</summary>
        <p>Summary · {flow.summaryId}</p>
        <p>Input source version · {flow.sourceRevisionIds.length} items</p>
      </details>
      <button type="button" onClick={() => onAction({ type: 'questionOpen' })}>
        Ask a question
      </button>
      {state.question?.open && state.question.anchorType !== 'explanation' ? (
        <ContextQuestions
          sourceTitles={Object.fromEntries(
            (state.detail?.links ?? []).map((link) => [link.threadId, link.title]),
          )}
          state={state.question}
          onAction={onAction}
        />
      ) : null}
    </dialog>
  );
}
