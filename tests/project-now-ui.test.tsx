// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectExecutionCommandSchema } from '@statecarry/contracts';
import type {
  Continuation,
  ProjectExecutionCommand,
  ProjectExecutionWorkspace,
  ProjectModelView,
  ProjectNow,
  ReleaseProjectView,
} from '@statecarry/contracts';
import {
  act,
  button,
  installBrowser,
  mountProjectRoot,
  now,
  press,
  projectEntry,
  projectUiFixture,
  settle,
  toggleDetails,
  typeField,
} from './project-ui-fixtures';

const noRecommendation: ProjectNow['recommendation'] = {
  status: 'none',
  candidate: null,
  action: null,
  reason: null,
  confidence: null,
  close: false,
  closeAlternatives: [],
  selectionState: 'not-applicable',
  evidenceGaps: [],
};

const storageValues = new Map<string, string>();
const storage: Storage = {
  get length() {
    return storageValues.size;
  },
  clear() {
    storageValues.clear();
  },
  getItem(key) {
    return storageValues.get(key) ?? null;
  },
  key(index) {
    return [...storageValues.keys()][index] ?? null;
  },
  removeItem(key) {
    storageValues.delete(key);
  },
  setItem(key, value) {
    storageValues.set(key, value);
  },
};

beforeEach(() => {
  installBrowser();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  storage.clear();
});
afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

function bundle() {
  const model: ProjectModelView = {
    project: {
      id: 'alpha',
      connectionId: 'connection-alpha',
      title: 'Project alpha',
      cwd: '/synthetic/alpha',
      purposes: [
        {
          id: 'purpose-alpha',
          text: 'Make exported work understandable when returning.',
          origin: 'user',
          confirmed: true,
        },
      ],
      focused: false,
      iconAsset: null,
      bannerAsset: null,
      lifecycle: 'active',
      revision: 7,
      createdAt: now,
    },
    directions: [
      {
        id: 'direction-alpha',
        projectId: 'alpha',
        text: 'Improve the project return experience.',
        state: 'active',
        primary: true,
        origin: 'user',
        confirmed: true,
        createdAt: now,
      },
    ],
    workItems: [
      {
        id: 'work-a',
        projectId: 'alpha',
        title: 'Improve the return screen',
        state: 'active',
        origin: 'user',
        completionCondition: null,
        completionConditionOrigin: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'work-b',
        projectId: 'alpha',
        title: 'Small follow-up cleanup',
        state: 'paused',
        origin: 'user',
        completionCondition: null,
        completionConditionOrigin: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    relations: [],
    decisions: [
      {
        id: 'link-work-a',
        projectId: 'alpha',
        workItemId: 'work-a',
        kind: 'link-work-proposal',
        value: { proposalKey: 'analysis:first' },
        basis: [],
        state: 'valid',
        decidedAt: now,
      },
      {
        id: 'link-work-b',
        projectId: 'alpha',
        workItemId: 'work-b',
        kind: 'link-work-proposal',
        value: { proposalKey: 'analysis:second' },
        basis: [],
        state: 'valid',
        decidedAt: now,
      },
    ],
    returnPoints: [],
    discussions: [],
    latestObservation: null,
  };
  const current = (workItemId: string): ProjectNow => ({
    projectId: 'alpha',
    primaryDirectionId: 'direction-alpha',
    currentWorkId: workItemId,
    currentWorkSelection: 'user',
    state: workItemId === 'work-b' ? 'paused' : 'active',
    currentState:
      workItemId === 'work-b'
        ? 'The cleanup is paused at a safe point.'
        : 'The new return layout is implemented and ready for behavior review.',
    uncertainty:
      workItemId === 'work-b'
        ? 'One small check remains.'
        : 'The return transition still needs one behavior check.',
    next:
      workItemId === 'work-b'
        ? { kind: 'resume-work', workItemId: 'work-b', text: 'Resume Small follow-up cleanup.' }
        : { kind: 'continue-work', workItemId: 'work-a', text: 'Check the return transition.' },
    secondaryActions:
      workItemId === 'work-b'
        ? [{ kind: 'stop-work', workItemId: 'work-b', text: 'Stop Small follow-up cleanup.' }]
        : [
            {
              kind: 'review-work',
              workItemId: 'work-a',
              text: 'Review the current state of Improve the return screen.',
            },
            { kind: 'stop-work', workItemId: 'work-a', text: 'Stop Improve the return screen.' },
          ],
    notice: null,
    otherWorkCount: 1,
    otherWorkCounts: { total: 1, progress: 1, completionReview: 0, evidenceConflict: 0 },
    otherWorkCandidates: model.workItems
      .filter((item) => item.id !== workItemId)
      .map((item) => ({
        id: item.id,
        title: item.title,
        state: item.state,
        source: 'work-item' as const,
        disposition: 'progress' as const,
      })),
    recommendation: { ...noRecommendation, selectionState: 'current-retained' },
    freshness: 'current',
    proposalMatches: [],
  });
  return { model, current };
}

function decision(): ProjectExecutionWorkspace {
  return {
    analysisCurrent: true,
    scopeCurrent: true,
    record: {
      id: 'alpha',
      projectId: 'alpha',
      version: 0,
      observation: {
        basis: 'scope-a',
        checkedAt: now,
        complete: true,
        scopes: [],
        limitations: [],
      },
      observedWorkspaceBasis: 'semantic-a',
      kept: [],
      corrections: {},
      direction: { text: 'Improve the project return experience.', status: 'confirmed', at: now },
      policyConflict: null,
      requests: [],
      accepted: [],
      comparisons: {},
    },
    workspace: {
      cwd: '/synthetic/alpha',
      branch: 'main',
      commit: 'synthetic-commit',
      dirty: false,
      status: 'checked',
      checkedAt: now,
      limitations: [],
    },
    requests: [],
    capability: {
      create: 'supported',
      send: 'supported',
      detail: 'Synthetic session actions are available.',
      verifiedAt: now,
    },
  };
}

function scopedDecision(): ProjectExecutionWorkspace {
  const data = decision();
  data.record.observation = {
    basis: 'scope-a',
    checkedAt: now,
    complete: true,
    limitations: [],
    scopes: [
      {
        id: 'scope-a-1',
        path: 'src/export.ts',
        layer: 'unstaged',
        kind: 'hunk',
        description: '@@ export behavior @@',
        patch: '+selected change',
      },
    ],
  };
  data.scopeCurrent = true;
  data.workspace = {
    ...(data.workspace ?? {
      cwd: '/synthetic/alpha',
      status: 'checked',
      checkedAt: now,
      branch: 'main',
      commit: 'synthetic-commit',
      dirty: true,
      limitations: [],
    }),
    dirty: true,
    changedPaths: ['src/export.ts'],
  };
  return data;
}

function preparedRequest(
  command: Extract<ProjectExecutionCommand, { action: 'prepare' }>,
): Continuation {
  return {
    id: 'request-native',
    projectId: 'alpha',
    requestId: 'request-native-command',
    state: 'prepared',
    threadId: null,
    turnId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    preparedText: command.text,
    target: {
      mode: 'new-session',
      threadId: null,
      title: 'Native ProjectNow request',
      projectId: 'alpha',
      expectedRevision: 7,
      payload: {
        goal: null,
        currentState: '',
        nextAction: command.text,
        doneWhen: command.doneWhen,
        constraints: [],
        projectContext: command.context,
      },
    },
  };
}

function nativeDecisionLifecycle(
  h: ReturnType<typeof projectUiFixture>,
  initial: ProjectExecutionWorkspace = scopedDecision(),
  options: { completeOnSync?: boolean } = {},
) {
  let data = structuredClone(initial);
  const decisionGateway = vi.fn(async (_id: string, command?: ProjectExecutionCommand) => {
    if (command?.action === 'prepare') {
      const request = preparedRequest(command);
      data = { ...data, record: { ...data.record, requests: [request.id] }, requests: [request] };
    }
    if (command?.action === 'keep')
      data = {
        ...data,
        record: {
          ...data.record,
          kept: [
            ...data.record.kept,
            {
              id: 'keep-native',
              scopeIds: command.scopeIds,
              scopes:
                data.record.observation?.scopes.filter((scope) =>
                  command.scopeIds.includes(scope.id),
                ) ?? [],
              at: now,
            },
          ],
        },
      };
    if (command?.action === 'send')
      data = {
        ...data,
        requests: data.requests.map((request) =>
          request.id === command.requestId
            ? {
                ...request,
                state: 'sent' as const,
                threadId: 'thread-native',
                turnId: 'turn-native',
              }
            : request,
        ),
      };
    if (command?.action === 'sync' && options.completeOnSync)
      data = {
        ...data,
        requests: data.requests.map((request) =>
          request.id === command.requestId
            ? {
                ...request,
                state: 'sent' as const,
                execution: {
                  status: 'completed' as const,
                  report: 'The native check was reported.',
                  error: null,
                  questions: [],
                },
              }
            : request,
        ),
      };
    if (command?.action === 'compare')
      data = {
        ...data,
        record: {
          ...data.record,
          comparisons: {
            ...data.record.comparisons,
            [command.requestId]: {
              basis: data.record.observation?.basis ?? 'scope-a',
              checkedAt: now,
              remaining: [],
              changed: ['scope-a-1'],
            },
          },
        },
      };
    return structuredClone(data);
  });
  h.projectGateway.execution = decisionGateway;
  return {
    decisionGateway,
    getData: () => data,
    setData: (next: ProjectExecutionWorkspace) => {
      data = structuredClone(next);
    },
  };
}

it('switches explicitly to verification and preserves its request without requiring a large diff', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const model = bundle();
  model.model.workItems[0].completionCondition = 'The result is recorded.';
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(model.model),
    now: model.current('work-a'),
  }));
  const partial = decision();
  partial.record.observation = {
    basis: 'scope-a',
    checkedAt: now,
    complete: false,
    inventoryComplete: true,
    scopes: [],
    files: [
      {
        id: 'large',
        path: 'large.ts',
        layer: 'unstaged',
        detail: 'unread',
        limitation: 'Read this file separately.',
      },
    ],
    limitations: [],
  };
  const lifecycle = nativeDecisionLifecycle(h, partial);
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    expect(mounted.host.textContent).toContain('large.ts');
    expect(mounted.host.textContent).not.toContain(
      'No existing local changes need to be included.',
    );
    await typeField(
      mounted.host,
      '[aria-label="Review request"] textarea',
      'Run rtk pnpm verify and report the result.',
    );
    await press(mounted.host, 'Check current behavior');
    expect(mounted.host.querySelector('.pw-decision-scopes')).toBeNull();
    expect(mounted.host.textContent).toContain(
      'I reviewed the verification request and completion condition.',
    );
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')!
        .value,
    ).toBe('Run rtk pnpm verify and report the result.');
    const confirm = mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!;
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    await press(mounted.host, 'Prepare request for Codex');
    expect(
      lifecycle.decisionGateway.mock.calls.find(
        ([, command]) => command?.action === 'prepare',
      )?.[1],
    ).toMatchObject({
      action: 'prepare',
      text: 'Run rtk pnpm verify and report the result.',
      context: { operation: 'verify', scopeIds: [], workItemId: 'work-a' },
    });
    expect(
      lifecycle.decisionGateway.mock.calls.some(([, command]) => command?.action === 'send'),
    ).toBe(false);
  } finally {
    await mounted.unmount();
  }
});

