import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  projectError,
  projectHref,
  projectRouteHref,
  type ProjectController,
  type ProjectCreateInput,
  type ProjectSourcesInput,
  type ProjectView,
  type ProjectNowView,
  type ProjectCompactView,
  type PresentedProjectAction,
  type RecordRange,
  type ProjectDrafts,
  type WorkingTreeView,
  type AgentProvider,
  type AgentSettingsView,
} from '@statecarry/presentation';
import '@/styles/globals.css';
import { Alert } from '@/components/ui/alert';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Button as UiButton, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/use-theme';
import {
  ArrowLeft,
  MessageCircle,
  Info,
  Download,
  Folder,
  GitBranch,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Settings as SettingsIcon,
  TriangleAlert,
} from 'lucide-react';
import './project-workspace.css';
import { WorkDiscussion } from './WorkDiscussion';
import { ProjectNowActionMode } from './ProjectNowAction';

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
const emptyEdits: ProjectDrafts = { goalDraft: null, actionDrafts: [], expanded: [], scroll: 0 };
const updateUiPreviewKey = 'statecarry.developer.update-ui-preview.v1';
const dirtyWorkPreviewKey = 'statecarry.developer.dirty-work-preview.v1';
const feedbackUrl = 'https://forms.gle/U8RcHwGe1dJxLdvq5';
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
      'apps/web/src/ui/projects.css',
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
          'apps/web/src/ui/projects.css',
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

function buttonVariantForClass(className?: string) {
  if (className?.includes('pw-button--primary')) return 'default' as const;
  if (className?.includes('pw-button--quiet')) return 'ghost' as const;
  if (className?.includes('pw-button--danger')) return 'destructive' as const;
  return 'outline' as const;
}

function Button({ className, variant, ...props }: ComponentProps<typeof UiButton>) {
  return (
    <UiButton
      variant={variant ?? buttonVariantForClass(className)}
      className={cn('pw-button', className)}
      {...props}
    />
  );
}

