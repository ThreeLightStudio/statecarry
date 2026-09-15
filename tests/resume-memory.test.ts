import { expect, it } from 'vitest';
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
});
