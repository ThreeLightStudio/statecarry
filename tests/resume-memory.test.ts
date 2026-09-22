import { expect, it } from 'vitest';
import { LocalProjectDraftMemory } from '../apps/web/src/adapters/project-draft-memory';
import type { ProjectDrafts } from '@statecarry/presentation';
const prefix = 'statecarry.project-drafts.v3.';
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    keys: () => values.keys(),
  };
}
const drafts: ProjectDrafts = {
  goalDraft: { text: 'Unsent direction', version: 'v1' },
  actionDrafts: [['work-a', { action: 'Check export', done: 'Export opens', version: 'v1' }]],
  expanded: ['context'],
  scroll: 120,
  selectedKey: 'old-selection',
  selectedExplicit: true,
  taskDiscussions: [
    [
      'work-a',
      {
        version: 'basis',
        input: 'Unsent question',
        turns: [
          {
            question: 'Old question',
            answer: { items: [], unknowns: ['PRIVATE_ANSWER'], limitations: [] },
          },
        ],
      },
    ],
  ],
};
it('persists only unsent input and temporary view state across a new adapter', () => {
  const data = storage(),
    memory = new LocalProjectDraftMemory(() => data);
  memory.write('a', drafts);
  const saved = new LocalProjectDraftMemory(() => data).read('a');
  expect(saved).toMatchObject({
    goalDraft: drafts.goalDraft,
    actionDrafts: drafts.actionDrafts,
    expanded: ['context'],
    scroll: 120,
    taskDiscussions: [['work-a', { input: 'Unsent question', version: 'basis', turns: [] }]],
  });
  expect(saved).not.toHaveProperty('selectedKey');
  expect(saved).not.toHaveProperty('selectedExplicit');
  expect(data.getItem(prefix + 'a')).not.toMatch(/PRIVATE_ANSWER|Old question|old-selection|turns/);
});
it('removes all retired app draft keys while preserving current inputs and unrelated settings', () => {
  const data = storage();
  for (const old of [
    'statecarry.resume.v1.a',
    'statecarry.resume.v2.a',
    'statecarry.work.v1.a',
    'statecarry.project-action.v1.a',
  ])
    data.setItem(old, 'OLD_CONTENT');
  data.setItem('statecarry.settings', 'KEEP_SETTINGS');
  data.setItem('another-app', 'KEEP_OTHER');
  const memory = new LocalProjectDraftMemory(() => data);
  memory.write('a', drafts);
  memory.write('absent', drafts);
  memory.prune(['a']);
  expect([...data.values.keys()].sort()).toEqual(
    ['another-app', 'statecarry.settings', prefix + 'a'].sort(),
  );
  expect(data.getItem('statecarry.settings')).toBe('KEEP_SETTINGS');
});
it('does not interpret old envelopes, malformed JSON, or another project’s input', () => {
  const data = storage(),
    memory = new LocalProjectDraftMemory(() => data);
  for (const raw of [
    '{',
    JSON.stringify({ schema: 2, projectId: 'a', state: drafts }),
    JSON.stringify({ schema: 3, projectId: 'b', state: drafts }),
  ]) {
    data.setItem(prefix + 'a', raw);
    expect(memory.read('a')).toBeNull();
    expect(data.getItem(prefix + 'a')).toBe(raw);
  }
});
it('supports input-only storage without ever reading retired keys', () => {
  const data = storage();
  const memory = new LocalProjectDraftMemory(() => ({
    getItem: data.getItem,
    setItem: data.setItem,
  }));
  memory.write('a', drafts);
  expect(memory.read('a')?.goalDraft).toEqual(drafts.goalDraft);
});
it('reports storage access and write failures to the UI instead of silently losing input', () => {
  const data = storage();
  const read = new LocalProjectDraftMemory(() => ({
    ...data,
    getItem: () => {
      throw new Error('blocked');
    },
  }));
  expect(() => read.read('a')).toThrow('blocked');
  const write = new LocalProjectDraftMemory(() => ({
    ...data,
    setItem: () => {
      throw new Error('full');
    },
  }));
  expect(() => write.write('a', drafts)).toThrow('full');
});
it('reports cleanup failures and retries them without touching unrelated data', () => {
  const data = storage();
  data.setItem('statecarry.resume.v2.a', 'OLD');
  data.setItem('settings', 'KEEP');
  let fail = true;
  const memory = new LocalProjectDraftMemory(() => ({
    ...data,
    removeItem: (key) => {
      if (fail) throw new Error('cleanup blocked');
      data.removeItem(key);
    },
  }));
  expect(() => memory.prune(['a'])).toThrow('cleanup blocked');
  expect(data.getItem('settings')).toBe('KEEP');
  fail = false;
  memory.prune(['a']);
  expect(data.getItem('statecarry.resume.v2.a')).toBeNull();
});