it('shows unavailable inventory honestly and lets a successful reread reset stale confirmation', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const model = bundle();
  model.model.workItems[0].completionCondition = 'The result is recorded.';
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(model.model),
    now: model.current('work-a'),
  }));
  const unavailable = decision();
  unavailable.record.observation = {
    basis: 'unavailable',
    checkedAt: now,
    complete: false,
    inventoryComplete: false,
    files: [],
    scopes: [],
    limitations: ['Could not read the project.'],
  };
  const lifecycle = nativeDecisionLifecycle(h, unavailable);
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    expect(mounted.host.textContent).toContain('The changed-file list could not be read.');
    expect(mounted.host.textContent).not.toContain(
      'No existing local changes need to be included.',
    );
    expect(
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!.disabled,
    ).toBe(true);
    await typeField(
      mounted.host,
      '[aria-label="Review request"] textarea',
      'Keep this request after retry.',
    );
    lifecycle.setData(scopedDecision());
    await press(mounted.host, 'Read the current change scope');
    const confirm = mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!;
    expect(confirm.disabled).toBe(false);
    expect(confirm.checked).toBe(false);
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')!
        .value,
    ).toBe('Keep this request after retry.');
    await act(async () => confirm.click());
    await press(mounted.host, 'Prepare request for Codex');
    expect(
      lifecycle.decisionGateway.mock.calls.find(
        ([, command]) => command?.action === 'prepare',
      )?.[1],
    ).toMatchObject({ context: { basis: 'scope-a' } });
  } finally {
    await mounted.unmount();
  }
});

it('loads a file separately before offering its exact changes for selection', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const model = bundle();
  model.model.workItems[0].completionCondition = 'The result is recorded.';
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(model.model),
    now: model.current('work-a'),
  }));
  const partial = decision();
  partial.record.observation = {
    basis: 'scope-a',
    checkedAt: now,
    complete: false,
    inventoryComplete: true,
    scopes: [],
    files: [
      {
        id: 'large',
        path: 'src/export.ts',
        layer: 'unstaged',
        detail: 'unread',
        limitation: 'Read separately.',
      },
    ],
    limitations: [],
  };
  const lifecycle = nativeDecisionLifecycle(h, partial);
  const gateway = h.projectGateway.execution;
  h.projectGateway.execution = vi.fn(async (...args: Parameters<typeof gateway>) => {
    if (args[1]) projectExecutionCommandSchema.parse(args[1]);
    if (args[1]?.action === 'read-scope-file') lifecycle.setData(scopedDecision());
    return gateway(...args);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    expect(mounted.host.querySelector('.pw-decision-scopes input')).toBeNull();
    await press(mounted.host, 'Read changes in src/export.ts (unstaged)');
    expect(h.projectGateway.execution).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({
        action: 'read-scope-file',
        basis: 'scope-a',
        path: 'src/export.ts',
        layer: 'unstaged',
      }),
      expect.any(Number),
      'en',
    );
    const checkbox = mounted.host.querySelector<HTMLInputElement>('.pw-decision-scopes input')!;
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    await act(async () =>
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!.click(),
    );
    await press(mounted.host, 'Prepare request for Codex');
    expect(
      lifecycle.decisionGateway.mock.calls.find(
        ([, command]) => command?.action === 'prepare',
      )?.[1],
    ).toMatchObject({ context: { scopeIds: ['scope-a-1'] } });
  } finally {
    await mounted.unmount();
  }
});

