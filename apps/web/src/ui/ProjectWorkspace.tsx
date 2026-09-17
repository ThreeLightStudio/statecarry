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
  type WorkingTreeView,
} from '@statecarry/presentation';
import '@/styles/globals.css';
import { Alert } from '@/components/ui/alert';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button as UiButton, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Download,
  GitBranch,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Settings as SettingsIcon,
  Star,
} from 'lucide-react';
import './project-workspace.css';

type WorkspaceState = ReturnType<ProjectController['getSnapshot']>;
type Navigate = (href: string) => void;
type WorkspaceProps = { controller: ProjectController; onNavigate: Navigate };
type ProjectProps = WorkspaceProps & { project: ProjectView; state: WorkspaceState };
type UpdateUiPreviewPhase = 'available' | 'downloading' | 'ready' | 'restarting';
type DirtyWorkPreviewScenario = 'off' | 'clean' | 'normal' | 'mixed' | 'large' | 'no-git';
type DirtyWorkPreview = {
  kind: WorkingTreeView['kind'];
  fileCount?: number;
  additions?: number;
  deletions?: number;
  groups?: WorkingTreeView['groups'];
  files?: string[];
  lastCommit?: string;
  summary: string;
};
const emptyEdits: SavedResumeEdits = { goalDraft: null, actionDrafts: [], expanded: [], scroll: 0 };
const responseLanguageKey = 'statecarry.response-language.v1';
const updateUiPreviewKey = 'statecarry.developer.update-ui-preview.v1';
const dirtyWorkPreviewKey = 'statecarry.developer.dirty-work-preview.v1';
const feedbackUrl = 'https://forms.gle/U8RcHwGe1dJxLdvq5';
const productHuntUrl =
  'https://www.producthunt.com/products/statecarry?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-statecarry';
const productHuntBadgeUrl = '/product-hunt-featured.svg';
const isDevelopmentBuild =
  (typeof __STATECARRY_DEVELOPER_CONTROLS__ !== 'undefined' && __STATECARRY_DEVELOPER_CONTROLS__) ||
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

function readUpdateUiPreview(): boolean {
  if (!isDevelopmentBuild) return false;
  try {
    return window.localStorage.getItem(updateUiPreviewKey) === '1';
  } catch {
    return false;
  }
}

function writeUpdateUiPreview(enabled: boolean) {
  if (!isDevelopmentBuild) return;
  try {
    if (enabled) window.localStorage.setItem(updateUiPreviewKey, '1');
    else window.localStorage.removeItem(updateUiPreviewKey);
  } catch {
    // Developer preview remains active for this tab when browser storage is unavailable.
  }
}

const dirtyWorkPreviewScenarios: Record<
  Exclude<DirtyWorkPreviewScenario, 'off'>,
  DirtyWorkPreview
> = {
  clean: {
    kind: 'clean',
    summary:
      'This project has no uncommitted changes. StateCarry would keep the normal project flow.',
  },
  normal: {
    kind: 'normal',
    fileCount: 4,
    additions: 143,
    deletions: 58,
    files: [
      'apps/web/src/ui/ProjectWorkspace.tsx',
      'apps/web/src/ui/project-workspace.css',
      'apps/desktop/src/app-updater.ts',
      'tests/project-updater-ui.test.tsx',
    ],
    groups: [
      {
        title: 'Working-tree recovery',
        summary: 'Connect current Git state to the project workspace and continuation handoff.',
        currentState:
          'Git metadata, changed files, diff statistics, and the working-tree card are wired together.',
        suggestedNextStep: 'Review the current UI and copied handoff using this real dirty tree.',
        reason:
          'The implementation exists, but the continuation experience still needs user-facing validation.',
        doneWhen:
          'The current work is understandable here and the copied handoff gives a new Codex session a clear first action.',
        openItems: ['Review whether the continuation handoff is sufficient in real use.'],
        files: [
          'apps/web/src/ui/ProjectWorkspace.tsx',
          'apps/web/src/ui/project-workspace.css',
          'apps/desktop/src/app-updater.ts',
          'tests/project-updater-ui.test.tsx',
        ],
      },
    ],
    lastCommit: 'feat: improve updater status',
    summary:
      'The current working tree contains a focused set of changes. StateCarry would hand the current repository state to a new Codex session for reconstruction and continuation.',
  },
  mixed: {
    kind: 'mixed',
    fileCount: 7,
    additions: 286,
    deletions: 91,
    groups: [
      {
        title: 'Updater status flow',
        summary:
          'Move update status into the workspace and keep the desktop updater state visible.',
        currentState:
          'The workspace UI and desktop updater both contain changes for the new status flow.',
        suggestedNextStep: 'Review the final updater interaction in the running app.',
        reason: 'The diff shows the UI and updater wiring, but not user-facing validation.',
        doneWhen:
          'The updater status remains clear through the available, downloading, and ready states.',
        openItems: ['Review the final interaction in the app.'],
        files: ['apps/web/src/ui/ProjectWorkspace.tsx', 'apps/desktop/src/app-updater.ts'],
      },
      {
        title: 'Release presentation',
        summary:
          'Update release-facing documentation and assets to match the current product state.',
        currentState: 'Documentation and release assets have uncommitted updates.',
        suggestedNextStep: 'Review the release-facing copy against the current product behavior.',
        reason: 'The changed release material should match what the app now does.',
        doneWhen:
          'The release copy and assets describe the current product without stale behavior.',
        openItems: [],
        files: ['docs/ux-writing.md', 'README.md'],
      },
    ],
    lastCommit: 'chore: prepare stable release',
    summary:
      'The working tree spans several areas. StateCarry would preserve the whole state and ask a new Codex session to separate the changes into logical pieces before continuing.',
  },
  large: {
    kind: 'large',
    fileCount: 126,
    additions: 38_000,
    deletions: 12_000,
    groups: [
      {
        title: 'Workspace runtime consolidation',
        summary:
          'A broad runtime refactor spans application code, validation, and release support.',
        currentState:
          'The diff is large enough that the reconstructed scope should be reviewed before continuing.',
        suggestedNextStep: 'Review the reconstructed work group before making additional changes.',
        reason:
          'The change set is large enough that a wrong continuation would have a high correction cost.',
        doneWhen:
          'The current work boundary is clear enough to choose one next edit without mixing unrelated changes.',
        openItems: ['Confirm the work groups before making additional changes.'],
        files: ['apps/web/src/ui/ProjectWorkspace.tsx'],
      },
    ],
    lastCommit: 'refactor: consolidate workspace runtime',
    summary:
      'This is a large uncommitted change set. StateCarry would not try to reconstruct the work itself; it would start a new Codex session that inspects the repository first and reports logical work groups before changing anything.',
  },
  'no-git': {
    kind: 'no-git',
    summary:
      'Git is not available for this project, so StateCarry cannot reliably detect or carry uncommitted work. The normal project flow remains available, with Git setup recommended for working-tree recovery.',
  },
};

