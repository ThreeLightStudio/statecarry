import { expect, it } from 'vitest';
import { LocalProjectDraftMemory } from '../apps/web/src/adapters/project-draft-memory';

function memoryFixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  return { values, memory: new LocalProjectDraftMemory(() => storage) };
}

it('drops malformed screen memory without losing project drafts or discussion input', () => {
  const { values, memory } = memoryFixture();
  const key = 'statecarry.project-drafts.v3.alpha';
  values.set(
    key,
    JSON.stringify({
      schema: 3,
      projectId: 'alpha',
      state: {
        goalDraft: { text: 'Keep this goal draft.', version: 'v1' },
        actionDrafts: [],
        taskDiscussions: [['work-a', { version: 'v1', input: 'Keep this question.' }]],
        expanded: [],
        scroll: 80,
        projectNowUi: {
          projectId: 'alpha',
          lastViewedAt: 'yesterday',
          screen: 'action',
          activity: 'action',
          resumePending: false,
          actionEntry: { kind: 'continue-work' },
          selectedWorkId: 'work-a',
          basis: 'v1',
          policyConflictBasis: null,
          otherWorkOpen: false,
          projectContextOpen: false,
          scroll: 80,
        },
      },
    }),
  );

  expect(memory.read('alpha')).toMatchObject({
    goalDraft: { text: 'Keep this goal draft.' },
    taskDiscussions: [['work-a', { input: 'Keep this question.', turns: [] }]],
  });
  expect(memory.read('alpha')?.projectNowUi).toBeUndefined();
  expect(values.has(key)).toBe(true);
});

it('persists scoped screen identity and draft text but leaves discussion turns in Core', () => {
  const { values, memory } = memoryFixture();
  const projectNowUi = {
    projectId: 'alpha',
    lastViewedAt: 1_800_000_000_000,
    screen: 'action' as const,
    activity: 'action' as const,
    resumePending: false,
    actionEntry: {
      kind: 'continue-work' as const,
      selectionKey: 'work-a',
      requestId: null,
      releaseId: null,
      mode: 'continue' as const,
    },
    selectedWorkId: 'work-a',
    basis: 'basis-a',
    policyConflictBasis: null,
    otherWorkOpen: true,
    projectContextOpen: true,
    scroll: 320,
  };
  memory.write('alpha', {
    goalDraft: null,
    actionDrafts: [],
    expanded: [],
    scroll: 320,
    taskDiscussions: [
      [
        'work-a',
        {
          version: 'basis-a',
          input: 'Unsent question',
          turns: [
            {
              question: 'A saved question',
              answer: { items: [], unknowns: [], limitations: [] },
              version: 'basis-a',
            },
          ],
        },
      ],
    ],
    projectNowUi,
  });

  const restored = memory.read('alpha');
  expect(restored?.projectNowUi).toEqual(projectNowUi);
  expect(restored?.taskDiscussions).toEqual([
    ['work-a', { version: 'basis-a', input: 'Unsent question', turns: [] }],
  ]);
  expect(values.get('statecarry.project-drafts.v3.alpha')).not.toContain('A saved question');
});