function returnedRequest(id: string, report: string): Continuation {
  return {
    id,
    projectId: 'alpha',
    requestId: `${id}-command`,
    state: 'result-unknown',
    threadId: null,
    turnId: null,
    error: null,
    externalReport: report,
    createdAt: now,
    updatedAt: now,
    target: {
      mode: 'new-session',
      threadId: null,
      title: id,
      projectId: 'alpha',
      expectedRevision: 7,
      payload: {
        goal: null,
        currentState: '',
        nextAction: `Continue ${id}`,
        doneWhen: `${id} is done`,
        constraints: [],
        projectContext: { basis: 'scope-a', scopeIds: [], operation: 'continue' },
      },
    },
  };
}

it('renders ProjectNow as the only project page and loads execution data only inside an action mode', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('.pw-now-project-identity h1')?.textContent).toBe(
      'Project alpha',
    );
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    expect(mounted.host.querySelector('.pw-now-current-state')?.textContent).toBe(
      'The new return layout is implemented and ready for behavior review.',
    );
    expect(mounted.host.querySelector('.pw-now-uncertainty')?.textContent).toContain(
      'The return transition still needs one behavior check.',
    );
    expect(mounted.host.querySelector('.pw-now-next')?.textContent).toContain(
      'Check the return transition.',
    );
    expect(mounted.host.querySelector('[aria-label="Current project decision"]')).toBeNull();
    expect(h.projectGateway.execution).not.toHaveBeenCalled();

    await press(mounted.host, 'Review work');
    await settle();
    await settle();
    expect(mounted.host.textContent).toContain('Back to current work');
    expect(mounted.host.querySelector('[aria-label="Current work action"]')).toBeTruthy();
    expect(mounted.host.querySelector('[aria-label="Review current work"]')).toBeTruthy();
    expect(mounted.host.querySelector('[aria-label="Current project decision"]')).toBeNull();
    expect(h.projectGateway.execution).not.toHaveBeenCalled();

    await press(mounted.host, 'Check current behavior');
    await settle();
    await settle();
    await settle();
    await settle();
    expect(h.projectGateway.execution).toHaveBeenCalled();

    await press(mounted.host, 'Back to current work');
    expect(mounted.host.querySelector('[aria-label="Current work action"]')).toBeNull();
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
  } finally {
    await mounted.unmount();
  }
});

it('opens Continue work directly on the linked legacy work request instead of the generic chooser', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    await settle();
    await settle();
    expect(mounted.host.querySelector('[aria-label="Review request"]')?.textContent).toContain(
      'Continue this work',
    );
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')
        ?.value,
    ).toBe('Check the return transition.');
  } finally {
    await mounted.unmount();
  }
});

it('keeps native scope confirmation, request preparation, and sending as separate actions', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  const lifecycle = nativeDecisionLifecycle(h);
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    await settle();
    expect(button(mounted.host, 'Prepare request for Codex').disabled).toBe(true);
    await typeField(
      mounted.host,
      '.pw-decision-review label.pw-field:nth-of-type(2) textarea',
      'The selected return behavior is checked and reported.',
    );
    await act(async () => {
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-scopes input')!.click();
    });
    await settle();
    const confirmation = mounted.host.querySelector<HTMLInputElement>(
      '.pw-decision-confirm input',
    )!;
    await vi.waitFor(() => expect(confirmation.disabled).toBe(false));
    await act(async () => {
      confirmation.click();
    });
    await settle();
    await vi.waitFor(() =>
      expect(button(mounted.host, 'Prepare request for Codex').disabled).toBe(false),
    );
    await press(mounted.host, 'Prepare request for Codex');
    expect(
      lifecycle.decisionGateway.mock.calls.some(([, command]) => command?.action === 'send'),
    ).toBe(false);
    expect(
      lifecycle.decisionGateway.mock.calls.find(
        ([, command]) => command?.action === 'prepare',
      )?.[1],
    ).toMatchObject({
      context: {
        basis: 'scope-a',
        scopeIds: ['scope-a-1'],
        operation: 'continue',
        workItemId: 'work-a',
      },
    });
    await press(mounted.host, 'Send to a new Codex conversation');
    expect(
      lifecycle.decisionGateway.mock.calls.filter(([, command]) => command?.action === 'send'),
    ).toHaveLength(1);
  } finally {
    await mounted.unmount();
  }
});

it('restores an unsent native request draft after leaving and reopening the project', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  nativeDecisionLifecycle(h);
  window.history.replaceState(null, '', '#/project/alpha');
  let mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  await press(mounted.host, 'Continue work');
  await typeField(
    mounted.host,
    '[aria-label="Review request"] textarea',
    'Check my particular return case.',
  );
  await mounted.unmount();

  mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')
        ?.value,
    ).toBe('Check my particular return case.');
  } finally {
    await mounted.unmount();
  }
});

it('records selected changes as intentionally left without sending or completing work', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  const lifecycle = nativeDecisionLifecycle(h);
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    await act(async () => {
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-scopes input')!.click();
    });
    await settle();
    await act(async () => {
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!.click();
    });
    await settle();
    await toggleDetails(mounted.host, 'More options');
    await press(mounted.host, 'Leave selected changes and move on');
    expect(
      lifecycle.decisionGateway.mock.calls.find(([, command]) => command?.action === 'keep')?.[1],
    ).toMatchObject({ basis: 'scope-a', scopeIds: ['scope-a-1'] });
    expect(
      lifecycle.decisionGateway.mock.calls.some(([, command]) => command?.action === 'send'),
    ).toBe(false);
  } finally {
    await mounted.unmount();
  }
});

it('preserves native request text but invalidates confirmation when the scope basis changes', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  const lifecycle = nativeDecisionLifecycle(h);
  let notify: Parameters<NonNullable<typeof h.analysisGateway.subscribe>>[0] | undefined;
  h.analysisGateway.subscribe = (listener) => {
    notify = listener;
    return () => {};
  };
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    await typeField(
      mounted.host,
      '[aria-label="Review request"] textarea',
      'Preserve this exact request text.',
    );
    await act(async () => {
      mounted.host.querySelector<HTMLInputElement>('.pw-decision-confirm input')!.click();
    });
    await settle();
    const changed = lifecycle.getData();
    lifecycle.setData({
      ...changed,
      scopeCurrent: false,
      record: {
        ...changed.record,
        observation: { ...changed.record.observation!, basis: 'scope-b' },
      },
    });
    await act(async () => {
      notify?.({ projectId: 'alpha' });
    });
    await settle();
    expect(button(mounted.host, 'Prepare request for Codex').disabled).toBe(true);
    expect(mounted.host.textContent).toContain(
      'The project changed. Your request text is preserved',
    );
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')
        ?.value,
    ).toBe('Preserve this exact request text.');
  } finally {
    await mounted.unmount();
  }
});

it('automatically compares the current project when a native execution reports completion', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  const lifecycle = nativeDecisionLifecycle(h, scopedDecision(), { completeOnSync: true });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Continue work');
    await typeField(
      mounted.host,
      '.pw-decision-review label.pw-field:nth-of-type(2) textarea',
      'The native continuation check is complete and reported.',
    );
    const confirmation = mounted.host.querySelector<HTMLInputElement>(
      '.pw-decision-confirm input',
    )!;
    await vi.waitFor(() => expect(confirmation.disabled).toBe(false));
    await act(async () => confirmation.click());
    await settle();
    await vi.waitFor(() =>
      expect(button(mounted.host, 'Prepare request for Codex').disabled).toBe(false),
    );
    await press(mounted.host, 'Prepare request for Codex');
    await press(mounted.host, 'Send to a new Codex conversation');
    await vi.waitFor(() =>
      expect(
        lifecycle.decisionGateway.mock.calls.filter(([, command]) => command?.action === 'sync'),
      ).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(
        lifecycle.decisionGateway.mock.calls.filter(([, command]) => command?.action === 'compare'),
      ).toHaveLength(1),
    );
    expect(mounted.host.textContent).toContain('Observed after the request');
  } finally {
    await mounted.unmount();
  }
});

