// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Connection, RecordRange } from '@statecarry/contracts';
import { harness } from './helpers';
import {
  act,
  installBrowser,
  mountProjectRoot,
  press,
  projectUiFixture,
  typeField,
} from './project-ui-fixtures';

beforeEach(installBrowser);
afterEach(() => vi.unstubAllGlobals());

const bounded = (name: string): RecordRange => ({
  start: { turnId: `${name}-first-turn`, itemId: `${name}-first-item` },
  end: { turnId: `${name}-last-turn`, itemId: `${name}-last-item` },
});

function sourceScopeFixture(
  explicit: Partial<Pick<Connection, 'startTurnIds' | 'recordRanges'>> = {},
) {
  const h = harness();
  const id = h.connect();
  const connection = h.core.connection(h.core.work(id).projectId);
  const inherited = {
    startTurnIds: {
      'thread-a': 'inherited-a-first-turn',
      'thread-b': 'inherited-b-first-turn',
      'thread-c': 'inherited-c-first-turn',
    },
    recordRanges: {
      'thread-a': bounded('inherited-a'),
      'thread-b': bounded('inherited-b'),
      'thread-c': bounded('inherited-c'),
    },
  };
  h.repo.put('connection', {
    ...connection,
    startTurnIds: {},
    recordRanges: {},
    discover: true,
    ...explicit,
    discoveryScope: inherited,
  });
  const { projectGateway, resumeGateway } = projectUiFixture([]);
  projectGateway.list = vi.fn(async () => h.core.projects.list());
  projectGateway.connections = vi.fn(async () => h.core.listConnections());
  projectGateway.sources = vi.fn(async (workId, revision, input) =>
    h.core.projects.sources(workId, {
      requestId: h.core.ids.next(),
      expectedRevision: revision,
      payload: input,
    }),
  );
  projectGateway.discover = vi.fn(async () => ({
    threads: ['a', 'b', 'c'].map((key) => ({
      id: `thread-${key}`,
      title: `Conversation ${key}`,
      cwd: connection.cwd,
    })),
    complete: true,
    limitations: [],
  }));
  projectGateway.turns = vi.fn(async () => ({
    turns: [{ id: inherited.startTurnIds['thread-a'], at: null }],
  }));
  return {
    h,
    id,
    inherited,
    projectGateway,
    resumeGateway,
    connection: () => h.core.connection(connection.id),
  };
}

function conversation(host: HTMLElement, title: string): HTMLElement {
  const row = [...host.querySelectorAll<HTMLElement>('.pw-source-row')].find(
    (item) => item.querySelector('.pw-checkbox')?.textContent?.trim() === title,
  );
  expect(row, `Missing conversation ${title}`).toBeTruthy();
  return row!;
}

function bounds(row: HTMLElement) {
  return [...row.querySelectorAll<HTMLInputElement>('fieldset input')].map((input) => input.value);
}

