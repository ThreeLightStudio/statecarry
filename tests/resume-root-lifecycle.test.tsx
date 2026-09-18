// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  browserDrafts,
  button,
  follow,
  go,
  installBrowser,
  mountProjectRoot,
  press,
  projectUiFixture,
  RAW_ERROR,
  RAW_SOURCE,
  settle,
  toggleDetails,
  typeField,
} from './project-ui-fixtures';

beforeEach(installBrowser);
afterEach(() => vi.unstubAllGlobals());

it('preserves the exact task and original edit versions through real Root Home/original navigation and restart without reviving removed tasks', async () => {
  const h = projectUiFixture();
  const drafts = browserDrafts();
  window.history.replaceState(null, '', '#/resume/alpha');
  let mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, drafts.memory());
  const expectDraft = () => {
    expect(mounted.host.querySelector('[aria-label="Selected task"] h2')?.textContent).toContain(
      'Ship second alpha export',
    );
    expect(mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="goal"]')?.value).toBe(
      'Unsaved root goal',
    );
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="next-action"]')?.value,
    ).toBe('Unsaved root action');
    expect(
      mounted.host.querySelector<HTMLTextAreaElement>('textarea[name="done-when"]')?.value,
    ).toBe('Check the result in the working tool');
  };
  try {
    expect(window.location.hash).toBe('#/project/alpha');
    await follow(mounted.host, '#/project/alpha?task=second');
    await press(mounted.host, 'Edit direction');
    await typeField(mounted.host, 'textarea[name="goal"]', 'Unsaved root goal');
    await press(mounted.host, 'Edit next step');
    await typeField(mounted.host, 'textarea[name="next-action"]', 'Unsaved root action');
    await typeField(
      mounted.host,
      'textarea[name="done-when"]',
      'Check the result in the working tool',
    );
    await toggleDetails(mounted.host, 'What is this based on?');
    await act(async () => {
      Object.defineProperty(window, 'scrollY', { value: 190, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expectDraft();
    expect(drafts.memory().read('alpha')).toMatchObject({
      selectedKey: 'second',
      goalDraft: { text: 'Unsaved root goal', version: 'resume-v1' },
      scroll: 190,
    });
    expect(h.projectGateway.evidence).not.toHaveBeenCalled();
    expect(mounted.host.textContent).not.toContain(RAW_SOURCE);

    await toggleDetails(mounted.host, 'Inspect original records');
    await follow(mounted.host, '#/project/alpha/original/source-alpha?task=second');
    expect(mounted.host.querySelector('[aria-label="Selected task"]')).toBeNull();
    expect(mounted.host.querySelector('pre[aria-label="Original record text"]')?.textContent).toBe(
      RAW_SOURCE,
    );
    expect(h.projectGateway.evidence).toHaveBeenCalledWith('alpha', 'source-alpha');
    await follow(mounted.host, '#/project/alpha?task=second');
    expectDraft();
    expect(mounted.host.textContent).not.toContain(RAW_SOURCE);
    expect(mounted.host.querySelectorAll('details[open]')).toHaveLength(1);

    await follow(mounted.host, '#/home');
    expect(mounted.host.querySelector('textarea')).toBeNull();
    h.rows.projects[0].resume!.version = 'resume-v2';
    await go('#/project/alpha');
    expectDraft();
    expect(button(mounted.host, 'Save goal').disabled).toBe(true);
    expect(button(mounted.host, 'Save next step').disabled).toBe(true);
    expect(drafts.memory().read('alpha')!.goalDraft!.version).toBe('resume-v1');
    expect(drafts.memory().read('alpha')!.actionDrafts[0][1].version).toBe('resume-v1');

    await mounted.unmount();
    mounted = await mountProjectRoot(h.projectGateway, h.resumeGateway, drafts.memory());
    expectDraft();
    expect(drafts.memory().read('alpha')!.goalDraft!.version).toBe('resume-v1');

    const list = vi.mocked(h.projectGateway.list);
    list.mockRejectedValue(new Error(RAW_ERROR));
    await go('#/project/alpha?task=second');
    expectDraft();
    expect(mounted.host.textContent).toContain("StateCarry can't connect to its local service.");
    expect(mounted.host.querySelector('.pw-app-header .pw-workspace-status')?.textContent).toBe(
      "StateCarry can't connect to its local service.",
    );
    expect(mounted.host.querySelector('.pw-app-header')?.textContent).toContain(
      "StateCarry can't connect to its local service.",
    );
    expect(mounted.host.textContent).not.toContain(RAW_ERROR);
    expect(button(mounted.host, 'Save next step').disabled).toBe(true);
    list.mockImplementation(async () => structuredClone(h.rows));
    await press(mounted.host, 'Try again');
    expectDraft();

    await follow(mounted.host, '#/home');
    h.rows.projects[0].resume!.candidates = [];
    await go('#/project/alpha');
    expect(mounted.host.querySelector('[aria-label="Selected task"]')).toBeNull();
    expect(mounted.host.querySelector('textarea[name="next-action"]')).toBeNull();
    expect(mounted.host.textContent).toContain('The selected work is no longer available');
    expect(drafts.memory().read('alpha')!.selectedKey).toBe('second');
    expect(h.projectGateway.list).toHaveBeenCalled();
    expect(h.resumeGateway.list).not.toHaveBeenCalled();
    expect(h.resumeGateway.refresh).not.toHaveBeenCalled();
    expect(h.resumeGateway.setGoal).not.toHaveBeenCalled();
    expect(h.resumeGateway.correct).not.toHaveBeenCalled();
    for (const method of [
      'create',
      'settings',
      'sources',
      'disconnect',
      'restore',
      'delete',
    ] as const)
      expect(h.projectGateway[method]).not.toHaveBeenCalled();
  } finally {
    await mounted.unmount();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    await settle();
  }
});