it('stops the durable current work through Core without reopening generated-task UI', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let stopped = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === 'work-a' && stopped ? { ...item, state: 'stopped' as const } : item,
      ),
    },
    now: stopped
      ? {
          ...data.current('work-a'),
          state: 'stopped' as const,
          currentState: 'This work was stopped by you.',
          uncertainty: null,
          next: {
            kind: 'choose-next-work' as const,
            text: 'Decide the next work for this direction.',
          },
          secondaryActions: [],
        }
      : data.current('work-a'),
  }));
  h.projectGateway.stopWork = vi.fn(async (_id, _revision, workItemId) => {
    stopped = true;
    return {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === workItemId ? { ...item, state: 'stopped' as const } : item,
      ),
    };
  });
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Stop work');
    expect(h.projectGateway.stopWork).toHaveBeenCalledWith('alpha', 7, 'work-a');
    expect(h.projectGateway.execution).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    expect(mounted.host.querySelector('.pw-now-current-state')?.textContent).toBe(
      'This work was stopped by you.',
    );
    expect(mounted.host.textContent).toContain('Decide next work');
  } finally {
    await mounted.unmount();
  }
});

it('resumes paused durable work before opening the continuation scope mode', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let resumed = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === 'work-b' && resumed ? { ...item, state: 'active' as const } : item,
      ),
    },
    now: resumed
      ? {
          ...data.current('work-b'),
          state: 'active' as const,
          currentState: 'The cleanup is ready to continue.',
          next: {
            kind: 'continue-work' as const,
            workItemId: 'work-b',
            text: 'Continue Small follow-up cleanup.',
          },
        }
      : data.current('work-b'),
  }));
  h.projectGateway.resumeWork = vi.fn(async (_id, _revision, workItemId) => {
    resumed = true;
    return {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === workItemId ? { ...item, state: 'active' as const } : item,
      ),
    };
  });
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Resume work');
    expect(h.projectGateway.resumeWork).toHaveBeenCalledWith('alpha', 7, 'work-b');
    await settle();
    await settle();
    expect(mounted.host.querySelector('[aria-label="Review request"]')?.textContent).toContain(
      'Continue this work',
    );
  } finally {
    await mounted.unmount();
  }
});

it('pauses durable work from native review mode without using legacy task corrections', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let paused = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === 'work-a' && paused ? { ...item, state: 'paused' as const } : item,
      ),
    },
    now: paused
      ? {
          ...data.current('work-a'),
          state: 'paused' as const,
          currentState: 'This work is paused.',
          next: {
            kind: 'resume-work' as const,
            workItemId: 'work-a',
            text: 'Resume Improve the return screen.',
          },
          secondaryActions: [
            {
              kind: 'stop-work' as const,
              workItemId: 'work-a',
              text: 'Stop Improve the return screen.',
            },
          ],
        }
      : data.current('work-a'),
  }));
  h.projectGateway.pauseWork = vi.fn(async (_id, _revision, workItemId) => {
    paused = true;
    return {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === workItemId ? { ...item, state: 'paused' as const } : item,
      ),
    };
  });
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review work');
    await toggleDetails(mounted.host, 'More options');
    await press(mounted.host, 'Pause work');
    expect(h.projectGateway.pauseWork).toHaveBeenCalledWith('alpha', 7, 'work-a');
    expect(h.analysisGateway.correct).not.toHaveBeenCalled();
    expect(mounted.host.querySelector('.pw-now-current-state')?.textContent).toBe(
      'This work is paused.',
    );
  } finally {
    await mounted.unmount();
  }
});

it('marks durable work complete from review-completion mode', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let completed = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === 'work-a' && completed ? { ...item, state: 'completed' as const } : item,
      ),
    },
    now: completed
      ? {
          ...data.current('work-a'),
          state: 'complete' as const,
          currentState: 'This work is complete.',
          uncertainty: null,
          next: {
            kind: 'choose-next-work' as const,
            text: 'Decide the next work for this direction.',
          },
          secondaryActions: [],
        }
      : {
          ...data.current('work-a'),
          state: 'review' as const,
          currentState: 'The current evidence suggests this work reached its completion condition.',
          next: {
            kind: 'review-completion' as const,
            workItemId: 'work-a',
            text: 'Review whether Improve the return screen is complete.',
          },
          secondaryActions: [],
        },
  }));
  h.projectGateway.completeWork = vi.fn(async (_id, _revision, workItemId) => {
    completed = true;
    return {
      ...structuredClone(data.model),
      workItems: data.model.workItems.map((item) =>
        item.id === workItemId ? { ...item, state: 'completed' as const } : item,
      ),
    };
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review completion');
    expect(mounted.host.querySelector('[aria-label="Review current work"]')).toBeTruthy();
    await press(mounted.host, 'Mark complete');
    expect(h.projectGateway.completeWork).toHaveBeenCalledWith('alpha', 7, 'work-a');
    expect(mounted.host.querySelector('.pw-now-current-state')?.textContent).toBe(
      'This work is complete.',
    );
    expect(mounted.host.textContent).toContain('Decide next work');
  } finally {
    await mounted.unmount();
  }
});

it('opens a background result on the exact linked work and request instead of the newest request', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  const target = returnedRequest('background-result', 'Background result for work B.');
  const newer = returnedRequest('newer-result', 'Newer result for another request.');
  const decisionData = decision();
  decisionData.requests = [target, newer];
  decisionData.record.requests = [target.id, newer.id];
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: {
      ...data.current('work-a'),
      notice: {
        level: 'attention' as const,
        kind: 'result-ready' as const,
        workItemId: 'work-b',
        requestId: target.id,
        text: 'Small follow-up cleanup has a result ready to review.',
        reason: 'It does not currently block the selected work.',
      },
    },
  }));
  h.projectGateway.execution = vi.fn(async () => structuredClone(decisionData));
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review result');
    await settle();
    await settle();
    expect(mounted.host.querySelector('[aria-label="Current project decision"]')).toBeNull();
    expect(mounted.host.querySelector('[aria-label="Request and result"]')).toBeTruthy();
    expect(mounted.host.textContent).toContain('Background result for work B.');
    expect(mounted.host.textContent).not.toContain('Newer result for another request.');
    await press(mounted.host, 'Return to current work without accepting this result');
    expect(vi.mocked(h.projectGateway.execution).mock.calls.at(-1)?.[1]).toEqual({
      action: 'close-request',
      requestId: target.id,
    });
  } finally {
    await mounted.unmount();
  }
});

it('switches durable current work from the Other work disclosure without changing project order', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let currentWork = 'work-a';
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current(currentWork),
  }));
  h.projectGateway.selectWork = vi.fn(async (_id, _revision, workItemId) => {
    currentWork = workItemId;
    return structuredClone(data.model);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await toggleDetails(mounted.host, 'Other work · 1');
    await press(mounted.host, 'Small follow-up cleanupPaused');
    expect(h.projectGateway.selectWork).toHaveBeenCalledWith('alpha', 7, 'work-b');
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Small follow-up cleanup',
    );
    expect(mounted.host.querySelector('.pw-now-next')?.textContent).toContain(
      'Resume Small follow-up cleanup.',
    );
  } finally {
    await mounted.unmount();
  }
});

