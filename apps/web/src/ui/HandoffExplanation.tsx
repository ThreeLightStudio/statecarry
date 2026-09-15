import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  userActorLabel,
  userNatureLabel,
  type AppViewModel,
  type ExplanationNode,
  type ExplanationCandidate,
  type UIAction,
} from '@statecarry/presentation';
import './explanations.css';
import { ContextQuestions } from './ContextQuestions';

const statuses: Record<string, string> = {
  waiting: 'Waiting to prepare the explanation.',
  queued: 'Waiting for the explanation model.',
  generating: 'Connecting the background and progress of this work.',
  repairing: 'Revising the explanation after checking its evidence.',
  checking: 'Checking evidence for the explanation and its reasons.',
  ready: 'Explanation ready',
  failed: 'The explanation could not be prepared.',
  superseded: 'The explanation basis has changed.',
  'result-unknown':
    'The previous explanation run has not been confirmed to have ended. Automatic retry is stopped.',
};
type Props = { state: AppViewModel; onAction: (action: UIAction) => void };

function Citation({
  references,
  state,
  onAction,
}: Props & { references: ExplanationNode['evidence'] }) {
  const [open, setOpen] = useState(false),
    opener = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="explanation-citations"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          opener.current?.focus();
        }
      }}
    >
      <button
        ref={opener}
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open)
            references.forEach((ref) => {
              if (!state.explanation?.raw[ref.revisionId])
                onAction({ type: 'explanationEvidence', revisionId: ref.revisionId });
            });
        }}
      >
        {open ? 'Hide evidence' : `Read quotes and evidence · ${references.length} items`}
      </button>
      {open
        ? references.map((ref, index) => (
            <div key={`${ref.revisionId}:${ref.start}:${index}`}>
              <blockquote>{ref.quote}</blockquote>
              <p className="small muted">
                {state.detail?.links.find((link) =>
                  state.explanation?.raw[ref.revisionId]?.source.includes(link.threadId),
                )?.title ?? 'Conversation source'}{' '}
                · {userActorLabel(state.explanation?.raw[ref.revisionId]?.actor)}
              </p>
              <details>
                <summary>Citation details</summary>
                <p className="small muted">
                  Quote offset {ref.start} · Fixed source {ref.revisionId}
                </p>
              </details>
              <RawSource revisionId={ref.revisionId} state={state} onAction={onAction} />
            </div>
          ))
        : null}
    </div>
  );
}
function RawSource({ revisionId, state, onAction }: Props & { revisionId: string }) {
  const [opened, setOpened] = useState(false),
    panel = useRef<HTMLDivElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const raw = state.explanation?.raw[revisionId];
  useEffect(() => {
    if (opened && raw) panel.current?.focus();
  }, [opened, raw]);
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-expanded={opened}
        onClick={() => {
          setOpened(!opened);
          if (!opened) onAction({ type: 'explanationEvidence', revisionId });
        }}
      >
        {opened ? 'Hide source' : 'Read the full source'}
      </button>
      {opened ? (
        <div
          className="explanation-raw"
          ref={panel}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpened(false);
              opener.current?.focus();
            }
          }}
        >
          {raw ? (
            <>
              <p className="small muted">
                {state.detail?.links.find((link) => raw.source.includes(link.threadId))?.title ??
                  'Conversation source'}{' '}
                · {userActorLabel(raw.actor)} · {raw.recordedAt}
              </p>
              {raw.locator.includes('/archived_sessions/') ? (
                <p className="uncertainty">
                  This source is in archived records. You may need to unarchive the conversation in
                  Codex to open its original view.
                </p>
              ) : null}
              <pre>{raw.text}</pre>
              <details>
                <summary>Source location</summary>
                <p>
                  {raw.source}
                  <br />
                  {raw.locator}
                </p>
              </details>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={state.local.evidenceIds.includes(revisionId)}
                  onChange={(e) =>
                    onAction({ type: 'selectEvidence', id: revisionId, selected: e.target.checked })
                  }
                />
                Select for continuing
              </label>
            </>
          ) : (
            <p role="status">
              {state.explanation?.error
                ? 'The source could not be opened. Collapse and reopen to try again.'
                : 'Loading the fixed source.'}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
function Unknowns({ values }: { values: ExplanationCandidate['unknowns'] }) {
  return (
    <>
      {values.map((u, i) => (
        <p className="uncertainty" key={i}>
          <strong>Still unknown · </strong>
          {u.text}
          <br />
          <span>{u.impact}</span>
        </p>
      ))}
    </>
  );
}
function isQuestionTarget(state: AppViewModel, nodeId: string) {
  const revision = state.explanation?.revision;
  return (
    state.question?.anchorType === 'explanation' &&
    state.question.targetKey ===
      JSON.stringify([
        state.detail?.workId,
        revision?.summaryId,
        { explanationId: revision?.id, nodeId },
      ])
  );
}
function SentenceQuestion({
  state,
  onAction,
  focusOnOpen = true,
}: Props & { focusOnOpen?: boolean }) {
  return state.question?.open ? (
    <ContextQuestions
      focusOnOpen={focusOnOpen}
      sourceTitles={Object.fromEntries(
        (state.detail?.links ?? []).map((link) => [link.threadId, link.title]),
      )}
      state={state.question}
      onAction={onAction}
    />
  ) : null;
}
function ExplanationSentence({
  node,
  candidate,
  state,
  onAction,
  depth = 0,
}: Props & { node: ExplanationNode; candidate: ExplanationCandidate; depth?: number }) {
  const detail = useRef<HTMLDetailsElement>(null),
    activeQuestion = state.question?.open && isQuestionTarget(state, node.id);
  useLayoutEffect(() => {
    if (!activeQuestion) return;
    let current: HTMLElement | null = detail.current;
    while (current) {
      if (current instanceof HTMLDetailsElement) current.open = true;
      current = current.parentElement;
    }
  }, [activeQuestion]);
  return (
    <article className="explanation-sentence" data-explanation-node={node.id}>
      <p className="explanation-text">{node.text}</p>
      <p className="small muted explanation-attribution">{userNatureLabel(node.nature)}</p>
      {node.condition ? <p className="condition">Condition · {node.condition}</p> : null}
      {node.uncertainty ? <p className="uncertainty">{node.uncertainty}</p> : null}
      <Unknowns values={node.unknowns} />
      <details className="sentence-detail" ref={detail}>
        <summary>
          {candidate.links.some((l) => l.parentId === node.id) && depth < 2
            ? 'Reasons, evidence and questions'
            : 'Evidence and questions'}
        </summary>
        {depth < 2
          ? candidate.links
              .filter((l) => l.parentId === node.id)
              .map((l) => {
                const child = candidate.nodes.find((n) => n.id === l.childId);
                return child ? (
                  <details className="explanation-reason" key={l.id}>
                    <summary>{l.question}</summary>
                    {l.kind === 'interpretation' ? (
                      <p className="small uncertainty">
                        This reason is an AI interpretation. {l.uncertainty}
                      </p>
                    ) : (
                      <p className="small muted">The record connects this choice to its reason.</p>
                    )}
                    <ExplanationSentence
                      node={child}
                      candidate={candidate}
                      state={state}
                      onAction={onAction}
                      depth={depth + 1}
                    />
                    <details className="explanation-relation">
                      <summary>Evidence for this reason</summary>
                      <Citation references={l.evidence} state={state} onAction={onAction} />
                    </details>
                  </details>
                ) : null;
              })
          : null}
        <p className="small muted">
          {node.kind === 'record'
            ? 'Direct record: the statement appears in the source; its reported result is not independently verified.'
            : 'AI interpretation of the cited records.'}
        </p>
        <div className="explanation-actions">
          <Citation references={node.evidence} state={state} onAction={onAction} />
          <button
            type="button"
            className="text-button"
            onClick={() => onAction({ type: 'explanationQuestion', nodeId: node.id })}
          >
            Ask about this sentence
          </button>
        </div>
        {activeQuestion ? <SentenceQuestion state={state} onAction={onAction} /> : null}
      </details>
    </article>
  );
}
export function HandoffExplanation({ state, onAction }: Props) {
  const view = state.explanation,
    latest = view?.latest,
    revision = view?.revision,
    job = latest?.job;
  if (!view || !latest?.available)
    return (
      <section
        className="handoff-explanation explanation-empty"
        aria-label="Work handoff explanation"
      >
        <h2>Pick up this work</h2>
        <p role="status">
          {state.detail?.summaryId
            ? 'No handoff explanation is available yet. Read the validated summary below.'
            : 'No validated summary or explanation is available yet. Read collected sources or check collection status for the next step.'}
        </p>
        {state.question?.anchorType === 'explanation' ? (
          <SentenceQuestion state={state} onAction={onAction} focusOnOpen={false} />
        ) : null}
      </section>
    );
  const edited = state.detail
    ? [...state.detail.current, ...state.detail.next, ...state.detail.reason].filter(
        (c) => c.edited,
      )
    : [];
  const retry = job?.canRetry === true;
  return (
    <section
      className={`handoff-explanation ${revision ? 'card' : 'explanation-empty'}`}
      aria-label="Work handoff explanation"
    >
      <div className="section-top">
        <h2 tabIndex={-1}>Pick up this work</h2>
        {job && (!revision || job.status !== 'ready') ? (
          <p className="small" role="status">
            {statuses[job.status]}
          </p>
        ) : null}
      </div>
      {view.error ? (
        <p role="alert" className="error">
          {view.error}
        </p>
      ) : null}
      {revision && view.stale && !state.detail?.scopeNotice ? (
        <p className="banner warning">
          This explanation reflects an earlier or partially checked scope. Check the latest summary
          and conditions before treating past actions as current tasks.
        </p>
      ) : null}
      {view.newAvailable ? (
        <button type="button" onClick={() => onAction({ type: 'explanationAdopt' })}>
          Read the new explanation
        </button>
      ) : null}
      {!revision ? (
        <p>
          {state.detail?.summaryId
            ? 'Read the validated summary below. It is not a completed handoff explanation.'
            : 'No validated summary is available. Inspect collected sources and check collection status for the next step.'}
        </p>
      ) : null}
      {!job && !revision ? (
        <>
          <button
            type="button"
            disabled={view.busy || !state.detail?.summaryId}
            onClick={() => onAction({ type: 'explanationPrepare' })}
          >
            Prepare explanation
          </button>
        </>
      ) : null}
      {edited.length ? (
        <aside className="explanation-edits">
          <strong>You have edited the displayed summary.</strong>
          <p className="small">
            This explanation uses the original automatic summary. Your edits below are not included
            in its validation.
          </p>
          {edited.map((c) => (
            <p key={c.id}>
              {c.label} · {c.text}
            </p>
          ))}
        </aside>
      ) : null}
      {revision ? (
        <div key={revision.id}>
          {revision.input.limitations.length ? (
            <p className="uncertainty">
              This explanation has input coverage limits. Read its basis and unknowns below.
            </p>
          ) : null}
          {revision.candidate.sections.map((section) => (
            <section className="explanation-section" key={section.id}>
              <h3>{section.title}</h3>
              {section.bodyIds.map((id) => {
                const node = revision.candidate.nodes.find((n) => n.id === id);
                return node ? (
                  <ExplanationSentence
                    key={id}
                    node={node}
                    candidate={revision.candidate}
                    state={state}
                    onAction={onAction}
                  />
                ) : null;
              })}
            </section>
          ))}
          <Unknowns values={revision.candidate.unknowns} />
          <details>
            <summary>Explanation basis and coverage</summary>
            <p className="small muted">
              Generated {revision.generatedAt} · Summary {revision.summaryId} · Policy{' '}
              {revision.input.policyVersion}
            </p>
            {revision.input.limitations.map((l, i) => (
              <p className="small uncertainty" key={i}>
                {l}
              </p>
            ))}
          </details>
        </div>
      ) : null}
      {state.question?.open &&
      state.question.anchorType === 'explanation' &&
      !revision?.candidate.nodes.some((node) => isQuestionTarget(state, node.id)) ? (
        <SentenceQuestion state={state} onAction={onAction} focusOnOpen={false} />
      ) : null}
      {job ? (
        <details className="explanation-timing">
          <summary>Explanation status details</summary>
          {job.error ? <p>{job.error}</p> : null}
          {retry ? (
            <button
              type="button"
              disabled={view.busy}
              onClick={() => onAction({ type: 'explanationRetry' })}
            >
              Retry explanation once
            </button>
          ) : null}
          <details>
            <summary>Explanation timing</summary>
            <p className="small muted">
              Generation and checks {job.calls}/4 times · automatic repairs {job.repairs}/1 times
            </p>
            {job.phases.map((p, i) => (
              <p className="small muted" key={i}>
                {statuses[p.phase]} ·{' '}
                {p.endedAt
                  ? `${Math.max(0, Math.round((Date.parse(p.endedAt) - Date.parse(p.startedAt)) / 1000))}s`
                  : 'In progress'}
              </p>
            ))}
          </details>
        </details>
      ) : null}
    </section>
  );
}
