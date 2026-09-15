// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Resume } from '../apps/web/src/ui/Resume';
import type { ResumeGateway, ResumeWork } from '@statecarry/presentation';

const requireWeb = createRequire(resolve('apps/web/package.json'));
const { act, createElement } = requireWeb('react') as typeof import('react');
const { createRoot } = requireWeb('react-dom/client') as typeof import('react-dom/client');
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function work(id: string): ResumeWork {
  return {
    workId: id,
    title: `Project ${id}`,
    cwd: '/synthetic-project',
    version: `${id}-v1`,
    revision: 1,
    goalText: `Goal ${id}`,
    goalOrigin: 'user-input',
    sessionCount: 1,
    updatesAvailable: false,
    busy: false,
    error: null,
    stale: false,
    state: 'ready',
    generatedAt: '2026-09-15T00:00:00Z',
    correctedKeys: [],
    dismissedKeys: [],
    workspace: {
      cwd: '/synthetic-project',
      status: 'checked',
      branch: 'main',
      commit: 'synthetic-commit',
      dirty: false,
      checkedAt: '2026-09-15T00:00:00Z',
      limitations: [],
    },
    candidates: ['first', 'second'].map((key) => ({
      key,
      goal: `${id} ${key}`,
      currentState: `${id} ${key} awaits its check`,
      status: 'active',
      reason: 'The synthetic check remains open.',
      nextAction: `Check ${id} ${key}`,
      doneWhen: `${id} ${key} check recorded`,
      actionSource: 'recorded',
      threadId: `thread-${id}`,
      prerequisites: [],
      evidence: [{ revisionId: `record-${id}`, quote: 'The synthetic check remains open.' }],
    })),
  };
}

async function setup() {
  let rows = [work('A'), work('B')];
  let listener: (() => void) | undefined;
  const gateway = {
    list: vi.fn(async () => structuredClone(rows)),
    setGoal: vi.fn<ResumeGateway['setGoal']>(async () => {}),
    correct: vi.fn<ResumeGateway['correct']>(async () => {}),
    refresh: vi.fn<ResumeGateway['refresh']>(async () => {}),
    subscribe: (onChange: () => void) => {
      listener = onChange;
      return () => {
        listener = undefined;
      };
    },
  } satisfies ResumeGateway;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const show = async (workId: string) => {
    await act(async () => {
      root.render(createElement(Resume, { gateway, workId }));
    });
  };
  const button = (label: string) => {
    const result = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(result, `Missing button: ${label}`).toBeTruthy();
    return result!;
  };
  const click = async (label: string) => {
    await act(async () => {
      button(label).click();
    });
  };
  const field = (name: string) =>
    host.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
  const type = async (name: string, value: string) => {
    const input = field(name);
    expect(input, `Missing field: ${name}`).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        value,
      );
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field(name)?.value).toBe(value);
  };
  const choose = async (key: 'first' | 'second') => {
    const choices = [...host.querySelectorAll<HTMLButtonElement>('.resume-choices button')];
    await act(async () => {
      choices[key === 'first' ? 0 : 1].click();
    });
  };
  const selected = () =>
    host.querySelector('.resume-choices button[aria-pressed="true"]')?.textContent;
  const publish = async (change: (current: ResumeWork[]) => ResumeWork[]) => {
    rows = change(structuredClone(rows));
    await act(async () => {
      listener?.();
    });
  };
  await show('A');
  return { gateway, host, show, button, click, field, type, choose, selected, publish };
}

it('keeps goal drafts owned by each work across A to B to A', async () => {
  const t = await setup();
  await t.click('Edit goal');
  await t.type('goal', 'Unsaved goal A');
  await t.show('B');
  expect(t.field('goal')).toBeNull();
  await t.click('Edit goal');
  expect(t.field('goal')?.value).toBe('Goal B');
  await t.type('goal', 'Unsaved goal B');
  await t.show('A');
  expect(t.field('goal')?.value).toBe('Unsaved goal A');
  await t.click('Save goal');
  expect(t.gateway.setGoal.mock.calls).toEqual([['A', 'Unsaved goal A', 'A-v1']]);
  await t.show('B');
  expect(t.field('goal')?.value).toBe('Unsaved goal B');
  expect(t.gateway.refresh.mock.calls).toEqual([['A']]);
});

it('preserves each work selection and each candidate correction draft', async () => {
  const t = await setup();
  await t.choose('second');
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Corrected action A second');
  await t.type('done-when', 'Checked A second');
  await t.choose('first');
  expect(t.field('next-action')).toBeNull();
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Corrected action A first');
  await t.choose('second');
  expect(t.field('next-action')?.value).toBe('Corrected action A second');
  await t.show('B');
  expect(t.field('next-action')).toBeNull();
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Corrected action B first');
  await t.show('A');
  expect(t.selected()).toContain('A second');
  expect(t.field('next-action')?.value).toBe('Corrected action A second');
  expect(t.field('done-when')?.value).toBe('Checked A second');
  await t.click('Save correction');
  expect(t.gateway.correct.mock.calls).toEqual([
    [
      'A',
      {
        candidateKey: 'second',
        version: 'A-v1',
        kind: 'wrong-action',
        nextAction: 'Corrected action A second',
        doneWhen: 'Checked A second',
      },
    ],
  ]);
  await t.show('B');
  expect(t.selected()).toContain('B first');
  expect(t.field('next-action')?.value).toBe('Corrected action B first');
});