it('shows the Core recommendation and changes current work only after the user chooses it', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let currentWork = 'work-a';
  h.projectGateway.now = vi.fn(async () => {
    const now = data.current(currentWork);
    if (currentWork === 'work-a') {
      now.state = 'waiting';
      now.currentState = 'The selected work is waiting for an external result.';
      now.next = {
        kind: 'start-work',
        workItemId: 'work-b',
        text: 'Work on Small follow-up cleanup while this is waiting.',
      };
      now.recommendation = {
        status: 'recommended',
        candidate: {
          id: 'work-b',
          title: 'Small follow-up cleanup',
          state: 'paused',
          source: 'work-item',
          disposition: 'progress',
        },
        action: 'select-work-item',
        reason: 'It has a return point for the latest checked project state.',
        confidence: 'medium',
        close: false,
        closeAlternatives: [],
        selectionState: 'current-retained',
        evidenceGaps: ['user-impact'],
      };
    }
    return { initialized: true, model: structuredClone(data.model), now };
  });
  h.projectGateway.selectWork = vi.fn(async (_id, _revision, workItemId) => {
    currentWork = workItemId;
    return structuredClone(data.model);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    const recommendation = mounted.host.querySelector('[aria-label="Suggested next work"]');
    expect(recommendation?.textContent).toContain('Small follow-up cleanup');
    expect(recommendation?.textContent).toContain(
      'It has a return point for the latest checked project state.',
    );
    expect(h.projectGateway.selectWork).not.toHaveBeenCalled();

    await press(mounted.host, 'Choose this work');

    expect(h.projectGateway.selectWork).toHaveBeenCalledWith('alpha', 7, 'work-b');
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Small follow-up cleanup',
    );
  } finally {
    await mounted.unmount();
  }
});

it('keeps unmatched legacy analysis as a proposal until the user chooses it', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  const proposal = {
    key: 'analysis:export-check',
    source: 'analysis-candidate' as const,
    title: 'Finish export validation',
    state: 'active' as const,
    currentState: 'The export is implemented and needs its final check.',
    uncertainty: 'The final behavior is not verified.',
    nextAction: 'Run the export check.',
    doneWhen: 'The export check passes.',
    evidenceBasis: 'legacy-scope',
  };
  data.model.workItems = [];
  let migrated = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: migrated
      ? {
          ...data.current('work-a'),
          currentState: proposal.currentState,
          uncertainty: proposal.uncertainty,
          next: { kind: 'continue-work' as const, workItemId: 'work-a', text: proposal.nextAction },
          otherWorkCount: 0,
          otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [],
          proposalMatches: [
            {
              proposal,
              workItemId: 'work-a',
              confidence: 'explicit' as const,
              reason: 'User selected it.',
            },
          ],
        }
      : {
          projectId: 'alpha',
          primaryDirectionId: 'direction-alpha',
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'choose-work' as const,
          currentState:
            'StateCarry found unfinished work, but it has not been confirmed as the current work.',
          uncertainty: null,
          next: {
            kind: 'choose-current-work' as const,
            text: 'Confirm whether this is the work you want to continue.',
          },
          secondaryActions: [],
          notice: null,
          otherWorkCount: 1,
          otherWorkCounts: { total: 1, progress: 1, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [
            {
              id: proposal.key,
              title: proposal.title,
              state: 'proposal' as const,
              source: 'proposal' as const,
              disposition: 'progress' as const,
              proposalState: proposal.state,
              currentState: proposal.currentState,
              uncertainty: proposal.uncertainty,
              nextAction: proposal.nextAction,
            },
          ],
          recommendation: noRecommendation,
          freshness: 'current' as const,
          proposalMatches: [
            {
              proposal,
              workItemId: null,
              confidence: 'unmatched' as const,
              reason: 'Not confirmed.',
            },
          ],
        },
  }));
  h.projectGateway.selectProposal = vi.fn(async () => {
    migrated = true;
    data.model.workItems = [
      {
        id: 'work-a',
        projectId: 'alpha',
        title: proposal.title,
        state: 'active',
        origin: 'reconstructed',
        completionCondition: proposal.doneWhen,
        completionConditionOrigin: 'suggested',
        createdAt: now,
        updatedAt: now,
      },
    ];
    return structuredClone(data.model);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Choose current work',
    );
    expect(mounted.host.textContent).toContain(
      'Confirm whether this is the work you want to continue.',
    );
    await toggleDetails(mounted.host, 'Other work · 1');
    expect(mounted.host.textContent).toContain(proposal.currentState);
    const choose = mounted.host.querySelector<HTMLButtonElement>(
      '[aria-label="Choose Finish export validation"]',
    )!;
    await act(async () => choose.click());
    expect(h.projectGateway.selectProposal).toHaveBeenCalledWith(
      'alpha',
      7,
      'analysis:export-check',
    );
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Finish export validation',
    );
  } finally {
    await mounted.unmount();
  }
});

it('defines the next durable ProjectRecord directly instead of reopening the generated-task chooser', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  data.model.workItems = [];
  data.model.decisions = [];
  let created = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: created
      ? {
          ...data.current('work-new'),
          currentState: 'This work is ready to continue.',
          uncertainty: null,
          next: {
            kind: 'continue-work' as const,
            workItemId: 'work-new',
            text: 'Continue Validate the new return flow.',
          },
          otherWorkCount: 0,
          otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [],
        }
      : {
          projectId: 'alpha',
          primaryDirectionId: 'direction-alpha',
          currentWorkId: null,
          currentWorkSelection: null,
          state: 'complete' as const,
          currentState: 'The current direction is active, but no work is selected to continue it.',
          uncertainty: null,
          next: {
            kind: 'choose-next-work' as const,
            text: 'Decide the next work for this direction.',
          },
          secondaryActions: [],
          notice: null,
          otherWorkCount: 0,
          otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
          otherWorkCandidates: [],
          recommendation: noRecommendation,
          freshness: 'current' as const,
          proposalMatches: [],
        },
  }));
  h.projectGateway.createWork = vi.fn(async (_id, _revision, input) => {
    created = true;
    data.model.workItems = [
      {
        id: 'work-new',
        projectId: 'alpha',
        title: input.title,
        state: 'active',
        origin: 'user',
        completionCondition: input.completionCondition ?? null,
        completionConditionOrigin: input.completionCondition ? 'user' : null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    return structuredClone(data.model);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(h.projectGateway.execution).not.toHaveBeenCalled();
    await press(mounted.host, 'Decide next work');
    expect(mounted.host.querySelector('[aria-label="Decide next work"]')).toBeTruthy();
    expect(mounted.host.querySelector('[aria-label="Current project decision"]')).toBeNull();
    await typeField(
      mounted.host,
      '[aria-label="Decide next work"] input',
      'Validate the new return flow',
    );
    await typeField(
      mounted.host,
      '[aria-label="Decide next work"] textarea',
      'The return flow is checked against one real project.',
    );
    await press(mounted.host, 'Start this work');
    expect(h.projectGateway.createWork).toHaveBeenCalledWith('alpha', 7, {
      title: 'Validate the new return flow',
      completionCondition: 'The return flow is checked against one real project.',
    });
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Validate the new return flow',
    );
  } finally {
    await mounted.unmount();
  }
});

