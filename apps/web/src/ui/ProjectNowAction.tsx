import { useEffect, useRef, useState } from 'react';
import type {
  ProjectController,
  ProjectView,
  ProjectNowView,
  PresentedProjectAction,
  ProjectDrafts,
  DecisionOperation,
  ProjectExecutionCommand,
  ProjectExecutionWorkspace,
  SessionQuestion,
  ReleaseProjectView,
} from '@statecarry/presentation';
import { projectError } from '@statecarry/presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { WorkDiscussion } from './WorkDiscussion';

type Props = {
  project: ProjectView;
  controller: ProjectController;
  data?: ProjectExecutionWorkspace;
  view: ProjectNowView;
  edits: ProjectDrafts;
  actionKind: PresentedProjectAction['kind'];
  mode:
    | 'continue'
    | 'remaining'
    | 'verify'
    | 'policy'
    | 'direction'
    | 'result'
    | 'review'
    | 'new-work'
    | 'release';
  requestId: string | null;
  releaseId?: string | null;
  release?: ReleaseProjectView;
  releaseLoading?: boolean;
  selectionKey: string | null;
  discussionOpen?: boolean;
  onBack: () => void;
  onVerify: () => void;
  onDiscussionChange?: (open: boolean) => void;
};

function ActionError({ value }: { value: string }) {
  return value ? (
    <p className="pw-notice" role="alert">
      {value}
    </p>
  ) : null;
}

type ScopeDraft = {
  text: string;
  doneWhen: string;
  scopeIds: string[];
  basis: string;
  confirmed: boolean;
};

function readScopeDraft(key: string, fallback: ScopeDraft): ScopeDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ScopeDraft> | null;
    if (!value) return fallback;
    return {
      text: typeof value.text === 'string' ? value.text.slice(0, 2000) : fallback.text,
      doneWhen:
        typeof value.doneWhen === 'string' ? value.doneWhen.slice(0, 2000) : fallback.doneWhen,
      scopeIds: Array.isArray(value.scopeIds)
        ? value.scopeIds.filter((item): item is string => typeof item === 'string').slice(0, 300)
        : [],
      basis: typeof value.basis === 'string' ? value.basis.slice(0, 256) : '',
      // Confirmation is per visit and must be checked again after reopening.
      confirmed: false,
    };
  } catch {
    return fallback;
  }
}

function writeScopeDraft(key: string, value: ScopeDraft) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...value, confirmed: false }));
  } catch {
    // The in-memory draft remains usable for this action session.
  }
}

