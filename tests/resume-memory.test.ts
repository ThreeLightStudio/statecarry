import { expect, it, vi } from 'vitest';
import { LocalResumeMemory } from '../apps/web/src/adapters/resume-memory';
import type { SavedResumeEdits } from '@statecarry/presentation';

const edits = (): SavedResumeEdits => ({
  selectedKey: 'second',
  goalDraft: { text: 'Unsaved goal', version: 'v1' },
  actionDrafts: [['second', { action: 'Check the output', done: 'Output checked', version: 'v1' }]],
  expanded: ['correction'],
  scroll: 320,
});
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
it('restores per-work draft versions from a new adapter without transient state or evidence', () => {
  const data = storage();
  const first = new LocalResumeMemory(() => data);
  first.write('A', {
    ...edits(),
    busy: true,
    candidates: ['do not cache'],
    evidence: ['private quote'],
  } as SavedResumeEdits);
  first.write('B', { ...edits(), goalDraft: null, actionDrafts: [] });
  const restarted = new LocalResumeMemory(() => data);
  expect(restarted.read('A')).toEqual(edits());
  expect(restarted.read('B')?.goalDraft).toBeNull();
  expect(data.getItem('statecarry.resume.v1.A')).not.toMatch(
    /busy|candidates|evidence|private quote/,
  );
});
it.each([
  '{',
  JSON.stringify({ schema: 2 }),
  JSON.stringify({ schema: 1, workId: 'B', state: edits() }),
  JSON.stringify({
    schema: 1,
    workId: 'A',
    state: { ...edits(), actionDrafts: [['x', { action: 3 }]] },
  }),
])('does not use malformed, obsolete, or another-work memory', (raw) => {
  const data = storage();
  data.setItem('statecarry.resume.v1.A', raw);
  expect(new LocalResumeMemory(() => data).read('A')).toBeNull();
  expect(data.getItem('statecarry.resume.v1.A')).toBe(raw);
});
it('reports storage access failures to the caller instead of promising persistence', () => {
  const memory = new LocalResumeMemory(() => {
    throw new Error('storage disabled');
  });
  expect(() => memory.read('A')).toThrow('storage disabled');
  expect(() => memory.write('A', edits())).toThrow('storage disabled');
  expect(() => memory.prune(['A'])).toThrow('storage disabled');
});

function removableStorage() {
  const data = storage();
  return {
    ...data,
    get length() {
      return data.values.size;
    },
    key: (index: number) => [...data.values.keys()][index] ?? null,
    removeItem: vi.fn((key: string) => {
      data.values.delete(key);
    }),
  };
}

it('prunes only absent registration IDs in the Resume and legacy work namespaces without transferring drafts', () => {
  const data = removableStorage();
  const memory = new LocalResumeMemory(() => data);
  for (const id of ['old-a', 'old-b', 'current', 'disconnected']) memory.write(id, edits());
  data.setItem('statecarry.resume.v1.orphan-malformed', '{');
  data.setItem('statecarry.work.v1.old-a', 'old detail draft');
  data.setItem('statecarry.work.v1.old-b', 'another old detail draft');
  data.setItem('statecarry.work.v1.current', 'current detail draft');
  data.setItem('statecarry.work.v1.disconnected', 'disconnected detail draft');
  const unrelated = {
    'statecarry.resume.v2.old-a': 'another schema',
    'statecarry.resume.v1': 'another key',
    'statecarry.resume.v1.': 'not a registration ID',
    'statecarry.browser.v1.old-a': 'legacy detail input',
    'statecarry.work.v2.old-a': 'another work schema',
    'statecarry.work.v1.': 'not a registration ID',
    'statecarry.settings': 'keep settings',
    'statecarry.theme': 'keep theme',
    'other-application-key': 'untouched',
  };
  for (const [key, value] of Object.entries(unrelated)) data.setItem(key, value);
  const current = data.getItem('statecarry.resume.v1.current');
  const disconnected = data.getItem('statecarry.resume.v1.disconnected');

  memory.prune(['new-statecarry', 'current', 'disconnected']);

  expect(data.removeItem.mock.calls).toEqual([
    ['statecarry.resume.v1.old-a'],
    ['statecarry.resume.v1.old-b'],
    ['statecarry.resume.v1.orphan-malformed'],
    ['statecarry.work.v1.old-a'],
    ['statecarry.work.v1.old-b'],
  ]);
  expect(data.getItem('statecarry.resume.v1.current')).toBe(current);
  expect(data.getItem('statecarry.resume.v1.disconnected')).toBe(disconnected);
  expect(data.getItem('statecarry.work.v1.current')).toBe('current detail draft');
  expect(data.getItem('statecarry.work.v1.disconnected')).toBe('disconnected detail draft');
  for (const [key, value] of Object.entries(unrelated)) expect(data.getItem(key)).toBe(value);
  const restarted = new LocalResumeMemory(() => data);
  expect(restarted.read('old-a')).toBeNull();
  expect(restarted.read('old-b')).toBeNull();
  expect(restarted.read('new-statecarry')).toBeNull();
  expect(restarted.read('disconnected')).toEqual(edits());
  data.removeItem.mockClear();
  memory.prune(['new-statecarry', 'current', 'disconnected']);
  expect(data.removeItem).not.toHaveBeenCalled();
});

it('supports enumerable storage adapters and an authoritative empty list', () => {
  const data = storage();
  const removeItem = vi.fn((key: string) => {
    data.values.delete(key);
  });
  const memory = new LocalResumeMemory(() => ({
    ...data,
    keys: () => data.values.keys(),
    removeItem,
  }));
  memory.write('old-a', edits());
  memory.write('old-b', edits());
  data.setItem('other-key', 'keep');
  memory.prune([]);
  expect(data.values).toEqual(new Map([['other-key', 'keep']]));
  expect(removeItem).toHaveBeenCalledTimes(2);
});

it('leaves existing get/set-only storage mocks compatible', () => {
  const data = storage();
  const memory = new LocalResumeMemory(() => data);
  memory.write('A', edits());
  expect(() => memory.prune([])).not.toThrow();
  expect(memory.read('A')).toEqual(edits());
});

it('reports enumeration failure before removing any draft', () => {
  const data = removableStorage();
  const memory = new LocalResumeMemory(() => ({
    ...data,
    key: (index: number) => {
      if (index === 1) throw new Error('key enumeration denied');
      return data.key(index);
    },
  }));
  memory.write('old-a', edits());
  memory.write('old-b', edits());
  expect(() => memory.prune([])).toThrow('key enumeration denied');
  expect(data.removeItem).not.toHaveBeenCalled();
  expect(memory.read('old-a')).toEqual(edits());
  expect(memory.read('old-b')).toEqual(edits());
});

it('reports removal failures without clearing active or unrelated storage', () => {
  const data = removableStorage();
  const memory = new LocalResumeMemory(() => ({
    ...data,
    removeItem: () => {
      throw new Error('removal denied');
    },
  }));
  memory.write('active', edits());
  memory.write('old', edits());
  data.setItem('other-key', 'keep');
  expect(() => memory.prune(['active'])).toThrow('removal denied');
  expect(memory.read('active')).toEqual(edits());
  expect(memory.read('old')).toEqual(edits());
  expect(data.getItem('other-key')).toBe('keep');
});