it('lets B save while A is pending and keeps B input and selection after A finishes', async () => {
  const t = await setup();
  const pending = deferred<void>();
  t.gateway.setGoal.mockImplementationOnce(() => pending.promise);
  await t.click('Edit goal');
  await t.type('goal', 'Submitted goal A');
  await t.click('Save goal');
  await t.show('B');
  await t.choose('second');
  await t.click('Edit goal');
  await t.type('goal', 'Still editing B');
  expect(t.button('Save goal').disabled).toBe(false);
  await act(async () => {
    pending.resolve();
  });
  expect(t.field('goal')?.value).toBe('Still editing B');
  expect(t.selected()).toContain('B second');
  expect(t.gateway.setGoal).toHaveBeenCalledTimes(1);
  expect(t.gateway.refresh.mock.calls).toEqual([['A']]);
});

it('retains a newer edit to A when its earlier goal save completes', async () => {
  const t = await setup();
  const pending = deferred<void>();
  t.gateway.setGoal.mockImplementationOnce(() => pending.promise);
  await t.click('Edit goal');
  await t.type('goal', 'Submitted A');
  await t.click('Save goal');
  await t.show('B');
  await t.show('A');
  await t.type('goal', 'Newer unsaved A');
  await act(async () => {
    pending.resolve();
  });
  expect(t.field('goal')?.value).toBe('Newer unsaved A');
});

it.each(['save', 'refresh'] as const)(
  'keeps a late A %s error off B and available on returning to A',
  async (operation) => {
    const t = await setup();
    const pending = deferred<void>();
    if (operation === 'save') {
      t.gateway.setGoal.mockImplementationOnce(() => pending.promise);
      await t.click('Edit goal');
      await t.click('Save goal');
    } else {
      t.gateway.refresh.mockImplementationOnce(() => pending.promise);
      await t.click('Recheck records');
    }
    await t.show('B');
    await t.click('Edit goal');
    await t.type('goal', 'Keep B input');
    await act(async () => {
      pending.reject(new Error(`A ${operation} failed`));
    });
    expect(t.host.querySelector('.resume-error')).toBeNull();
    expect(t.field('goal')?.value).toBe('Keep B input');
    await t.show('A');
    expect(t.host.querySelector('.resume-error')?.textContent).toContain(`A ${operation} failed`);
  },
);

it('does not let a late correction for A close B correction or replace its error', async () => {
  const t = await setup();
  const pending = deferred<void>();
  t.gateway.correct.mockImplementationOnce(() => pending.promise);
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Submitted A correction');
  await t.click('Save correction');
  await t.show('B');
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Keep B correction');
  t.gateway.refresh.mockRejectedValueOnce(new Error('B recheck failed'));
  await t.click('Recheck records');
  await act(async () => {
    pending.resolve();
  });
  expect(t.field('next-action')?.value).toBe('Keep B correction');
  expect(t.host.querySelector('.resume-error')?.textContent).toContain('B recheck failed');
  expect(t.host.textContent).not.toContain('Your correction was saved');
});

it('keeps B data, errors and selection when A follow-up list response arrives late', async () => {
  const t = await setup();
  const oldRows = [work('A'), work('B')];
  const pending = deferred<ResumeWork[]>();
  t.gateway.list.mockImplementationOnce(() => pending.promise);
  await t.click('Edit goal');
  await t.click('Save goal');
  await t.show('B');
  await t.choose('second');
  await t.publish((rows) =>
    rows.map((row) =>
      row.workId === 'B' ? { ...row, goalText: 'New B server goal', version: 'B-v2' } : row,
    ),
  );
  t.gateway.refresh.mockRejectedValueOnce(new Error('Keep B error'));
  await t.click('Recheck records');
  await act(async () => {
    pending.resolve(oldRows);
  });
  expect(t.host.querySelector('.resume-card h1')?.textContent).toBe('New B server goal');
  expect(t.selected()).toContain('B second');
  expect(t.host.querySelector('.resume-error')?.textContent).toContain('Keep B error');
});

it('does not quietly replace a selected candidate removed during a recheck', async () => {
  const t = await setup();
  await t.choose('second');
  await t.click('Right work, wrong next step');
  await t.type('next-action', 'Keep missing candidate draft');
  await t.click('Recheck records');
  await t.publish((rows) =>
    rows.map((row) =>
      row.workId === 'A'
        ? { ...row, generatedAt: '2026-09-15T00:01:00Z', candidates: [row.candidates[0]] }
        : row,
    ),
  );
  expect(t.host.querySelector('.resume-card')).toBeNull();
  expect(t.host.textContent).toContain('The selected candidate needs a recheck');
  await t.show('B');
  await t.choose('second');
  await t.show('A');
  expect(t.host.querySelector('.resume-card')).toBeNull();
  await t.publish((rows) =>
    rows.map((row) => (row.workId === 'A' ? { ...row, candidates: work('A').candidates } : row)),
  );
  expect(t.selected()).toContain('A second');
  expect(t.field('next-action')?.value).toBe('Keep missing candidate draft');
});

it('does not put a completed refresh back into checking when its acceptance arrives late', async () => {
  const t = await setup();
  const pending = deferred<void>();
  t.gateway.refresh.mockImplementationOnce(() => pending.promise);
  await t.click('Recheck records');
  await t.publish((rows) =>
    rows.map((row) => (row.workId === 'A' ? { ...row, generatedAt: '2026-09-15T00:01:00Z' } : row)),
  );
  await act(async () => {
    pending.resolve();
  });
  expect(t.button('Recheck records').disabled).toBe(false);
  expect(t.host.textContent).not.toContain('Checking connected records');
});