function isDirtyWorkPreviewScenario(value: string | null): value is DirtyWorkPreviewScenario {
  return (
    value === 'off' ||
    value === 'clean' ||
    value === 'normal' ||
    value === 'mixed' ||
    value === 'large' ||
    value === 'no-git'
  );
}

function readDirtyWorkPreview(): DirtyWorkPreviewScenario {
  if (!isDevelopmentBuild) return 'off';
  try {
    const value = window.localStorage.getItem(dirtyWorkPreviewKey);
    return isDirtyWorkPreviewScenario(value) ? value : 'off';
  } catch {
    return 'off';
  }
}

function writeDirtyWorkPreview(scenario: DirtyWorkPreviewScenario) {
  if (!isDevelopmentBuild) return;
  try {
    if (scenario === 'off') window.localStorage.removeItem(dirtyWorkPreviewKey);
    else window.localStorage.setItem(dirtyWorkPreviewKey, scenario);
  } catch {
    // Developer preview remains active for this tab when browser storage is unavailable.
  }
}

function previewAppUpdate(
  enabled: boolean,
  phase: UpdateUiPreviewPhase,
): WorkspaceState['appUpdate'] {
  if (!isDevelopmentBuild || !enabled) return null;
  return {
    supported: true,
    currentVersion: __STATECARRY_VERSION__,
    latestVersion: 'preview',
    phase,
    progress: phase === 'downloading' ? 42 : null,
    error: null,
  };
}

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
          Overview updated{' '}
          <time dateTime={value!}>
            {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        </>
      ) : (
        'The overview time is not available.'
      )}
    </span>
  );
}

function attentionCount(project: ProjectView): number {
  return project.tasks.filter((task) => task.status !== 'accepted' && task.status !== 'paused')
    .length;
}