it('lets the user continue through an unchanged direction conflict without hiding the current work', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  let overridden = false;
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: overridden
      ? data.current('work-a')
      : {
          ...data.current('work-a'),
          state: 'active' as const,
          currentState: 'Current work: Improve the return screen.',
          uncertainty: 'Showing more state may increase return-time reading cost.',
          next: {
            kind: 'review-direction' as const,
            text: 'Review whether the current direction should continue.',
          },
          secondaryActions: [
            {
              kind: 'continue-despite-direction-conflict' as const,
              workItemId: 'work-a',
              text: 'Continue the current work anyway.',
            },
          ],
          notice: {
            level: 'immediate' as const,
            kind: 'direction-conflict' as const,
            text: 'The current direction conflicts with a recorded project constraint.',
            reason: 'Showing more state may increase return-time reading cost.',
          },
        },
  }));
  h.projectGateway.continueDirectionConflict = vi.fn(async () => {
    overridden = true;
    return structuredClone(data.model);
  });
  const conflictDecision = decision();
  conflictDecision.record.policyConflict = {
    description: 'Showing more state may increase return-time reading cost.',
    source: 'project-purpose',
    status: 'open',
  };
  h.projectGateway.execution = vi.fn(async () => structuredClone(conflictDecision));
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    expect(mounted.host.querySelector('.pw-now-notice--immediate')?.textContent).toContain(
      'Direction needs review',
    );
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    await press(mounted.host, 'Review direction');
    await settle();
    await settle();
    expect(mounted.host.querySelector('[aria-label="Current work action"]')).toBeTruthy();
    expect(mounted.host.querySelector('[aria-label="Current project decision"]')).toBeNull();
    expect(mounted.host.textContent).toContain('The direction conflicts with a recorded policy');
    await press(mounted.host, 'Review a policy change');
    expect(mounted.host.querySelector('[aria-label="Review request"]')?.textContent).toContain(
      'Review policy change',
    );
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('[aria-label="Review request"] textarea')
        ?.value,
    ).toContain('Showing more state may increase return-time reading cost.');
    const policyConfirmation = mounted.host.querySelector<HTMLInputElement>(
      '[aria-label="Review request"] .pw-decision-confirm input',
    );
    expect(policyConfirmation).toBeTruthy();
    await act(async () => {
      policyConfirmation!.click();
    });
    await settle();
    await press(mounted.host, 'Prepare request for Codex');
    expect(vi.mocked(h.projectGateway.execution).mock.calls.at(-1)?.[1]).toMatchObject({
      action: 'prepare',
      context: { basis: 'scope-a', scopeIds: [], operation: 'policy', workItemId: 'work-a' },
      text: expect.stringContaining('Showing more state may increase return-time reading cost.'),
      threadId: null,
    });
    await press(mounted.host, 'Decide later');
    await press(mounted.host, 'Review direction');
    await settle();
    await settle();
    await typeField(
      mounted.host,
      '[aria-label="Review project direction"] textarea',
      'Keep return context concise.',
    );
    await press(mounted.host, 'Save a different direction');
    expect(vi.mocked(h.projectGateway.execution).mock.calls.at(-1)?.[1]).toEqual({
      action: 'resolve-direction',
      text: 'Keep return context concise.',
    });
    await press(mounted.host, 'Review direction');
    await settle();
    await settle();
    await press(mounted.host, 'Back to current work');
    await press(mounted.host, 'Continue anyway');
    expect(h.projectGateway.continueDirectionConflict).toHaveBeenCalledWith('alpha', 7);
    expect(mounted.host.querySelector('.pw-now-notice--immediate')).toBeNull();
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
  } finally {
    await mounted.unmount();
  }
});

it('opens Define direction in direction mode even when the legacy decision view still remembers an older direction', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  data.model.directions = [];
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: {
      projectId: 'alpha',
      primaryDirectionId: null,
      currentWorkId: null,
      currentWorkSelection: null,
      state: 'needs-direction' as const,
      currentState: 'No confirmed current direction is available.',
      uncertainty: null,
      next: { kind: 'define-direction' as const, text: 'Confirm or define the current direction.' },
      secondaryActions: [],
      notice: null,
      otherWorkCount: 0,
      otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
      otherWorkCandidates: [],
      recommendation: noRecommendation,
      freshness: 'current' as const,
      proposalMatches: [],
    },
  }));
  h.projectGateway.execution = vi.fn(async () => decision());
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Define direction');
    await settle();
    await settle();
    expect(mounted.host.querySelector('.pw-decision-direction')).toBeTruthy();
    expect(mounted.host.textContent).toContain('Direction to confirm');
  } finally {
    await mounted.unmount();
  }
});

it('shows saved content while checking and can represent a real nothing-to-do state without inventing actions', async () => {
  const checkingFixture = projectUiFixture([projectEntry('alpha')]);
  const checkingData = bundle();
  checkingFixture.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(checkingData.model),
    now: { ...checkingData.current('work-a'), freshness: 'checking' as const },
  }));
  window.history.replaceState(null, '', '#/project/alpha');
  const checking = await mountProjectRoot(
    checkingFixture.projectGateway,
    checkingFixture.analysisGateway,
  );
  try {
    expect(checking.host.textContent).toContain('Checking recent changes');
    expect(checking.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    expect(checking.host.querySelector('.pw-now-current-state')?.textContent).toContain(
      'The new return layout is implemented',
    );
  } finally {
    await checking.unmount();
  }

  const idleFixture = projectUiFixture([projectEntry('alpha')]);
  const idleData = bundle();
  idleData.model.workItems = [];
  idleData.model.directions = [
    { ...idleData.model.directions[0], state: 'completed', primary: false, endedAt: now },
  ];
  idleFixture.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(idleData.model),
    now: {
      projectId: 'alpha',
      primaryDirectionId: null,
      currentWorkId: null,
      currentWorkSelection: null,
      state: 'idle' as const,
      currentState: 'There is no current work or result that needs attention.',
      uncertainty: null,
      next: null,
      secondaryActions: [],
      notice: null,
      otherWorkCount: 0,
      otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
      otherWorkCandidates: [],
      recommendation: noRecommendation,
      freshness: 'current' as const,
      proposalMatches: [],
    },
  }));
  window.history.replaceState(null, '', '#/project/alpha');
  const idle = await mountProjectRoot(idleFixture.projectGateway, idleFixture.analysisGateway);
  try {
    expect(idle.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Nothing to do right now',
    );
    expect(idle.host.querySelector('.pw-now-current-state')?.textContent).toBe(
      'There is no current work or result that needs attention.',
    );
    expect(idle.host.querySelector('.pw-now-next')).toBeNull();
    expect(idle.host.querySelector('.pw-now-actions')).toBeNull();
  } finally {
    await idle.unmount();
  }
});

it('stops the saved-state spinner after a failed ProjectNow read and recovers on retry', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.observe = vi.fn(async () => {
    throw new Error('Current project observation is unavailable.');
  });
  const readNow = vi.fn().mockRejectedValue(new Error('synthetic ProjectNow read failure'));
  h.projectGateway.now = readNow;
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await settle();
    expect(mounted.host.textContent).toContain('StateCarry could not prepare this project.');
    expect(mounted.host.textContent).not.toContain('Reading project state…');

    readNow.mockResolvedValue({
      initialized: true,
      model: structuredClone(data.model),
      now: data.current('work-a'),
    });
    const retry = mounted.host.querySelector<HTMLButtonElement>('.pw-now-loading button');
    expect(retry?.textContent?.trim()).toBe('Try again');
    await act(async () => {
      retry!.click();
    });
    await settle();

    expect(mounted.host.textContent).not.toContain('StateCarry could not prepare this project.');
    expect(mounted.host.querySelector('#pw-now-work-title')?.textContent).toBe(
      'Improve the return screen',
    );
    expect(readNow.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    await mounted.unmount();
  }
});