function DirectionAction({
  project,
  controller,
  data,
  view,
  onBack,
}: Omit<
  Props,
  'edits' | 'actionKind' | 'mode' | 'requestId' | 'selectionKey' | 'onVerify' | 'onPolicy'
>) {
  const conflict =
    data?.record.policyConflict?.status === 'open' &&
    data.record.policyConflict.category === 'purpose-direction'
      ? data.record.policyConflict
      : null;
  const suggestedDirection = view.bootstrap.directionSuggestion?.text ?? '';
  const savedGoal =
    !view.bootstrap.directionDeferred && project.goalConfirmed ? project.goal.trim() || null : null;
  const savedDirection = conflict
    ? (view.direction?.text ?? data?.record.direction?.text ?? savedGoal ?? suggestedDirection)
    : (view.direction?.text ?? savedGoal ?? suggestedDirection);
  const [text, setText] = useState(savedDirection);
  const initialized = useRef(!!savedDirection);
  const [purposeText, setPurposeText] = useState(
    project.purpose || view.bootstrap.purposeSuggestion?.text || '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialized.current) return;
    const next = conflict
      ? (view.direction?.text ??
        data?.record.direction?.text ??
        savedGoal ??
        view.bootstrap.directionSuggestion?.text ??
        '')
      : (view.direction?.text ?? savedGoal ?? view.bootstrap.directionSuggestion?.text ?? '');
    if (!next) return;
    initialized.current = true;
    setText(next);
  }, [
    data?.record.direction?.text,
    savedGoal,
    view.bootstrap.directionSuggestion?.text,
    view.direction?.text,
  ]);

  useEffect(() => {
    if (project.purpose) {
      setPurposeText(project.purpose);
      return;
    }
    if (!purposeText && view.bootstrap.purposeSuggestion?.text)
      setPurposeText(view.bootstrap.purposeSuggestion.text);
  }, [project.purpose, purposeText, view.bootstrap.purposeSuggestion?.text]);

  const savePurpose = async () => {
    const purpose = purposeText.trim();
    if (!purpose || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await controller.settings(
        project.id,
        {
          title: project.title,
          purpose,
          responseLanguage: project.responseLanguage ?? 'en',
          focused: project.focused,
          iconAsset: project.iconAsset,
          bannerAsset: project.bannerAsset,
        },
        project.revision,
      );
      if (saved) await controller.readProjectNow(project.id);
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async (finish = false) => {
    const direction = text.trim();
    if (!direction || busy) return;
    setBusy(true);
    setError('');
    try {
      const command: ProjectExecutionCommand = conflict
        ? { action: 'resolve-direction', text: direction }
        : { action: 'direction', text: direction, finish };
      await controller.projectDecision(project.id, command);
      await controller.readProjectNow(project.id);
      onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const deferDirection = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await controller.projectDecision(project.id, { action: 'defer-direction' });
      await controller.readProjectNow(project.id);
      onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p role="status">Reading saved project state…</p>;

  if (!conflict && !project.purpose)
    return (
      <section className="pw-decision-direction" aria-label="Set project purpose">
        <section className="pw-direction-bootstrap" aria-label="Project purpose">
          <div>
            <h3>Project purpose</h3>
            <p>
              {view.bootstrap.purposeSuggestion
                ? `StateCarry suggested this from ${view.bootstrap.purposeSuggestion.detail}. Review or edit it before saving.`
                : 'Describe what this project should make possible. StateCarry will use it to explain why work matters.'}
            </p>
          </div>
          <label className="pw-field">
            Project purpose
            <Textarea
              maxLength={1200}
              value={purposeText}
              placeholder="What should this project make possible?"
              onChange={(event) => setPurposeText(event.target.value)}
            />
          </label>
          <Button disabled={busy || !purposeText.trim()} onClick={() => void savePurpose()}>
            Save project purpose
          </Button>
        </section>
        <ActionError value={error} />
      </section>
    );

  return (
    <section className="pw-decision-direction" aria-label="Review project direction">
      {conflict ? (
        <div className="pw-decision-uncertain">
          <h3>The current direction conflicts with the project purpose</h3>
          <p>{conflict.description}</p>
          <p className="pw-small">Source: {conflict.source}</p>
        </div>
      ) : (
        <>
          <p>{project.purpose}</p>
          {!view.direction && view.bootstrap.directionSuggestion && (
            <p className="pw-small">
              Suggested from {view.bootstrap.directionSuggestion.detail}. Edit it before saving if
              the broader direction is different.
            </p>
          )}
        </>
      )}
      <label className="pw-field">
        Current direction
        <Textarea
          maxLength={400}
          value={text}
          placeholder="What result are you focusing on now?"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="pw-actions">
        <Button disabled={busy || !text.trim()} onClick={() => void save(false)}>
          {conflict
            ? 'Save a different direction'
            : view.direction
              ? 'Save direction'
              : 'Use this direction'}
        </Button>
        {!conflict && !view.direction && (
          <Button variant="ghost" disabled={busy} onClick={() => void deferDirection()}>
            No current direction
          </Button>
        )}
        {!conflict && view.direction && (
          <Button variant="ghost" disabled={busy || !text.trim()} onClick={() => void save(true)}>
            Finish this direction
          </Button>
        )}
      </div>
      <ActionError value={error} />
    </section>
  );
}

function RequestReport({
  data,
  requestId,
}: {
  data: ProjectExecutionWorkspace;
  requestId: string;
}) {
  const request = data.requests.find((item) => item.id === requestId);
  if (!request)
    return (
      <p role="status">
        This result is no longer available in the current project state. Return to the current work
        and refresh before choosing another action.
      </p>
    );
  const statusText =
    request.state === 'prepared' && !request.externalReport
      ? 'Your request is ready to review before anything is sent.'
      : request.externalReport
        ? 'You recorded an external result for this request.'
        : request.state === 'failed' && !request.execution
          ? 'StateCarry could not send this request. Review it before preparing another request.'
          : request.execution?.status === 'waiting'
            ? 'Codex needs your input before it can continue.'
            : request.execution?.status === 'running'
              ? 'Codex is working on this request.'
              : request.execution?.status === 'failed'
                ? 'The execution reported a failure.'
                : request.execution?.status === 'interrupted'
                  ? 'The execution was interrupted.'
                  : request.execution?.status === 'completed'
                    ? 'A result is recorded and is waiting for your review.'
                    : request.execution?.status === 'unknown' ||
                        ['dispatching', 'result-unknown'].includes(request.state)
                      ? 'StateCarry could not confirm whether this request is still running. Check the Codex conversation before sending it again.'
                      : 'The request is waiting for an execution update.';
  const executionMayStillBeActive =
    !request.externalReport &&
    !['completed', 'failed', 'interrupted'].includes(request.execution?.status ?? '') &&
    ['dispatching', 'sent', 'result-unknown'].includes(request.state);
  return (
    <>
      <p role="status">{statusText}</p>
      {executionMayStillBeActive && (
        <p className="pw-small">
          If you fully quit StateCarry, this execution may be interrupted. When you reopen
          StateCarry, check this request’s current status before deciding what to do next.
        </p>
      )}
      <details className="pw-details">
        <summary>Read the exact request</summary>
        <pre>{request.preparedText ?? request.target.payload.nextAction}</pre>
      </details>
      {request.externalReport && (
        <>
          <h4>Reported by you after external execution</h4>
          <p className="pw-decision-report">{request.externalReport}</p>
        </>
      )}
      {request.execution?.report && (
        <>
          <h4>Reported by Codex</h4>
          <div className="pw-decision-report">{request.execution.report}</div>
          <p className="pw-small">
            This report is not independent verification or your acceptance.
          </p>
        </>
      )}
      {!!request.execution?.checks?.length && (
        <details className="pw-details">
          <summary>Recorded command results</summary>
          {request.execution.checks.map((check, index) => (
            <div key={check.command + ':' + index}>
              <strong>
                {check.exitCode === null
                  ? 'Result unknown'
                  : check.exitCode === 0
                    ? 'Command passed'
                    : 'Command failed'}
              </strong>
              <p>{check.command}</p>
              <pre>{check.output || 'No command output was recorded.'}</pre>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

function ExecutionQuestion({
  question,
  busy,
  onAnswer,
}: {
  question: SessionQuestion;
  busy: boolean;
  onAnswer: (accept: boolean, answers?: Record<string, string[]>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  return (
    <section className="pw-decision-approval">
      <h4>{question.title}</h4>
      <pre>{question.detail}</pre>
      {question.questions?.map((item) => (
        <label className="pw-field" key={item.id}>
          {item.question}
          {item.options.length ? (
            <select
              value={answers[item.id]?.[0] ?? ''}
              onChange={(event) =>
                setAnswers((old) => ({ ...old, [item.id]: [event.target.value] }))
              }
            >
              <option value="">Choose an answer</option>
              {item.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <Textarea
              maxLength={4000}
              value={answers[item.id]?.[0] ?? ''}
              onChange={(event) =>
                setAnswers((old) => ({ ...old, [item.id]: [event.target.value] }))
              }
            />
          )}
        </label>
      ))}
      <Button
        disabled={
          busy ||
          (question.kind === 'question' &&
            question.questions?.some((item) => !answers[item.id]?.[0]?.trim()))
        }
        onClick={() => onAnswer(true, answers)}
      >
        {question.kind === 'question' ? 'Send answers' : 'Approve this request'}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => onAnswer(false)}>
        Decline
      </Button>
    </section>
  );
}

function RequestAction({
  project,
  controller,
  data,
  requestId,
  onBack,
}: Omit<
  Props,
  'view' | 'edits' | 'actionKind' | 'mode' | 'selectionKey' | 'onVerify' | 'onPolicy'
>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [externalReport, setExternalReport] = useState('');
  const comparing = useRef(false);
  const mounted = useRef(false);
  const lastCheckedRequest = useRef<string | null>(null);
  const request = data?.requests.find((item) => item.id === requestId);
  const comparison = requestId ? data?.record.comparisons[requestId] : undefined;
  const canAccept =
    !!request &&
    !!comparison &&
    (!!request.externalReport || request.execution?.status === 'completed');
  const canResolvePolicy =
    canAccept &&
    data?.record.policyConflict?.status === 'open' &&
    request?.target.payload.projectContext?.operation === 'policy';
  const executionTerminal = ['completed', 'failed', 'interrupted'].includes(
    request?.execution?.status ?? '',
  );
  const executionInFlight =
    !!request &&
    ['dispatching', 'sent', 'result-unknown'].includes(request.state) &&
    !executionTerminal;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (command: ProjectExecutionCommand, returnAfter = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await controller.projectDecision(project.id, command);
      if (!mounted.current) return undefined;
      await controller.readProjectNow(project.id);
      if (returnAfter && mounted.current) onBack();
      return result;
    } catch (cause) {
      if (mounted.current) setError(projectError(cause));
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (
      !request ||
      !['sent', 'dispatching', 'result-unknown'].includes(request.state) ||
      lastCheckedRequest.current === request.id ||
      ['completed', 'failed', 'interrupted'].includes(request.execution?.status ?? '')
    )
      return;
    lastCheckedRequest.current = request.id;
    let cancelled = false;
    void controller
      .projectDecision(project.id, { action: 'sync', requestId: request.id })
      .catch((cause) => {
        if (!cancelled && mounted.current) setError(projectError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [controller, project.id, request?.execution?.status, request?.id, request?.state]);

  useEffect(() => {
    if (!request || request.execution?.status !== 'completed' || comparison || comparing.current)
      return;
    let cancelled = false;
    comparing.current = true;
    void controller
      .projectDecision(project.id, {
        action: 'compare',
        requestId: request.id,
        outputLanguage: project.outputLanguage,
      })
      .catch((cause) => {
        if (!cancelled) setError(projectError(cause));
      })
      .finally(() => {
        comparing.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [
    comparison,
    controller,
    project.id,
    project.outputLanguage,
    request?.execution?.status,
    request?.id,
  ]);

  if (!data) return <p role="status">Reading saved project state…</p>;
  if (!requestId) return <p role="status">This result no longer has a request to review.</p>;

  const terminal = ['completed', 'failed', 'interrupted'].includes(
    request?.execution?.status ?? '',
  );
  const closable =
    request?.state === 'prepared' ||
    request?.state === 'failed' ||
    !!request?.externalReport ||
    terminal;

  return (
    <section className="pw-decision-result" aria-label="Request and result">
      <h3>
        {request?.state === 'prepared' && !request.externalReport
          ? 'Your request is ready to review'
          : request?.state === 'failed' && !request.execution
            ? 'The request could not be sent'
            : request?.execution?.status === 'waiting'
              ? 'Codex needs your input'
              : terminal || request?.externalReport
                ? 'Review the returned result'
                : 'Your Codex request'}
      </h3>
      <RequestReport data={data} requestId={requestId} />
      {request && (
        <>
          {request.state === 'prepared' && !request.externalReport && (
            <div className="pw-actions">
              <Button
                disabled={
                  busy ||
                  data.capability.send !== 'supported' ||
                  data.scopeCurrent === false ||
                  request.target.payload.projectContext?.basis !== data.record.observation?.basis
                }
                onClick={() => void run({ action: 'send', requestId })}
              >
                Send to a new Codex conversation
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  data.scopeCurrent === false ||
                  request.target.payload.projectContext?.basis !== data.record.observation?.basis
                }
                onClick={() =>
                  void run({ action: 'review', requestId }).then(async (result) => {
                    if (!result) return;
                    try {
                      await navigator.clipboard.writeText(
                        request.preparedText ?? request.target.payload.nextAction,
                      );
                      setNotice('Request copied. Nothing was sent or started.');
                    } catch {
                      setError(
                        'The request could not be copied. You can select and copy its text above.',
                      );
                    }
                  })
                }
              >
                Copy reviewed request
              </Button>
            </div>
          )}
          {data.capability.send !== 'supported' && <p>{data.capability.detail}</p>}
          {request.threadId && (
            <p>
              <a href={`codex://threads/${encodeURIComponent(request.threadId)}`}>
                Open the Codex conversation
              </a>
            </p>
          )}
          {request.execution?.status === 'waiting' &&
            request.execution.questions.map((question) => (
              <ExecutionQuestion
                key={question.id}
                question={question}
                busy={busy}
                onAnswer={(accept, answers) =>
                  void run({
                    action: 'answer',
                    requestId,
                    questionId: question.id,
                    accept,
                    answers,
                  })
                }
              />
            ))}
          {request.state === 'prepared' && !request.externalReport && (
            <details className="pw-details">
              <summary>Already ran this request outside StateCarry?</summary>
              <p>
                Record what happened, including checks and remaining work. This records your report,
                not an independently verified result.
              </p>
              <label className="pw-field">
                External result
                <Textarea
                  value={externalReport}
                  maxLength={8000}
                  onChange={(event) => setExternalReport(event.target.value)}
                />
              </label>
              <Button
                disabled={busy || !externalReport.trim()}
                onClick={() =>
                  void run({
                    action: 'record-result',
                    requestId,
                    report: externalReport.trim(),
                  }).then((result) => {
                    if (result) setExternalReport('');
                  })
                }
              >
                Record external result
              </Button>
            </details>
          )}
          {(request.state !== 'prepared' || request.externalReport) && (
            <div className="pw-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run({ action: 'sync', requestId })}
              >
                Check execution state
              </Button>
              {!executionInFlight && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: 'compare',
                      requestId,
                      outputLanguage: project.outputLanguage,
                    })
                  }
                >
                  Compare with current project
                </Button>
              )}
              {['running', 'waiting'].includes(request.execution?.status ?? '') && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run({ action: 'interrupt', requestId })}
                >
                  Stop this execution
                </Button>
              )}
            </div>
          )}
          {comparison && (
            <div>
              <h4>Observed after the request</h4>
              <p>
                {comparison.remaining.length} selected sections are unchanged.{' '}
                {comparison.changed.length} changed or disappeared. This comparison does not prove
                the requested behavior works.
              </p>
              <Button
                disabled={busy || !canAccept}
                onClick={() => void run({ action: 'accept', requestId }, true)}
              >
                Accept result against the completion condition
              </Button>
              {canResolvePolicy && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run({ action: 'resolve-conflict', requestId }, true)}
                >
                  Confirm the policy change resolves this conflict
                </Button>
              )}
            </div>
          )}
          {closable && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run({ action: 'close-request', requestId }, true)}
            >
              Return to current work without accepting this result
            </Button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      <ActionError value={error} />
    </section>
  );
}

function ScopeAction({
  project,
  controller,
  data,
  view,
  mode,
  onBack,
}: Omit<Props, 'edits' | 'actionKind' | 'requestId' | 'selectionKey' | 'onVerify' | 'onPolicy'> & {
  mode: 'continue' | 'remaining' | 'verify' | 'policy';
}) {
  const work = view.work;
  const remainingOnly = mode === 'remaining';
  const projectPolicy = mode === 'policy';
  const draftKey = (operation: DecisionOperation) =>
    `statecarry.project-action.v3.${project.id}.${operation === 'policy' ? 'project' : (work?.id ?? 'none')}.${operation}`;
  const defaultDraft = (operation: DecisionOperation): ScopeDraft => ({
    text:
      operation === 'verify'
        ? `Check the current behavior of ${work?.title ?? project.title}. Report what works, what remains, and what could not be checked. Do not implement fixes.`
        : operation === 'policy'
          ? `Address the recorded policy conflict: ${data?.record.policyConflict?.description ?? 'Review the project policy conflict.'}`
          : operation === 'commit'
            ? 'Commit only the selected changes.'
            : operation === 'revert'
              ? 'Discard only the selected changes.'
              : operation === 'unstage'
                ? 'Unstage only the selected staged changes.'
                : (view.nextText ?? (work ? `Continue ${work.title}.` : '')),
    doneWhen:
      operation === 'verify'
        ? 'The checked behavior, results, remaining work, and limitations are reported.'
        : operation === 'policy'
          ? 'The policy change is implemented, compared with the current project, and ready for explicit confirmation.'
          : operation === 'commit'
            ? 'The selected changes are committed without including excluded changes.'
            : operation === 'revert'
              ? 'The selected modifications are discarded and excluded changes remain.'
              : operation === 'unstage'
                ? 'The selected changes are removed from the index and working files remain unchanged.'
                : (work?.completionCondition ?? ''),
    scopeIds: [],
    basis: '',
    confirmed: false,
  });
  const [operation, setOperation] = useState<DecisionOperation>(remainingOnly ? 'verify' : mode);
  const storageKey = draftKey(operation);
  const [draft, setDraft] = useState<ScopeDraft>(() => {
    const initialOperation = remainingOnly ? 'verify' : mode;
    return readScopeDraft(draftKey(initialOperation), defaultDraft(initialOperation));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const observeRequested = useRef(false);

  useEffect(() => {
    writeScopeDraft(storageKey, draft);
  }, [draft, storageKey]);

  useEffect(() => {
    if (!data || data.record.observation || observeRequested.current) return;
    observeRequested.current = true;
    void controller
      .projectDecision(project.id, { action: 'observe', outputLanguage: project.outputLanguage })
      .catch((cause) => setError(projectError(cause)));
  }, [controller, data, project.id, project.outputLanguage]);

  const observation = data?.record.observation;
  const policyDescription = data?.record.policyConflict?.description;
  useEffect(() => {
    if (!observation) return;
    setDraft((old) => {
      const basisChanged = !!old.basis && old.basis !== observation.basis;
      const scopeBecameStale = data?.scopeCurrent === false && old.scopeIds.length > 0;
      if (old.basis === observation.basis && !scopeBecameStale) return old;
      return {
        ...old,
        basis: observation.basis,
        scopeIds: basisChanged || scopeBecameStale ? [] : old.scopeIds,
        confirmed: false,
      };
    });
  }, [data?.scopeCurrent, draft.basis, observation]);

  useEffect(() => {
    if (!projectPolicy || !policyDescription) return;
    const genericText = 'Address the recorded policy conflict: Review the project policy conflict.';
    setDraft((old) =>
      old.text === genericText
        ? {
            ...old,
            text: `Address the recorded policy conflict: ${policyDescription}`,
            confirmed: false,
          }
        : old,
    );
  }, [policyDescription, projectPolicy]);

  const activeRequest =
    !remainingOnly && data
      ? [...data.requests].reverse().find((request) => {
          const context = request.target.payload.projectContext;
          return (
            (projectPolicy
              ? context?.operation === 'policy' &&
                !!context.policyConflictBasis &&
                context.policyConflictBasis === data.policyConflictBasis
              : !!work && context?.workItemId === work.id) &&
            !data.record.accepted.includes(request.id) &&
            !data.record.closed?.includes(request.id)
          );
        })
      : null;

  if (activeRequest)
    return (
      <RequestAction
        project={project}
        controller={controller}
        data={data}
        requestId={activeRequest.id}
        onBack={onBack}
      />
    );

  if (!data || (!work && !projectPolicy)) return <p role="status">Reading saved project state…</p>;

  const keptIds = new Set(data.record.kept.flatMap((item) => item.scopeIds));
  const scopes = observation?.scopes ?? [];
  const stale =
    data.scopeCurrent === false || (!!draft.basis && observation?.basis !== draft.basis);
  const verification = operation === 'verify';
  const inventoryReady =
    !!observation &&
    observation.inventoryComplete !== false &&
    (remainingOnly
      ? observation.complete || observation.inventoryComplete === true
      : verification || observation.complete || observation.inventoryComplete === true);
  const canConfirm = inventoryReady && !stale;
  const exactScopeRequired = ['commit', 'revert', 'unstage'].includes(operation);
  const operationLabel = {
    verify: 'Check current behavior',
    continue: 'Continue this work',
    commit: 'Review a commit',
    revert: 'Review discarding changes',
    unstage: 'Review unstaging changes',
    direction: 'Review direction',
    policy: 'Review project policy change',
  }[operation];
  const chooseOperation = (next: DecisionOperation) => {
    setOperation(next);
    setDraft(
      next === 'verify' || next === 'continue'
        ? { ...draft, scopeIds: [], confirmed: false }
        : readScopeDraft(draftKey(next), defaultDraft(next)),
    );
  };

  const readScope = async (file?: { path: string; layer: 'staged' | 'unstaged' | 'untracked' }) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const latest = await controller.projectDecision(
        project.id,
        file
          ? {
              action: 'read-scope-file',
              basis: observation!.basis,
              path: file.path,
              layer: file.layer,
              outputLanguage: project.outputLanguage,
            }
          : { action: 'observe', outputLanguage: project.outputLanguage },
      );
      const current = latest.record.observation;
      if (current)
        setDraft((old) => ({
          ...old,
          basis: current.basis,
          confirmed: false,
          scopeIds: old.scopeIds.filter((id) => current.scopes.some((scope) => scope.id === id)),
        }));
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (
      busy ||
      !canConfirm ||
      !draft.confirmed ||
      stale ||
      !draft.basis ||
      !draft.text.trim() ||
      !draft.doneWhen.trim() ||
      (exactScopeRequired && !draft.scopeIds.length)
    )
      return;
    setBusy(true);
    setError('');
    try {
      await controller.projectDecision(project.id, {
        action: 'prepare',
        context: {
          basis: draft.basis,
          scopeIds: verification ? [] : draft.scopeIds,
          operation,
          ...(operation === 'policy' ? {} : { workItemId: work!.id }),
        },
        text: draft.text.trim(),
        doneWhen: draft.doneWhen.trim(),
        threadId: null,
      });
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const keepSelectedChanges = async () => {
    if (busy || !observation || !draft.confirmed || stale || !draft.scopeIds.length) return;
    const keptScopeIds = new Set(draft.scopeIds);
    setBusy(true);
    setError('');
    try {
      await controller.projectDecision(project.id, {
        action: 'keep',
        basis: observation.basis,
        scopeIds: [...keptScopeIds],
      });
      const nextDraft = {
        ...draft,
        scopeIds: draft.scopeIds.filter((id) => !keptScopeIds.has(id)),
        basis: observation.basis,
        confirmed: false,
      };
      writeScopeDraft(storageKey, nextDraft);
      setDraft(nextDraft);
      await controller.readProjectNow(project.id);
      onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="pw-decision-review"
      aria-label={
        remainingOnly
          ? 'Review remaining changes'
          : projectPolicy
            ? 'Review project policy request'
            : 'Review request'
      }
    >
      <h3>{remainingOnly ? 'Review remaining changes' : operationLabel}</h3>
      {projectPolicy && (
        <p>
          This request applies to {project.title}. StateCarry will prepare it for your review; it
          will not be sent unless you choose Send.
        </p>
      )}
      {remainingOnly && (
        <p>
          This work remains stopped. Review the project changes here, or keep selected changes and
          move on without restarting the work.
        </p>
      )}
      {!remainingOnly && work && !projectPolicy && (
        <div className="pw-actions" aria-label="Request type">
          {operation !== 'verify' && (
            <Button variant="outline" disabled={busy} onClick={() => chooseOperation('verify')}>
              Check current behavior
            </Button>
          )}
          {operation === 'verify' && (
            <Button variant="outline" disabled={busy} onClick={() => chooseOperation('continue')}>
              Continue this work
            </Button>
          )}
        </div>
      )}
      {!remainingOnly && work && verification && (
        <p>
          Run the reviewed checks for this task. Existing changes do not need to be included. Report
          the results without implementing fixes; normal build and test artifacts may be produced.
        </p>
      )}
      {!observation ? (
        <p role="status">Reading the current change scope…</p>
      ) : (
        <>
          {!observation.complete && !verification && (
            <div className="pw-decision-uncertain">
              <p>
                {observation.inventoryComplete
                  ? 'Some file changes have not been read. Read a file before including its changes; other files stay outside this request.'
                  : 'The changed-file list could not be read.'}
              </p>
              {!observation.files?.length &&
                observation.limitations.map((limit) => <p key={limit}>{limit}</p>)}
            </div>
          )}
          {!remainingOnly && (
            <label className="pw-field">
              What should happen?
              <Textarea
                maxLength={2000}
                value={draft.text}
                onChange={(event) =>
                  setDraft((old) => ({ ...old, text: event.target.value, confirmed: false }))
                }
              />
            </label>
          )}
          {!remainingOnly && (
            <label className="pw-field">
              Done when
              <Textarea
                maxLength={2000}
                value={draft.doneWhen}
                onChange={(event) =>
                  setDraft((old) => ({ ...old, doneWhen: event.target.value, confirmed: false }))
                }
              />
            </label>
          )}
          {(remainingOnly || !verification) && (
            <>
              <p>
                {remainingOnly
                  ? 'Review each change before deciding whether to keep it unchanged.'
                  : 'Choose any existing changes that belong to this request. Unselected changes stay outside the request, even in the same file.'}
              </p>
              <fieldset disabled={busy || !inventoryReady} className="pw-decision-scopes">
                <legend>{remainingOnly ? 'Remaining project changes' : 'Included changes'}</legend>
                {(observation.files ?? [])
                  .filter((file) => file.detail !== 'ready')
                  .map((file) => (
                    <div key={file.id}>
                      <p>
                        <strong>{file.path}</strong> · {file.layer}
                      </p>
                      <p className="pw-small">
                        {file.limitation ?? 'The changes in this file have not been read.'}
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy || stale}
                        onClick={() => void readScope(file)}
                      >
                        Read changes in {file.path} ({file.layer})
                      </Button>
                    </div>
                  ))}
                {scopes.length ? (
                  scopes.map((scope) => (
                    <div key={scope.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.scopeIds.includes(scope.id)}
                          disabled={
                            !remainingOnly && operation === 'unstage' && scope.layer !== 'staged'
                          }
                          onChange={(event) =>
                            setDraft((old) => ({
                              ...old,
                              scopeIds: event.target.checked
                                ? [...old.scopeIds, scope.id]
                                : old.scopeIds.filter((id) => id !== scope.id),
                              basis: observation.basis,
                              confirmed: false,
                            }))
                          }
                        />{' '}
                        {scope.path} · {scope.layer}
                        {keptIds.has(scope.id) ? ' · previously left unchanged' : ''}
                      </label>
                      <details className="pw-details">
                        <summary>{scope.description}</summary>
                        <pre>{scope.patch}</pre>
                      </details>
                    </div>
                  ))
                ) : (
                  <p className="pw-small">
                    {remainingOnly
                      ? observation.files?.length
                        ? 'No readable changes are selected. Some file changes have not been read yet.'
                        : observation.complete
                          ? 'No remaining local changes were found.'
                          : 'The remaining project changes could not be determined.'
                      : observation.files?.length
                        ? 'No file changes are selected yet. Unread files remain outside this request.'
                        : observation.complete
                          ? 'No existing local changes need to be included.'
                          : 'The existing changes could not be determined.'}
                  </p>
                )}
              </fieldset>
            </>
          )}
          {(stale || !inventoryReady) && (
            <div role="status">
              <p>
                {stale
                  ? 'The project changed. Your request text is preserved; review the current scope before confirming again.'
                  : 'The current project state could not be checked. Read it again before confirming the request.'}
              </p>
              <Button variant="outline" disabled={busy} onClick={() => void readScope()}>
                Read the current change scope
              </Button>
            </div>
          )}
          <label className="pw-decision-confirm">
            <input
              type="checkbox"
              checked={draft.confirmed && !stale}
              disabled={!canConfirm}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  confirmed: event.target.checked,
                  basis: observation.basis,
                }))
              }
            />{' '}
            {remainingOnly
              ? 'I reviewed these changes and want to leave the selected ones unchanged.'
              : verification
                ? 'I reviewed the verification request and completion condition.'
                : 'I reviewed what is included, what stays unchanged, and the completion condition.'}
          </label>
          {remainingOnly ? (
            <div className="pw-actions">
              <Button
                disabled={
                  busy || stale || !draft.confirmed || !draft.scopeIds.length || !inventoryReady
                }
                onClick={() => void keepSelectedChanges()}
              >
                Leave selected changes and move on
              </Button>
              <Button variant="ghost" onClick={onBack}>
                Decide later
              </Button>
            </div>
          ) : (
            <>
              <div className="pw-actions">
                <Button
                  disabled={
                    busy ||
                    !canConfirm ||
                    !draft.confirmed ||
                    stale ||
                    !draft.text.trim() ||
                    !draft.doneWhen.trim() ||
                    (exactScopeRequired && !draft.scopeIds.length)
                  }
                  onClick={() => void prepare()}
                >
                  {projectPolicy ? 'Prepare project policy request' : 'Prepare request for Codex'}
                </Button>
                <Button variant="ghost" onClick={onBack}>
                  Decide later
                </Button>
              </div>
              {work && !projectPolicy && (
                <details className="pw-details">
                  <summary>More options</summary>
                  <div className="pw-actions">
                    {operation !== 'commit' && (
                      <Button variant="ghost" onClick={() => chooseOperation('commit')}>
                        Review a commit
                      </Button>
                    )}
                    {operation !== 'revert' && (
                      <Button variant="ghost" onClick={() => chooseOperation('revert')}>
                        Review discarding changes
                      </Button>
                    )}
                    {operation !== 'unstage' && (
                      <Button variant="ghost" onClick={() => chooseOperation('unstage')}>
                        Review unstaging changes
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={
                        busy ||
                        stale ||
                        !draft.confirmed ||
                        !draft.scopeIds.length ||
                        !inventoryReady
                      }
                      onClick={() => void keepSelectedChanges()}
                    >
                      Leave selected changes and move on
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      <ActionError value={error} />
    </section>
  );
}

function ReviewWorkAction({
  project,
  controller,
  view,
  edits,
  actionKind,
  selectionKey,
  discussionOpen = false,
  onBack,
  onVerify,
  onDiscussionChange = () => {},
}: Omit<Props, 'data' | 'mode' | 'requestId' | 'onPolicy'>) {
  const [openingVerify, setOpeningVerify] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!discussionOpen || !selectionKey) return;
    controller.openTaskDiscussion(project.id, selectionKey);
  }, [controller, discussionOpen, project.id, selectionKey]);
  const openDiscussion = () => {
    if (!selectionKey) return;
    onDiscussionChange(true);
  };
  const openVerify = async () => {
    if (openingVerify) return;
    setOpeningVerify(true);
    setError('');
    try {
      await controller.projectDecision(project.id);
      onVerify();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setOpeningVerify(false);
    }
  };
  const transition = async (action: 'pause' | 'complete' | 'stop') => {
    if (!view.work || transitioning) return;
    setTransitioning(true);
    setError('');
    try {
      const result =
        action === 'pause'
          ? await controller.pauseWorkItem(project.id, view.work.id)
          : action === 'complete'
            ? await controller.completeWorkItem(project.id, view.work.id)
            : await controller.stopWorkItem(project.id, view.work.id);
      if (result) onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <section aria-label="Review current work">
      <h3>{view.work?.title ?? 'Review current work'}</h3>
      <p>{view.currentState}</p>
      {view.work?.completionCondition && (
        <p className="pw-small">Done when · {view.work.completionCondition}</p>
      )}
      {view.stillToCheck && (
        <div className="pw-decision-uncertain">
          <strong>Still to check</strong>
          <p>{view.stillToCheck}</p>
        </div>
      )}
      {discussionOpen && selectionKey ? (
        <WorkDiscussion
          project={project}
          workKey={selectionKey}
          edits={edits}
          controller={controller}
          onClose={() => onDiscussionChange(false)}
        />
      ) : (
        <>
          <div className="pw-actions">
            {actionKind === 'review-completion' && view.work && (
              <Button disabled={transitioning} onClick={() => void transition('complete')}>
                Mark complete
              </Button>
            )}
            <Button disabled={openingVerify || transitioning} onClick={() => void openVerify()}>
              Check current behavior
            </Button>
            {selectionKey && (
              <Button variant="outline" disabled={transitioning} onClick={openDiscussion}>
                Discuss this work
              </Button>
            )}
          </div>
          {view.work && !['completed', 'stopped'].includes(view.work.state) && (
            <details className="pw-details">
              <summary>More options</summary>
              <div className="pw-actions">
                {view.work.state !== 'paused' && (
                  <Button
                    variant="ghost"
                    disabled={transitioning}
                    onClick={() => void transition('pause')}
                  >
                    Pause work
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={transitioning}
                  onClick={() => void transition('stop')}
                >
                  Stop work
                </Button>
              </div>
            </details>
          )}
        </>
      )}
      <ActionError value={error} />
    </section>
  );
}

function NextWorkAction({
  project,
  controller,
  view,
  onBack,
}: Omit<
  Props,
  'data' | 'edits' | 'actionKind' | 'mode' | 'requestId' | 'selectionKey' | 'onVerify' | 'onPolicy'
>) {
  const [title, setTitle] = useState('');
  const [doneWhen, setDoneWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (item: ProjectNowView['otherWork'][number]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result =
        item.source === 'proposal'
          ? await controller.selectProposal(project.id, item.id)
          : await controller.selectWorkItem(project.id, item.id);
      if (result) onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await controller.createWorkItem(project.id, title, doneWhen || null);
      if (result) onBack();
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Decide next work">
      <h3>Decide the next work</h3>
      {view.otherWork.length > 0 && (
        <div>
          <p>Choose existing work if one of these is what you want to continue.</p>
          <div className="pw-now-other-work-list">
            {view.otherWork.map((item) => (
              <Button
                key={item.id}
                className="pw-now-other-work-item"
                variant="ghost"
                disabled={busy}
                onClick={() => void choose(item)}
              >
                <span>{item.title}</span>
                <span className="pw-small">{item.statusLabel}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p>
          {view.otherWork.length
            ? 'Or define new work.'
            : 'Define the work you want to start next.'}
        </p>
        <label className="pw-field">
          Work name
          <Input maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="pw-field">
          Done when <span className="pw-small">optional</span>
          <Textarea
            maxLength={1200}
            value={doneWhen}
            onChange={(event) => setDoneWhen(event.target.value)}
          />
        </label>
        <Button disabled={busy || !title.trim()} onClick={() => void create()}>
          Start this work
        </Button>
      </div>
      <ActionError value={error} />
    </section>
  );
}

type ReleaseTargetDraft = { key: string; label: string; required: boolean };

function ReleaseAction({
  project,
  controller,
  release,
  releaseLoading,
  releaseId,
  onBack,
}: {
  project: ProjectView;
  controller: ProjectController;
  release?: ReleaseProjectView;
  releaseLoading?: boolean;
  releaseId?: string | null;
  onBack: () => void;
}) {
  const [policyName, setPolicyName] = useState('Stable release policy');
  const [policyTiming, setPolicyTiming] = useState('');
  const [policyChannel, setPolicyChannel] = useState('');
  const [policyTargets, setPolicyTargets] = useState<ReleaseTargetDraft[]>([
    { key: 'primary', label: 'Primary delivery', required: true },
  ]);
  const [requiredChecksText, setRequiredChecksText] = useState('');
  const [inclusionRule, setInclusionRule] = useState<'ready-only' | 'explicit'>('ready-only');
  const [completionMode, setCompletionMode] = useState<'automatic' | 'user-confirmation'>(
    'user-confirmation',
  );
  const [postReleaseVerification, setPostReleaseVerification] = useState<
    'none' | 'risk-based' | 'required'
  >('risk-based');
  const [editingPolicy, setEditingPolicy] = useState(false);
  const policyInitialized = useRef(false);
  const [releaseTitle, setReleaseTitle] = useState('Release completed work');
  const [selectedReleaseWorkIds, setSelectedReleaseWorkIds] = useState<string[]>([]);
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionTargetLabel, setExceptionTargetLabel] = useState('Emergency delivery');
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [repairTitle, setRepairTitle] = useState('Repair delivery problem');
  const [repairDoneWhen, setRepairDoneWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!release && !releaseLoading) void controller.readRelease(project.id);
  }, [controller, project.id, release, releaseLoading]);

  useEffect(() => {
    if (!release?.policy || policyInitialized.current) return;
    policyInitialized.current = true;
    setPolicyName(release.policy.name);
    setPolicyTiming(release.policy.timing ?? '');
    setPolicyChannel(release.policy.channel ?? '');
    setPolicyTargets(release.policy.targets.map((target) => ({ ...target })));
    setRequiredChecksText(release.policy.requiredChecks.join('\n'));
    setInclusionRule(release.policy.inclusionRule);
    setCompletionMode(release.policy.completionMode);
    setPostReleaseVerification(release.policy.postReleaseVerification);
  }, [release?.policy]);

  useEffect(() => {
    if (!release?.policy) return;
    const available = new Set(release.pendingWork.map((item) => item.id));
    setSelectedReleaseWorkIds((selected) => {
      const kept = selected.filter((id) => available.has(id));
      if (kept.length || release.policy!.inclusionRule === 'explicit') return kept;
      return release.pendingWork.map((item) => item.id);
    });
  }, [release?.policy?.id, release?.policy?.inclusionRule, release?.pendingWork]);

  const run = async (task: () => Promise<unknown>, finish = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await task();
      if (finish && result) onBack();
      return result;
    } catch (cause) {
      setError(projectError(cause));
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async () => {
    const targets = policyTargets.filter((target) => target.label.trim());
    const result = await run(() =>
      controller.setReleasePolicy(project.id, {
        name: policyName.trim(),
        timing: policyTiming.trim() || null,
        channel: policyChannel.trim() || null,
        requiredChecks: requiredChecksText
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        inclusionRule,
        targets: targets.map((target) => ({ ...target, label: target.label.trim() })),
        completionMode,
        postReleaseVerification,
      }),
    );
    if (result) setEditingPolicy(false);
  };

  const addPolicyTarget = () => {
    let index = 1;
    while (policyTargets.some((target) => target.key === `target-${index}`)) index++;
    setPolicyTargets([...policyTargets, { key: `target-${index}`, label: '', required: false }]);
  };

  const recordReleaseException = async () => {
    const reason = exceptionReason.trim();
    if (!reason) return;
    const result = (await run(() => controller.createReleaseException(project.id, { reason }))) as
      | ReleaseProjectView
      | null
      | undefined;
    const exception = [...(result?.exceptions ?? [])]
      .reverse()
      .find((item) => item.state === 'active');
    if (exception) setSelectedExceptionId(exception.id);
  };

  if (!release)
    return (
      <p role="status">
        {releaseLoading ? 'Reading release state…' : 'Release state unavailable.'}
      </p>
    );

  const requestedRelease = releaseId
    ? (release.batches.find((batch) => batch.id === releaseId) ?? null)
    : null;
  const nonTerminalRelease =
    release.batches.find((batch) => !['completed', 'rolled-back'].includes(batch.state)) ?? null;
  const active =
    (requestedRelease && !['completed', 'rolled-back'].includes(requestedRelease.state)
      ? requestedRelease
      : nonTerminalRelease) ??
    requestedRelease ??
    null;

  const policyTargetsReady = policyTargets
    .filter((target) => target.label.trim())
    .map((target) => ({ ...target, label: target.label.trim() }));
  const canSavePolicy =
    !!policyName.trim() &&
    policyTargetsReady.length > 0 &&
    policyTargetsReady.some((target) => target.required);
  const policyEditor = (
    <div role="group" aria-label="Release policy editor">
      <label className="pw-field">
        Policy name
        <Input
          name="release-policy-name"
          value={policyName}
          maxLength={120}
          onChange={(event) => setPolicyName(event.target.value)}
        />
      </label>
      <label className="pw-field">
        Timing <span className="pw-small">optional</span>
        <Input
          name="release-policy-timing"
          value={policyTiming}
          maxLength={500}
          onChange={(event) => setPolicyTiming(event.target.value)}
        />
      </label>
      <label className="pw-field">
        Channel <span className="pw-small">optional</span>
        <Input
          name="release-policy-channel"
          value={policyChannel}
          maxLength={160}
          onChange={(event) => setPolicyChannel(event.target.value)}
        />
      </label>
      <div>
        <strong>Delivery targets</strong>
        {policyTargets.map((target, index) => (
          <div key={target.key} className="pw-context-item">
            <label className="pw-field">
              Target {index + 1}
              <Input
                name={`release-target-${index}`}
                value={target.label}
                maxLength={160}
                onChange={(event) =>
                  setPolicyTargets((items) =>
                    items.map((item) =>
                      item.key === target.key ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={target.required}
                aria-label={`Required for release completion — target ${index + 1}`}
                onChange={(event) =>
                  setPolicyTargets((items) =>
                    items.map((item) =>
                      item.key === target.key ? { ...item, required: event.target.checked } : item,
                    ),
                  )
                }
              />{' '}
              Required for release completion
            </label>
            {policyTargets.length > 1 && (
              <Button
                variant="ghost"
                onClick={() =>
                  setPolicyTargets((items) => items.filter((item) => item.key !== target.key))
                }
              >
                Remove target
              </Button>
            )}
          </div>
        ))}
        <Button variant="outline" onClick={addPolicyTarget}>
          Add delivery target
        </Button>
      </div>
      <label className="pw-field">
        Required checks <span className="pw-small">one per line</span>
        <Textarea
          name="release-required-checks"
          maxLength={2000}
          value={requiredChecksText}
          onChange={(event) => setRequiredChecksText(event.target.value)}
        />
      </label>
      <label className="pw-field">
        Release scope
        <select
          name="release-inclusion-rule"
          value={inclusionRule}
          onChange={(event) => setInclusionRule(event.target.value as 'ready-only' | 'explicit')}
        >
          <option value="ready-only">Default to all ready completed work</option>
          <option value="explicit">Choose release work explicitly</option>
        </select>
      </label>
      <label className="pw-field">
        Release completion
        <select
          name="release-completion-mode"
          value={completionMode}
          onChange={(event) =>
            setCompletionMode(event.target.value as 'automatic' | 'user-confirmation')
          }
        >
          <option value="user-confirmation">Ask me to confirm completion</option>
          <option value="automatic">Complete automatically when policy conditions pass</option>
        </select>
      </label>
      <label className="pw-field">
        Post-release verification
        <select
          name="release-verification"
          value={postReleaseVerification}
          onChange={(event) =>
            setPostReleaseVerification(event.target.value as 'none' | 'risk-based' | 'required')
          }
        >
          <option value="risk-based">Risk based</option>
          <option value="required">Always required</option>
          <option value="none">Not required by policy</option>
        </select>
      </label>
      <Button disabled={busy || !canSavePolicy} onClick={() => void savePolicy()}>
        Save release policy
      </Button>
    </div>
  );

  if (!release.policy)
    return (
      <section aria-label="Release and delivery">
        <h3>Set a release policy</h3>
        <p>Implementation completion and delivery stay separate.</p>
        {policyEditor}
        <ActionError value={error} />
      </section>
    );

  if (active) {
    const targets = release.targets.filter((target) => target.releaseId === active.id);
    return (
      <section aria-label="Release and delivery">
        <h3>{active.title}</h3>
        <p>
          Release state · <strong>{active.state.replaceAll('-', ' ')}</strong>
        </p>
        {release.policyNeedsReview && (
          <p className="pw-decision-uncertain">
            Release policy exceptions have repeated. Review whether the policy itself should change.
          </p>
        )}
        <div className="pw-actions">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setEditingPolicy((value) => !value)}
          >
            {editingPolicy ? 'Close policy editor' : 'Edit release policy'}
          </Button>
        </div>
        {editingPolicy && policyEditor}
        <p className="pw-small">
          Included implementation work remains complete even when delivery fails or is rolled back.
        </p>
        {targets.map((target) => (
          <div key={target.id} className="pw-context-item">
            <strong>{target.label}</strong>
            <span className="pw-small">
              {target.required ? 'Required' : 'Optional'} · {target.state.replaceAll('-', ' ')}
            </span>
            <div className="pw-actions">
              {['pending', 'delivering', 'failed'].includes(target.state) && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      controller.updateDelivery(project.id, active.id, {
                        targetId: target.id,
                        state: 'succeeded',
                      }),
                    )
                  }
                >
                  Mark delivered
                </Button>
              )}
              {['pending', 'delivering'].includes(target.state) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      controller.updateDelivery(project.id, active.id, {
                        targetId: target.id,
                        state: 'failed',
                        detail: 'Delivery was reported as failed.',
                      }),
                    )
                  }
                >
                  Mark failed
                </Button>
              )}
              {target.state === 'failed' && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      controller.updateDelivery(project.id, active.id, {
                        targetId: target.id,
                        state: 'delivering',
                        detail: 'Delivery retry started.',
                      }),
                    )
                  }
                >
                  Retry delivery
                </Button>
              )}
              {target.state === 'succeeded' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      controller.updateDelivery(project.id, active.id, {
                        targetId: target.id,
                        state: 'rolled-back',
                        detail: 'Delivery was rolled back.',
                      }),
                    )
                  }
                >
                  Record rollback
                </Button>
              )}
            </div>
          </div>
        ))}
        {!!active.checks.length && (
          <div>
            <h4>Required checks</h4>
            {active.checks.map((check) => (
              <div key={check.id} className="pw-context-item">
                <strong>{check.label}</strong>
                <span className="pw-small">
                  {check.state === 'pending'
                    ? 'Waiting'
                    : check.state === 'passed'
                      ? 'Passed'
                      : check.state === 'failed'
                        ? 'Failed'
                        : check.state}
                </span>
                {check.detail && <span className="pw-small">{check.detail}</span>}
                <div className="pw-actions">
                  {check.state !== 'passed' && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          controller.updateReleaseCheck(project.id, active.id, {
                            checkId: check.id,
                            state: 'passed',
                          }),
                        )
                      }
                    >
                      Mark check passed
                    </Button>
                  )}
                  {check.state === 'pending' && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          controller.updateReleaseCheck(project.id, active.id, {
                            checkId: check.id,
                            state: 'failed',
                            detail: 'Required release check was reported as failed.',
                          }),
                        )
                      }
                    >
                      Mark check failed
                    </Button>
                  )}
                  {check.state === 'failed' && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          controller.updateReleaseCheck(project.id, active.id, {
                            checkId: check.id,
                            state: 'pending',
                            detail: 'Required release check is being retried.',
                          }),
                        )
                      }
                    >
                      Retry check
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {active.state === 'awaiting-confirmation' && (
          <Button
            disabled={busy}
            onClick={() => void run(() => controller.confirmRelease(project.id, active.id), true)}
          >
            Confirm release complete
          </Button>
        )}
        {(active.state === 'partial' || active.state === 'rolled-back') && (
          <div className="pw-decision-uncertain">
            <p>
              Delivery needs a separate decision. Safe completed implementation work stays complete.
            </p>
            {active.state === 'rolled-back' && release.pendingWork.length > 0 && (
              <Button
                variant="outline"
                disabled={busy || !selectedReleaseWorkIds.length}
                onClick={() =>
                  void run(() =>
                    controller.createRelease(project.id, {
                      title: `${active.title} re-delivery`,
                      workItemIds: selectedReleaseWorkIds,
                    }),
                  )
                }
              >
                Create re-delivery release
              </Button>
            )}
            <label className="pw-field">
              Repair work
              <Input
                name="release-repair-title"
                maxLength={160}
                value={repairTitle}
                onChange={(event) => setRepairTitle(event.target.value)}
              />
            </label>
            <label className="pw-field">
              Done when <span className="pw-small">optional</span>
              <Textarea
                name="release-repair-done"
                maxLength={1200}
                value={repairDoneWhen}
                onChange={(event) => setRepairDoneWhen(event.target.value)}
              />
            </label>
            <Button
              disabled={busy || !repairTitle.trim()}
              onClick={() =>
                void run(
                  () =>
                    controller.createWorkItem(
                      project.id,
                      repairTitle.trim(),
                      repairDoneWhen.trim() || null,
                    ),
                  true,
                )
              }
            >
              Start repair work
            </Button>
          </div>
        )}
        <ActionError value={error} />
      </section>
    );
  }

  return (
    <section className="pw-release-section" aria-label="Release and delivery">
      <h3>Review completed work for delivery</h3>
      <p>Policy · {release.policy.name}</p>
      {release.policyNeedsReview && (
        <p className="pw-decision-uncertain">
          Release policy exceptions have repeated. Review whether the policy itself should change.
        </p>
      )}
      <div className="pw-actions">
        <Button variant="ghost" disabled={busy} onClick={() => setEditingPolicy((value) => !value)}>
          {editingPolicy ? 'Close policy editor' : 'Edit release policy'}
        </Button>
      </div>
      {editingPolicy && policyEditor}
      <details className="pw-details">
        <summary>One-off policy exception</summary>
        <p className="pw-small">
          Use this for one release without rewriting the saved release policy.
        </p>
        <label className="pw-field">
          Why this exception is needed
          <Textarea
            name="release-exception-reason"
            maxLength={1200}
            value={exceptionReason}
            onChange={(event) => setExceptionReason(event.target.value)}
          />
        </label>
        <label className="pw-field">
          One-off required delivery target
          <Input
            name="release-exception-target"
            maxLength={160}
            value={exceptionTargetLabel}
            onChange={(event) => setExceptionTargetLabel(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={
            busy || !!selectedExceptionId || !exceptionReason.trim() || !exceptionTargetLabel.trim()
          }
          onClick={() => void recordReleaseException()}
        >
          Record policy exception
        </Button>
        {selectedExceptionId && (
          <p className="pw-small" role="status">
            Exception recorded for this release.
          </p>
        )}
      </details>
      {release.pendingWork.length ? (
        <>
          <div role="group" aria-label="Choose release work">
            {release.pendingWork.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selectedReleaseWorkIds.includes(item.id)}
                  onChange={(event) =>
                    setSelectedReleaseWorkIds((selected) =>
                      event.target.checked
                        ? [...new Set([...selected, item.id])]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />{' '}
                {item.title}
              </label>
            ))}
          </div>
          <label className="pw-field">
            Release name
            <Input
              value={releaseTitle}
              maxLength={160}
              onChange={(event) => setReleaseTitle(event.target.value)}
            />
          </label>
          <Button
            disabled={busy || !releaseTitle.trim() || !selectedReleaseWorkIds.length}
            onClick={() =>
              void run(() =>
                controller.createRelease(project.id, {
                  title: releaseTitle.trim(),
                  workItemIds: selectedReleaseWorkIds,
                  ...(selectedExceptionId
                    ? {
                        exceptionId: selectedExceptionId,
                        targets: [
                          {
                            key: 'exception-primary',
                            label: exceptionTargetLabel.trim(),
                            required: true,
                          },
                        ],
                      }
                    : {}),
                }),
              )
            }
          >
            Create release
          </Button>
        </>
      ) : (
        <p>No completed work is waiting for delivery.</p>
      )}
      <ActionError value={error} />
    </section>
  );
}

export function ProjectNowActionMode(props: Props) {
  useEffect(() => {
    if (!['review', 'new-work', 'release'].includes(props.mode) && !props.data)
      void props.controller.projectDecision(props.project.id).catch(() => {});
  }, [props.controller, props.data, props.mode, props.project.id]);

  if (props.mode === 'direction')
    return (
      <DirectionAction
        project={props.project}
        controller={props.controller}
        data={props.data}
        view={props.view}
        onBack={props.onBack}
      />
    );
  if (props.mode === 'review')
    return (
      <ReviewWorkAction
        project={props.project}
        controller={props.controller}
        view={props.view}
        edits={props.edits}
        actionKind={props.actionKind}
        selectionKey={props.selectionKey}
        discussionOpen={props.discussionOpen ?? false}
        onBack={props.onBack}
        onVerify={props.onVerify}
        onDiscussionChange={(open) => props.onDiscussionChange?.(open)}
      />
    );
  if (props.mode === 'new-work')
    return (
      <NextWorkAction
        project={props.project}
        controller={props.controller}
        view={props.view}
        onBack={props.onBack}
      />
    );
  if (props.mode === 'release')
    return (
      <ReleaseAction
        project={props.project}
        controller={props.controller}
        release={props.release}
        releaseLoading={props.releaseLoading}
        releaseId={props.releaseId}
        onBack={props.onBack}
      />
    );
  if (
    props.mode === 'continue' ||
    props.mode === 'remaining' ||
    props.mode === 'verify' ||
    props.mode === 'policy'
  )
    return (
      <ScopeAction
        project={props.project}
        controller={props.controller}
        data={props.data}
        view={props.view}
        mode={props.mode}
        onBack={props.onBack}
      />
    );
  return (
    <RequestAction
      project={props.project}
      controller={props.controller}
      data={props.data}
      requestId={props.requestId}
      onBack={props.onBack}
    />
  );
}
