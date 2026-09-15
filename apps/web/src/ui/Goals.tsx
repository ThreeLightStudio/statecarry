import type { AppViewModel, UIAction } from '@statecarry/presentation';

export function GoalChoices({
  state,
  onAction,
}: {
  state: AppViewModel;
  onAction: (action: UIAction) => void;
}) {
  return (
    <section className="card">
      <h2>Resume this work</h2>
      <p>
        Review the goal, current progress and next step in the Resume view. Opening it keeps the
        same connected records.
      </p>
      <a href={`#/resume/${state.detail?.workId ?? ''}`}>Open Resume</a>
    </section>
  );
}

export function ProjectGoals({ state }: { state: AppViewModel }) {
  const groups = new Map<string, typeof state.projects>();
  for (const goal of state.projects) groups.set(goal.cwd, [...(groups.get(goal.cwd) ?? []), goal]);
  return (
    <section className="projects">
      <p className="eyebrow">Your work, in context</p>
      <h1>What are you returning to?</h1>
      {[...groups].map(([cwd, goals]) => (
        <section className="card" key={cwd}>
          <h2>{cwd.split('/').filter(Boolean).at(-1) ?? cwd}</h2>
          <p className="small">{cwd}</p>
          <h3>Goals</h3>
          {goals.map((goal) => (
            <article className="goal-choice" key={goal.workId}>
              <h3>
                <a href={`#/work/${goal.workId}`}>{goal.title}</a>
              </h3>
              <p>
                {goal.current ??
                  'No checked explanation yet. Read the selected records or choose a goal.'}
              </p>
              <a href={`#/work/${goal.workId}`}>Read goal</a>
            </article>
          ))}
        </section>
      ))}
      <a className="card project-card" href="#/connect">
        Connect records · Describe a goal
      </a>
    </section>
  );
}