it('reviews release delivery independently from completed implementation work', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  data.model.workItems = [
    {
      id: 'work-release',
      projectId: 'alpha',
      title: 'Completed release work',
      state: 'completed',
      origin: 'user',
      completionCondition: 'Implementation is complete.',
      completionConditionOrigin: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ];
  data.model.decisions = [];
  const releaseNow: ProjectNow = {
    projectId: 'alpha',
    primaryDirectionId: 'direction-alpha',
    currentWorkId: null,
    currentWorkSelection: null,
    state: 'complete',
    currentState: '1 completed work item is ready for delivery review.',
    uncertainty: null,
    next: { kind: 'review-release', text: 'Review release and delivery state.' },
    secondaryActions: [],
    notice: {
      level: 'quiet',
      kind: 'release-ready',
      text: '1 completed work item is ready for delivery review.',
      reason: 'A release policy is configured and this work is not delivered.',
    },
    otherWorkCount: 0,
    otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
    otherWorkCandidates: [],
    recommendation: { ...noRecommendation, selectionState: 'current-retained' },
    freshness: 'current',
    proposalMatches: [],
  };
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: structuredClone(releaseNow),
  }));

  const policy = {
    id: 'policy-alpha',
    projectId: 'alpha',
    name: 'Stable policy',
    timing: null,
    channel: 'stable',
    requiredChecks: ['Build passes'],
    inclusionRule: 'ready-only' as const,
    targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
    completionMode: 'user-confirmation' as const,
    postReleaseVerification: 'risk-based' as const,
    createdAt: now,
    updatedAt: now,
  };
  let release: ReleaseProjectView = {
    policy,
    policyNeedsReview: false,
    batches: [],
    targets: [],
    exceptions: [],
    pendingWork: [{ id: 'work-release', title: 'Completed release work' }],
  };
  h.projectGateway.release = vi.fn(async () => structuredClone(release));
  h.projectGateway.createRelease = vi.fn(async (_id, _revision, input) => {
    expect(input.workItemIds).toEqual(['work-release']);
    release = {
      ...release,
      batches: [
        {
          id: 'release-alpha',
          projectId: 'alpha',
          policyId: policy.id,
          exceptionId: null,
          title: input.title,
          workItemIds: ['work-release'],
          completionMode: 'user-confirmation',
          checks: [
            {
              id: 'check-build',
              label: 'Build passes',
              phase: 'pre-delivery',
              state: 'pending',
              detail: null,
            },
          ],
          state: 'planned',
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      ],
      targets: [
        {
          id: 'target-desktop',
          projectId: 'alpha',
          releaseId: 'release-alpha',
          key: 'desktop',
          label: 'Desktop app',
          required: true,
          state: 'pending',
          detail: null,
          updatedAt: now,
        },
      ],
    };
    return structuredClone(release);
  });
  h.projectGateway.updateDelivery = vi.fn(async (_id, _revision, releaseId, input) => {
    expect(releaseId).toBe('release-alpha');
    release = {
      ...release,
      batches: release.batches.map((batch) => ({ ...batch, state: 'delivering' as const })),
      targets: release.targets.map((target) =>
        target.id === input.targetId ? { ...target, state: input.state, updatedAt: now } : target,
      ),
    };
    return structuredClone(release);
  });
  h.projectGateway.updateReleaseCheck = vi.fn(async (_id, _revision, releaseId, input) => {
    expect(releaseId).toBe('release-alpha');
    release = {
      ...release,
      batches: release.batches.map((batch) => ({
        ...batch,
        state: 'awaiting-confirmation' as const,
        checks: batch.checks.map((check) =>
          check.id === input.checkId ? { ...check, state: input.state } : check,
        ),
      })),
    };
    return structuredClone(release);
  });
  h.projectGateway.confirmRelease = vi.fn(async (_id, _revision, releaseId) => {
    expect(releaseId).toBe('release-alpha');
    release = {
      ...release,
      batches: release.batches.map((batch) => ({
        ...batch,
        state: 'completed' as const,
        completedAt: now,
      })),
      pendingWork: [],
    };
    return structuredClone(release);
  });

  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review release');
    await vi.waitFor(() =>
      expect(mounted.host.querySelector('[aria-label="Release and delivery"]')).toBeTruthy(),
    );
    expect(mounted.host.textContent).toContain('Completed release work');
    await press(mounted.host, 'Create release');
    expect(h.projectGateway.createRelease).toHaveBeenCalledWith(
      'alpha',
      7,
      expect.objectContaining({ workItemIds: ['work-release'] }),
    );
    expect(mounted.host.textContent).toContain('Desktop app');
    expect(mounted.host.textContent).toContain('Build passes');

    await press(mounted.host, 'Mark delivered');
    expect(h.projectGateway.updateDelivery).toHaveBeenCalledWith('alpha', 7, 'release-alpha', {
      targetId: 'target-desktop',
      state: 'succeeded',
    });
    await press(mounted.host, 'Mark check passed');
    expect(h.projectGateway.updateReleaseCheck).toHaveBeenCalledWith('alpha', 7, 'release-alpha', {
      checkId: 'check-build',
      state: 'passed',
    });
    expect(mounted.host.textContent).toContain('awaiting confirmation');

    await press(mounted.host, 'Confirm release complete');
    expect(h.projectGateway.confirmRelease).toHaveBeenCalledWith('alpha', 7, 'release-alpha');
    expect(data.model.workItems[0].state).toBe('completed');
  } finally {
    await mounted.unmount();
  }
});
it('creates a multi-target release policy from Project context without changing current work', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: data.current('work-a'),
  }));
  let release: ReleaseProjectView = {
    policy: null,
    policyNeedsReview: false,
    batches: [],
    targets: [],
    exceptions: [],
    pendingWork: [],
  };
  h.projectGateway.release = vi.fn(async () => structuredClone(release));
  h.projectGateway.setReleasePolicy = vi.fn(async (_id, _revision, input) => {
    release = {
      ...release,
      policy: { id: 'policy-new', projectId: 'alpha', ...input, createdAt: now, updatedAt: now },
    };
    return structuredClone(release);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await toggleDetails(mounted.host, 'Project context');
    await press(mounted.host, 'Review release');
    await vi.waitFor(() =>
      expect(mounted.host.querySelector('[aria-label="Release policy editor"]')).toBeTruthy(),
    );
    expect(mounted.host.querySelector('#pw-now-work-title')).toBeNull();
    await typeField(
      mounted.host,
      'input[name="release-policy-name"]',
      'Stable multi-target policy',
    );
    await typeField(
      mounted.host,
      'input[name="release-policy-timing"]',
      'After required checks pass',
    );
    await typeField(mounted.host, 'input[name="release-policy-channel"]', 'stable');
    await typeField(mounted.host, 'input[name="release-target-0"]', 'Desktop app');
    await press(mounted.host, 'Add delivery target');
    await typeField(mounted.host, 'input[name="release-target-1"]', 'Docs site');
    await typeField(
      mounted.host,
      'textarea[name="release-required-checks"]',
      'Build passes\nSmoke test passes',
    );
    await typeField(mounted.host, 'select[name="release-inclusion-rule"]', 'explicit');
    await typeField(mounted.host, 'select[name="release-completion-mode"]', 'automatic');
    await typeField(mounted.host, 'select[name="release-verification"]', 'required');
    await press(mounted.host, 'Save release policy');
    expect(h.projectGateway.setReleasePolicy).toHaveBeenCalledWith('alpha', 7, {
      name: 'Stable multi-target policy',
      timing: 'After required checks pass',
      channel: 'stable',
      requiredChecks: ['Build passes', 'Smoke test passes'],
      inclusionRule: 'explicit',
      targets: [
        { key: 'primary', label: 'Desktop app', required: true },
        { key: 'target-1', label: 'Docs site', required: false },
      ],
      completionMode: 'automatic',
      postReleaseVerification: 'required',
    });
    expect(data.model.workItems.find((item) => item.id === 'work-a')?.state).toBe('active');
  } finally {
    await mounted.unmount();
  }
});