export function ProjectWorkspace({ controller, onNavigate }: WorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [updateUiPreview, setUpdateUiPreview] = useState(readUpdateUiPreview);
  const [dirtyWorkPreview, setDirtyWorkPreview] =
    useState<DirtyWorkPreviewScenario>(readDirtyWorkPreview);
  const [updateUiPreviewPhase, setUpdateUiPreviewPhase] =
    useState<UpdateUiPreviewPhase>('available');
  const updateUiPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUpdate = previewAppUpdate(updateUiPreview, updateUiPreviewPhase);
  const appUpdate = previewUpdate ?? state.appUpdate;
  const { route } = state;
  const project = state.projects.find((item) => item.id === route.workId);
  const workspaceStatus = state.loading
    ? 'Loading projects…'
    : !state.online
      ? "StateCarry can't connect to its local service."
      : state.checkingCurrent
        ? 'Checking for changes…'
        : null;
  const mainRef = useRef<HTMLElement>(null);
  const clearUpdateUiPreviewTimer = () => {
    if (updateUiPreviewTimer.current === null) return;
    clearTimeout(updateUiPreviewTimer.current);
    updateUiPreviewTimer.current = null;
  };
  const changeUpdateUiPreview = (enabled: boolean) => {
    clearUpdateUiPreviewTimer();
    setUpdateUiPreviewPhase('available');
    setUpdateUiPreview(enabled);
    writeUpdateUiPreview(enabled);
  };
  const changeDirtyWorkPreview = (scenario: DirtyWorkPreviewScenario) => {
    setDirtyWorkPreview(scenario);
    writeDirtyWorkPreview(scenario);
  };
  const previewDownloadAppUpdate = () => {
    clearUpdateUiPreviewTimer();
    setUpdateUiPreviewPhase('downloading');
    updateUiPreviewTimer.current = setTimeout(() => {
      updateUiPreviewTimer.current = null;
      setUpdateUiPreviewPhase('ready');
    }, 1200);
  };
  const previewRestartForAppUpdate = () => {
    clearUpdateUiPreviewTimer();
    setUpdateUiPreviewPhase('restarting');
    updateUiPreviewTimer.current = setTimeout(() => {
      updateUiPreviewTimer.current = null;
      setUpdateUiPreviewPhase('available');
    }, 1200);
  };
  useEffect(
    () => () => {
      clearUpdateUiPreviewTimer();
    },
    [],
  );
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
    <div className={cn('pw-shell', railCollapsed && 'pw-shell--rail-collapsed')}>
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
      <header className="pw-app-header">
        <div className="pw-app-header-leading">
          <Button
            type="button"
            className="pw-rail-toggle"
            variant="ghost"
            aria-controls="workspace-navigation"
            aria-expanded={!railCollapsed}
            aria-label={railCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={railCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={() => setRailCollapsed((collapsed) => !collapsed)}
          >
            {railCollapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <PanelLeftClose aria-hidden="true" />
            )}
          </Button>
          <span className="pw-app-header-title">Workspace</span>
        </div>
        <div className="pw-actions">
          <a className="pw-feedback-link" href={feedbackUrl} target="_blank" rel="noreferrer">
            Send feedback <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
      <aside id="workspace-navigation" className="pw-rail" aria-label="Workspace navigation">
        <RouteLink
          href="#/home"
          onNavigate={onNavigate}
          className="pw-brand"
          current={route.page === 'home' ? 'page' : undefined}
        >
          <img className="pw-brand-mark" src="/statecarry-logo.png" alt="" aria-hidden="true" />
          <span className="pw-brand-name">StateCarry</span>
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
          <nav className="pw-nav" aria-label="Projects">
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
          <a
            className="pw-product-hunt-badge"
            href={productHuntUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={productHuntBadgeUrl}
              alt="StateCarry - Resume coding where you left off. | Product Hunt"
              width="250"
              height="54"
              draggable={false}
            />
          </a>
          <div className="pw-settings-row">
            <RouteLink
              href="#/settings"
              onNavigate={onNavigate}
              className="pw-settings-link"
              current={route.page === 'global-settings' ? 'page' : undefined}
            >
              <SettingsIcon aria-hidden="true" />
              <span>Settings</span>
            </RouteLink>
            {(appUpdate?.phase === 'available' ||
              (appUpdate?.phase === 'error' &&
                !!appUpdate.latestVersion &&
                appUpdate.latestVersion !== appUpdate.currentVersion)) && (
              <Button
                type="button"
                className="pw-update-action"
                onClick={() => {
                  if (previewUpdate) {
                    previewDownloadAppUpdate();
                    return;
                  }
                  void controller.downloadAppUpdate();
                }}
                aria-label="Download update"
                title="Download update"
              >
                <Download aria-hidden="true" />
                <span className="sr-only">Download</span>
              </Button>
            )}
            {appUpdate?.phase === 'downloading' && (
              <span
                className="pw-update-status"
                role="status"
                aria-label={
                  appUpdate.progress === null
                    ? 'Downloading update'
                    : `Downloading update ${appUpdate.progress}%`
                }
                title={
                  appUpdate.progress === null
                    ? 'Downloading update'
                    : `Downloading update · ${appUpdate.progress}%`
                }
              >
                <LoaderCircle aria-hidden="true" />
                <span className="sr-only">
                  {appUpdate.progress === null
                    ? 'Downloading…'
                    : `Downloading… ${appUpdate.progress}%`}
                </span>
              </span>
            )}
            {appUpdate?.phase === 'ready' && (
              <Button
                type="button"
                className="pw-update-action"
                onClick={() => {
                  if (previewUpdate) {
                    previewRestartForAppUpdate();
                    return;
                  }
                  void controller.restartForAppUpdate();
                }}
                aria-label="Restart to update"
                title="Restart to update"
              >
                <RotateCw aria-hidden="true" />
                <span className="sr-only">Restart</span>
              </Button>
            )}
            {appUpdate?.phase === 'restarting' && (
              <span
                className="pw-update-status"
                role="status"
                aria-label="Restarting to update"
                title="Restarting to update"
              >
                <LoaderCircle aria-hidden="true" />
                <span className="sr-only">Restarting…</span>
              </span>
            )}
          </div>
        </div>
      </aside>
      <main ref={mainRef} className="pw-main" id="workspace-main" tabIndex={-1}>
        <div className="pw-topbar">
          <nav className="pw-breadcrumb" aria-label="Breadcrumb">
            <span className="pw-beta-wrap" tabIndex={0} aria-describedby="beta-preview-detail">
              <span className="pw-beta-badge">Beta</span>
              <span className="pw-beta-popover" id="beta-preview-detail" role="tooltip">
                <strong>Beta preview</strong>
                <span>
                  StateCarry is still being stabilized. Features and saved project data may change.
                </span>
              </span>
            </span>
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
          {workspaceStatus && (
            <span className="pw-workspace-status" role="status" aria-live="polite">
              {workspaceStatus}
            </span>
          )}
        </div>
        {state.error && (
          <section className="pw-notice" role="alert">
            <p>{state.error}</p>
            <Button className="pw-button" onClick={() => void controller.refresh()}>
              Try again
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
                Dismiss
              </Button>
            </Alert>
          </div>
        )}
        {route.page === 'home' ? (
          <Home state={state} controller={controller} onNavigate={onNavigate} />
        ) : route.page === 'new' ? (
          <CreateProject controller={controller} onNavigate={onNavigate} />
        ) : route.page === 'global-settings' ? (
          <GlobalSettings
            state={state}
            controller={controller}
            onNavigate={onNavigate}
            updateUiPreview={updateUiPreview}
            onUpdateUiPreviewChange={changeUpdateUiPreview}
            dirtyWorkPreview={dirtyWorkPreview}
            onDirtyWorkPreviewChange={changeDirtyWorkPreview}
          />
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
              dirtyWorkPreview={dirtyWorkPreview}
            />
          )
        ) : state.loading ? (
          <p role="status">Reading this project…</p>
        ) : (
          <section className="pw-empty">
            <h1 tabIndex={-1}>Project not available</h1>
            <p>This project is no longer in StateCarry. It may have been removed.</p>
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
  updateUiPreview,
  onUpdateUiPreviewChange,
  dirtyWorkPreview,
  onDirtyWorkPreviewChange,
}: WorkspaceProps & {
  state: WorkspaceState;
  updateUiPreview: boolean;
  onUpdateUiPreviewChange: (enabled: boolean) => void;
  dirtyWorkPreview: DirtyWorkPreviewScenario;
  onDirtyWorkPreviewChange: (scenario: DirtyWorkPreviewScenario) => void;
}) {
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
            Choose the overview language and check whether Codex is available.
          </p>
        </div>
      </header>

      <div className="pw-stack">
        <Card className={cardSurface} aria-labelledby="response-language-heading">
          <h2 id="response-language-heading">Overview language</h2>
          <p className="pw-small">
            This changes generated overview and working-tree analysis text. Existing overviews are
            translated without re-checking project files, Git, or Codex conversations. Working-tree
            analysis is reused when the repository state and selected language have not changed.
            Quoted source text stays unchanged.
          </p>
          <label className="pw-field">
            Language
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
              Updating existing overview text…
            </p>
          )}
        </Card>

        <Card className={cardSurface} aria-labelledby="codex-integration-heading">
          <div className="pw-section-head">
            <h2 id="codex-integration-heading">Codex</h2>
            <Badge
              kind={
                capabilities?.summary.state === 'ready'
                  ? 'continue'
                  : capabilities?.summary.state === 'unverified'
                    ? 'checking'
                    : 'limited'
              }
            >
              {capabilities
                ? capabilities.summary.state === 'ready'
                  ? 'Ready'
                  : capabilities.summary.state === 'unverified'
                    ? 'Detected · not verified'
                    : 'Needs attention'
                : 'Checking'}
            </Badge>
          </div>
          {capabilities ? (
            <>
              <p>
                {capabilities.summary.state === 'ready'
                  ? 'StateCarry can use Codex when creating or updating overviews.'
                  : capabilities.summary.state === 'unverified'
                    ? "Codex was found, but StateCarry hasn't verified analysis yet."
                    : "StateCarry can't use Codex to prepare overviews right now."}
              </p>
            </>
          ) : capabilityError ? (
            <p className="pw-notice" role="alert">
              {capabilityError}
            </p>
          ) : (
            <p className="pw-small" role="status">
              Checking Codex…
            </p>
          )}
          <p className="pw-small">
            Codex conversations are optional. Choose the conversations that belong with each
            project.
          </p>
          <div>
            <Button
              className="pw-button"
              disabled={checking}
              onClick={() => void checkIntegrations()}
            >
              {checking ? 'Checking…' : 'Check again'}
            </Button>
          </div>
        </Card>

        <Card className={cardSurface} aria-labelledby="project-integrations-heading">
          <h2 id="project-integrations-heading">Project sources</h2>
          <p className="pw-small">
            Project files and Git are checked automatically from each project folder. Codex
            conversations are optional.
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
                      Edit Codex conversations
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
            <p className="pw-small">Add a project to see its project files and Git status.</p>
          )}
        </Card>

        {isDevelopmentBuild && (
          <Card className={cardSurface} aria-labelledby="advanced-settings-heading">
            <h2 id="advanced-settings-heading">Advanced</h2>
            <p className="pw-small">
              Development controls for checking interface states in this build.
            </p>
            <div className="pw-setting-row">
              <div className="pw-setting-copy">
                <strong>Developer mode</strong>
                <span className="pw-small">
                  Preview the update flow beside Settings without downloading or restarting.
                </span>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  name="preview-update-ui"
                  checked={updateUiPreview}
                  onChange={(event) => onUpdateUiPreviewChange(event.target.checked)}
                />
                Preview update UI
              </label>
            </div>
            <div className="pw-setting-row">
              <div className="pw-setting-copy">
                <strong>Uncommitted work preview</strong>
                <span className="pw-small">
                  Show a hard-coded dirty-work scenario on Project without changing project data.
                </span>
              </div>
              <label className="pw-field pw-preview-scenario">
                Scenario
                <select
                  name="preview-dirty-work"
                  value={dirtyWorkPreview}
                  onChange={(event) => {
                    const value = event.target.value;
                    onDirtyWorkPreviewChange(isDirtyWorkPreviewScenario(value) ? value : 'off');
                  }}
                >
                  <option value="off">Off</option>
                  <option value="clean">Clean working tree</option>
                  <option value="normal">Normal dirty tree</option>
                  <option value="mixed">Mixed dirty tree</option>
                  <option value="large">Large dirty tree</option>
                  <option value="no-git">No Git</option>
                </select>
              </label>
            </div>
          </Card>
        )}
      </div>
      <footer className="pw-settings-footer">StateCarry · Version {__STATECARRY_VERSION__}</footer>
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
            See what needs your attention, why it matters, and what would finish it.
          </p>
        </div>
        <RouteLink className="pw-button pw-button--primary" href="#/new" onNavigate={onNavigate}>
          Add a project
        </RouteLink>
      </header>
      <div className="pw-grid" role="search" aria-label="Find projects">
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
            <option value="all">All projects</option>
            <option value="focused">Focused projects</option>
            <option value="disconnected">Disconnected projects</option>
          </select>
        </label>
      </div>
      <section className="pw-section" aria-labelledby="pending-heading">
        <div className="pw-section-head">
          <h2 id="pending-heading">Needs your attention</h2>
          <span className="pw-small">
            Your focused project appears first. Recent activity does not change your priority.
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
              </RouteLink>
            ))}
          </div>
        ) : (
          <div className="pw-empty">
            <h3>
              {state.loading
                ? 'Reading your projects…'
                : query || filter !== 'all'
                  ? 'No tasks match these filters.'
                  : awaitingContext
                    ? "The first overview isn't ready yet."
                    : 'No next step needs attention right now.'}
            </h3>
            <p>
              {awaitingContext
                ? 'Open the project to see its status and retry if needed.'
                : state.projects.length
                  ? 'Open a project below, or change the filters to see more work.'
                  : 'Add a project to check its project files and Git. StateCarry also looks for related Codex conversations.'}
            </p>
          </div>
        )}
      </section>
      <section className="pw-section" aria-labelledby="all-projects-heading">
        <div className="pw-section-head">
          <h2 id="all-projects-heading">All projects</h2>
          <span className="pw-small" role="status">
            {projects.length} shown · {state.projects.length} projects
          </span>
        </div>
        <div className="pw-grid">
          {projects.map((project) => (
            <article
              key={project.id}
              className={cn(cardSurface, 'pw-card pw-card--quiet pw-project-card')}
            >
              <div className="pw-card-meta">
                {project.focused && <Badge>Your focus</Badge>}
                <Badge kind={project.disconnected ? 'disconnected' : ''}>
                  {project.stateLabel}
                </Badge>
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
              </div>
              <h3>
                <RouteLink
                  className="pw-project-card-link"
                  href={projectHref(project.id)}
                  onNavigate={onNavigate}
                >
                  {project.title}
                </RouteLink>
              </h3>
              <p className="pw-small">{project.purpose || 'No purpose set.'}</p>
              <p className="pw-small">
                {project.disconnected
                  ? 'Disconnected. Saved project data is still available.'
                  : `${attentionCount(project)} task${attentionCount(project) === 1 ? '' : 's'} need attention`}
              </p>
              {project.disconnected && (
                <Button
                  className="pw-button"
                  disabled={!state.online || state.busyWorkId === project.id}
                  onClick={() => void controller.restore(project.id)}
                >
                  Reconnect project
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function UncommittedWorkPreview({ scenario }: { scenario: DirtyWorkPreviewScenario }) {
  if (!isDevelopmentBuild || scenario === 'off') return null;
  const preview = dirtyWorkPreviewScenarios[scenario];
  return <WorkingTreeCard tree={preview} developerPreview />;
}

function WorkingTreeCard({
  tree,
  developerPreview = false,
  loading = false,
  onContinue,
}: {
  tree: DirtyWorkPreview | WorkingTreeView;
  developerPreview?: boolean;
  loading?: boolean;
  onContinue?: () => void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  if (tree.kind === 'clean' && !developerPreview) return null;

  if (tree.kind === 'clean') {
    return (
      <section
        className={cn(cardSurface, 'pw-card pw-uncommitted-work pw-uncommitted-work--clean')}
        aria-label="Uncommitted work developer preview"
      >
        <div className="pw-card-meta">
          {developerPreview && <Badge kind="checking">Developer preview</Badge>}
          <span className="pw-small">Clean working tree</span>
        </div>
        <div className="pw-git-heading">
          <GitBranch aria-hidden="true" />
          <h2>No uncommitted changes</h2>
        </div>
        <p className="pw-small">{tree.summary}</p>
      </section>
    );
  }

  if (tree.kind === 'no-git') {
    return (
      <section
        className={cn(cardSurface, 'pw-card pw-uncommitted-work pw-uncommitted-work--no-git')}
        aria-label={
          developerPreview ? 'Uncommitted work developer preview' : 'Working-tree recovery'
        }
      >
        <div className="pw-card-meta">
          {developerPreview && <Badge kind="checking">Developer preview</Badge>}
          <span className="pw-small">Git unavailable</span>
        </div>
        <div className="pw-git-heading">
          <GitBranch aria-hidden="true" />
          <h2>Working-tree recovery unavailable</h2>
        </div>
        <p>{tree.summary}</p>
        <div className="pw-actions" aria-label="No Git preview actions">
          <Button type="button" disabled>
            Set up Git
          </Button>
        </div>
        {developerPreview && (
          <p className="pw-small">Actions are disabled in this developer preview.</p>
        )}
      </section>
    );
  }

  return (
    <section
      className={cn(
        cardSurface,
        'pw-card pw-uncommitted-work',
        tree.kind === 'normal' && 'pw-uncommitted-work--normal',
        tree.kind === 'mixed' && 'pw-uncommitted-work--mixed',
        tree.kind === 'large' && 'pw-uncommitted-work--large',
      )}
      aria-label={developerPreview ? 'Uncommitted work developer preview' : 'Uncommitted work'}
    >
      <div className="pw-section-head">
        <div className="pw-stack pw-uncommitted-heading">
          <div className="pw-card-meta">
            {developerPreview && <Badge kind="checking">Developer preview</Badge>}
            <span className="pw-small">
              {tree.fileCount} file{tree.fileCount === 1 ? '' : 's'} changed
            </span>
          </div>
          <div className="pw-git-heading">
            <GitBranch aria-hidden="true" />
            <h2>Uncommitted work</h2>
          </div>
        </div>
      </div>
      <p>{tree.summary}</p>
      <dl className="pw-facts pw-uncommitted-last-point">
        {tree.additions !== undefined && tree.deletions !== undefined && (
          <div>
            <dt>Diff size</dt>
            <dd>
              +{tree.additions.toLocaleString()} / −{tree.deletions.toLocaleString()}
            </dd>
          </div>
        )}
        {tree.lastCommit && (
          <div>
            <dt>Last commit</dt>
            <dd>{tree.lastCommit}</dd>
          </div>
        )}
      </dl>
      {tree.groups && tree.groups.length > 0 && (
        <div className="pw-uncommitted-groups">
          {tree.groups.map((group) => (
            <article className="pw-uncommitted-group" key={group.title}>
              <div className="pw-uncommitted-group-heading">
                <h3>{group.title}</h3>
                <span className="pw-small">
                  {group.files.length} file{group.files.length === 1 ? '' : 's'}
                </span>
              </div>
              <p>{group.summary}</p>
              <dl className="pw-uncommitted-group-state">
                <div>
                  <dt>Current state</dt>
                  <dd>{group.currentState}</dd>
                </div>
                {group.suggestedNextStep && (
                  <div>
                    <dt>Suggested next step</dt>
                    <dd>{group.suggestedNextStep}</dd>
                  </div>
                )}
                {group.reason && (
                  <div>
                    <dt>Why</dt>
                    <dd>{group.reason}</dd>
                  </div>
                )}
                {group.doneWhen && (
                  <div>
                    <dt>Done when</dt>
                    <dd>{group.doneWhen}</dd>
                  </div>
                )}
                {group.openItems.length > 0 && (
                  <div>
                    <dt>Open or review next</dt>
                    <dd>
                      <ul>
                        {group.openItems.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      )}
      {tree.files && tree.files.length > 0 && showFiles && (
        <section className="pw-details pw-uncommitted-files" aria-label="Changed files">
          <div className="pw-section-head">
            <h3>Changed files</h3>
            <span className="pw-small">{tree.files.length} shown</span>
          </div>
          <ul>
            {tree.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="pw-actions" aria-label="Uncommitted work preview actions">
        <Button type="button" disabled={developerPreview || loading} onClick={onContinue}>
          Copy handoff for new Codex session
        </Button>
        <Button
          type="button"
          className="pw-button--quiet"
          disabled={developerPreview}
          aria-expanded={showFiles}
          onClick={() => setShowFiles((value) => !value)}
        >
          {showFiles ? 'Hide changed files' : 'View changed files'}
        </Button>
      </div>
      {developerPreview && (
        <p className="pw-small">Actions are disabled in this developer preview.</p>
      )}
    </section>
  );
}

function ProjectPage({
  project,
  state,
  controller,
  onNavigate,
  dirtyWorkPreview,
}: ProjectProps & { dirtyWorkPreview: DirtyWorkPreviewScenario }) {
  const edits = state.edits[project.id] ?? emptyEdits;
  const selectedKey = state.route.candidateKey ?? edits.selectedKey;
  const selected =
    selectedKey !== undefined
      ? project.tasks.find((task) => task.key === selectedKey)
      : (project.tasks.find((task) => task.status !== 'accepted' && task.status !== 'paused') ??
        project.tasks[0]);
  const busy = state.busyWorkId === project.id;
  const workingTree = state.workingTrees[project.id];
  const workingTreeLoading = state.workingTreeLoading[project.id] ?? false;
  const [workingTreeCopyStatus, setWorkingTreeCopyStatus] = useState('');
  const continueWorkingTree = async () => {
    const text = await controller.workingTreeHandoff(project.id);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setWorkingTreeCopyStatus(
        'Repository handoff copied. Start a new Codex session in this project and paste it there.',
      );
    } catch {
      setWorkingTreeCopyStatus(
        'Could not copy the repository handoff. No project files were changed.',
      );
    }
  };
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
          <p className="pw-lead">{project.purpose || 'No purpose set.'}</p>
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
            Reconnect project
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
              <span className="pw-small">Project files, Git, and optional Codex conversations</span>
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
                <dt>Still open</dt>
                <dd>{project.projectState.openOrUncertain}</dd>
              </div>
              <div>
                <dt>Next step</dt>
                <dd>{project.projectState.next}</dd>
              </div>
            </dl>
          </section>
          {dirtyWorkPreview !== 'off' ? (
            <UncommittedWorkPreview scenario={dirtyWorkPreview} />
          ) : workingTree ? (
            <>
              <WorkingTreeCard
                tree={workingTree}
                loading={workingTreeLoading}
                onContinue={() => void continueWorkingTree()}
              />
              {workingTreeCopyStatus && <p className="pw-small">{workingTreeCopyStatus}</p>}
            </>
          ) : workingTreeLoading ? (
            <p className="pw-small">Checking current Git working tree…</p>
          ) : null}
          <section
            className={`pw-goal${!project.goal && selected && !edits.goalDraft ? ' pw-goal--suggested' : ''}`}
            aria-label="Current goal"
          >
            <span className="pw-eyebrow">
              {!project.goal && selected ? 'Suggested goal' : 'Goal'}
            </span>
            {edits.goalDraft ? (
              <GoalEditor project={project} edits={edits} controller={controller} busy={busy} />
            ) : (
              <>
                <p>{project.goal || selected?.title || 'No goal has been chosen yet.'}</p>
                {!project.goalConfirmed && (project.goal || selected) && (
                  <span className="pw-small">
                    StateCarry inferred this goal from the available project information. Confirm it
                    or set your own.
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
                    Checking for changes. Your saved overview stays in place.
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
                    Update overview
                  </Button>
                </div>
                {!project.sourceCount && (
                  <RouteLink href={`${projectHref(project.id)}/settings`} onNavigate={onNavigate}>
                    Add Codex conversations
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
                  <h2>No next step is available</h2>
                  <p>
                    The goal is the starting point. Add missing project information or leave the
                    project here for now.
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
              <h2>Tasks</h2>
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
                          Resume task
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
        <span className="pw-eyebrow">Goal</span>
        {edits.goalDraft ? (
          <GoalEditor project={project} edits={edits} controller={controller} busy={busy} />
        ) : (
          <>
            <p>{project.goal || 'No goal has been recorded.'}</p>
            <Button
              className="pw-button pw-button--quiet"
              onClick={() => controller.editGoal(project.id)}
            >
              {project.goal ? 'Edit goal' : 'Set goal'}
            </Button>
          </>
        )}
      </section>
      <section className={cn(cardSurface, 'pw-card')} aria-labelledby="first-overview-heading">
        <h2 id="first-overview-heading">Create your first overview</h2>
        <p>
          StateCarry checks project files and Git automatically. Codex conversations are optional.
        </p>
        <p
          className={
            project.stateDescription.startsWith('StateCarry could not prepare the latest overview')
              ? 'pw-notice'
              : 'pw-small'
          }
          role={project.stateLabel === 'Updating overview' ? 'status' : undefined}
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
            {busy || project.stateLabel === 'Updating overview'
              ? 'Creating overview…'
              : 'Create overview'}
          </Button>
          <RouteLink
            className="pw-button pw-button--quiet"
            href={`${projectHref(project.id)}/settings`}
            onNavigate={onNavigate}
          >
            {project.sourceCount ? 'Review Codex conversations' : 'Add Codex conversations'}
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
        Goal
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
            This draft was written against an earlier overview. Compare it with the current project
            before saving.
          </p>
          <Button
            type="button"
            className="pw-button"
            disabled={!project.canEdit || busy}
            onClick={() => controller.rebaseGoal(project.id)}
          >
            I reviewed the latest goal
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
          Discard draft
        </Button>
        <span className="pw-small">Draft saved in this browser.</span>
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
      ? 'This task is complete. Leave it here, or choose another goal.'
      : task.status === 'paused'
        ? 'This task is paused. Resume it when you are ready.'
        : task.status === 'waiting'
          ? 'Wait for the required input, or clarify what is missing.'
          : task.status === 'review'
            ? 'Review the result, then accept it or describe what needs changing.'
            : (task.canAct || task.rechecking) && task.nextAction
              ? task.nextAction
              : 'Clarify the current situation before choosing an action.';
  const copyTask = async () => {
    try {
      const text = await controller.handoff(project.id, task.key);
      if (!text || !mounted.current) return;
      await navigator.clipboard.writeText(text);
      if (mounted.current) setCopyStatus('Task context copied. No work was started.');
    } catch {
      if (mounted.current) setCopyStatus('Could not copy this task. Your task is still here.');
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
            <dt>{task.status === 'accepted' ? 'What this acceptance covers' : 'Done when'}</dt>
            <dd>
              {task.doneWhen || 'No completion condition is set yet. Add one before continuing.'}
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
              {task.status === 'accepted' ? 'Reopen task' : 'Resume task'}
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
                Open Codex conversation
              </a>
            )}
            {task.canAct && (
              <Button
                className={`pw-button${task.destinationUrl ? '' : ' pw-button--primary'}`}
                disabled={busy}
                onClick={() => void copyTask()}
              >
                Copy task context
              </Button>
            )}
            {(task.status === 'review' || task.canAct) && (
              <Button
                className={`pw-button${task.status === 'review' ? ' pw-button--primary' : ''}`}
                disabled={!canDecide}
                onClick={() => void controller.correct(project.id, task.key, 'done')}
              >
                {task.status === 'review' ? 'Accept result' : 'Mark complete'}
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
              Pause task
            </Button>
          </div>
        )}
        {task.canAct && (
          <p className="pw-small">
            Opening Codex does not send a message or start work. Copying includes supporting source
            excerpts.
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
          <h3>Edit next step</h3>
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
            Done when
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
                I reviewed the latest task
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
              Discard draft
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
        <div className="pw-source-summary" aria-label="Sources">
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
          The overview time shows when this overview was created, not when its sources were
          observed.
        </p>
      </details>
      <details className="pw-details">
        <summary>This task isn&apos;t relevant</summary>
        <p>Set this task aside. You can restore it later.</p>
        <Button
          className="pw-button"
          disabled={!canDecide}
          onClick={() => void controller.correct(project.id, task.key, 'wrong-work')}
        >
          Set aside
        </Button>
      </details>
      <details className="pw-details">
        <summary>Inspect original records</summary>
        <p className="pw-small">
          Open an original to check exact wording. Your task and unfinished writing stay here.
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
              Open original Codex conversation
            </a>
          )}
        </div>
        {!task.originals.length && !task.destinationUrl && (
          <p className="pw-small">No original record is available for this task.</p>
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
            This is an original source record. Reading it does not accept the result or change your
            task.
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
            It may have been removed or excluded from this project's Codex conversations. Your task
            and input are kept.
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
  const [choosingFolder, setChoosingFolder] = useState(false);
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
  const chooseFolder = async () => {
    if (busy || choosingFolder) return;
    setChoosingFolder(true);
    setError('');
    try {
      const selected = await controller.chooseProjectFolder();
      if (!mounted.current || selected === null) return;
      setCwd(selected);
      setReusedProject(null);
    } catch (failure) {
      if (mounted.current) setError(projectError(failure));
    } finally {
      if (mounted.current) setChoosingFolder(false);
    }
  };
  const submit = async () => {
    if (duplicate || busy || choosingFolder || !state.online || state.checkingCurrent) return;
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
          <span className="pw-eyebrow">Project</span>
          <h1 tabIndex={-1}>Add a project</h1>
          <p className="pw-lead">
            Choose the folder you work in. StateCarry checks its project files and Git, looks for
            related Codex conversations, and requests the first overview automatically.
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
        <div className="pw-field">
          <label htmlFor="project-folder">Project folder</label>
          <div className="pw-folder-field">
            <Input
              id="project-folder"
              name="cwd"
              required
              disabled={busy || choosingFolder}
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
            <Button
              type="button"
              className="pw-button"
              disabled={busy || choosingFolder || !state.online}
              onClick={() => void chooseFolder()}
            >
              {choosingFolder ? 'Choosing…' : 'Choose folder'}
            </Button>
          </div>
          <span className="pw-field-help">
            Choose a local folder or enter its absolute path. StateCarry does not change its files.
          </span>
        </div>
        {existing ? (
          <section className="pw-notice" aria-label="Existing project folder">
            <h2>This folder is already a project</h2>
            <p>
              Open {existing.title} to continue. Its saved purpose, goal, overview, task choices,
              and Codex conversations are kept.
            </p>
            <p className="pw-small">
              The values entered here do not replace the existing project. Use project settings to
              change its Codex conversations.
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
            <h2>This folder is used by more than one project</h2>
            <p>Review your projects before adding this folder again.</p>
            <RouteLink className="pw-button" href="#/home" onNavigate={onNavigate}>
              Review projects
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
              Current goal <span className="pw-field-help">Optional</span>
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
              disabled={
                !state.online || state.checkingCurrent || busy || choosingFolder || folder === null
              }
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
            You can change the goal and Codex conversations later in project settings.
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
        Choose the Codex conversations that belong with this project. You can also choose where a
        conversation starts.
      </p>
      <div>
        <Button
          type="button"
          className="pw-button"
          disabled={disabled || searching || turnBusy !== null || !cwd.trim().startsWith('/')}
          onClick={() => void find()}
        >
          {searching ? 'Finding conversations…' : 'Find related conversations'}
        </Button>
      </div>
      {partial && (
        <p className="pw-notice">
          StateCarry could only check some conversations. Your current choices are kept.
        </p>
      )}
      {searched && !threads.length && (
        <p className="pw-small">
          No related Codex conversations were found. You can use the project without one.
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
            Select all
          </Button>
          <Button
            type="button"
            className="pw-button pw-button--quiet"
            disabled={disabled || !value.threadIds.length}
            onClick={clearSelection}
          >
            Clear
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
                        <option value="">Start of conversation</option>
                        {value.startTurnIds[thread.id] &&
                          !turns[thread.id].some(
                            (turn) => turn.id === value.startTurnIds[thread.id],
                          ) && (
                            <option value={value.startTurnIds[thread.id]}>
                              Saved starting point · unavailable now
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
                          An advanced conversation range is set below. Remove it to use a starting
                          point instead.
                        </span>
                      )}
                    </label>
                  )}
                  <details className="pw-details">
                    <summary>Advanced conversation range</summary>
                    <p className="pw-small">
                      Limit the exact part of this Codex conversation StateCarry can read.
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
                              {field === 'turnId' ? 'turn ID' : 'item ID'}
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
                        Use starting point onward
                      </Button>
                      {exact?.end && (
                        <Button
                          type="button"
                          className="pw-button"
                          disabled={disabled}
                          onClick={() => range(thread.id, { start: exact.start })}
                        >
                          Remove end point
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
        Keep looking for related Codex conversations
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
        setSourceError('Codex conversation settings could not be found. Try again.');
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
        'Complete the required IDs for the advanced conversation range, or remove it.',
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
            Edit this project and choose which Codex conversations StateCarry can use.
          </p>
        </div>
        <RouteLink className="pw-button" href={projectHref(project.id)} onNavigate={onNavigate}>
          Return to project
        </RouteLink>
      </header>
      <div className="pw-stack">
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-profile-heading">
          <h2 id="project-profile-heading">Project details</h2>
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
                  Show this project first on Home. Only one project can be focused at a time.
                </span>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={profile.focused}
                  onChange={(event) => setProfile({ ...profile, focused: event.target.checked })}
                />
                Set as Home focus
              </label>
            </div>
            <p className="pw-small">Project folder: {project.cwd}</p>
            {profile.revision !== project.revision && (
              <div className="pw-notice">
                <p>
                  The project changed while these settings were open. Review your changes before
                  saving.
                </p>
                <Button
                  type="button"
                  className="pw-button"
                  disabled={!state.online || busy}
                  onClick={() => setProfile({ ...profile, revision: project.revision })}
                >
                  I reviewed the latest project
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
                Save details
              </Button>
            </div>
          </form>
        </section>
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-sources-heading">
          <h2 id="project-sources-heading">
            Codex conversations <span className="pw-small">Optional</span>
          </h2>
          <p className="pw-small">
            StateCarry checks project files and Git automatically. Add conversations when their
            decisions, progress, or history help explain the work. Saving this list does not update
            the overview.
          </p>
          {project.disconnected ? (
            <p>Reconnect the project before editing Codex conversations.</p>
          ) : (
            <>
              {loadingSources && <p role="status">Loading Codex conversations…</p>}
              {sourceError && (
                <div className="pw-notice" role="alert">
                  <p>{sourceError}</p>
                  <Button
                    className="pw-button"
                    disabled={loadingSources}
                    onClick={() => void readSources()}
                  >
                    Try again
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
                        The project changed while these Codex conversations were open. Reload them
                        before saving.
                      </p>
                      <Button
                        type="button"
                        className="pw-button"
                        disabled={!state.online || busy || loadingSources}
                        onClick={() => void readSources()}
                      >
                        Reload conversations
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
                      Save conversations
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
        <section
          className={cn(cardSurface, 'pw-card')}
          aria-labelledby="project-connection-heading"
        >
          <h2 id="project-connection-heading">Connection</h2>
          <p>
            {project.disconnected
              ? 'This project is disconnected. Reconnect it so StateCarry can check for changes again. Updating the overview remains a separate action.'
              : 'Disconnect this project to stop StateCarry from checking for new project information. Its saved goal, overview, tasks, and choices remain.'}
          </p>
          <p className="pw-small">Project files and original Codex conversations stay unchanged.</p>
          <Button
            className="pw-button"
            disabled={!state.online || busy}
            onClick={() =>
              project.disconnected ? void controller.restore(project.id) : void disconnect()
            }
          >
            {project.disconnected ? 'Reconnect project' : 'Disconnect project'}
          </Button>
        </section>
        <section className={cn(cardSurface, 'pw-card')} aria-labelledby="project-removal-heading">
          <h2 id="project-removal-heading">Delete StateCarry data</h2>
          <p>
            Delete this project&apos;s saved StateCarry records and source copies used only by this
            project. Shared source copies stay available to other projects.
          </p>
          <p className="pw-small">
            Project files and original Codex conversations are not deleted. Minimal action receipts,
            activity logs, analysis diagnostics, and backups are outside this deletion.
          </p>
          <Button
            className="pw-button pw-button--danger"
            disabled={!state.online || busy || previewing}
            onClick={() => void previewRemoval()}
          >
            {previewing ? 'Checking…' : 'Review what will be deleted'}
          </Button>
          {preview && (
            <div className="pw-stack" aria-label="Deletion preview">
              <p>This permanently deletes the project data listed below. This cannot be undone.</p>
              <dl className="pw-facts">
                <div>
                  <dt>Saved project data</dt>
                  <dd>{preview.ownedRecords}</dd>
                </div>
                <div>
                  <dt>Sources used only by this project</dt>
                  <dd>{preview.exclusiveSources}</dd>
                </div>
                <div>
                  <dt>Shared sources kept</dt>
                  <dd>{preview.sharedSources}</dd>
                </div>
              </dl>
              {preview.blocked ? (
                <p className="pw-notice">
                  Project data cannot be deleted while StateCarry is still checking work or the
                  latest outcome is unresolved.
                </p>
              ) : preview.revision !== project.revision ? (
                <p className="pw-notice">
                  The project changed after this preview. Review what will be deleted again before
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
                    Delete StateCarry data for {project.title}
                  </label>
                  <div>
                    <Button
                      className="pw-button pw-button--danger"
                      disabled={!state.online || busy || !confirmRemoval}
                      onClick={() => void remove()}
                    >
                      Delete project data
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
