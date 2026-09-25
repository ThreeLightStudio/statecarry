import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import {
  projectError,
  type ProjectController,
  type ProjectView,
  type ProjectDrafts,
} from '@statecarry/presentation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const attribution = {
  'user-request': 'Your recorded request',
  'user-decision': 'Your recorded decision',
  'agent-report': 'Reported by the agent',
  'agent-interpretation': 'Agent interpretation',
  'agent-proposal': 'Agent suggestion',
  'tool-result': 'Observed check result',
  'file-observation': 'Observed in project files',
};

export function WorkDiscussion({
  project,
  workKey,
  edits,
  controller,
  version = project.version,
  onClose,
}: {
  project: ProjectView;
  workKey: string;
  edits: ProjectDrafts;
  controller: ProjectController;
  version?: string;
  onClose: () => void;
}) {
  const discussion = edits.taskDiscussions?.find(([key]) => key === workKey)?.[1];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
    };
  }, []);
  const ask = async (question?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await controller.askTaskDiscussion(project.id, workKey, question);
    } catch (cause) {
      if (mounted.current) setError(projectError(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  if (!discussion) return null;
  const stale = discussion.version !== version;
  return (
    <section className="pw-task-discussion" aria-label="Task discussion">
      <h3 ref={heading} tabIndex={-1}>
        <MessageCircle size={20} aria-hidden="true" /> Talk this through
      </h3>
      {discussion.turns.length === 0 && (
        <p className="pw-discussion-invitation">
          What would help you decide? Ask why this work matters, where to draw the line, or whether
          to keep it.
        </p>
      )}
      {stale && (
        <div className="pw-return-observation" role="status">
          <div>
            <p>The project has changed. Earlier answers still refer to the previous state.</p>
            <Button
              disabled={busy}
              onClick={() => controller.rebaseTaskDiscussion(project.id, workKey)}
            >
              Continue with current project state
            </Button>
          </div>
        </div>
      )}
      <div className="pw-task-discussion-turns" aria-live="polite" aria-busy={busy}>
        {discussion.turns.map((turn, index) => (
          <article key={`${index}:${turn.question}`} className="pw-task-discussion-turn">
            <div className="pw-task-discussion-question">
              <span className="pw-small">You</span>
              <p>{turn.question}</p>
            </div>
            <div className="pw-discussion-reply">
              <span className="pw-discussion-avatar" aria-hidden="true">
                S
              </span>
              <div className="pw-task-discussion-answer">
                <strong className="pw-small">StateCarry</strong>
                {(turn.version ?? discussion.version) !== version && (
                  <span className="pw-small">Answer from an earlier project state</span>
                )}
                <h4>Answer</h4>
                {turn.answer.items
                  .filter((item) => item.kind === 'record')
                  .map((item) => (
                    <div key={item.id}>
                      <p>{item.text}</p>
                      <span className="pw-small">{attribution[item.nature]}</span>
                      {item.uncertainty && <p className="pw-small">{item.uncertainty}</p>}
                    </div>
                  ))}
                {turn.answer.items.some((item) => item.kind === 'interpretation') && (
                  <section>
                    <h4>
                      {turn.answer.items.some((item) => item.kind === 'record')
                        ? 'Reasoning'
                        : 'StateCarry interpretation'}
                    </h4>
                    {turn.answer.items
                      .filter((item) => item.kind === 'interpretation')
                      .map((item) => (
                        <div key={item.id}>
                          <p>{item.text}</p>
                          {item.uncertainty && <p>{item.uncertainty}</p>}
                        </div>
                      ))}
                  </section>
                )}
                {turn.answer.unknowns.length > 0 && <h4>What still needs checking</h4>}
                {turn.answer.unknowns.map((unknown) => (
                  <p className="pw-small" key={unknown}>
                    Still unknown · {unknown}
                  </p>
                ))}
                {turn.answer.limitations.length > 0 && (
                  <details className="pw-details">
                    <summary>Answer limits</summary>
                    {turn.answer.limitations.map((limit) => (
                      <p className="pw-small" key={limit}>
                        {limit}
                      </p>
                    ))}
                  </details>
                )}
                <p className="pw-small">For discussion · No decision has been recorded.</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <form
        className="pw-task-discussion-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <div className="pw-discussion-compose">
          <label className="pw-field">
            <span className="sr-only">Your question</span>
            <Textarea
              name={`task-discussion-${workKey}`}
              maxLength={2000}
              placeholder="Share what you are considering…"
              value={discussion.input}
              onChange={(event) =>
                controller.editTaskDiscussionInput(project.id, workKey, event.target.value)
              }
            />
          </label>
          <Button
            className="pw-button pw-button--primary"
            disabled={busy || stale || !discussion.input.trim()}
          >
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
        <Button
          type="button"
          className="pw-button pw-button--quiet pw-discussion-organize"
          disabled={busy || stale}
          onClick={() =>
            void ask(
              'Summarize the possible directions: continue, narrow the scope, stop, or decide later. Explain the reason and tradeoff of each without choosing for me.',
            )
          }
        >
          Organize possible directions
        </Button>
        <p className="pw-small pw-discussion-saved">
          You can decide later. Your questions and answers stay with this work.
        </p>
        <Button
          type="button"
          variant="ghost"
          className="pw-button pw-button--quiet"
          onClick={onClose}
        >
          Close discussion
        </Button>
      </form>
      {error && (
        <p className="pw-notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