it('starts a new re-delivery batch after rollback while keeping implementation work complete', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  data.model.workItems.push({
    id: 'work-shipped',
    projectId: 'alpha',
    title: 'Safe completed feature',
    state: 'completed',
    origin: 'user',
    completionCondition: 'Implementation is complete.',
    completionConditionOrigin: 'user',
    createdAt: now,
    updatedAt: now,
  });
  const releaseId = 'release-rolled-back';
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: {
      ...data.current('work-a'),
      notice: {
        level: 'attention' as const,
        kind: 'delivery-problem' as const,
        releaseId,
        text: 'Stable release was rolled back.',
        reason: 'Implementation work stays complete while delivery needs another decision.',
      },
      secondaryActions: [
        { kind: 'review-release' as const, releaseId, text: 'Review release and delivery state.' },
      ],
    },
  }));
  const policy = {
    id: 'policy-alpha',
    projectId: 'alpha',
    name: 'Stable policy',
    timing: null,
    channel: 'stable',
    requiredChecks: [],
    inclusionRule: 'ready-only' as const,
    targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
    completionMode: 'automatic' as const,
    postReleaseVerification: 'none' as const,
    createdAt: now,
    updatedAt: now,
  };
  let release: ReleaseProjectView = {
    policy,
    policyNeedsReview: false,
    batches: [
      {
        id: releaseId,
        projectId: 'alpha',
        policyId: policy.id,
        exceptionId: null,
        title: 'Stable release',
        workItemIds: ['work-shipped'],
        completionMode: 'automatic',
        checks: [],
        state: 'rolled-back',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
    ],
    targets: [
      {
        id: 'target-old',
        projectId: 'alpha',
        releaseId,
        key: 'desktop',
        label: 'Desktop app',
        required: true,
        state: 'rolled-back',
        detail: 'Rolled back.',
        updatedAt: now,
      },
    ],
    exceptions: [],
    pendingWork: [{ id: 'work-shipped', title: 'Safe completed feature' }],
  };
  h.projectGateway.release = vi.fn(async () => structuredClone(release));
  h.projectGateway.createRelease = vi.fn(async (_id, _revision, input) => {
    expect(input.workItemIds).toEqual(['work-shipped']);
    release = {
      ...release,
      batches: [
        {
          id: 'release-redelivery',
          projectId: 'alpha',
          policyId: policy.id,
          exceptionId: null,
          title: input.title,
          workItemIds: ['work-shipped'],
          completionMode: 'automatic',
          checks: [],
          state: 'planned',
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
        ...release.batches,
      ],
      targets: [
        {
          id: 'target-new',
          projectId: 'alpha',
          releaseId: 'release-redelivery',
          key: 'desktop',
          label: 'Desktop app',
          required: true,
          state: 'pending',
          detail: null,
          updatedAt: now,
        },
        ...release.targets,
      ],
    };
    return structuredClone(release);
  });
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review release');
    await vi.waitFor(() =>
      expect(mounted.host.textContent).toContain(
        'Safe completed implementation work stays complete',
      ),
    );
    await vi.waitFor(() =>
      expect(button(mounted.host, 'Create re-delivery release').disabled).toBe(false),
    );
    await press(mounted.host, 'Create re-delivery release');
    expect(h.projectGateway.createRelease).toHaveBeenCalledWith('alpha', 7, {
      title: 'Stable release re-delivery',
      workItemIds: ['work-shipped'],
    });
    expect(mounted.host.textContent).toContain('Stable release re-delivery');
    expect(data.model.workItems.find((item) => item.id === 'work-shipped')?.state).toBe(
      'completed',
    );
  } finally {
    await mounted.unmount();
  }
});
it('uses a one-off release policy exception without rewriting the saved policy', async () => {
  const h = projectUiFixture([projectEntry('alpha')]);
  const data = bundle();
  data.model.workItems = [
    {
      id: 'work-exception',
      projectId: 'alpha',
      title: 'Completed hotfix',
      state: 'completed',
      origin: 'user',
      completionCondition: 'Implementation is complete.',
      completionConditionOrigin: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ];
  data.model.decisions = [];
  h.projectGateway.now = vi.fn(async () => ({
    initialized: true,
    model: structuredClone(data.model),
    now: {
      projectId: 'alpha',
      primaryDirectionId: 'direction-alpha',
      currentWorkId: null,
      currentWorkSelection: null,
      state: 'complete' as const,
      currentState: '1 completed work item is ready for delivery review.',
      uncertainty: null,
      next: { kind: 'review-release' as const, text: 'Review release and delivery state.' },
      secondaryActions: [],
      notice: {
        level: 'quiet' as const,
        kind: 'release-ready' as const,
        text: '1 completed work item is ready for delivery review.',
        reason: 'A release policy is configured and this work is not delivered.',
      },
      otherWorkCount: 0,
      otherWorkCounts: { total: 0, progress: 0, completionReview: 0, evidenceConflict: 0 },
      otherWorkCandidates: [],
      recommendation: noRecommendation,
      freshness: 'current' as const,
      proposalMatches: [],
    },
  }));
  const policy = {
    id: 'policy-stable',
    projectId: 'alpha',
    name: 'Stable policy',
    timing: null,
    channel: 'stable',
    requiredChecks: [],
    inclusionRule: 'ready-only' as const,
    targets: [{ key: 'desktop', label: 'Desktop app', required: true }],
    completionMode: 'user-confirmation' as const,
    postReleaseVerification: 'none' as const,
    createdAt: now,
    updatedAt: now,
  };
  let release: ReleaseProjectView = {
    policy,
    policyNeedsReview: false,
    batches: [],
    targets: [],
    exceptions: [],
    pendingWork: [{ id: 'work-exception', title: 'Completed hotfix' }],
  };
  h.projectGateway.release = vi.fn(async () => structuredClone(release));
  h.projectGateway.createReleaseException = vi.fn(async (_id, _revision, input) => {
    expect(input).toEqual({ reason: 'Severe user impact needs a hotfix channel.' });
    release = {
      ...release,
      exceptions: [
        {
          id: 'exception-hotfix',
          projectId: 'alpha',
          policyId: policy.id,
          reason: input.reason,
          state: 'active',
          createdAt: now,
        },
      ],
    };
    return structuredClone(release);
  });
  h.projectGateway.createRelease = vi.fn(async (_id, _revision, input) => {
    expect(input).toEqual({
      title: 'Release completed work',
      workItemIds: ['work-exception'],
      exceptionId: 'exception-hotfix',
      targets: [{ key: 'exception-primary', label: 'Emergency hotfix', required: true }],
    });
    return structuredClone(release);
  });

  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.analysisGateway);
  try {
    await press(mounted.host, 'Review release');
    await toggleDetails(mounted.host, 'One-off policy exception');
    await typeField(
      mounted.host,
      'textarea[name="release-exception-reason"]',
      'Severe user impact needs a hotfix channel.',
    );
    await typeField(mounted.host, 'input[name="release-exception-target"]', 'Emergency hotfix');
    await press(mounted.host, 'Record policy exception');
    expect(h.projectGateway.createReleaseException).toHaveBeenCalledWith('alpha', 7, {
      reason: 'Severe user impact needs a hotfix channel.',
    });
    await vi.waitFor(() => expect(button(mounted.host, 'Create release').disabled).toBe(false));
    await press(mounted.host, 'Create release');
    expect(h.projectGateway.createRelease).toHaveBeenCalledTimes(1);
    expect(release.policy).toEqual(policy);
  } finally {
    await mounted.unmount();
  }
});