function routeButtonClass(className?: string) {
  if (!className?.includes('pw-button')) return className;
  return cn(buttonVariants({ variant: buttonVariantForClass(className) }), className);
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

function projectAssetUrl(ref: string | null): string | undefined {
  return ref ? `/api/v1/local/project-assets/${encodeURIComponent(ref)}` : undefined;
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

export function ProjectWorkspace({ controller, onNavigate }: WorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [railCollapsed, setRailCollapsed] = useState(
    () =>
      typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 720px)').matches ?? false),
  );
  const [updateUiPreview, setUpdateUiPreview] = useState(readUpdateUiPreview);
  const [dirtyWorkPreview, setDirtyWorkPreview] =
    useState<DirtyWorkPreviewScenario>(readDirtyWorkPreview);
  const [updateUiPreviewPhase, setUpdateUiPreviewPhase] =
    useState<UpdateUiPreviewPhase>('available');
  const updateUiPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUpdate = previewAppUpdate(updateUiPreview, updateUiPreviewPhase);
  const appUpdate = previewUpdate ?? state.appUpdate;
  const { route } = state;
  const project = state.projects.find((item) => item.id === route.projectId);
  const workspaceStatus = state.loading
    ? 'Finding projects…'
    : state.loadingDetails
      ? 'Loading project details…'
      : !state.online
        ? "StateCarry can't connect to its local service."
        : state.checkingCurrent
          ? 'Checking current state'
          : null;
  const routeTitle =
    route.page === 'home'
      ? 'Home'
      : route.page === 'projects'
        ? 'Projects'
        : route.page === 'new'
          ? 'Add a project'
          : route.page === 'global-settings'
            ? 'Settings'
            : route.page === 'settings'
              ? project
                ? `${project.title} settings`
                : 'Project settings'
              : route.page === 'original'
                ? 'Original record'
                : (project?.title ?? 'Project');
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
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    heading?.focus({ preventScroll: true });
  }, [route.page, route.projectId, !!project]);
  useEffect(() => {
    if (route.page !== 'project' || !project) return;
    const id = project.id;
    let scroll = controller.getSnapshot().edits[id]?.scroll ?? 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const frame = requestAnimationFrame(() => window.scrollTo(0, scroll));
    // Scroll events fire per frame; persisting each one would re-render the
    // whole workspace and write storage far more often than a saved scroll
    // position is ever read back.
    const record = () => {
      scroll = window.scrollY;
      if (pending === null) {
        pending = setTimeout(() => {
          pending = null;
          controller.recordScroll(id, scroll);
        }, 250);
      }
    };
    window.addEventListener('scroll', record, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', record);
      if (pending !== null) clearTimeout(pending);
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
          <span className="pw-app-header-title">{routeTitle}</span>
          <span className="pw-beta-wrap" tabIndex={0} aria-describedby="beta-preview-detail">
            <span className="pw-beta-badge">Beta</span>
            <span className="pw-beta-popover" id="beta-preview-detail" role="tooltip">
              <strong>Beta preview</strong>
              <span>
                StateCarry is still being stabilized. Features and saved project data may change.
              </span>
            </span>
          </span>
        </div>
        <div className="pw-actions">
          {workspaceStatus && (
            <span className="pw-workspace-status" role="status" aria-live="polite">
              {workspaceStatus}
            </span>
          )}
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
            href="#/projects"
            onNavigate={onNavigate}
            current={route.page === 'projects' ? 'page' : undefined}
          >
            Projects
          </RouteLink>
        </nav>
        <div className="pw-rail-foot">
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
        ) : route.page === 'projects' ? (
          <Projects state={state} controller={controller} onNavigate={onNavigate} />
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
              key={project.id}
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
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<ProjectController['capabilities']>
  > | null>(null);
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [agentSettings, setAgentSettings] = useState<AgentSettingsView | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>('codex');
  const [openrouterModel, setOpenrouterModel] = useState('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [capabilityError, setCapabilityError] = useState('');
  const mounted = useRef(true);

  const readAgentSettings = async () => {
    try {
      const next = await controller.agentSettings();
      if (mounted.current) {
        setAgentSettings(next);
        setAgentProvider(next.provider);
        setOpenrouterModel(next.openrouterModel);
      }
    } catch {
      // Older gateways without agent settings keep the Codex default.
    }
  };

  const readCapabilities = async () => {
    try {
      const next = await controller.capabilities();
      if (mounted.current) {
        setCapabilities(next);
        setCapabilityError('');
      }
    } catch {
      if (mounted.current)
        setCapabilityError(
          'The analysis status could not be read from the local StateCarry service.',
        );
    }
  };

  useEffect(() => {
    mounted.current = true;
    void readCapabilities();
    void readAgentSettings();
    return () => {
      mounted.current = false;
    };
  }, [controller]);

  const checkIntegrations = async () => {
    setChecking(true);
    await readCapabilities();
    if (mounted.current) setChecking(false);
  };

  const agentDraftChanged =
    !!agentSettings &&
    (agentProvider !== agentSettings.provider ||
      (agentProvider === 'openrouter' &&
        (openrouterModel.trim() !== agentSettings.openrouterModel ||
          openrouterApiKey.trim().length > 0)));

  const saveAgent = async () => {
    if (!agentSettings) return;
    setSaving(true);
    const saved = await controller.saveAgentSettings({
      provider: agentProvider,
      ...(agentProvider === 'openrouter'
        ? {
            openrouterModel: openrouterModel.trim() || agentSettings.openrouterModel,
            ...(openrouterApiKey.trim() ? { openrouterApiKey: openrouterApiKey.trim() } : {}),
          }
        : {}),
    });
    if (mounted.current) {
      setSaving(false);
      if (saved) {
        setOpenrouterApiKey('');
        await readAgentSettings();
        await readCapabilities();
      }
    }
  };

  const summary = capabilities?.summary;
  const openrouterSelected = summary?.provider === 'openrouter';
  const statusText = summary
    ? openrouterSelected
      ? summary.state === 'ready'
        ? 'StateCarry runs background analysis through OpenRouter.'
        : summary.state === 'unverified'
          ? 'An OpenRouter key is saved, but StateCarry has not verified analysis yet.'
          : "StateCarry can't use OpenRouter for analysis right now."
      : summary.state === 'ready'
        ? 'StateCarry can use Codex when creating or updating overviews.'
        : summary.state === 'unverified'
          ? "Codex was found, but StateCarry hasn't verified analysis yet."
          : "StateCarry can't use Codex to prepare overviews right now."
    : null;

  return (
    <>
      <header className="pw-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Settings</span>
          <h1 tabIndex={-1}>StateCarry settings</h1>
          <p className="pw-lead">Check whether analysis is available right now.</p>
        </div>
      </header>

      <div className="pw-stack">
        <Card className={cardSurface} aria-labelledby="analysis-agent-heading">
          <div className="pw-section-head">
            <h2 id="analysis-agent-heading">Analysis agent</h2>
            <Badge
              kind={
                summary?.state === 'ready'
                  ? 'continue'
                  : summary?.state === 'unverified'
                    ? 'checking'
                    : summary
                      ? 'limited'
                      : 'checking'
              }
            >
              {summary
                ? summary.state === 'ready'
                  ? 'Ready'
                  : summary.state === 'unverified'
                    ? 'Detected · not verified'
                    : 'Needs attention'
                : 'Checking'}
            </Badge>
          </div>
          {capabilityError ? (
            <p className="pw-notice" role="alert">
              {capabilityError}
            </p>
          ) : (
            <p role="status" className={summary ? undefined : 'pw-small'}>
              {summary && statusText
                ? statusText
                : `Checking ${openrouterSelected ? 'OpenRouter' : 'Codex'}…`}
            </p>
          )}
          <div className="pw-setting-row">
            <div className="pw-setting-copy">
              <strong>Where analysis runs</strong>
              <span className="pw-small">
                StateCarry checks Codex on this device by default. OpenRouter runs the analysis
                through its API instead. If Codex usage runs out and an OpenRouter key is saved,
                analysis automatically continues with OpenRouter until Codex is available again.
              </span>
            </div>
            <label className="pw-field">
              Analysis agent
              <select
                name="analysis-agent"
                value={agentProvider}
                onChange={(event) =>
                  setAgentProvider(event.target.value === 'openrouter' ? 'openrouter' : 'codex')
                }
              >
                <option value="codex">Codex (this device)</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
          </div>
          {agentProvider === 'openrouter' && (
            <>
              <label className="pw-field">
                OpenRouter API key
                <input
                  type="password"
                  name="openrouter-api-key"
                  value={openrouterApiKey}
                  autoComplete="off"
                  placeholder={agentSettings?.apiKeyHint ?? 'Paste your OpenRouter key'}
                  onChange={(event) => setOpenrouterApiKey(event.target.value)}
                />
                <span className="pw-field-help">
                  Create a key at openrouter.ai/keys.{' '}
                  {agentSettings?.hasApiKey
                    ? 'A key is already saved on this Mac; type a new one only to replace it.'
                    : 'The key is stored on this Mac only.'}
                </span>
              </label>
              <label className="pw-field">
                OpenRouter model
                <input
                  type="text"
                  name="openrouter-model"
                  value={openrouterModel}
                  onChange={(event) => setOpenrouterModel(event.target.value)}
                />
                <span className="pw-field-help">
                  openrouter/free picks a free model for every request. You can also name one model,
                  for example deepseek/deepseek-chat-v3.1:free.
                </span>
              </label>
            </>
          )}
          {agentDraftChanged && (
            <div>
              {!state.online && (
                <p className="pw-small">
                  The local service is unavailable, so settings can't be saved right now.
                </p>
              )}
              <Button
                className="pw-button"
                disabled={saving || !state.online || !!state.busyWorkId}
                onClick={() => void saveAgent()}
              >
                {saving ? 'Saving…' : 'Save agent settings'}
              </Button>
            </div>
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

        <Card className={cardSurface} aria-labelledby="appearance-settings-heading">
          <div className="pw-section-head">
            <h2 id="appearance-settings-heading">Appearance</h2>
          </div>
          <div className="pw-setting-row">
            <div className="pw-setting-copy">
              <strong>Theme</strong>
              <span className="pw-small">
                System follows the appearance setting of this device until you pick Light or Dark.
              </span>
            </div>
            <label className="pw-field">
              Theme
              <select
                name="theme"
                value={themePreference}
                onChange={(event) => {
                  const value = event.target.value;
                  setThemePreference(value === 'light' || value === 'dark' ? value : 'system');
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
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

function FocusProjectCard({
  project,
  compact,
  onNavigate,
}: {
  project: ProjectView;
  compact: ProjectCompactView | undefined;
  onNavigate: Navigate;
}) {
  const bannerUrl = projectAssetUrl(project.bannerAsset);
  const iconUrl = projectAssetUrl(project.iconAsset);
  return (
    <RouteLink
      href={projectHref(project.id)}
      onNavigate={onNavigate}
      className="pw-focus-card"
      current={undefined}
    >
      <span className="pw-focus-card-banner" aria-hidden="true">
        {bannerUrl && (
          <img className="pw-focus-card-banner-image" src={bannerUrl} alt="" decoding="async" />
        )}
      </span>
      <span className="pw-focus-card-body">
        <span className="pw-focus-card-icon" aria-hidden="true">
          {iconUrl ? <img src={iconUrl} alt="" decoding="async" /> : <Folder />}
        </span>
        <span className="pw-focus-card-copy">
          <strong>{project.title}</strong>
          {compact && <span className="pw-focus-card-work">{compact.current}</span>}
          <span className="pw-focus-card-status">{compact?.status ?? project.stateLabel}</span>
          {compact?.reason && <span className="pw-focus-card-reason">{compact.reason}</span>}
        </span>
      </span>
    </RouteLink>
  );
}

function LoadingLines({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className="pw-loading-block" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span className="pw-loading-line" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

function FocusLoadingSlot() {
  return (
    <div className="pw-focus-card pw-focus-card--loading">
      <span className="pw-focus-card-banner pw-loading-surface" aria-hidden="true" />
      <span className="pw-focus-card-body">
        <span className="pw-focus-card-icon pw-loading-surface" aria-hidden="true" />
        <LoadingLines label="Finding projects" lines={2} />
      </span>
    </div>
  );
}

function FocusEmptySlot({ primary, onNavigate }: { primary: boolean; onNavigate: Navigate }) {
  if (!primary)
    return (
      <div className="pw-focus-slot pw-focus-slot--empty">
        <span>Ready for a project</span>
      </div>
    );
  return (
    <RouteLink
      href="#/projects"
      onNavigate={onNavigate}
      className="pw-focus-slot pw-focus-slot--add"
    >
      <span className="pw-focus-slot-plus" aria-hidden="true">
        +
      </span>
      <strong>Choose a project</strong>
      <span>Add it to your focus</span>
    </RouteLink>
  );
}

function Home({ state, onNavigate }: WorkspaceProps & { state: WorkspaceState }) {
  const focused = state.projects
    .filter((project) => project.focused && !project.disconnected)
    .slice(0, 3);
  const emptySlots = Math.max(0, 3 - focused.length);
  const slots = Array.from({ length: emptySlots }, (_, index) => index);
  return (
    <>
      <header className="pw-hero pw-home-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Your focus</span>
          <h1 tabIndex={-1}>Where will you pick up?</h1>
          <p className="pw-lead">Keep up to three projects in focus and choose where to return.</p>
        </div>
      </header>
      <section className="pw-focus-section" aria-labelledby="home-focus-heading">
        <div className="pw-section-head">
          <div className="pw-stack">
            <h2 id="home-focus-heading">Focus projects</h2>
            <span className="pw-small">{focused.length} of 3 in focus</span>
          </div>
        </div>
        <div className="pw-focus-grid">
          {state.loading && !state.projects.length ? (
            <>
              <FocusLoadingSlot />
              <FocusLoadingSlot />
              <FocusLoadingSlot />
            </>
          ) : (
            <>
              {focused.map((project) => (
                <FocusProjectCard
                  key={project.id}
                  project={project}
                  compact={state.projectCompacts[project.id]}
                  onNavigate={onNavigate}
                />
              ))}
              {slots.map((slot) => (
                <FocusEmptySlot key={slot} primary={slot === 0} onNavigate={onNavigate} />
              ))}
            </>
          )}
        </div>
        <div className="pw-focus-footer">
          <RouteLink href="#/projects" onNavigate={onNavigate} className="pw-project-picker-link">
            Choose projects
          </RouteLink>
        </div>
      </section>
    </>
  );
}

function Projects({ state, controller, onNavigate }: WorkspaceProps & { state: WorkspaceState }) {
  const [search, setSearch] = useState('');
  const [focusReplacement, setFocusReplacement] = useState<ProjectView | null>(null);
  const [replacingFocus, setReplacingFocus] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const focused = state.projects.filter((project) => project.focused && !project.disconnected);
  const matchesSearch = (project: ProjectView) =>
    !query ||
    [project.title, project.purpose, project.cwd, ...project.tasks.map((task) => task.title)].some(
      (text) => text.toLocaleLowerCase().includes(query),
    );
  const activeProjects = state.projects
    .filter((project) => !project.disconnected && matchesSearch(project))
    .sort(
      (a, b) =>
        Number(b.focused) - Number(a.focused) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  const disconnectedProjects = state.projects
    .filter((project) => project.disconnected && matchesSearch(project))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const showSearch = state.projects.length >= 6;
  const focusBusy = !state.online || state.checkingCurrent || state.busyWorkId !== null;
  const requestFocus = (project: ProjectView) => {
    if (project.focused) {
      void controller.setFocused(project.id, false);
      return;
    }
    if (focused.length < 3) {
      void controller.setFocused(project.id, true);
      return;
    }
    setFocusReplacement(project);
  };
  const replaceFocus = async (previous: ProjectView) => {
    if (!focusReplacement || replacingFocus) return;
    setReplacingFocus(true);
    const removed = await controller.setFocused(previous.id, false);
    if (removed) {
      const added = await controller.setFocused(focusReplacement.id, true);
      if (added) setFocusReplacement(null);
    }
    setReplacingFocus(false);
  };
  useEffect(() => {
    if (!focusReplacement) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !replacingFocus) setFocusReplacement(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [focusReplacement, replacingFocus]);
  const focusReplaceDialog = useRef<HTMLElement>(null);
  const focusReplaceTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focusReplacement) return;
    focusReplaceTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusReplaceDialog.current?.querySelector<HTMLElement>('#focus-replace-heading')?.focus();
    return () => {
      focusReplaceTrigger.current?.focus();
      focusReplaceTrigger.current = null;
    };
  }, [focusReplacement]);
  const trapFocusReplaceTab = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || !focusReplaceDialog.current) return;
    const focusables = Array.from(
      focusReplaceDialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusables.length) return;
    const active = document.activeElement;
    if (
      event.shiftKey &&
      (active === focusables[0] || !focusReplaceDialog.current.contains(active))
    ) {
      event.preventDefault();
      focusables[focusables.length - 1].focus();
    } else if (!event.shiftKey && active === focusables[focusables.length - 1]) {
      event.preventDefault();
      focusables[0].focus();
    }
  };
  const projectCard = (project: ProjectView) => {
    const compact = state.projectCompacts[project.id];
    return (
      <article
        key={project.id}
        className={cn(cardSurface, 'pw-card pw-card--quiet pw-project-card pw-project-list-card')}
      >
        <span className="pw-project-list-icon" aria-hidden="true">
          {project.iconAsset ? (
            <img src={projectAssetUrl(project.iconAsset)} alt="" decoding="async" loading="lazy" />
          ) : (
            <Folder />
          )}
        </span>
        <div className="pw-project-list-copy">
          <div className="pw-project-list-title">
            <h3>
              <RouteLink
                className="pw-project-card-link"
                href={projectHref(project.id)}
                onNavigate={onNavigate}
              >
                {project.title}
              </RouteLink>
            </h3>
            {project.focused && <Badge>Your focus</Badge>}
          </div>
          {compact && <p className="pw-project-list-current">{compact.current}</p>}
          <span className="pw-project-list-status">{compact?.status ?? project.stateLabel}</span>
        </div>
        <div className="pw-project-list-action">
          {project.disconnected ? (
            <Button
              className="pw-button"
              disabled={!state.online || state.busyWorkId === project.id}
              onClick={() => void controller.restore(project.id)}
            >
              {state.busyWorkId === project.id ? 'Reconnecting…' : 'Reconnect project'}
            </Button>
          ) : (
            <Button
              type="button"
              className="pw-button pw-button--quiet"
              disabled={focusBusy}
              onClick={() => requestFocus(project)}
            >
              {project.focused ? 'Remove from focus' : 'Add to focus'}
            </Button>
          )}
        </div>
      </article>
    );
  };
  const loadingCards = Array.from({ length: 3 }, (_, index) => (
    <article key={index} className={cn(cardSurface, 'pw-card pw-card--quiet pw-project-list-card')}>
      <span className="pw-project-list-icon pw-loading-surface" aria-hidden="true" />
      <LoadingLines label="Finding projects" lines={2} />
    </article>
  ));
  return (
    <>
      <header className="pw-hero pw-project-hero">
        <div className="pw-hero-copy">
          <span className="pw-eyebrow">Projects</span>
          <h1 tabIndex={-1}>Projects</h1>
          <p className="pw-lead">Choose what stays in focus or open any project.</p>
          <span className="pw-small">{focused.length} of 3 in focus</span>
        </div>
        <RouteLink className="pw-button pw-button--primary" href="#/new" onNavigate={onNavigate}>
          Add a project
        </RouteLink>
      </header>
      {showSearch && (
        <div className="pw-project-search" role="search" aria-label="Find projects">
          <label className="pw-field">
            Find a project
            <Input
              type="search"
              name="workspace-search"
              placeholder="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      )}
      <section className="pw-section" aria-labelledby="active-projects-heading">
        <div className="pw-section-head">
          <h2 id="active-projects-heading">Active projects</h2>
          <span className="pw-small" role="status">
            {activeProjects.length} shown
          </span>
        </div>
        <div className="pw-project-list">
          {state.loading && !state.projects.length ? (
            loadingCards
          ) : activeProjects.length ? (
            activeProjects.map(projectCard)
          ) : (
            <div className="pw-empty">
              <h3>{query ? 'No active projects match your search.' : 'No active projects yet.'}</h3>
              <p>{query ? 'Try another project name.' : 'Add a project to begin.'}</p>
            </div>
          )}
        </div>
      </section>
      {disconnectedProjects.length > 0 && (
        <section className="pw-section" aria-labelledby="disconnected-projects-heading">
          <div className="pw-section-head">
            <h2 id="disconnected-projects-heading">Disconnected</h2>
            <span className="pw-small">{disconnectedProjects.length} projects</span>
          </div>
          <div className="pw-project-list">{disconnectedProjects.map(projectCard)}</div>
        </section>
      )}
      {focusReplacement && (
        <div className="pw-modal-layer" role="presentation">
          <section
            ref={focusReplaceDialog}
            className="pw-focus-replace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-replace-heading"
            onKeyDown={trapFocusReplaceTab}
          >
            <div className="pw-stack">
              <span className="pw-eyebrow">Focus is full</span>
              <h2 id="focus-replace-heading" tabIndex={-1}>
                Choose a project to replace
              </h2>
              <p className="pw-small">
                {focusReplacement.title} will take its place in Home focus.
              </p>
            </div>
            <div className="pw-focus-replace-list">
              {focused.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  className="pw-focus-replace-option"
                  disabled={replacingFocus}
                  onClick={() => void replaceFocus(project)}
                >
                  <span className="pw-focus-replace-project">
                    <span className="pw-project-list-icon" aria-hidden="true">
                      <Folder />
                    </span>
                    <span>
                      <strong>{project.title}</strong>
                      <span className="pw-small">{project.stateLabel}</span>
                    </span>
                  </span>
                  <span>Replace</span>
                </Button>
              ))}
            </div>
            <div className="pw-actions">
              <Button
                type="button"
                className="pw-button pw-button--quiet"
                disabled={replacingFocus}
                onClick={() => setFocusReplacement(null)}
              >
                Cancel
              </Button>
            </div>
          </section>
        </div>
      )}
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
  onContinue?: (groupIndexes?: number[]) => void;
}) {
  const [showFiles, setShowFiles] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const groups = tree.groups ?? [];
  const multipleGroups = groups.length > 1 && !!onContinue;
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
        {developerPreview && (
          <>
            <div className="pw-actions">
              <Button type="button" disabled>
                Set up Git
              </Button>
            </div>
            <p className="pw-small">Actions are disabled in this developer preview.</p>
          </>
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
            <dd className="pw-mono">
              +{tree.additions.toLocaleString()} / −{tree.deletions.toLocaleString()}
            </dd>
          </div>
        )}
        {tree.lastCommit && (
          <div>
            <dt>Last commit</dt>
            <dd className="pw-mono">{tree.lastCommit}</dd>
          </div>
        )}
      </dl>
      {groups.length > 0 && (
        <div className="pw-uncommitted-groups">
          {multipleGroups && !developerPreview && (
            <div className="pw-uncommitted-scope">
              <strong>Choose what to carry forward</strong>
              <p className="pw-small">
                These changes look like separate pieces of work. Select only the group or groups you
                want to continue. The copied handoff will leave the rest out of scope.
              </p>
            </div>
          )}
          {groups.map((group, index) => (
            <article className="pw-uncommitted-group" key={group.title}>
              <div className="pw-uncommitted-group-heading">
                <div className="pw-uncommitted-group-title">
                  {multipleGroups && !developerPreview && (
                    <input
                      type="checkbox"
                      aria-label={`Include ${group.title}`}
                      checked={selectedGroups.includes(index)}
                      onChange={(event) =>
                        setSelectedGroups((current) =>
                          event.target.checked
                            ? [...current, index].sort((a, b) => a - b)
                            : current.filter((item) => item !== index),
                        )
                      }
                    />
                  )}
                  <h3>{group.title}</h3>
                </div>
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
        {onContinue && (
          <Button
            type="button"
            disabled={
              developerPreview || loading || (multipleGroups && selectedGroups.length === 0)
            }
            onClick={() => onContinue(multipleGroups ? selectedGroups : undefined)}
          >
            Copy handoff for new Codex session
          </Button>
        )}
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

function ProjectPage(props: ProjectProps & { dirtyWorkPreview: DirtyWorkPreviewScenario }) {
  return <ProjectNowProjectPage {...props} />;
}

function projectNowHeading(view: ProjectNowView): string {
  if (view.work) return view.work.title;
  if (view.primaryAction?.kind === 'review-release') return 'Review release and delivery';
  if (view.primaryAction?.kind === 'choose-next-work') return 'Choose what comes next';
  if (view.state === 'idle') return 'Nothing to do right now';
  if (view.state === 'disconnected') return 'Project disconnected';
  if (view.state === 'needs-direction') return 'Decide the current direction';
  if (view.state === 'choose-work') return 'Choose current work';
  if (view.state === 'choose-next-work') return 'Choose what comes next';
  if (view.state === 'complete') return 'Choose what comes next';
  return 'Current project state';
}

type ProjectNowActionEntry = {
  kind: PresentedProjectAction['kind'];
  selectionKey: string | null;
  requestId: string | null;
  releaseId: string | null;
  mode:
    | 'continue'
    | 'remaining'
    | 'verify'
    | 'policy'
    | 'review'
    | 'direction'
    | 'result'
    | 'new-work'
    | 'release';
};

function projectNowActionEntryMode(
  kind: PresentedProjectAction['kind'],
): ProjectNowActionEntry['mode'] {
  switch (kind) {
    case 'continue-work':
    case 'resume-work':
      return 'continue';
    case 'review-result':
    case 'open-request':
    case 'respond-to-request':
      return 'result';
    case 'review-direction':
    case 'define-direction':
      return 'direction';
    case 'choose-next-work':
      return 'new-work';
    case 'review-remaining-changes':
      return 'remaining';
    case 'discuss-work':
      return 'review';
    case 'review-release':
      return 'release';
    case 'review-work':
    case 'review-completion':
    case 'review-work-plan':
      return 'review';
    case 'reconnect-project':
    case 'start-work':
    case 'choose-current-work':
    case 'stop-work':
    case 'check-execution':
    case 'continue-despite-direction-conflict':
      throw new Error(`Project action ${kind} is handled before action-mode entry.`);
  }
}

function ProjectNowProjectPage({
  project,
  state,
  controller,
  onNavigate,
  dirtyWorkPreview,
}: ProjectProps & { dirtyWorkPreview: DirtyWorkPreviewScenario }) {
  const view = state.projectNow[project.id];
  const loading = state.projectNowLoading[project.id] ?? false;
  const initializing = state.projectNowInitializing[project.id] ?? false;
  const busy = state.busyWorkId === project.id;
  const edits = state.edits[project.id] ?? emptyEdits;
  const workingTree = state.workingTrees[project.id];
  const workingTreeLoading = state.workingTreeLoading[project.id] ?? false;
  const workingTreeAnalysisLoading = state.workingTreeAnalysisLoading[project.id] ?? false;
  const [mode, setMode] = useState<'default' | 'action'>('default');
  const [actionEntry, setActionEntry] = useState<ProjectNowActionEntry | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [checkingExecution, setCheckingExecution] = useState(false);
  const [executionCheckError, setExecutionCheckError] = useState('');
  const requestedNow = useRef(false);
  const pageMounted = useRef(false);

  useEffect(() => {
    pageMounted.current = true;
    return () => {
      pageMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!view && !loading && !state.error && !requestedNow.current) {
      requestedNow.current = true;
      void controller.readProjectNow(project.id);
    }
  }, [controller, loading, project.id, state.error, view]);

  useEffect(() => {
    if (view?.state !== 'waiting' || !view.work || state.decisions[project.id]) return;
    void controller.projectDecision(project.id).catch(() => {});
  }, [controller, project.id, state.decisions, view?.state, view?.work?.id]);

  const openActionMode = (
    kind: PresentedProjectAction['kind'],
    workItemId: string | null,
    requestId: string | null,
    releaseId: string | null = null,
  ) => {
    const targetWorkId = workItemId ?? view?.work?.id ?? null;
    setActionEntry({
      kind,
      selectionKey: targetWorkId,
      requestId,
      releaseId,
      mode: projectNowActionEntryMode(kind),
    });
    setMode('action');
  };

  const runAction = async (action: PresentedProjectAction) => {
    if (action.kind === 'reconnect-project') {
      await controller.restore(project.id);
      return;
    }
    if (action.kind === 'start-work' && action.workItemId) {
      await controller.selectWorkItem(project.id, action.workItemId);
      setOtherOpen(false);
      return;
    }
    if (action.kind === 'resume-work' && action.workItemId) {
      const resumed = await controller.resumeWorkItem(project.id, action.workItemId);
      if (resumed) openActionMode('continue-work', action.workItemId, action.requestId);
      return;
    }
    if (action.kind === 'choose-current-work') {
      setOtherOpen(true);
      return;
    }
    if (action.kind === 'stop-work' && action.workItemId) {
      await controller.stopWorkItem(project.id, action.workItemId);
      return;
    }
    if (action.kind === 'continue-despite-direction-conflict') {
      await controller.continueDirectionConflict(project.id);
      return;
    }
    if (action.kind === 'check-execution' && action.requestId) {
      if (checkingExecution) return;
      setCheckingExecution(true);
      setExecutionCheckError('');
      try {
        await controller.projectDecision(project.id, {
          action: 'sync',
          requestId: action.requestId,
        });
        await controller.readProjectNow(project.id, { quiet: true, initialize: false });
      } catch (cause) {
        if (pageMounted.current) setExecutionCheckError(projectError(cause));
      } finally {
        if (pageMounted.current) setCheckingExecution(false);
      }
      return;
    }
    if (
      (action.kind === 'open-request' || action.kind === 'respond-to-request') &&
      action.requestId
    ) {
      openActionMode('review-result', action.workItemId, action.requestId);
      return;
    }
    openActionMode(action.kind, action.workItemId, action.requestId, action.releaseId);
  };

  const chooseRecommendation = async () => {
    const recommendation = view?.recommendation;
    if (recommendation?.status !== 'recommended' || !recommendation.candidate) return;
    if (recommendation.candidate.source === 'proposal')
      await controller.selectProposal(project.id, recommendation.candidate.id);
    else await controller.selectWorkItem(project.id, recommendation.candidate.id);
    setOtherOpen(false);
  };

  const recommendationUsesPrimaryAction =
    view?.recommendation.status === 'recommended' &&
    view.recommendation.candidate?.source === 'work-item' &&
    view.primaryAction?.kind === 'start-work' &&
    view.primaryAction.workItemId === view.recommendation.candidate.id;
  // A recommendation plus a generic "choose current work" primary would render
  // two primary buttons. The recommendation carries the primary action; the
  // Next sentence keeps its context above it and secondaries stay available.
  const recommendationReplacesNext =
    view?.recommendation.status === 'recommended' &&
    !!view.recommendation.candidate &&
    view.primaryAction?.kind === 'choose-current-work';
  return (
    <div className="pw-project-detail pw-project-now-page">
      <RouteLink className="pw-project-back" href="#/projects" onNavigate={onNavigate}>
        <ArrowLeft size={15} aria-hidden="true" /> Back to projects
      </RouteLink>

      {project.bannerAsset && (
        <div className="pw-project-cover" aria-hidden="true">
          <img src={projectAssetUrl(project.bannerAsset)} alt="" />
        </div>
      )}

      <header className="pw-now-project-header">
        <div className="pw-card-meta">{project.focused && <Badge>Your focus</Badge>}</div>
        <div className="pw-now-project-identity">
          {project.iconAsset && (
            <img
              className="pw-project-title-icon"
              src={projectAssetUrl(project.iconAsset)}
              alt=""
              aria-hidden="true"
            />
          )}
          <h1 tabIndex={-1}>{project.title}</h1>
        </div>
      </header>

      <section className="pw-now-direction" aria-label="Project direction">
        <span className="pw-small">Current direction</span>
        <p>
          {view?.direction?.text ??
            ((!view?.bootstrap.directionDeferred && project.goal) ||
              project.purpose ||
              'No direction set.')}
        </p>
        {view && view.state !== 'disconnected' && (
          <Button
            className="pw-button pw-button--quiet"
            disabled={busy}
            onClick={() => openActionMode('define-direction', view.work?.id ?? null, null)}
          >
            Change direction
          </Button>
        )}
      </section>

      {view?.checking && (
        <p className="pw-now-checking" role="status">
          <LoaderCircle size={14} aria-hidden="true" /> Checking recent changes
        </p>
      )}
      {!view?.checking && workingTreeAnalysisLoading && (
        <p className="pw-now-checking" role="status">
          <LoaderCircle size={14} aria-hidden="true" /> Analyzing repository changes…
        </p>
      )}

      {mode === 'action' && view ? (
        <section className="pw-now-action-mode" aria-label="Current work action">
          <Button className="pw-button pw-button--quiet" onClick={() => setMode('default')}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to current work
          </Button>
          <div className="pw-now-mode-context">
            <span className="pw-small">
              {actionEntry?.mode === 'release' ? 'Release & delivery' : 'Current work'}
            </span>
            <strong>
              {actionEntry?.mode === 'release' ? project.title : projectNowHeading(view)}
            </strong>
          </div>
          {actionEntry ? (
            <ProjectNowActionMode
              project={project}
              controller={controller}
              data={state.decisions[project.id]}
              view={view}
              edits={edits}
              actionKind={actionEntry.kind}
              mode={actionEntry.mode}
              requestId={actionEntry.requestId}
              releaseId={actionEntry.releaseId}
              selectionKey={actionEntry.selectionKey}
              release={state.releases[project.id]}
              releaseLoading={state.releaseLoading[project.id] ?? false}
              onBack={() => setMode('default')}
              onVerify={() =>
                setActionEntry((entry) => (entry ? { ...entry, mode: 'verify' } : entry))
              }
              onPolicy={() =>
                setActionEntry((entry) => (entry ? { ...entry, mode: 'policy' } : entry))
              }
            />
          ) : (
            <p role="status">Choose an action from the current work.</p>
          )}
        </section>
      ) : view ? (
        <>
          <section className="pw-now-work" aria-labelledby="pw-now-work-title">
            <h2 id="pw-now-work-title">{projectNowHeading(view)}</h2>

            <p className="pw-now-current-state">{view.currentState}</p>

            {view.execution && (
              <div className="pw-now-execution-status">
                {view.execution.workItemId !== view.work?.id && (
                  <span className="pw-small">Request for {view.execution.workTitle}</span>
                )}
                <p role="status">{view.execution.text}</p>
                <div className="pw-now-actions">
                  {view.execution.actions.map((action) => (
                    <Button
                      key={`${action.kind}:${action.requestId ?? ''}`}
                      className="pw-button pw-button--quiet"
                      disabled={busy || (action.kind === 'check-execution' && checkingExecution)}
                      onClick={() => void runAction(action)}
                    >
                      {action.kind === 'check-execution' && checkingExecution
                        ? 'Checking execution state…'
                        : action.label}
                    </Button>
                  ))}
                </div>
                {executionCheckError && <p role="alert">{executionCheckError}</p>}
              </div>
            )}

            {view.stillToCheck && (
              <div className="pw-now-uncertainty">
                <span className="pw-small">Still to check</span>
                <p>{view.stillToCheck}</p>
              </div>
            )}

            {view.notice && (
              <aside
                className={cn('pw-now-notice', `pw-now-notice--${view.notice.level}`)}
                aria-label={view.notice.title}
              >
                <div>
                  <strong>
                    {view.notice.level !== 'quiet' && (
                      <TriangleAlert size={16} aria-hidden="true" className="pw-now-notice-icon" />
                    )}
                    {view.notice.title}
                  </strong>
                  <p>{view.notice.text}</p>
                  {view.notice.reason && <span className="pw-small">{view.notice.reason}</span>}
                </div>
                {view.notice.kind === 'result-ready' && (
                  <Button
                    className="pw-button pw-button--quiet"
                    disabled={busy}
                    onClick={() =>
                      openActionMode(
                        'review-result',
                        view.notice?.workItemId ?? null,
                        view.notice?.requestId ?? null,
                      )
                    }
                  >
                    Review result
                  </Button>
                )}
                {['release-ready', 'delivery-problem', 'release-confirmation'].includes(
                  view.notice.kind,
                ) && (
                  <Button
                    className="pw-button pw-button--quiet"
                    disabled={busy}
                    onClick={() =>
                      openActionMode('review-release', null, null, view.notice?.releaseId ?? null)
                    }
                  >
                    Review release
                  </Button>
                )}
              </aside>
            )}

            {recommendationReplacesNext && view.nextText && (
              <div className="pw-now-next">
                <span className="pw-small">Next</span>
                <p>{view.nextText}</p>
              </div>
            )}

            {view.recommendation.status === 'recommended' && view.recommendation.candidate && (
              <section className="pw-now-recommendation" aria-label="Suggested next work">
                <span className="pw-small">StateCarry suggests</span>
                <strong>{view.recommendation.candidate.title}</strong>
                <p>{view.recommendation.reason}</p>
                {view.recommendation.closeText && (
                  <p className="pw-now-recommendation-detail">{view.recommendation.closeText}</p>
                )}
                {view.recommendation.selectionText && (
                  <p className="pw-now-recommendation-detail">
                    {view.recommendation.selectionText}
                  </p>
                )}
                {view.recommendation.evidenceText && (
                  <details className="pw-now-recommendation-basis">
                    <summary>What is still unknown</summary>
                    <p>{view.recommendation.evidenceText}</p>
                  </details>
                )}
                {!recommendationUsesPrimaryAction && (
                  <Button
                    className="pw-button pw-button--primary"
                    disabled={busy}
                    onClick={() => void chooseRecommendation()}
                  >
                    Choose this work
                  </Button>
                )}
              </section>
            )}

            {view.recommendation.status === 'insufficient-evidence' && (
              <section
                className="pw-now-recommendation pw-now-recommendation--limited"
                aria-label="No suggested next work"
              >
                <span className="pw-small">No suggested next work yet</span>
                <p>{view.recommendation.reason}</p>
                {view.recommendation.evidenceText && (
                  <details className="pw-now-recommendation-basis">
                    <summary>What is still unknown</summary>
                    <p>{view.recommendation.evidenceText}</p>
                  </details>
                )}
              </section>
            )}

            {recommendationReplacesNext && view.secondaryActions.length > 0 && (
              <div className="pw-now-actions">
                {view.secondaryActions.map((action) => (
                  <Button
                    key={`${action.kind}:${action.workItemId ?? ''}:${action.requestId ?? ''}`}
                    className="pw-button pw-button--quiet"
                    disabled={busy}
                    onClick={() => void runAction(action)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}

            {!recommendationReplacesNext &&
              (!view.nextText || !view.primaryAction) &&
              view.secondaryActions.length > 0 && (
                <div className="pw-now-actions">
                  {view.secondaryActions.map((action) => (
                    <Button
                      key={`${action.kind}:${action.workItemId ?? ''}:${action.requestId ?? ''}`}
                      className="pw-button pw-button--quiet"
                      disabled={busy}
                      onClick={() => void runAction(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}

            {!recommendationReplacesNext && view.nextText && view.primaryAction && (
              <div className="pw-now-next">
                <span className="pw-small">Next</span>
                <p>{view.nextText}</p>
                <div className="pw-now-actions">
                  <Button
                    className="pw-button pw-button--primary"
                    disabled={busy}
                    onClick={() => void runAction(view.primaryAction!)}
                  >
                    {view.primaryAction.label}
                  </Button>
                  {view.secondaryActions.map((action) => (
                    <Button
                      key={`${action.kind}:${action.workItemId ?? ''}:${action.requestId ?? ''}`}
                      className="pw-button pw-button--quiet"
                      disabled={busy}
                      onClick={() => void runAction(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {view.otherWorkCount > 0 && (
            <section className="pw-now-other-work" aria-label="Other work">
              <details
                open={otherOpen}
                onToggle={(event) => setOtherOpen(event.currentTarget.open)}
              >
                <summary>Other work · {view.otherWorkCount}</summary>
                <div className="pw-now-other-work-list">
                  {view.otherWorkNotes.map((note) => (
                    <p className="pw-now-other-work-note" key={note}>
                      {note}
                    </p>
                  ))}
                  {view.otherWork.map((item) => (
                    <Button
                      key={item.id}
                      className="pw-now-other-work-item"
                      aria-label={`Choose ${item.title}`}
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void (item.source === 'proposal'
                          ? controller.selectProposal(project.id, item.id)
                          : controller.selectWorkItem(project.id, item.id))
                      }
                    >
                      <span>{item.title}</span>
                      <span className="pw-small">{item.statusLabel}</span>
                      {item.source === 'proposal' && <span>{item.currentState}</span>}
                      {item.source === 'proposal' && item.uncertainty && (
                        <span className="pw-small">{item.uncertainty}</span>
                      )}
                      {item.source === 'proposal' && item.nextAction && (
                        <span className="pw-small">{item.nextAction}</span>
                      )}
                    </Button>
                  ))}
                </div>
              </details>
            </section>
          )}

          <section className="pw-context-section" aria-labelledby="project-context-heading">
            <details className="pw-context-disclosure">
              <summary id="project-context-heading">Project context</summary>
              <div className="pw-context-list">
                {dirtyWorkPreview !== 'off' ? (
                  <details className="pw-context-item">
                    <summary>Working tree preview</summary>
                    <UncommittedWorkPreview scenario={dirtyWorkPreview} />
                  </details>
                ) : workingTree && workingTree.kind !== 'clean' ? (
                  <details className="pw-context-item">
                    <summary>
                      Repository changes · {workingTree.fileCount} file
                      {workingTree.fileCount === 1 ? '' : 's'}
                    </summary>
                    <WorkingTreeCard tree={workingTree} loading={workingTreeLoading} />
                  </details>
                ) : workingTreeLoading ? (
                  <div className="pw-context-item">
                    <strong>Repository changes</strong>
                    <span className="pw-small">Checking the current project state…</span>
                  </div>
                ) : null}
                <div className="pw-context-item">
                  <strong>Overview</strong>
                  <div className="pw-actions">
                    <OverviewDate value={project.generatedAt} />
                    <Button
                      className="pw-button pw-button--quiet"
                      disabled={!project.canRefresh || busy}
                      onClick={() => void controller.prepare(project.id)}
                    >
                      Update overview
                    </Button>
                  </div>
                </div>
                <div className="pw-context-item">
                  <strong>Sources</strong>
                  <span className="pw-small">
                    Project files · Git · optional Codex conversations
                  </span>
                  <RouteLink href={`${projectHref(project.id)}/settings`} onNavigate={onNavigate}>
                    Project settings
                  </RouteLink>
                </div>
                <div className="pw-context-item">
                  <strong>Release & delivery</strong>
                  <span className="pw-small">
                    Keep implementation completion separate from delivery state.
                  </span>
                  <Button
                    className="pw-button pw-button--quiet"
                    disabled={busy}
                    onClick={() => openActionMode('review-release', null, null, null)}
                  >
                    Review release
                  </Button>
                </div>
              </div>
            </details>
          </section>
        </>
      ) : loading ? (
        <section className="pw-now-loading" role="status">
          <LoaderCircle size={16} aria-hidden="true" />
          <div>
            <strong>
              {initializing
                ? 'Analyzing this project for the first time…'
                : 'Reading project state…'}
            </strong>
            <p>
              {initializing
                ? 'StateCarry is checking the current project before creating its first work view.'
                : 'StateCarry is preparing the current work view.'}
            </p>
          </div>
        </section>
      ) : (
        <section className="pw-now-loading">
          <div>
            <strong>StateCarry could not prepare this project.</strong>
            <p>Try again to check the current project and prepare its work view.</p>
            <Button
              className="pw-button"
              onClick={() => {
                requestedNow.current = true;
                void controller.readProjectNow(project.id);
              }}
            >
              Try again
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function OriginalInspection({ project, state, onNavigate }: ProjectProps) {
  const inspection = state.inspection?.projectId === project.id ? state.inspection : null;
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
        <RouteLink className="pw-button" href={projectHref(project.id)} onNavigate={onNavigate}>
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

function ResponseLanguageField({
  value,
  disabled,
  onChange,
}: {
  value: 'en' | 'ko';
  disabled: boolean;
  onChange: (value: 'en' | 'ko') => void;
}) {
  return (
    <label className="pw-field">
      Response language
      <select
        name="response-language"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === 'ko' ? 'ko' : 'en')}
      >
        <option value="en">English</option>
        <option value="ko">한국어</option>
      </select>
      <span className="pw-field-help">
        Applies to future answers and overviews. Existing results stay unchanged.
      </span>
    </label>
  );
}

function CreateProject({ controller, onNavigate }: WorkspaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [title, setTitle] = useState('');
  const [cwd, setCwd] = useState('');
  const [purpose, setPurpose] = useState('');
  const [responseLanguage, setResponseLanguage] = useState<'en' | 'ko'>('en');
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
      responseLanguage,
      ...(goal.trim() ? { goal: goal.trim() } : {}),
      threadIds: [],
      startTurnIds: {},
      recordRanges: {},
      discover: false,
    };
    const result = await controller.create(input);
    if (!result || !mounted.current || controller.getSnapshot().route.page !== 'new') return;
    if (result.reused) {
      const project = controller
        .getSnapshot()
        .projects.find((entry) => entry.id === result.projectId);
      setReusedProject({ id: result.projectId, title: project?.title ?? 'the saved project' });
    } else onNavigate(projectHref(result.projectId));
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
              Open {existing.title} to continue. Its saved purpose, goal, overview, work, and Codex
              conversations are kept.
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
            <ResponseLanguageField
              value={responseLanguage}
              disabled={busy}
              onChange={setResponseLanguage}
            />
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
            {value.threadIds.length >= 30 && ' · Up to 30 conversations can be connected.'}
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
                        aria-label={`Read this conversation from ${thread.title}`}
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
    responseLanguage: project.responseLanguage ?? 'en',
    focused: project.focused,
    iconAsset: project.iconAsset,
    bannerAsset: project.bannerAsset,
    revision: project.revision,
  });
  const [sourceDraft, setSourceDraft] = useState<{
    input: ProjectSourcesInput;
    inherited?: SourceScope;
    revision: number;
    loaded: boolean;
  }>({ input: initialSources(), revision: project.revision, loaded: false });
  const [sourceError, setSourceError] = useState<{ message: string; retryable: boolean } | null>(
    null,
  );
  const [loadingSources, setLoadingSources] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [assetBusy, setAssetBusy] = useState<'icon' | 'banner' | null>(null);
  const [assetError, setAssetError] = useState('');
  const mounted = useRef(true);
  const sourceRequest = useRef(0);
  const preview = state.deletion?.projectId === project.id ? state.deletion : null;
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
    setSourceError(null);
    try {
      const connections = await controller.connections();
      if (!mounted.current || generation !== sourceRequest.current) return;
      const connection = connections.find((item) => item.projectId === project.id);
      if (!connection) {
        setSourceError({
          message: 'Codex conversation settings could not be found. Try again.',
          retryable: true,
        });
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
        setSourceError({ message: projectError(failure), retryable: true });
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
        responseLanguage: submitted.responseLanguage,
        focused: submitted.focused,
        iconAsset: submitted.iconAsset,
        bannerAsset: submitted.bannerAsset,
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
  const chooseAsset = async (kind: 'icon' | 'banner') => {
    if (assetBusy) return;
    setAssetBusy(kind);
    setAssetError('');
    try {
      const assetRef = await controller.chooseProjectAsset(project.id, kind);
      if (!mounted.current || !assetRef) return;
      setProfile((current) => ({
        ...current,
        ...(kind === 'icon' ? { iconAsset: assetRef } : { bannerAsset: assetRef }),
      }));
    } catch {
      if (mounted.current)
        setAssetError('The selected image could not be added. Try another file.');
    } finally {
      if (mounted.current) setAssetBusy(null);
    }
  };
  const saveSources = async () => {
    const submitted = sourceDraft;
    const input = selectedSources(submitted.input);
    if (!validSourceRanges(input)) {
      // A validation error describes the current draft, so reloading sources
      // would discard the user's unsaved edits. Only load failures may retry.
      setSourceError({
        message: 'Complete the required IDs for the advanced conversation range, or remove it.',
        retryable: false,
      });
      return;
    }
    setSourceError(null);
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
    if (saved && route.page === 'settings' && route.projectId === project.id) onNavigate('#/home');
  };
  const previewRemoval = async () => {
    setPreviewing(true);
    await controller.previewDeletion(project.id);
    if (mounted.current) setPreviewing(false);
  };
  const remove = async () => {
    const removed = await controller.remove(project.id);
    const route = controller.getSnapshot().route;
    if (removed && route.page === 'settings' && route.projectId === project.id)
      onNavigate('#/home');
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
            <ResponseLanguageField
              value={profile.responseLanguage}
              disabled={busy}
              onChange={(responseLanguage) => setProfile({ ...profile, responseLanguage })}
            />
            <div className="pw-project-assets">
              <div className="pw-project-asset-setting">
                <div className="pw-project-asset-preview pw-project-asset-preview--icon">
                  {profile.iconAsset ? (
                    <img
                      src={projectAssetUrl(profile.iconAsset)}
                      alt="Project icon preview"
                      decoding="async"
                      loading="lazy"
                    />
                  ) : (
                    <Folder aria-hidden="true" />
                  )}
                </div>
                <div className="pw-setting-copy">
                  <strong>Project icon</strong>
                  <span className="pw-small">Shown with this project across StateCarry.</span>
                </div>
                <div className="pw-actions">
                  <Button
                    type="button"
                    className="pw-button"
                    disabled={!!assetBusy}
                    onClick={() => void chooseAsset('icon')}
                  >
                    {assetBusy === 'icon'
                      ? 'Choosing…'
                      : profile.iconAsset
                        ? 'Replace'
                        : 'Choose image'}
                  </Button>
                  {profile.iconAsset && (
                    <Button
                      type="button"
                      className="pw-button pw-button--quiet"
                      disabled={!!assetBusy}
                      onClick={() => setProfile({ ...profile, iconAsset: null })}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <div className="pw-project-asset-setting">
                <div className="pw-project-asset-preview pw-project-asset-preview--banner">
                  {profile.bannerAsset ? (
                    <img
                      src={projectAssetUrl(profile.bannerAsset)}
                      alt="Project banner preview"
                      decoding="async"
                      loading="lazy"
                    />
                  ) : (
                    <span className="pw-small">No banner</span>
                  )}
                </div>
                <div className="pw-setting-copy">
                  <strong>Project banner</strong>
                  <span className="pw-small">Used as the visual banner for this project.</span>
                </div>
                <div className="pw-actions">
                  <Button
                    type="button"
                    className="pw-button"
                    disabled={!!assetBusy}
                    onClick={() => void chooseAsset('banner')}
                  >
                    {assetBusy === 'banner'
                      ? 'Choosing…'
                      : profile.bannerAsset
                        ? 'Replace'
                        : 'Choose image'}
                  </Button>
                  {profile.bannerAsset && (
                    <Button
                      type="button"
                      className="pw-button pw-button--quiet"
                      disabled={!!assetBusy}
                      onClick={() => setProfile({ ...profile, bannerAsset: null })}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              {assetError && (
                <p className="pw-notice" role="alert">
                  {assetError}
                </p>
              )}
            </div>
            <div className="pw-setting-row">
              <div className="pw-setting-copy">
                <strong>Home focus</strong>
                <span className="pw-small">
                  Keep this project on Home. Up to three projects can be in focus at a time.
                </span>
              </div>
              <label className="pw-checkbox">
                <input
                  type="checkbox"
                  checked={profile.focused}
                  onChange={(event) => setProfile({ ...profile, focused: event.target.checked })}
                />
                Keep in Home focus
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
                  <p>{sourceError.message}</p>
                  {sourceError.retryable && (
                    <Button
                      className="pw-button"
                      disabled={loadingSources}
                      onClick={() => void readSources()}
                    >
                      Try again
                    </Button>
                  )}
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
              : 'Disconnect this project to stop StateCarry from checking for new project information. Its saved goal, overview, work, and choices remain.'}
          </p>
          <p className="pw-small">Project files and original Codex conversations stay unchanged.</p>
          <Button
            className="pw-button"
            disabled={!state.online || busy}
            onClick={() =>
              project.disconnected ? void controller.restore(project.id) : void disconnect()
            }
          >
            {project.disconnected
              ? busy
                ? 'Reconnecting…'
                : 'Reconnect project'
              : 'Disconnect project'}
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
            <div className="pw-stack" role="region" aria-label="Deletion preview">
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
