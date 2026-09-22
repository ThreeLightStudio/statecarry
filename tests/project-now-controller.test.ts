import { requiredProjectGateway } from './project-gateway-fixture';
import { describe, expect, it, vi } from 'vitest';
import {
  ProjectController,
  type ProjectGateway,
  type ProjectWorkspace,
  type AnalysisGateway,
  type AnalysisMemory,
  type ProjectDrafts,
} from '@statecarry/presentation';
import type { ProjectModelView, ProjectNow, Receipt } from '@statecarry/contracts';
import { HttpProjectGateway } from '../apps/web/src/adapters/project-gateway';

const AT = '2026-09-21T01:00:00Z';

const receipt = (id: string): Receipt => ({
  id: `receipt-${id}`,
  command: 'test',
  bodyHash: 'body',
  projectId: id,
  committedRevision: 1,
  resultId: id,
  createdAt: AT,
});

function fixture() {
  const workspace: ProjectWorkspace = {
    projects: [
      {
        projectId: 'a',
        connectionId: 'connection-a',
        title: 'Project A',
        cwd: '/project/a',
        purpose: 'Resume work cheaply.',
        focused: false,
        revision: 1,
        disconnectedAt: null,
        acceptedKeys: [],
        pausedKeys: [],
        analysis: {
          projectId: 'a',
          title: 'Project A',
          cwd: '/project/a',
          goalText: 'Improve project return.',
          goalOrigin: 'user-input',
          sessionCount: 0,
          version: 'v1',
          revision: 1,
          updatesAvailable: false,
          busy: false,
          error: null,
          stale: false,
          generatedAt: AT,
          correctedKeys: [],
          dismissedKeys: [],
          state: 'ready',
          candidates: [
            {
              key: 'first',
              goal: 'Legacy selected work',
              currentState: 'The selected work has saved context.',
              status: 'active',
              reason: 'It was explicitly selected before migration.',
              nextAction: 'Continue the selected work.',
              actionSource: 'recorded',
              doneWhen: 'The selected work is complete.',
              threadId: 'thread-a',
              prerequisites: [],
              evidence: [{ revisionId: 'source-a', quote: 'Legacy selected work' }],
            },
          ],
        },
      },
    ],
  };
  const model: ProjectModelView = {
    project: {
      id: 'a',
      connectionId: 'connection-a',
      title: 'Project A',
      cwd: '/project/a',
      purposes: [],
      focused: false,
      iconAsset: null,
      bannerAsset: null,
      lifecycle: 'active',
      revision: 1,
      createdAt: AT,
    },
    directions: [
      {
        id: 'direction-a',
        projectId: 'a',
        text: 'Improve project return.',
        state: 'active',
        primary: true,
        origin: 'user',
        confirmed: true,
        createdAt: AT,
      },
    ],
    workItems: [
      {
        id: 'work-a',
        projectId: 'a',
        title: 'Legacy selected work',
        state: 'active',
        origin: 'reconstructed',
        completionCondition: 'The selected work is complete.',
        completionConditionOrigin: 'suggested',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    relations: [],
    decisions: [
      {
        id: 'link-a',
        projectId: 'a',
        workItemId: 'work-a',
        kind: 'link-work-proposal',
        value: { proposalKey: 'analysis:first' },
        basis: [],
        state: 'valid',
        decidedAt: AT,
      },
    ],
    returnPoints: [],
    discussions: [],
    latestObservation: null,
  };
  const now: ProjectNow = {
    projectId: 'a',
    primaryDirectionId: 'direction-a',
    currentWorkId: 'work-a',
    currentWorkSelection: 'user',
    state: 'active',
    currentState: 'The selected work has saved context.',
    uncertainty: null,
    next: { kind: 'continue-work', workItemId: 'work-a', text: 'Continue the selected work.' },
    secondaryActions: [],
    notice: null,
    otherWorkCount: 0,
    freshness: 'unknown',
    proposalMatches: [],
  };
  const gateway: ProjectGateway = {
    ...requiredProjectGateway(() => workspace),
    list: vi.fn(async () => structuredClone(workspace)),
    now: vi.fn(async () => ({
      initialized: true,
      model: structuredClone(model),
      now: structuredClone(now),
    })),
    selectProposal: vi.fn(async () => structuredClone(model)),
    create: vi.fn(async () => receipt('new')),
    settings: vi.fn(async (id) => receipt(id)),
    sources: vi.fn(async (id) => receipt(id)),
    disconnect: vi.fn(async (id) => receipt(id)),
    restore: vi.fn(async (id) => receipt(id)),
    deletionPreview: vi.fn(async (id) => ({
      projectId: id,
      title: 'Project A',
      token: 'token',
      revision: 1,
      ownedRecords: 0,
      exclusiveSources: 0,
      sharedSources: 0,
      blocked: false,
      explanation: 'Nothing pending.',
    })),
    delete: vi.fn(async (id) => receipt(id)),
    connections: vi.fn(async () => []),
    discover: vi.fn(async () => ({ threads: [], complete: true, limitations: [] })),
    turns: vi.fn(async () => ({ turns: [] })),
    evidence: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
  const analysis: AnalysisGateway = {
    list: vi.fn(async () => []),
    refresh: vi.fn(async () => {}),
    setGoal: vi.fn(async () => {}),
    correct: vi.fn(async () => {}),
  };
  let memoryValue: ProjectDrafts = {
    selectedKey: 'first',
    selectedExplicit: true,
    goalDraft: null,
    actionDrafts: [],
    expanded: [],
    scroll: 0,
  };
  const memory: AnalysisMemory = {
    read: () => structuredClone(memoryValue),
    write: (_id, value) => {
      memoryValue = structuredClone(value);
    },
  };
  return {
    gateway,
    analysis,
    memory,
    workspace,
    model,
    readMemory: () => structuredClone(memoryValue),
    writeMemory: (value: ProjectDrafts) => {
      memoryValue = structuredClone(value);
    },
  };
}

describe('ProjectController ProjectNow cutover', () => {
  it.each([true, false])(
    'opens project detail through the HTTP gateway (initialized: %s)',
    async (initialized) => {
      const f = fixture();
      const bundle = await f.gateway.now!('a');
      const fetcher = vi.fn(async (input: string) => {
        let body: unknown;
        switch (input) {
          case '/api/v1/projects/registrations':
            body = { projects: f.workspace.projects };
            break;
          case '/api/v1/projects':
            body = f.workspace;
            break;
          case '/api/v1/projects/a/now':
            body = { ...bundle, initialized };
            break;
          case '/api/v1/projects/a/initialize':
            body = { ...bundle, initialized: true };
            break;
          case '/api/v1/local/updater/check':
          case '/api/v1/local/updater':
            body = { supported: false };
            break;
          case '/api/v1/projects/a/observe':
          case '/api/v1/projects/a/workspace?outputLanguage=en':
            body = {
              cwd: '/project/a',
              root: '/project/a',
              branch: 'main',
              commit: 'abc',
              dirty: false,
              status: 'checked',
              checkedAt: AT,
              limitations: [],
            };
            break;
          default:
            throw new Error(`Unexpected project request: ${input}`);
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetcher);
      const controller = new ProjectController(new HttpProjectGateway(), f.analysis, f.memory);
      try {
        await controller.start({ page: 'project', projectId: 'a' });
        expect(fetcher.mock.calls.some(([path]) => path.endsWith('/a/now'))).toBe(true);
        expect(fetcher.mock.calls.some(([path]) => path.endsWith('/a/initialize'))).toBe(
          !initialized,
        );
        expect(controller.getSnapshot().projectNow.a).toMatchObject({
          work: { id: 'work-a' },
          currentState: 'The selected work has saved context.',
          primaryAction: { kind: 'continue-work' },
        });
        expect(controller.getSnapshot().error).toBeNull();
      } finally {
        controller.stop();
        vi.unstubAllGlobals();
      }
    },
  );

  it('can retry a project read after a synchronous gateway failure', async () => {
    const f = fixture();
    const bundle = await f.gateway.now!('a');
    f.gateway.now = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Read failed before sending');
      })
      .mockResolvedValue(bundle);
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    try {
      await controller.start({ page: 'home' });
      expect(await controller.readProjectNow('a')).toBeNull();
      expect(await controller.readProjectNow('a')).toMatchObject({ work: { id: 'work-a' } });
      expect(controller.getSnapshot().error).toBeNull();
      expect(f.gateway.now).toHaveBeenCalledTimes(2);
    } finally {
      controller.stop();
    }
  });

  it('ignores legacy browser selection and presents durable ProjectNow directly', async () => {
    const f = fixture();
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });
    await controller.readProjectNow('a');

    expect(f.gateway.selectProposal).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projectNow.a).toMatchObject({
      project: { title: 'Project A' },
      work: { id: 'work-a', title: 'Legacy selected work' },
      nextText: 'Continue the selected work.',
      primaryAction: { kind: 'continue-work', label: 'Continue work' },
    });
    controller.stop();
  });

  it('prepares a project once when the new Project state has not been initialized', async () => {
    const f = fixture();
    const emptyModel: ProjectModelView = {
      ...structuredClone(f.model),
      directions: [],
      workItems: [],
      decisions: [],
      latestObservation: null,
    };
    f.gateway.now = vi.fn(async () => ({
      model: structuredClone(emptyModel),
      now: {
        projectId: 'a',
        primaryDirectionId: null,
        currentWorkId: null,
        currentWorkSelection: null,
        state: 'needs-direction',
        currentState: 'No confirmed current direction is available.',
        uncertainty: null,
        next: { kind: 'define-direction', text: 'Confirm or define the current direction.' },
        secondaryActions: [],
        notice: null,
        otherWorkCount: 0,
        freshness: 'unknown',
        proposalMatches: [],
      } as ProjectNow,
      initialized: false,
    }));
    f.gateway.initialize = vi.fn(async () => ({
      model: structuredClone(f.model),
      now: {
        projectId: 'a',
        primaryDirectionId: 'direction-a',
        currentWorkId: 'work-a',
        currentWorkSelection: 'user',
        state: 'active',
        currentState: 'The selected work has saved context.',
        uncertainty: null,
        next: { kind: 'continue-work', workItemId: 'work-a', text: 'Continue the selected work.' },
        secondaryActions: [],
        notice: null,
        otherWorkCount: 0,
        freshness: 'current',
        proposalMatches: [],
      } as ProjectNow,
      initialized: true,
    }));
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });

    expect(f.gateway.initialize).toHaveBeenCalledWith('a', 'en');
    expect(controller.getSnapshot().projectNow.a).toMatchObject({
      work: { id: 'work-a' },
      primaryAction: { kind: 'continue-work' },
    });
    expect(controller.getSnapshot().projectNowInitializing.a).toBe(false);
    controller.stop();
  });

  it('does not import browser-only legacy discussion turns during ProjectNow reads', async () => {
    const f = fixture();
    f.writeMemory({
      selectedKey: 'first',
      selectedExplicit: true,
      goalDraft: null,
      actionDrafts: [],
      expanded: [],
      scroll: 0,
      taskDiscussions: [
        [
          'first',
          {
            version: 'v1',
            input: 'One unsent follow-up',
            turns: [
              {
                question: 'What still matters?',
                answer: {
                  items: [
                    {
                      id: 'answer-a',
                      kind: 'record',
                      nature: 'agent-report',
                      text: 'The saved work still needs one focused check.',
                      uncertainty: '',
                      evidence: [],
                    },
                  ],
                  unknowns: [],
                  limitations: [],
                },
                version: 'v1',
              },
            ],
          },
        ],
      ],
    });
    f.gateway.syncDiscussion = vi.fn(async () => structuredClone(f.model));

    const first = new ProjectController(f.gateway, f.analysis, f.memory);
    await first.start({ page: 'project', projectId: 'a' });
    await first.readProjectNow('a');
    expect(f.gateway.syncDiscussion).not.toHaveBeenCalled();
    first.stop();
  });

  it('reads a natively persisted answer by work ID without storing its history in browser memory', async () => {
    const f = fixture();
    f.analysis.discussTask = vi.fn(async (_id, input) => {
      f.model.discussions = [
        {
          id: 'discussion-a',
          projectId: 'a',
          workItemId: input.workItemId!,
          basis: 'v1',
          updatedAt: AT,
          turns: [
            {
              question: input.question,
              basis: 'v1',
              answer: { items: [], unknowns: ['A final check remains.'], limitations: [] },
            },
          ],
        },
      ];
      return { answer: { items: [], unknowns: ['A final check remains.'] }, limitations: [] };
    });
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });
    controller.openTaskDiscussion('a', 'work-a');
    controller.editTaskDiscussionInput('a', 'work-a', 'What still needs checking?');
    await controller.askTaskDiscussion('a', 'work-a');
    expect(f.analysis.discussTask).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ workItemId: 'work-a', question: 'What still needs checking?' }),
    );
    expect(f.gateway.syncDiscussion).not.toHaveBeenCalled();
    expect(
      controller.getSnapshot().edits.a.taskDiscussions?.find(([key]) => key === 'work-a')?.[1]
        .turns[0].question,
    ).toBe('What still needs checking?');
    expect(f.readMemory().taskDiscussions?.find(([key]) => key === 'work-a')?.[1].turns).toEqual(
      [],
    );
    controller.stop();
  });
  it('hydrates work discussion from Core and preserves only the unsent local question', async () => {
    const f = fixture();
    f.model.discussions = [
      {
        id: 'discussion-a',
        projectId: 'a',
        workItemId: 'work-a',
        basis: 'v1',
        updatedAt: AT,
        turns: [
          {
            question: 'Saved question',
            basis: 'v1',
            answer: { items: [], unknowns: [], limitations: [] },
          },
        ],
      },
    ];
    f.writeMemory({
      goalDraft: null,
      actionDrafts: [],
      expanded: [],
      scroll: 0,
      taskDiscussions: [['work-a', { version: 'v1', input: 'Unsent follow-up', turns: [] }]],
    });
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });
    expect(
      controller.getSnapshot().edits.a.taskDiscussions?.find(([key]) => key === 'work-a')?.[1],
    ).toMatchObject({ input: 'Unsent follow-up', turns: [{ question: 'Saved question' }] });
    expect(f.gateway.syncDiscussion).not.toHaveBeenCalled();
    controller.stop();
  });
  it('preserves the unsent question when the server cannot persist its answer', async () => {
    const f = fixture();
    f.analysis.discussTask = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });
    controller.openTaskDiscussion('a', 'work-a');
    controller.editTaskDiscussionInput('a', 'work-a', 'New question');
    await expect(controller.askTaskDiscussion('a', 'work-a')).rejects.toThrow(
      'storage unavailable',
    );
    expect(
      controller.getSnapshot().edits.a.taskDiscussions?.find(([key]) => key === 'work-a')?.[1],
    ).toMatchObject({ input: 'New question', turns: [] });
    expect(f.model.discussions).toEqual([]);
    controller.stop();
  });

  it('keeps saved ProjectNow visible as checking until the background change check finishes', async () => {
    const f = fixture();
    const controller = new ProjectController(f.gateway, f.analysis, f.memory);
    await controller.start({ page: 'project', projectId: 'a' });
    await controller.readProjectNow('a');
    let release!: (value: ProjectWorkspace) => void;
    const pending = new Promise<ProjectWorkspace>((resolve) => {
      release = resolve;
    });
    f.gateway.list = vi.fn(async () => pending);

    const check = controller.checkForChanges();
    expect(controller.getSnapshot().projectNow.a).toMatchObject({
      work: { id: 'work-a' },
      checking: true,
      freshness: 'checking',
    });
    release(structuredClone(f.workspace));
    await check;
    expect(controller.getSnapshot().projectNow.a).toMatchObject({
      work: { id: 'work-a' },
      checking: false,
      freshness: 'unknown',
    });
    controller.stop();
  });
});