async function choose(row: HTMLElement) {
  await act(async () => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}

it('keeps inherited first and last boundaries when a real connection is saved without source edits', async () => {
  const f = sourceScopeFixture();
  const revision = f.h.core.work(f.id).revision;
  window.history.replaceState(null, '', `#/project/${f.id}/settings`);
  const mounted = await mountProjectRoot(f.projectGateway, f.resumeGateway);
  try {
    expect(f.connection().startTurnIds).toEqual({});
    expect(f.connection().recordRanges).toEqual({});
    expect(bounds(conversation(mounted.host, 'Connected conversation 1'))).toEqual([
      'inherited-a-first-turn',
      'inherited-a-first-item',
      'inherited-a-last-turn',
      'inherited-a-last-item',
    ]);
    expect(f.projectGateway.sources).not.toHaveBeenCalled();

    await press(mounted.host, 'Save conversations');
    const selected = {
      threadIds: ['thread-a'],
      startTurnIds: { 'thread-a': f.inherited.startTurnIds['thread-a'] },
      recordRanges: { 'thread-a': f.inherited.recordRanges['thread-a'] },
      discover: true,
    };
    expect(f.projectGateway.sources).toHaveBeenCalledWith(f.id, revision, selected);
    expect(f.connection()).toMatchObject(selected);
    expect(f.connection().discoveryScope).toEqual({
      startTurnIds: {
        'thread-b': f.inherited.startTurnIds['thread-b'],
        'thread-c': f.inherited.startTurnIds['thread-c'],
      },
      recordRanges: {
        'thread-b': f.inherited.recordRanges['thread-b'],
        'thread-c': f.inherited.recordRanges['thread-c'],
      },
    });
    expect(f.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(f.h.counts()).toMatchObject({ generationCalls: 0, checkCalls: 0 });
  } finally {
    await mounted.unmount();
  }
});

it('seeds a newly selected discovered conversation while preserving explicit and edited selected boundaries', async () => {
  const explicit = bounded('explicit-a');
  const f = sourceScopeFixture({
    startTurnIds: { 'thread-a': 'explicit-a-first-turn' },
    recordRanges: { 'thread-a': explicit },
  });
  const revision = f.h.core.work(f.id).revision;
  window.history.replaceState(null, '', `#/project/${f.id}/settings`);
  const mounted = await mountProjectRoot(f.projectGateway, f.resumeGateway);
  try {
    await press(mounted.host, 'Find related conversations');
    const first = conversation(mounted.host, 'Conversation a');
    expect(bounds(first)).toEqual([
      'explicit-a-first-turn',
      'explicit-a-first-item',
      'explicit-a-last-turn',
      'explicit-a-last-item',
    ]);
    await typeField(first, 'fieldset:last-of-type label:last-child input', 'edited-last-item');
    await choose(conversation(mounted.host, 'Conversation b'));
    expect(bounds(conversation(mounted.host, 'Conversation b'))).toEqual([
      'inherited-b-first-turn',
      'inherited-b-first-item',
      'inherited-b-last-turn',
      'inherited-b-last-item',
    ]);
    await choose(conversation(mounted.host, 'Conversation c'));
    await choose(conversation(mounted.host, 'Conversation c'));
    await press(mounted.host, 'Save conversations');

    const selected = {
      threadIds: ['thread-a', 'thread-b'],
      startTurnIds: {
        'thread-a': 'explicit-a-first-turn',
        'thread-b': f.inherited.startTurnIds['thread-b'],
      },
      recordRanges: {
        'thread-a': { ...explicit, end: { ...explicit.end!, itemId: 'edited-last-item' } },
        'thread-b': f.inherited.recordRanges['thread-b'],
      },
      discover: true,
    };
    expect(f.projectGateway.sources).toHaveBeenCalledWith(f.id, revision, selected);
    expect(f.connection()).toMatchObject(selected);
    expect(f.connection().discoveryScope).toEqual({
      startTurnIds: { 'thread-c': f.inherited.startTurnIds['thread-c'] },
      recordRanges: { 'thread-c': f.inherited.recordRanges['thread-c'] },
    });
    expect(f.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(f.h.counts()).toMatchObject({ generationCalls: 0, checkCalls: 0 });
  } finally {
    await mounted.unmount();
  }
});

it('does not restore deliberately cleared boundaries on another selected conversation', async () => {
  const f = sourceScopeFixture();
  window.history.replaceState(null, '', `#/project/${f.id}/settings`);
  const mounted = await mountProjectRoot(f.projectGateway, f.resumeGateway);
  try {
    await press(mounted.host, 'Find related conversations');
    const first = conversation(mounted.host, 'Conversation a');
    await press(first, 'Use starting point onward');
    await press(first, 'Choose a starting point');
    await typeField(first, 'select', '');
    await choose(conversation(mounted.host, 'Conversation b'));
    await press(mounted.host, 'Save conversations');

    const saved = f.connection();
    expect(saved.threadIds).toEqual(['thread-a', 'thread-b']);
    expect(saved.startTurnIds).toEqual({ 'thread-b': f.inherited.startTurnIds['thread-b'] });
    expect(saved.recordRanges).toEqual({ 'thread-b': f.inherited.recordRanges['thread-b'] });
    expect(f.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});

it('selects all discovered Codex conversations while preserving inherited boundaries', async () => {
  const f = sourceScopeFixture();
  window.history.replaceState(null, '', `#/project/${f.id}/settings`);
  const mounted = await mountProjectRoot(f.projectGateway, f.resumeGateway);
  try {
    await press(mounted.host, 'Find related conversations');
    await press(mounted.host, 'Select all');
    expect(mounted.host.textContent).toContain('3 selected');
    await press(mounted.host, 'Save conversations');
    expect(f.connection()).toMatchObject({
      threadIds: ['thread-a', 'thread-b', 'thread-c'],
      startTurnIds: f.inherited.startTurnIds,
      recordRanges: f.inherited.recordRanges,
    });
    expect(f.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
  }
});
