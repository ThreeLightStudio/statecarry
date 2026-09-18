// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectWorkspace, ResumeGateway } from '@statecarry/presentation';
import {
  act,
  button,
  deferred,
  installBrowser,
  mountProjectRoot,
  press,
  projectEntry,
  projectUiFixture,
  typeField,
} from './project-ui-fixtures';

beforeEach(installBrowser);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps the real project explanation and editor stable while a burst of changes is checked', async () => {
  const h = projectUiFixture([projectEntry('alpha'), projectEntry('beta')]);
  let changed!: Parameters<NonNullable<ResumeGateway['subscribe']>>[0];
  h.resumeGateway.subscribe = (listener) => {
    changed = listener;
    return () => {};
  };
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    await press(mounted.host, 'Edit direction');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Keep my unfinished goal');
    const goal = mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')!;
    goal.focus();
    goal.setSelectionRange(4, 8);
    const nextChoice = mounted.host.querySelector('.pw-decision-main')!.textContent;
    const nextRead = deferred<ProjectWorkspace>();
    vi.mocked(h.projectGateway.list).mockImplementationOnce(() => nextRead.promise);
    vi.useFakeTimers();
    await act(async () => {
      for (let count = 0; count < 20; count++) changed({ workId: 'alpha' });
    });
    expect(mounted.host.querySelector('.pw-decision-main')!.textContent).toBe(nextChoice);
    expect(mounted.host.querySelector('[aria-labelledby="project-context-heading"]')).toBeTruthy();
    expect(mounted.host.textContent).not.toContain('Reading saved state…');
    expect(goal.value).toBe('Keep my unfinished goal');
    expect(document.activeElement).toBe(goal);
    expect([goal.selectionStart, goal.selectionEnd]).toEqual([4, 8]);
    expect(button(mounted.host, 'Save goal').disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      nextRead.resolve(structuredClone(h.rows));
    });
    expect(button(mounted.host, 'Save goal').disabled).toBe(false);
    expect(mounted.host.querySelector('.pw-decision-main')!.textContent).toBe(nextChoice);
    expect(document.activeElement).toBe(goal);
    expect(goal.value).toBe('Keep my unfinished goal');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(2);
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await mounted.unmount();
  }
});

it('checks once on app return, with no periodic read or analysis', async () => {
  const h = projectUiFixture();
  window.history.replaceState(null, '', '#/project/alpha');
  const mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway);
  try {
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(1);
    const returnedRead = deferred<ProjectWorkspace>();
    vi.mocked(h.projectGateway.list).mockImplementationOnce(() => returnedRead.promise);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(h.projectGateway.list).toHaveBeenCalledTimes(2);
    expect(mounted.host.querySelector('.pw-app-header .pw-workspace-status')?.textContent).toBe(
      'Checking for changes…',
    );
    expect(mounted.host.querySelector('.pw-app-header')?.textContent).toContain('Send feedback');
    expect(mounted.host.querySelector('.pw-app-header')?.textContent).not.toContain(
      'Check for changes',
    );
    await act(async () => {
      returnedRead.resolve(structuredClone(h.rows));
    });
    expect(mounted.host.querySelector('.pw-workspace-status')).toBeNull();
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(h.resumeGateway.setGoal).not.toHaveBeenCalled();
    expect(h.resumeGateway.correct).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    await mounted.unmount();
  }
});
