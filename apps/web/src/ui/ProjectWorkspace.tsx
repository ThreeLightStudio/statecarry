import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  projectError,
  projectHref,
  projectRouteHref,
  type ProjectController,
  type ProjectCreateInput,
  type ProjectSourcesInput,
  type ProjectTaskView,
  type ProjectView,
  type RecordRange,
  type SavedResumeEdits,
} from '@statecarry/presentation';
import '@/styles/globals.css';
import { Alert } from '@/components/ui/alert';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button as UiButton, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Star } from 'lucide-react';
import './project-workspace.css';

type WorkspaceState = ReturnType<ProjectController['getSnapshot']>;
type Navigate = (href: string) => void;
type WorkspaceProps = { controller: ProjectController; onNavigate: Navigate };
type ProjectProps = WorkspaceProps & { project: ProjectView; state: WorkspaceState };
const emptyEdits: SavedResumeEdits = { goalDraft: null, actionDrafts: [], expanded: [], scroll: 0 };
const responseLanguageKey = 'statecarry.response-language.v1';

function readResponseLanguage(): 'en' | 'ko' {
  try {
    return window.localStorage.getItem(responseLanguageKey) === 'ko' ? 'ko' : 'en';
  } catch {
    return 'en';
  }
}

function writeResponseLanguage(language: 'en' | 'ko') {
  try {
    window.localStorage.setItem(responseLanguageKey, language);
  } catch {
    // The preference remains active for this tab when browser storage is unavailable.
  }
}

function legacyButtonVariant(className?: string) {
  if (className?.includes('pw-button--primary')) return 'default' as const;
  if (className?.includes('pw-button--quiet')) return 'ghost' as const;
  if (className?.includes('pw-button--danger')) return 'destructive' as const;
  return 'outline' as const;
}

function Button({ className, variant, ...props }: ComponentProps<typeof UiButton>) {
  return (
    <UiButton
      variant={variant ?? legacyButtonVariant(className)}
      className={cn('pw-button', className)}
      {...props}
    />
  );
}

function routeButtonClass(className?: string) {
  if (!className?.includes('pw-button')) return className;
  return cn(buttonVariants({ variant: legacyButtonVariant(className) }), className);
}

const cardSurface =
  'min-w-0 space-y-3.5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm';

function RouteLink({
  href,
  onNavigate,
  children,
  className,
  current,
  beforeNavigate,
}: {
  href: string;
  onNavigate: Navigate;
  children: ReactNode;
  className?: string;
  current?: 'page' | 'true';
  beforeNavigate?: () => void;
}) {
  return (
    <a
      href={href}
      className={routeButtonClass(className)}
      aria-current={current}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        beforeNavigate?.();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

function Badge({ children, kind = '' }: { children: ReactNode; kind?: string }) {
  const alias = kind === 'accepted' ? 'completed' : kind === 'continue' ? 'ready' : kind;
  return (
    <UiBadge variant="secondary" className={`pw-badge pw-badge--${alias}`}>
      {children}
    </UiBadge>
  );
}

function OverviewDate({ value }: { value: string | null }) {
  const date = value ? new Date(value) : null;
  return (
    <span className="pw-small">
      {date && Number.isFinite(date.getTime()) ? (
        <>
          Overview prepared{' '}
          <time dateTime={value!}>
            {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        </>
      ) : (
        'The preparation time is not available.'
      )}
    </span>
  );
}

export function ProjectWorkspace({ controller, onNavigate }: WorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { route } = state;
  const project = state.projects.find((item) => item.id === route.workId);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    controller.setOutputLanguage(readResponseLanguage());
  }, [controller]);
  useEffect(() => {
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    heading?.focus({ preventScroll: true });
  }, [route.page, route.workId, !!project]);
  useEffect(() => {
    if (route.page !== 'project' || !project) return;
    const id = project.id;
    let scroll = controller.getSnapshot().edits[id]?.scroll ?? 0;
    const frame = requestAnimationFrame(() => window.scrollTo(0, scroll));
    const record = () => {
      scroll = window.scrollY;
      controller.recordScroll(id, scroll);
    };
    window.addEventListener('scroll', record, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', record);
      controller.recordScroll(id, scroll);
    };
  }, [controller, route.page, project?.id]);

  return (
    <div className="pw-shell">
      <a
        href="#workspace-main"
        className="pw-skip"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to current work
      </a>
      <aside className="pw-rail" aria-label="Workspace navigation">
        <RouteLink href="#/home" onNavigate={onNavigate} className="pw-brand">
          <span className="pw-brand-mark" aria-hidden="true">
            ↗
          </span>
          StateCarry
        </RouteLink>
        <nav className="pw-nav" aria-label="Main">
          <RouteLink
            href="#/home"
            onNavigate={onNavigate}
            current={route.page === 'home' ? 'page' : undefined}
          >
            Home
          </RouteLink>
          <RouteLink
            href="#/new"
            onNavigate={onNavigate}
            current={route.page === 'new' ? 'page' : undefined}
          >
            Add a project
          </RouteLink>
        </nav>
        <div>
          <span className="pw-nav-label">Your projects</span>
          <nav className="pw-nav" aria-label="Registered projects">
            {state.projects
              .filter((item) => !item.disconnected)
              .map((item) => (
                <RouteLink
                  key={item.id}
                  href={projectHref(item.id)}
                  onNavigate={onNavigate}
                  current={item.id === route.workId ? 'page' : undefined}
                >
                  {item.title}
                </RouteLink>
              ))}
          </nav>
        </div>
        <div className="pw-rail-foot">
          <RouteLink
            href="#/settings"
            onNavigate={onNavigate}
            className="pw-settings-link"
            current={route.page === 'global-settings' ? 'page' : undefined}
          >
            Settings
          </RouteLink>
          <p>A place to return, understand your work, and choose what comes next.</p>
        </div>
      </aside>
      <main ref={mainRef} className="pw-main" id="workspace-main" tabIndex={-1}>
        <div className="pw-topbar">
          <nav className="pw-breadcrumb" aria-label="Breadcrumb">
            <RouteLink href="#/home" onNavigate={onNavigate}>
              Workspace
            </RouteLink>
            {project && (
              <>
                <span aria-hidden="true">/</span>
                <RouteLink href={projectHref(project.id)} onNavigate={onNavigate}>
                  {project.title}
                </RouteLink>
              </>
            )}
            {route.page === 'settings' && (
              <>
                <span aria-hidden="true">/</span>
                <span>Settings</span>
              </>
            )}
            {route.page === 'global-settings' && (
              <>
                <span aria-hidden="true">/</span>
                <span>Settings</span>
              </>
            )}
            {route.page === 'original' && (
              <>
                <span aria-hidden="true">/</span>
                <span>Original inspection</span>
              </>
            )}
          </nav>
          <div className="pw-actions">
            <span className="pw-small" role="status">
              {state.loading
                ? 'Reading saved state…'
                : state.online
                  ? 'Local service connected'
                  : 'Local service unavailable'}
            </span>
            <Button
              type="button"
              className="pw-button pw-button--quiet"
              title="Re-read the latest saved project state. StateCarry also refreshes when you return to the app."
              disabled={state.loading || (state.online && state.checkingCurrent)}
              onClick={() => void controller.checkForChanges()}
            >
              Refresh now
            </Button>
          </div>
        </div>
        {state.error && (
          <section className="pw-notice" role="alert">
            <p>{state.error}</p>
            <Button className="pw-button" onClick={() => void controller.refresh()}>
              Read latest state
            </Button>
          </section>
        )}
        {state.memoryError && (
          <p className="pw-notice" role="alert">
            {state.memoryError}
          </p>
        )}
        {state.notice && (
          <div className="pw-toast-layer" aria-live="polite">
            <Alert className="pw-toast" role="status">
              <p>{state.notice}</p>
              <Button className="pw-button" onClick={() => controller.clearNotice()}>
                Dismiss message
              </Button>
            </Alert>
          </div>
        )}
        {route.page === 'home' ? (
          <Home state={state} controller={controller} onNavigate={onNavigate} />
        ) : route.page === 'new' ? (
          <CreateProject controller={controller} onNavigate={onNavigate} />
        ) : route.page === 'global-settings' ? (
          <GlobalSettings state={state} controller={controller} onNavigate={onNavigate} />
        ) : project ? (
          route.page === 'settings' ? (
            <ProjectSettings
              key={project.id}
              project={project}
              state={state}
              controller={controller}
              onNavigate={onNavigate}
            />
          ) : route.page === 'original' ? (
            <OriginalInspection
              project={project}
              state={state}
              controller={controller}
              onNavigate={onNavigate}
            />
          ) : (
            <ProjectPage
              project={project}
              state={state}
              controller={controller}
              onNavigate={onNavigate}
            />
          )
        ) : state.loading ? (
          <p role="status">Reading this project…</p>
        ) : (
          <section className="pw-empty">
            <h1 tabIndex={-1}>Project not available</h1>
            <p>This registration is not in the current workspace. It may have been removed.</p>
            <RouteLink className="pw-button" href="#/home" onNavigate={onNavigate}>
              Return Home
            </RouteLink>
          </section>
        )}
      </main>
    </div>
  );
}

function GlobalSettings({
  state,
  controller,
  onNavigate,
}: WorkspaceProps & { state: WorkspaceState }) {
  const [language, setLanguage] = useState<'en' | 'ko'>(() => readResponseLanguage());
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<ProjectController['capabilities']>
  > | null>(null);
  const [checking, setChecking] = useState(false);
  const [localizing, setLocalizing] = useState(false);
  const [capabilityError, setCapabilityError] = useState('');
  const mounted = useRef(true);
  const localizationAttempt = useRef('');

  const readCapabilities = async () => {
    try {
      const next = await controller.capabilities();
      if (mounted.current) {
        setCapabilities(next);
        setCapabilityError('');
      }
    } catch {
      if (mounted.current)
        setCapabilityError('Codex status could not be read from the local StateCarry service.');
    }
  };

  useEffect(() => {
    mounted.current = true;
    void readCapabilities();
    return () => {
      mounted.current = false;
    };
  }, [controller]);

  useEffect(() => {
    if (!state.online || state.loading || state.checkingCurrent || state.busyWorkId) return;
    const mismatched = state.projects
      .filter((project) => project.generatedAt && project.outputLanguage !== language)
      .map((project) => `${project.id}:${project.generatedAt}:${project.outputLanguage}`)
      .join('|');
    if (!mismatched) return;
    const attempt = `${language}:${mismatched}`;
    if (localizationAttempt.current === attempt) return;
    localizationAttempt.current = attempt;
    setLocalizing(true);
    void controller.localizeGeneratedOverviews(language).finally(() => {
      if (mounted.current) setLocalizing(false);
    });
  }, [
    controller,
    language,
    state.busyWorkId,
    state.checkingCurrent,
    state.loading,
    state.online,
    state.projects,
  ]);

  const checkIntegrations = async () => {
    setChecking(true);
    await readCapabilities();
    if (mounted.current) setChecking(false);
  };

  const changeLanguage = (next: 'en' | 'ko') => {
    setLanguage(next);
    writeResponseLanguage(next);
    controller.setOutputLanguage(next);
    localizationAttempt.current = '';
    setLocalizing(true);
    void controller.localizeGeneratedOverviews(next).finally(() => {
      if (mounted.current) setLocalizing(false);
    });
  };

  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Settings</span>
          <h1 tabIndex={-1}>StateCarry settings</h1>
          <p className="pw-lead">
            Check the local integrations StateCarry can read and choose the language used for newly
            prepared project overviews.
          </p>
        </div>
      </header>

      <div className="pw-stack">
        <Card className={cardSurface} aria-labelledby="response-language-heading">
          <h2 id="response-language-heading">Response language</h2>
          <p className="pw-small">
            This changes overview explanation text without changing the StateCarry interface or
            rewriting quoted source evidence. Existing prepared overviews are translated without
            re-analyzing the project.
          </p>
          <label className="pw-field">
            Overview responses
            <select
              name="response-language"
              value={language}
              disabled={localizing}
              onChange={(event) => changeLanguage(event.target.value === 'ko' ? 'ko' : 'en')}
            >
              <option value="en">English</option>
              <option value="ko">Korean</option>
            </select>
          </label>
          {localizing && (
            <p className="pw-small" role="status">
              Updating existing overview text without re-analyzing project evidence…
            </p>
          )}
        </Card>

        <Card className={cardSurface} aria-labelledby="codex-integration-heading">
          <div className="pw-section-head">
            <h2 id="codex-integration-heading">Codex</h2>
            <Badge kind={capabilities?.summary.state === 'ready' ? 'continue' : 'limited'}>
              {capabilities
                ? capabilities.summary.state === 'ready'
                  ? 'Ready on this machine'
                  : 'Not ready'
                : 'Checking'}
            </Badge>
          </div>
          {capabilities ? (
            <>
              <p>
                {capabilities.summary.state === 'ready'
                  ? 'StateCarry can use the Codex installation available on this machine.'
                  : capabilities.summary.detail}
              </p>
              {capabilities.summary.state !== 'ready' && (
                <p className="pw-small">
                  Confirm Codex can start normally on this machine, then recheck its status here.
                </p>
              )}
            </>
          ) : capabilityError ? (
            <p className="pw-notice" role="alert">
              {capabilityError}
            </p>
          ) : (
            <p className="pw-small" role="status">
              Reading Codex capability status…
            </p>
          )}
          <p className="pw-small">
            Codex conversations are optional project context. Choose them separately for each
            project.
          </p>
          <div>
            <Button
              className="pw-button"
              disabled={checking}
              onClick={() => void checkIntegrations()}
            >
              {checking ? 'Checking Codex…' : 'Recheck Codex'}
            </Button>
          </div>
        </Card>

        <Card className={cardSurface} aria-labelledby="project-integrations-heading">
          <h2 id="project-integrations-heading">Project integrations</h2>
          <p className="pw-small">
            Codebase and Git checks are automatic for each registered project folder. They do not
            need a separate account connection.
          </p>
          {state.projects.length ? (
            <div className="pw-stack">
              {state.projects.map((project) => (
                <section
                  key={project.id}
                  className="pw-settings-project"
                  aria-label={project.title}
                >
                  <div className="pw-section-head">
                    <div>
                      <h3>{project.title}</h3>
                      <p className="pw-small">{project.cwd}</p>
                    </div>
                    <RouteLink
                      className="pw-button"
                      href={`${projectHref(project.id)}/settings`}
                      onNavigate={onNavigate}
                    >
                      Manage Codex context
                    </RouteLink>
                  </div>
                  <div
                    className="pw-source-summary"
                    aria-label={`Integration status for ${project.title}`}
                  >
                    {project.sourceSummary.map((source) => (
                      <div key={source.kind} className="pw-source-summary-item">
                        <strong>{source.label}</strong>
                        <span>{source.detail}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="pw-small">Add a project to see its codebase and Git check status.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Home({ state, controller, onNavigate }: WorkspaceProps & { state: WorkspaceState }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const query = search.trim().toLocaleLowerCase();
  const projects = state.projects.filter(
    (project) =>
      (filter === 'all' ||
        (filter === 'focused' && project.focused) ||
        (filter === 'disconnected' && project.disconnected)) &&
      (!query ||
        [
          project.title,
          project.purpose,
          project.cwd,
          ...project.tasks.map((task) => task.title),
        ].some((text) => text.toLocaleLowerCase().includes(query))),
  );
  const pending = projects
    .filter((project) => !project.disconnected)
    .flatMap((project) =>
      project.tasks
        .filter((task) => task.status !== 'accepted' && task.status !== 'paused')
        .map((task) => ({ project, task })),
    );
  const awaitingContext = projects.some(
    (project) =>
      !project.disconnected &&
      !project.generatedAt &&
      !project.tasks.length &&
      !project.dismissed.length,
  );
  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Your workspace</span>
          <h1 tabIndex={-1}>Where will you pick up?</h1>
          <p className="pw-lead">
            See the work that needs a choice. Open a task to understand what changed, why it
            matters, and what will count as finished.
          </p>
        </div>
        <RouteLink className="pw-button pw-button--primary" href="#/new" onNavigate={onNavigate}>
          Add a project
        </RouteLink>
      </header>
      <div className="pw-grid" role="search" aria-label="Find registered work">
        <label className="pw-field">
          Find a project or task
          <Input
            type="search"
            name="workspace-search"
            placeholder="Search names, purpose, or folders"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="pw-field">
          Show projects
          <select
            name="project-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All registered projects</option>
            <option value="focused">My focused projects</option>
            <option value="disconnected">Disconnected projects</option>
          </select>
        </label>
      </div>
      <section className="pw-section" aria-labelledby="pending-heading">
        <div className="pw-section-head">
          <h2 id="pending-heading">Work to consider</h2>
          <span className="pw-small">
            Your focus comes first. Recent activity is not a priority ranking.
          </span>
        </div>
        {pending.length ? (
          <div className="pw-grid">
            {pending.map(({ project, task }) => (
              <RouteLink
                key={`${project.id}:${task.key}`}
                href={projectHref(project.id, task.key)}
                onNavigate={onNavigate}
                beforeNavigate={() => controller.select(project.id, task.key)}
                className={cn(
                  cardSurface,
                  `pw-card pw-card-link${project.focused ? ' pw-card--focused' : ''}`,
                )}
              >
                <div className="pw-card-meta">
                  <Badge kind={project.canDecide ? task.status : 'limited'}>
                    {project.canDecide ? task.statusLabel : project.stateLabel}
                  </Badge>
                  {project.focused && <span className="pw-small">Your focus</span>}
                </div>
                <span className="pw-eyebrow">{project.title}</span>
                <h3>{task.title}</h3>
                <p className="pw-small">{task.currentState}</p>
                <p>{task.reason}</p>
                {!project.canDecide && <p className="pw-small">{project.stateDescription}</p>}
                <span className="pw-link-label">
                  Understand this task <span aria-hidden="true">→</span>
                </span>
              </RouteLink>
            ))}
          </div>
        ) : (
          <div className="pw-empty">
            <h3>
              {state.loading
                ? 'Reading your projects…'
                : query || filter !== 'all'
                  ? 'No pending tasks match these filters.'
                  : awaitingContext
                    ? 'No work recommendations have been prepared yet.'
                    : 'Nothing needs a new task just to clear this view.'}
            </h3>
            <p>
              {awaitingContext
                ? 'Open a project to record its purpose and current goal, connect relevant conversations, then explicitly prepare its first overview.'
                : state.projects.length
                  ? 'Open a project below, or change the filters to see more work.'
                  : 'Register a project with its purpose and a goal. You can connect conversations later.'}
            </p>
          </div>
        )}
      </section>
      <section className="pw-section" aria-labelledby="all-projects-heading">
        <div className="pw-section-head">
          <h2 id="all-projects-heading">All projects</h2>
          <span className="pw-small" role="status">
            {projects.length} shown · {state.projects.length} registered
          </span>
        </div>
        <div className="pw-grid">
          {projects.map((project) => (
            <article
              key={project.id}
              className={cn(cardSurface, 'pw-card pw-card--quiet pw-project-card')}
            >
              <Button
                type="button"
                className="pw-focus-toggle"
                variant="ghost"
                aria-label={
                  project.focused
                    ? `Remove ${project.title} from Home focus`
                    : `Make ${project.title} my Home focus`
                }
                aria-pressed={project.focused}
                title={project.focused ? 'Remove from Home focus' : 'Make this my Home focus'}
                disabled={!state.online || state.checkingCurrent || state.busyWorkId !== null}
                onClick={() => void controller.setFocused(project.id, !project.focused)}
              >
                <Star aria-hidden="true" fill={project.focused ? 'currentColor' : 'none'} />
              </Button>
              <div className="pw-card-meta">
                {project.focused && <Badge>Your focus</Badge>}
                <Badge kind={project.disconnected ? 'disconnected' : ''}>
                  {project.stateLabel}
                </Badge>
              </div>
              <h3>
                <RouteLink href={projectHref(project.id)} onNavigate={onNavigate}>
                  {project.title}
                </RouteLink>
              </h3>
              <p className="pw-small">
                {project.purpose || 'No project purpose has been recorded yet.'}
              </p>
              <p className="pw-small">
                {project.disconnected
                  ? 'Collection is stopped. Saved work remains available after restoration.'
                  : `${project.tasks.filter((task) => task.status !== 'accepted' && task.status !== 'paused').length} tasks to consider`}
              </p>
              {project.disconnected && (
                <Button
                  className="pw-button"
                  disabled={!state.online || state.busyWorkId === project.id}
                  onClick={() => void controller.restore(project.id)}
                >
                  Restore project
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ProjectPage({ project, state, controller, onNavigate }: ProjectProps) {
  const edits = state.edits[project.id] ?? emptyEdits;
  const selectedKey = state.route.candidateKey ?? edits.selectedKey;
  const selected =
    selectedKey !== undefined
      ? project.tasks.find((task) => task.key === selectedKey)
      : (project.tasks.find((task) => task.status !== 'accepted' && task.status !== 'paused') ??
        project.tasks[0]);
  const busy = state.busyWorkId === project.id;
  const missing = selectedKey !== undefined && !selected;
  useEffect(() => {
    if (selectedKey === undefined && selected) controller.select(project.id, selected.key);
  }, [controller, project.id, selectedKey, selected?.key]);
  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <div className="pw-card-meta">
            <span className="pw-eyebrow">Project</span>
            {project.focused && <Badge>Your focus</Badge>}
          </div>
          <h1 tabIndex={-1}>{project.title}</h1>
          <p className="pw-lead">
            {project.purpose ||
              'No project purpose has been recorded yet. Add it in project settings.'}
          </p>
        </div>
        <RouteLink
          className="pw-button"
          href={`${projectHref(project.id)}/settings`}
          onNavigate={onNavigate}
        >
          Project settings
        </RouteLink>
      </header>
      {project.disconnected ? (
        <section className="pw-empty">
          <h2>This project is disconnected</h2>
          <p>{project.stateDescription}</p>
          <Button
            className="pw-button pw-button--primary"
            disabled={!state.online || busy}
            onClick={() => void controller.restore(project.id)}
          >
            Restore project
          </Button>
        </section>
      ) : !missing && !project.tasks.length && !project.dismissed.length && !project.generatedAt ? (
        <ProjectSetup
          project={project}
          state={state}
          controller={controller}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          <section
            className={cn(cardSurface, 'pw-card pw-project-state')}
            aria-label="Project state"
          >
            <div className="pw-section-head">
              <h2>Project state</h2>
              <span className="pw-small">Codebase, Git, and optional Codex context</span>
            </div>
            <dl className="pw-state-grid">
              <div>
                <dt>Current state</dt>
                <dd>{project.projectState.currentState}</dd>
              </div>
              <div>
                <dt>Recent work</dt>
                <dd>{project.projectState.recentWork}</dd>
              </div>
              <div>
                <dt>Open or uncertain</dt>
                <dd>{project.projectState.openOrUncertain}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{project.projectState.next}</dd>
              </div>
            </dl>
          </section>
          <section
            className={`pw-goal${!project.goal && selected && !edits.goalDraft ? ' pw-goal--suggested' : ''}`}
            aria-label="Current goal"
          >
            <span className="pw-eyebrow">
              {!project.goal && selected ? 'Suggested outcome' : 'Current goal'}
            </span>
            {edits.goalDraft ? (
              <GoalEditor project={project} edits={edits} controller={controller} busy={busy} />
            ) : (
              <>
                <p>{project.goal || selected?.title || 'No goal has been chosen yet.'}</p>
                {!project.goalConfirmed && (project.goal || selected) && (
                  <span className="pw-small">
                    This outcome comes from the connected work. You can use it as context or record
                    your own goal.
                  </span>
                )}
                <div>
                  <Button
                    className="pw-button pw-button--quiet"
                    onClick={() => controller.editGoal(project.id)}
                  >
                    {project.goal ? 'Edit goal' : selected ? 'Record my goal' : 'Set a goal'}
                  </Button>
                </div>
              </>
            )}
          </section>
          <div className="pw-project-layout">
            <div className="pw-stack">
              <section
                className={project.canDecide || project.updating ? 'pw-overview-meta' : 'pw-notice'}
                aria-label="Current overview status"
              >
                {project.updating ? (
                  <p className="pw-small" role="status">
                    Checking changed records. Your saved overview stays in place.
                  </p>
                ) : !project.canDecide ? (
                  <p>{project.stateDescription}</p>
                ) : null}
                <div className="pw-actions">
                  <OverviewDate value={project.generatedAt} />
                  <Button
                    className={project.canDecide ? 'pw-button pw-button--quiet' : 'pw-button'}
                    disabled={!project.canRefresh || busy}
                    onClick={() => void controller.prepare(project.id)}
                  >
                    Prepare an updated overview
                  </Button>
                </div>
                {!project.sourceCount && (
                  <RouteLink href={`${projectHref(project.id)}/settings`} onNavigate={onNavigate}>
                    Add optional Codex context
                  </RouteLink>
                )}
              </section>
              {missing ? (
                <section className="pw-empty">
                  <h2>The selected task is no longer available</h2>
                  <p>
                    Your writing is kept, but it cannot restore a task removed from the current
                    project state. Choose another task or review the project context.
                  </p>
                </section>
              ) : selected ? (
                <TaskDetail
                  key={`${project.id}:${selected.key}`}
                  project={project}
                  task={selected}
                  edits={edits}
                  controller={controller}
                  onNavigate={onNavigate}
                  busy={busy}
                />
              ) : (
                <section className="pw-empty">
                  <h2>No next task has been chosen</h2>
                  <p>
                    Your purpose and goal are the starting point. Add the missing context or leave
                    the project here for now.
                  </p>
                </section>
              )}
              {project.tasks.length > 0 &&
                project.tasks.every((task) => task.status === 'accepted') && (
                  <section className="pw-empty">
                    <h2>No next goal has been chosen</h2>
                    <p>
                      The recorded tasks are accepted. You can leave this project here or record
                      another goal.
                    </p>
                    <Button className="pw-button" onClick={() => controller.editGoal(project.id)}>
                      Choose another goal
                    </Button>
                  </section>
                )}
            </div>
            <aside className="pw-stack" aria-label="Project tasks">
              <h2>Tasks in this project</h2>
              <nav className="pw-task-nav" aria-label="Choose a task">
                {project.tasks.map((task) => (
                  <RouteLink
                    key={task.key}
                    href={projectHref(project.id, task.key)}
                    onNavigate={onNavigate}
                    beforeNavigate={() => controller.select(project.id, task.key)}
                    current={selected?.key === task.key ? 'true' : undefined}
                  >
                    <Badge kind={task.status}>{task.statusLabel}</Badge>
                    <span className="pw-task-title">{task.title}</span>
                  </RouteLink>
                ))}
              </nav>
              {project.dismissed.length > 0 && (
                <details className="pw-details">
                  <summary>Tasks set aside</summary>
                  <div className="pw-stack">
                    {project.dismissed.map((task) => (
                      <Card className="pw-card space-y-3.5 p-6" key={task.key}>
                        <p>{task.title}</p>
                        <Button
                          className="pw-button"
                          disabled={!project.canDecide || busy}
                          onClick={() => void controller.correct(project.id, task.key, 'restore')}
                        >
                          Restore this task
                        </Button>
                      </Card>
                    ))}
                  </div>
                </details>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

function ProjectSetup({ project, state, controller, onNavigate }: ProjectProps) {
  const edits = state.edits[project.id] ?? emptyEdits;
  const busy = state.busyWorkId === project.id;
  return (
    <div className="pw-stack">
      <section className="pw-goal" aria-label="Current goal">
        <span className="pw-eyebrow">Current goal</span>
        {edits.goalDraft ? (
          <GoalEditor project={project} edits={edits} controller={controller} busy={busy} />
        ) : (
          <>
            <p>{project.goal || 'No current goal has been recorded.'}</p>
            <Button
              className="pw-button pw-button--quiet"
              onClick={() => controller.editGoal(project.id)}
            >
              {project.goal ? 'Edit goal' : 'Set a goal'}
            </Button>
          </>
        )}
      </section>
      <section className={cn(cardSurface, 'pw-card')} aria-labelledby="first-overview-heading">
        <h2 id="first-overview-heading">Prepare this project's first overview</h2>
        <p>
          StateCarry starts from the project itself. It checks the codebase and Git state
          automatically; Codex conversations are optional supporting context.
        </p>
        <p
          className={
            project.stateDescription.startsWith('The latest overview could not be prepared')
              ? 'pw-notice'
              : 'pw-small'
          }
          role={project.stateLabel === 'Preparing an update' ? 'status' : undefined}
        >
          {project.stateDescription}
        </p>
        <div className="pw-source-summary" aria-label="Sources StateCarry can use">
          {project.sourceSummary.map((source) => (
            <div key={source.kind} className="pw-source-summary-item">
              <strong>{source.label}</strong>
              <span>{source.detail}</span>
            </div>
          ))}
        </div>
        {!project.purpose && (
          <p>
            Add why this project exists in{' '}
            <RouteLink href={`${projectHref(project.id)}/settings`} onNavigate={onNavigate}>
              project settings
            </RouteLink>{' '}
            if that context would help.
          </p>
        )}
        <div className="pw-actions">
          <Button
            className="pw-button pw-button--primary"
            disabled={!project.canRefresh || busy}
            onClick={() => void controller.prepare(project.id)}
          >
            {busy || project.stateLabel === 'Preparing an update'
              ? 'Preparing overview…'
              : 'Prepare the first overview'}
          </Button>
          <RouteLink
            className="pw-button pw-button--quiet"
            href={`${projectHref(project.id)}/settings`}
            onNavigate={onNavigate}
          >
            {project.sourceCount ? 'Review Codex context' : 'Add Codex context'}
          </RouteLink>
        </div>
      </section>
    </div>
  );
}

function GoalEditor({
  project,
  edits,
  controller,
  busy,
}: {
  project: ProjectView;
  edits: SavedResumeEdits;
  controller: ProjectController;
  busy: boolean;
}) {
  const draft = edits.goalDraft!;
  const stale = draft.version !== project.version;
  const unchanged = !stale && draft.text.trim() === project.goal.trim();
  return (
    <form
      className="pw-form"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.saveGoal(project.id);
      }}
    >
      <label>
        Your intended result
        <Textarea
          name="goal"
          maxLength={400}
          value={draft.text}
          onChange={(event) => controller.editGoal(project.id, event.target.value)}
        />
      </label>
      {stale && (
        <div className="pw-notice">
          <p>
            This draft was written against an earlier overview. Compare it with the current work
            before saving.
          </p>
          <Button
            type="button"
            className="pw-button"
            disabled={!project.canEdit || busy}
            onClick={() => controller.rebaseGoal(project.id)}
          >
            I reviewed this goal against the current overview
          </Button>
        </div>
      )}
      <div className="pw-actions">
        <Button
          className="pw-button pw-button--primary"
          disabled={!project.canEdit || busy || stale || unchanged || !draft.text.trim()}
        >
          Save goal
        </Button>
        <Button
          type="button"
          className="pw-button pw-button--quiet"
          onClick={() => controller.discardGoal(project.id)}
        >
          Discard goal draft
        </Button>
        <span className="pw-small">Draft kept on this device.</span>
        {unchanged && <span className="pw-small">No goal changes to save.</span>}
      </div>
    </form>
  );
}

function TaskDetail({
  project,
  task,
  edits,
  controller,
  onNavigate,
  busy,
}: WorkspaceProps & {
  project: ProjectView;
  task: ProjectTaskView;
  edits: SavedResumeEdits;
  busy: boolean;
}) {
  const draft = edits.actionDrafts.find(([key]) => key === task.key)?.[1];
  const [copyStatus, setCopyStatus] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canDecide = project.canDecide && !busy;
  const detailKey = `basis:${task.key}`;
  const detailsOpen = edits.expanded.includes(detailKey);
  const decision =
    task.status === 'accepted'
      ? 'This task is accepted. Leave it here, or choose another goal.'
      : task.status === 'paused'
        ? 'Keep this work paused, or restore it when you are ready.'
        : task.status === 'waiting'
          ? 'Wait for the required input, or clarify what is missing.'
          : task.status === 'review'
            ? 'Review the result against the finish condition, then accept it or describe what needs changing.'
            : (task.canAct || task.rechecking) && task.nextAction
              ? task.nextAction
              : 'Clarify the current situation before choosing an action.';
  const copyTask = async () => {
    try {
      const text = await controller.handoff(project.id, task.key);
      if (!text || !mounted.current) return;
      await navigator.clipboard.writeText(text);
      if (mounted.current) setCopyStatus('Task context copied. Nothing was sent or started.');
    } catch {
      if (mounted.current)
        setCopyStatus(
          'The clipboard could not be written. Your task is kept; try again in a browser with clipboard access.',
        );
    }
  };
  return (
    <article className={cn(cardSurface, 'pw-card')} aria-label="Selected task">
      <div className="pw-card-meta">
        <Badge kind={task.status}>{task.statusLabel}</Badge>
        <span className="pw-small">{task.sourceLabel}</span>
      </div>
      <h2>{task.title}</h2>
      <p>{task.currentState}</p>
      <section className="pw-decision" aria-label="Your next choice">
        <div className="pw-decision-main">
          <span className="pw-eyebrow">Your next choice</span>
          <p>{decision}</p>
        </div>
        <dl className="pw-facts">
          <div>
            <dt>Why this matters</dt>
            <dd>{task.reason}</dd>
          </div>
          <div>
            <dt>{task.status === 'accepted' ? 'What this acceptance covers' : 'Finished when'}</dt>
            <dd>
              {task.doneWhen ||
                'No finish condition has been recorded. Define one before continuing.'}
            </dd>
          </div>
        </dl>
        {task.prerequisites.length > 0 && (
          <section className="pw-notice" aria-label="What still needs confirmation">
            <h3>What still needs confirmation</h3>
            {task.prerequisites.map((item, index) => (
              <p key={index}>{item}</p>
            ))}
          </section>
        )}
        {task.status === 'accepted' || task.status === 'paused' ? (
          <div className="pw-actions">
            <Button
              className="pw-button"
              disabled={!canDecide}
              onClick={() => void controller.correct(project.id, task.key, 'restore')}
            >
              {task.status === 'accepted' ? 'Reopen this task' : 'Restore this task'}
            </Button>
          </div>
        ) : (
          <div className="pw-actions">
            {task.canAct && task.destinationUrl && (
              <a
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'pw-button pw-button--primary',
                )}
                href={task.destinationUrl}
              >
                Open working conversation
              </a>
            )}
            {task.canAct && (
              <Button
                className={`pw-button${task.destinationUrl ? '' : ' pw-button--primary'}`}
                disabled={busy}
                onClick={() => void copyTask()}
              >
                Copy task for my working tool
              </Button>
            )}
            {(task.status === 'review' || task.canAct) && (
              <Button
                className={`pw-button${task.status === 'review' ? ' pw-button--primary' : ''}`}
                disabled={!canDecide}
                onClick={() => void controller.correct(project.id, task.key, 'done')}
              >
                Accept as complete
              </Button>
            )}
            <Button
              className="pw-button"
              onClick={() => controller.editAction(project.id, task.key)}
            >
              Edit next step
            </Button>
            <Button
              className="pw-button pw-button--quiet"
              disabled={!canDecide}
              onClick={() => void controller.correct(project.id, task.key, 'paused')}
            >
              Pause this task
            </Button>
          </div>
        )}
        {task.canAct && (
          <p className="pw-small">
            Opening the working conversation does not send a message or start work. Copied
            instructions include supporting source excerpts for your working tool.
          </p>
        )}
        {copyStatus && (
          <p className="pw-small" role="status">
            {copyStatus}
          </p>
        )}
      </section>
      {draft && (
        <form
          className="pw-form pw-decision"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.saveAction(project.id, task.key);
          }}
        >
          <h3>Correct the next step</h3>
          <label>
            Next step
            <Textarea
              name="next-action"
              maxLength={1200}
              value={draft.action}
              onChange={(event) =>
                controller.editAction(project.id, task.key, event.target.value, draft.done)
              }
            />
          </label>
          <label>
            Finish condition
            <Textarea
              name="done-when"
              maxLength={1200}
              value={draft.done}
              onChange={(event) =>
                controller.editAction(project.id, task.key, draft.action, event.target.value)
              }
            />
          </label>
          {draft.version !== project.version && (
            <div className="pw-notice">
              <p>This draft uses an earlier overview. Review the current task before saving it.</p>
              <Button
                className="pw-button"
                type="button"
                disabled={!project.canEdit || busy}
                onClick={() => controller.rebaseAction(project.id, task.key)}
              >
                I reviewed this step against the current overview
              </Button>
            </div>
          )}
          <div className="pw-actions">
            <Button
              className="pw-button pw-button--primary"
              disabled={
                !project.canEdit ||
                busy ||
                draft.version !== project.version ||
                !draft.action.trim() ||
                !draft.done.trim()
              }
            >
              Save next step
            </Button>
            <Button
              className="pw-button pw-button--quiet"
              type="button"
              onClick={() => controller.discardAction(project.id, task.key)}
            >
              Discard step draft
            </Button>
          </div>
        </form>
      )}
      <details
        className="pw-details"
        open={detailsOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open !== detailsOpen) controller.expand(project.id, detailKey, open);
        }}
      >
        <summary>What is this based on?</summary>
        <div className="pw-source-summary" aria-label="Evidence sources">
          {task.evidenceSources.map((source) => (
            <div key={source.kind} className="pw-source-summary-item">
              <strong>{source.label}</strong>
              <span>{source.detail}</span>
            </div>
          ))}
        </div>
        {task.evidenceExplanation.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
        <p className="pw-small">
          The preparation time describes this overview, not when its sources were observed.
        </p>
      </details>
      <details className="pw-details">
        <summary>This is the wrong work</summary>
        <p>Set this suggestion aside while keeping the project and your other tasks.</p>
        <Button
          className="pw-button"
          disabled={!canDecide}
          onClick={() => void controller.correct(project.id, task.key, 'wrong-work')}
        >
          Set this task aside
        </Button>
      </details>
      <details className="pw-details">
        <summary>Inspect original records</summary>
        <p className="pw-small">
          Open an original to check exact wording. Your task selection and unfinished writing stay
          here.
        </p>
        <div className="pw-actions">
          {task.originals.map((source) => (
            <RouteLink
              key={source.id}
              className="pw-button"
              href={projectRouteHref({
                page: 'original',
                workId: project.id,
                candidateKey: task.key,
                sourceId: source.id,
              })}
              onNavigate={onNavigate}
            >
              {source.label}
            </RouteLink>
          ))}
          {task.destinationUrl && (
            <a
              className={cn(buttonVariants({ variant: 'outline' }), 'pw-button')}
              href={task.destinationUrl}
            >
              Open original conversation
            </a>
          )}
        </div>
        {!task.originals.length && !task.destinationUrl && (
          <p className="pw-small">An original destination is not available for this task.</p>
        )}
      </details>
    </article>
  );
}

function OriginalInspection({ project, state, onNavigate }: ProjectProps) {
  const inspection = state.inspection?.workId === project.id ? state.inspection : null;
  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Original inspection</span>
          <h1 tabIndex={-1}>Original record</h1>
          <p className="pw-lead">
            This is source material, shown because you explicitly opened it. Reading it does not
            accept the result or change your task.
          </p>
        </div>
        <RouteLink
          className="pw-button"
          href={projectHref(project.id, state.route.candidateKey)}
          onNavigate={onNavigate}
        >
          Return to this task
        </RouteLink>
      </header>
      {state.inspectionLoading ? (
        <p role="status">Reading the original record…</p>
      ) : inspection ? (
        <section className={cn(cardSurface, 'pw-card')}>
          <h2>{inspection.title}</h2>
          <p className="pw-small">
            {inspection.actor}
            {inspection.at
              ? ` · ${new Date(inspection.at).toLocaleString()}`
              : ' · Source time unavailable'}
          </p>
          <pre className="pw-original" tabIndex={0} aria-label="Original record text">
            {inspection.text}
          </pre>
        </section>
      ) : (
        <section className="pw-empty">
          <h2>This original is not available</h2>
          <p>
            It may have been removed or fall outside the connected source range. Your task and input
            are kept.
          </p>
        </section>
      )}
    </>
  );
}

const initialSources = (): ProjectSourcesInput => ({
  threadIds: [],
  startTurnIds: {},
  recordRanges: {},
  discover: false,
});
type SourceScope = Pick<ProjectSourcesInput, 'startTurnIds' | 'recordRanges'>;

function selectedSources(input: ProjectSourcesInput): ProjectSourcesInput {
  const selected = new Set(input.threadIds);
  return {
    ...input,
    threadIds: [...selected],
    startTurnIds: Object.fromEntries(
      Object.entries(input.startTurnIds).filter(([id]) => selected.has(id)),
    ),
    recordRanges: Object.fromEntries(
      Object.entries(input.recordRanges ?? {}).filter(([id]) => selected.has(id)),
    ),
  };
}

function validSourceRanges(input: ProjectSourcesInput) {
  return input.threadIds.every((id) => {
    const range = input.recordRanges?.[id];
    return (
      !range ||
      (!!range.start.turnId.trim() &&
        !!range.start.itemId.trim() &&
        (!range.end || (!!range.end.turnId.trim() && !!range.end.itemId.trim())))
    );
  });
}

/** A folder spelling hint only. The server decides registration identity; this
 * comparison does not resolve symlinks or assume case-insensitive paths. */
function registrationFolder(path: string): string | null {
  if (!path.startsWith('/') || path.includes('\0')) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function projectTitle(title: string, folder: string): string {
  const explicit = title.trim();
  if (explicit) return explicit;
  return folder.split('/').filter(Boolean).at(-1) ?? 'Project';
}

function CreateProject({ controller, onNavigate }: WorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [title, setTitle] = useState('');
  const [cwd, setCwd] = useState('');
  const [purpose, setPurpose] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [reusedProject, setReusedProject] = useState<{ id: string; title: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = state.busyWorkId === 'new';
  const folder = registrationFolder(cwd.trim());
  const matches =
    folder === null
      ? []
      : state.projects.filter((project) => registrationFolder(project.cwd) === folder);
  const existing = reusedProject ?? (matches.length === 1 ? matches[0] : null);
  const duplicate = !!existing || matches.length > 1;
  const submit = async () => {
    if (duplicate || busy || !state.online || state.checkingCurrent) return;
    if (folder === null) {
      setError('Choose an absolute project folder path.');
      return;
    }
    setError('');
    const input: ProjectCreateInput = {
      title: projectTitle(title, folder),
      cwd: cwd.trim(),
      purpose: purpose.trim(),
      ...(goal.trim() ? { goal: goal.trim() } : {}),
      threadIds: [],
      startTurnIds: {},
      recordRanges: {},
      discover: false,
    };
    const result = await controller.create(input);
    if (!result || !mounted.current || controller.getSnapshot().route.page !== 'new') return;
    if (result.reused) {
      const project = controller.getSnapshot().projects.find((entry) => entry.id === result.workId);
      setReusedProject({ id: result.workId, title: project?.title ?? 'the saved project' });
    } else onNavigate(projectHref(result.workId));
  };
  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Start with the project</span>
          <h1 tabIndex={-1}>Add a project</h1>
          <p className="pw-lead">
            Register the folder you work in. StateCarry will inspect its codebase and Git state;
            related Codex conversations are added as optional context when they can be found.
          </p>
        </div>
      </header>
      <form
        className={cn(cardSurface, 'pw-form pw-card')}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Project folder
          <Input
            name="cwd"
            required
            disabled={busy}
            maxLength={2000}
            placeholder="/Users/you/Projects/my-project"
            value={cwd}
            onChange={(event) => {
              setCwd(event.target.value);
              setReusedProject(null);
              setError('');
            }}
            autoComplete="off"
          />
          <span className="pw-field-help">
            The absolute path identifies where you work. Registering it does not change the folder.
          </span>
        </label>
        {existing ? (
          <section className="pw-notice" aria-label="Registered folder">
            <h2>This folder is already registered</h2>
            <p>
              Open {existing.title} to continue. Its saved purpose, goal, task choices, and Codex
              context are kept.
            </p>
            <p className="pw-small">
              The values entered here do not replace the existing context. Opening the project also
              keeps its connection status; use its settings to adjust Codex context.
            </p>
            <RouteLink
              className="pw-button pw-button--primary"
              href={projectHref(existing.id)}
              onNavigate={onNavigate}
            >
              Open existing project
            </RouteLink>
          </section>
        ) : matches.length > 1 ? (
          <section className="pw-notice" role="alert">
            <h2>This folder has multiple registrations</h2>
            <p>Review the registered projects before adding this folder again.</p>
            <RouteLink className="pw-button" href="#/home" onNavigate={onNavigate}>
              Review registered projects
            </RouteLink>
          </section>
        ) : (
          <>
            <label>
              Project name <span className="pw-field-help">Optional</span>
              <Input
                name="title"
                disabled={busy}
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={folder ? projectTitle('', folder) : 'Uses the folder name by default'}
                autoComplete="off"
              />
              <span className="pw-field-help">Leave blank to use the project folder name.</span>
            </label>
            <label>
              Why this project exists <span className="pw-field-help">Optional</span>
              <Textarea
                name="purpose"
                disabled={busy}
                maxLength={1200}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="What should this project make possible?"
              />
            </label>
            <label>
              First goal <span className="pw-field-help">Optional</span>
              <Textarea
                name="initial-goal"
                disabled={busy}
                maxLength={400}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="What outcome are you working toward now?"
              />
            </label>
          </>
        )}
        {error && (
          <p className="pw-notice" role="alert">
            {error}
          </p>
        )}
        <div className="pw-actions">
          {!duplicate && (
            <Button
              className="pw-button pw-button--primary"
              disabled={!state.online || state.checkingCurrent || busy || folder === null}
            >
              {busy ? 'Adding project…' : 'Add project'}
            </Button>
          )}
          <RouteLink className="pw-button pw-button--quiet" href="#/home" onNavigate={onNavigate}>
            Cancel
          </RouteLink>
        </div>
        {!duplicate && (
          <p className="pw-small">
            After registration, StateCarry requests the first project overview from the codebase and
            Git state and includes related Codex context when it is available. You can adjust that
            context later in project settings.
          </p>
        )}
      </form>
    </>
  );
}

function SourcePicker({
  controller,
  cwd,
  value,
  inherited,
  onChange,
  disabled,
}: {
  controller: ProjectController;
  cwd: string;
  value: ProjectSourcesInput;
  inherited?: SourceScope;
  onChange: (input: ProjectSourcesInput) => void;
  disabled: boolean;
}) {
  const [found, setFound] = useState<{ id: string; title: string }[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Record<string, { id: string; at: string | null }[]>>({});
  const [turnBusy, setTurnBusy] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const threads = [
    ...found,
    ...value.threadIds
      .filter((id) => !found.some((thread) => thread.id === id))
      .map((id, index) => ({ id, title: `Connected conversation ${index + 1}` })),
  ];
  const find = async () => {
    const generation = ++request.current;
    setSearching(true);
    setError('');
    try {
      const result = await controller.discover(cwd.trim());
      if (generation !== request.current) return;
      setFound(result.threads);
      setSearched(true);
      setPartial(!result.complete || result.limitations.length > 0);
    } catch (failure) {
      if (generation === request.current) setError(projectError(failure));
    } finally {
      if (generation === request.current) setSearching(false);
    }
  };
  const loadTurns = async (id: string) => {
    const generation = request.current;
    setTurnBusy(id);
    setError('');
    try {
      const result = await controller.turns(id);
      if (generation === request.current)
        setTurns((previous) => ({ ...previous, [id]: result.turns }));
    } catch (failure) {
      if (generation === request.current) setError(projectError(failure));
    } finally {
      if (generation === request.current) setTurnBusy(null);
    }
  };
  const choose = (id: string, checked: boolean) => {
    const newlySelected = checked && !value.threadIds.includes(id);
    const threadIds = checked
      ? [...value.threadIds, id]
      : value.threadIds.filter((item) => item !== id);
    const inheritedStart = inherited?.startTurnIds[id];
    const inheritedRange = inherited?.recordRanges?.[id];
    // Seed only the added conversation. Reapplying all inherited limits would
    // overwrite intentional edits, including removed bounds, on existing choices.
    onChange(
      selectedSources({
        ...value,
        threadIds,
        startTurnIds: {
          ...(newlySelected && inheritedStart ? { [id]: inheritedStart } : {}),
          ...value.startTurnIds,
        },
        recordRanges: {
          ...(newlySelected && inheritedRange ? { [id]: inheritedRange } : {}),
          ...value.recordRanges,
        },
      }),
    );
  };
  const selectAll = () => {
    const ids = [...new Set(threads.map((thread) => thread.id))].slice(0, 30);
    const startTurnIds = { ...value.startTurnIds };
    const recordRanges = { ...value.recordRanges };
    for (const id of ids) {
      if (value.threadIds.includes(id)) continue;
      const inheritedStart = inherited?.startTurnIds[id];
      const inheritedRange = inherited?.recordRanges?.[id];
      if (inheritedStart && !startTurnIds[id]) startTurnIds[id] = inheritedStart;
      if (inheritedRange && !recordRanges[id]) recordRanges[id] = inheritedRange;
    }
    onChange(selectedSources({ ...value, threadIds: ids, startTurnIds, recordRanges }));
  };
  const clearSelection = () =>
    onChange({ ...value, threadIds: [], startTurnIds: {}, recordRanges: {} });
  const range = (id: string, next?: RecordRange) => {
    const ranges = { ...value.recordRanges };
    if (next) ranges[id] = next;
    else delete ranges[id];
    onChange({ ...value, recordRanges: ranges });
  };
  return (
    <div className="pw-form">
      <p className="pw-small">
        Choose only the conversations and ranges that belong to this work. Opening these controls
        only reads available sources.
      </p>
      <div>
        <Button
          type="button"
          className="pw-button"
          disabled={disabled || searching || turnBusy !== null || !cwd.trim().startsWith('/')}
          onClick={() => void find()}
        >
          {searching ? 'Finding conversations…' : 'Find conversations in this folder'}
        </Button>
      </div>
      {partial && (
        <p className="pw-notice">
          Only part of the available conversations could be checked. Your current selection is kept.
        </p>
      )}
      {searched && !threads.length && (
        <p className="pw-small">
          No conversations were found in this folder. You can save the project without one.
        </p>
      )}
      {error && (
        <p className="pw-notice" role="alert">
          {error}
        </p>
      )}
      {threads.length > 0 && (
        <div className="pw-actions">
          <Button
            type="button"
            className="pw-button"
            disabled={disabled || searching || turnBusy !== null || value.threadIds.length >= 30}
            onClick={selectAll}
          >
            Select all conversations
          </Button>
          <Button
            type="button"
            className="pw-button pw-button--quiet"
            disabled={disabled || !value.threadIds.length}
            onClick={clearSelection}
          >
            Clear selection
          </Button>
          <span className="pw-small" role="status">
            {value.threadIds.length} selected
          </span>
        </div>
      )}
      <div>
        {threads.map((thread) => {
          const selected = value.threadIds.includes(thread.id);
          const exact = value.recordRanges?.[thread.id];
          return (
            <div className="pw-source-row" key={thread.id}>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled || (!selected && value.threadIds.length >= 30)}
                  onChange={(event) => choose(thread.id, event.target.checked)}
                />
                {thread.title}
              </label>
              {selected && (
                <>
                  {!turns[thread.id] ? (
                    <div>
                      <Button
                        type="button"
                        className="pw-button pw-button--quiet"
                        disabled={disabled || turnBusy !== null}
                        onClick={() => void loadTurns(thread.id)}
                      >
                        {turnBusy === thread.id
                          ? 'Reading starting points…'
                          : 'Choose a starting point'}
                      </Button>
                    </div>
                  ) : (
                    <label>
                      Read this conversation from
                      <select
                        aria-label={`Starting point for ${thread.title}`}
                        disabled={disabled || !!exact}
                        value={value.startTurnIds[thread.id] ?? ''}
                        onChange={(event) => {
                          const starts = { ...value.startTurnIds };
                          if (event.target.value) starts[thread.id] = event.target.value;
                          else delete starts[thread.id];
                          onChange({ ...value, startTurnIds: starts });
                        }}
                      >
                        <option value="">Beginning of the conversation</option>
                        {value.startTurnIds[thread.id] &&
                          !turns[thread.id].some(
                            (turn) => turn.id === value.startTurnIds[thread.id],
                          ) && (
                            <option value={value.startTurnIds[thread.id]}>
                              Saved starting point · not currently listed
                            </option>
                          )}
                        {turns[thread.id].map((turn, index) => (
                          <option key={turn.id} value={turn.id}>
                            Part {index + 1}
                            {turn.at
                              ? ` · ${new Date(turn.at).toLocaleString()}`
                              : ' · Time unavailable'}
                          </option>
                        ))}
                      </select>
                      {exact && (
                        <span className="pw-field-help">
                          An exact record range is saved below. Remove it to use a starting point
                          instead.
                        </span>
                      )}
                    </label>
                  )}
                  <details className="pw-details">
                    <summary>Set exact record boundaries</summary>
                    <p className="pw-small">
                      Use the turn and item positions from the original source. A last record stops
                      the range; later records remain excluded.
                    </p>
                    {(['start', 'end'] as const).map((edge) => (
                      <fieldset key={edge}>
                        <legend>
                          {edge === 'start'
                            ? 'First included record'
                            : 'Last included record (optional)'}
                        </legend>
                        <div className="pw-form">
                          {(['turnId', 'itemId'] as const).map((field) => (
                            <label key={field}>
                              {edge === 'start' ? 'First' : 'Last'}{' '}
                              {field === 'turnId' ? 'turn position' : 'item position'}
                              <Input
                                disabled={disabled}
                                value={exact?.[edge]?.[field] ?? ''}
                                onChange={(event) =>
                                  range(thread.id, {
                                    ...exact,
                                    start: exact?.start ?? { turnId: '', itemId: '' },
                                    [edge]: {
                                      turnId: '',
                                      itemId: '',
                                      ...exact?.[edge],
                                      [field]: event.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    <div className="pw-actions">
                      <Button
                        type="button"
                        className="pw-button"
                        disabled={disabled || !exact}
                        onClick={() => range(thread.id)}
                      >
                        Use the starting point and later records
                      </Button>
                      {exact?.end && (
                        <Button
                          type="button"
                          className="pw-button"
                          disabled={disabled}
                          onClick={() => range(thread.id, { start: exact.start })}
                        >
                          Include later records
                        </Button>
                      )}
                    </div>
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>
      <label className="pw-checkbox">
        <input
          type="checkbox"
          checked={value.discover}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, discover: event.target.checked })}
        />
        Look for related conversations in this folder during future collection
      </label>
    </div>
  );
}

function ProjectSettings({ project, state, controller, onNavigate }: ProjectProps) {
  const [profile, setProfile] = useState({
    title: project.title,
    purpose: project.purpose,
    focused: project.focused,
    revision: project.revision,
  });
  const [sourceDraft, setSourceDraft] = useState<{
    input: ProjectSourcesInput;
    inherited?: SourceScope;
    revision: number;
    loaded: boolean;
  }>({ input: initialSources(), revision: project.revision, loaded: false });
  const [sourceError, setSourceError] = useState('');
  const [loadingSources, setLoadingSources] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const mounted = useRef(true);
  const sourceRequest = useRef(0);
  const preview = state.deletion?.workId === project.id ? state.deletion : null;
  const busy = state.busyWorkId === project.id;
  useEffect(() => {
    setConfirmRemoval(false);
  }, [preview?.token]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sourceRequest.current++;
    };
  }, []);
  const readSources = async () => {
    if (project.disconnected) return;
    const generation = ++sourceRequest.current;
    const revision = project.revision;
    setLoadingSources(true);
    setSourceError('');
    try {
      const connections = await controller.connections();
      if (!mounted.current || generation !== sourceRequest.current) return;
      const connection = connections.find((item) => item.workId === project.id);
      if (!connection) {
        setSourceError(
          'The current connection could not be found. Read the latest project state before changing its sources.',
        );
        return;
      }
      const inherited: SourceScope = {
        startTurnIds: { ...connection.discoveryScope?.startTurnIds },
        recordRanges: { ...connection.discoveryScope?.recordRanges },
      };
      setSourceDraft({
        input: selectedSources({
          threadIds: [...connection.threadIds],
          startTurnIds: { ...inherited.startTurnIds, ...connection.startTurnIds },
          recordRanges: { ...inherited.recordRanges, ...connection.recordRanges },
          discover: connection.discover,
        }),
        inherited,
        revision,
        loaded: true,
      });
    } catch (failure) {
      if (mounted.current && generation === sourceRequest.current)
        setSourceError(projectError(failure));
    } finally {
      if (mounted.current && generation === sourceRequest.current) setLoadingSources(false);
    }
  };
  useEffect(() => {
    void readSources();
  }, [project.id, project.disconnected]);
  const saveProfile = async () => {
    const submitted = profile;
    const saved = await controller.settings(
      project.id,
      {
        title: submitted.title.trim(),
        purpose: submitted.purpose.trim(),
        focused: submitted.focused,
      },
      submitted.revision,
    );
    if (saved && mounted.current)
      setProfile((current) =>
        current === submitted
          ? {
              ...current,
              revision:
                controller.getSnapshot().projects.find((item) => item.id === project.id)
                  ?.revision ?? current.revision,
            }
          : current,
      );
  };
  const saveSources = async () => {
    const submitted = sourceDraft;
    const input = selectedSources(submitted.input);
    if (!validSourceRanges(input)) {
      setSourceError(
        'Complete the first record positions and any last record positions, or remove the exact range.',
      );
      return;
    }
    setSourceError('');
    const saved = await controller.sources(project.id, input, submitted.revision);
    if (saved && mounted.current)
      setSourceDraft((current) =>
        current === submitted
          ? {
              ...current,
              revision:
                controller.getSnapshot().projects.find((item) => item.id === project.id)
                  ?.revision ?? current.revision,
            }
          : current,
      );
  };
  const disconnect = async () => {
    const saved = await controller.disconnect(project.id);
    const route = controller.getSnapshot().route;
    if (saved && route.page === 'settings' && route.workId === project.id) onNavigate('#/home');
  };
  const previewRemoval = async () => {
    setPreviewing(true);
    await controller.previewDeletion(project.id);
    if (mounted.current) setPreviewing(false);
  };
  const remove = async () => {
    const removed = await controller.remove(project.id);
    const route = controller.getSnapshot().route;
    if (removed && route.page === 'settings' && route.workId === project.id) onNavigate('#/home');
  };
  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Project settings</span>
          <h1 tabIndex={-1}>{project.title}</h1>
          <p className="pw-lead">
            Define the project, adjust optional Codex context, and manage the data StateCarry keeps
            for it.
          </p>
        </div>
        <RouteLink className="pw-button" href={projectHref(project.id)} onNavigate={onNavigate}>
          Return to project
        </RouteLink>
      </header>
      <div className="pw-stack">
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-profile-heading">
          <h2 id="project-profile-heading">Purpose and focus</h2>
          <form
            className="pw-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
          >
            <label>
              Project name
              <Input
                name="title"
                required
                maxLength={120}
                value={profile.title}
                onChange={(event) => setProfile({ ...profile, title: event.target.value })}
              />
            </label>
            <label>
              Why this project exists
              <Textarea
                name="purpose"
                maxLength={1200}
                value={profile.purpose}
                onChange={(event) => setProfile({ ...profile, purpose: event.target.value })}
              />
            </label>
            <div className="pw-setting-row">
              <div className="pw-setting-copy">
                <strong>Home focus</strong>
                <span className="pw-small">
                  Put this project first on Home. Choosing it moves Home focus from another project.
                </span>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={profile.focused}
                  onChange={(event) => setProfile({ ...profile, focused: event.target.checked })}
                />
                My Home focus
              </label>
            </div>
            <p className="pw-small">Working folder: {project.cwd}</p>
            {profile.revision !== project.revision && (
              <div className="pw-notice">
                <p>
                  The project changed after these settings were opened. Compare your input with the
                  latest saved project before saving.
                </p>
                <Button
                  type="button"
                  className="pw-button"
                  disabled={!state.online || busy}
                  onClick={() => setProfile({ ...profile, revision: project.revision })}
                >
                  I reviewed these settings against the current project
                </Button>
              </div>
            )}
            <div>
              <Button
                className="pw-button pw-button--primary"
                disabled={
                  !state.online ||
                  busy ||
                  !profile.title.trim() ||
                  profile.revision !== project.revision
                }
              >
                Save project settings
              </Button>
            </div>
          </form>
        </section>
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-sources-heading">
          <h2 id="project-sources-heading">
            Codex context <span className="pw-small">Optional</span>
          </h2>
          <p className="pw-small">
            StateCarry checks the project codebase and Git state automatically. Add Codex
            conversations when their decisions, progress reports, or history would help explain the
            current work. Changing this context does not prepare a new overview by itself.
          </p>
          {project.disconnected ? (
            <p>Restore the project before changing its Codex context.</p>
          ) : (
            <>
              {loadingSources && <p role="status">Reading the current source scope…</p>}
              {sourceError && (
                <div className="pw-notice" role="alert">
                  <p>{sourceError}</p>
                  <Button
                    className="pw-button"
                    disabled={loadingSources}
                    onClick={() => void readSources()}
                  >
                    Read source settings again
                  </Button>
                </div>
              )}
              {sourceDraft.loaded && (
                <form
                  className="pw-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSources();
                  }}
                >
                  <SourcePicker
                    controller={controller}
                    cwd={project.cwd}
                    value={sourceDraft.input}
                    inherited={sourceDraft.inherited}
                    onChange={(input) => setSourceDraft({ ...sourceDraft, input })}
                    disabled={!state.online || busy || loadingSources}
                  />
                  {sourceDraft.revision !== project.revision && (
                    <div className="pw-notice">
                      <p>
                        The project changed after this source selection was opened. Read the latest
                        scope before saving.
                      </p>
                      <Button
                        type="button"
                        className="pw-button"
                        disabled={!state.online || busy || loadingSources}
                        onClick={() => void readSources()}
                      >
                        Reload the current source selection
                      </Button>
                    </div>
                  )}
                  <div>
                    <Button
                      className="pw-button pw-button--primary"
                      disabled={
                        !state.online ||
                        busy ||
                        loadingSources ||
                        sourceDraft.revision !== project.revision
                      }
                    >
                      Save Codex context
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
        <section
          className={cn(cardSurface, 'pw-card')}
          aria-labelledby="project-collection-heading"
        >
          <h2 id="project-collection-heading">Collection</h2>
          <p>
            {project.disconnected
              ? 'This project is disconnected. Restore the same registration and saved work when you return.'
              : 'Disconnecting stops collection for this registration. Your saved project, goals, and task choices remain available to restore.'}
          </p>
          <p className="pw-small">
            Your project folder and original conversations stay in their source tools.
          </p>
          <Button
            className="pw-button"
            disabled={!state.online || busy}
            onClick={() =>
              project.disconnected ? void controller.restore(project.id) : void disconnect()
            }
          >
            {project.disconnected ? 'Restore project' : 'Disconnect project'}
          </Button>
        </section>
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-removal-heading">
          <h2 id="project-removal-heading">Remove saved application data</h2>
          <p>
            Remove this registration and the saved StateCarry records that belong to it. Source
            copies still needed by another project are retained.
          </p>
          <p className="pw-small">
            This does not remove your project folder or original conversations. Review the current
            scope before confirming.
          </p>
          <Button
            className="pw-button pw-button--danger"
            disabled={!state.online || busy || previewing}
            onClick={() => void previewRemoval()}
          >
            {previewing ? 'Reading removal scope…' : 'Review saved-data removal'}
          </Button>
          {preview && (
            <div className="pw-stack" aria-label="Removal preview">
              <p>{preview.explanation}</p>
              <dl className="pw-facts">
                <div>
                  <dt>Saved records belonging to this project</dt>
                  <dd>{preview.ownedRecords}</dd>
                </div>
                <div>
                  <dt>Source copies used only by this project</dt>
                  <dd>{preview.exclusiveSources}</dd>
                </div>
                <div>
                  <dt>Shared source copies that will be kept</dt>
                  <dd>{preview.sharedSources}</dd>
                </div>
              </dl>
              {preview.blocked ? (
                <p className="pw-notice">
                  Saved data cannot be removed while relevant work is running or its outcome is
                  unresolved.
                </p>
              ) : preview.revision !== project.revision ? (
                <p className="pw-notice">
                  The project changed after this preview. Read the removal scope again before
                  confirming.
                </p>
              ) : (
                <>
                  <label className="pw-checkbox">
                    <input
                      type="checkbox"
                      checked={confirmRemoval}
                      onChange={(event) => setConfirmRemoval(event.target.checked)}
                    />
                    Remove the saved StateCarry data for {project.title}
                  </label>
                  <div>
                    <Button
                      className="pw-button pw-button--danger"
                      disabled={!state.online || busy || !confirmRemoval}
                      onClick={() => void remove()}
                    >
                      Remove this project's saved data
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
