import { describe, expect, it } from 'vitest';
import { presentWorkingTree } from '@statecarry/presentation';
import type { WorkspaceSnapshot } from '@statecarry/contracts';

function snapshot(patch: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    cwd: '/repo',
    root: '/repo',
    branch: 'main',
    commit: 'abcdef123456',
    dirty: true,
    status: 'checked',
    checkedAt: '2026-09-18T00:00:00.000Z',
    limitations: [],
    changedPaths: ['apps/web/src/App.tsx'],
    changedFiles: [{ path: 'apps/web/src/App.tsx', status: 'modified' }],
    changedFileCount: 1,
    additions: 10,
    deletions: 2,
    untrackedCount: 0,
    recentCommits: [
      {
        hash: 'abcdef123456',
        subject: 'previous work',
        committedAt: '2026-09-17T00:00:00.000Z',
        changedPaths: ['apps/web/src/App.tsx'],
      },
    ],
    ...patch,
  };
}

describe('working-tree presentation', () => {
  it('distinguishes clean, normal, semantic-mixed, large and no-Git states', () => {
    expect(
      presentWorkingTree(
        snapshot({ dirty: false, changedPaths: [], changedFiles: [], changedFileCount: 0 }),
      ).kind,
    ).toBe('clean');
    expect(presentWorkingTree(snapshot()).kind).toBe('normal');
    expect(
      presentWorkingTree(
        snapshot({
          changedPaths: ['apps/web/src/App.tsx', 'docs/readme.md'],
          changedFiles: [
            { path: 'apps/web/src/App.tsx', status: 'modified' },
            { path: 'docs/readme.md', status: 'modified' },
          ],
          changedFileCount: 2,
          workingTreeAnalysis: {
            summary: 'Two distinct pieces of work are present.',
            groups: [
              {
                title: 'Workspace interaction update',
                summary: 'Adjust the workspace interaction.',
                currentState: 'The workspace component has an uncommitted interaction change.',
                suggestedNextStep: 'Review the interaction in the running app.',
                reason: 'The diff shows the interaction change but not user validation.',
                doneWhen: 'The interaction is understandable and behaves as intended.',
                openItems: [],
                files: ['apps/web/src/App.tsx'],
              },
              {
                title: 'Release documentation',
                summary: 'Update release documentation for the same project state.',
                currentState: 'The README has an uncommitted documentation change.',
                suggestedNextStep: 'Review the release copy against the current behavior.',
                reason: 'The documentation should match the changed interaction.',
                doneWhen: 'The release copy describes the current behavior accurately.',
                openItems: [],
                files: ['docs/readme.md'],
              },
            ],
          },
        }),
      ).kind,
    ).toBe('mixed');
    expect(presentWorkingTree(snapshot({ changedFileCount: 51 })).kind).toBe('large');
    expect(presentWorkingTree(snapshot({ dirty: null, commit: null, branch: null })).kind).toBe(
      'no-git',
    );
  });

  it('exposes current repository evidence without requiring conversation history', () => {
    const view = presentWorkingTree(
      snapshot({
        untrackedCount: 1,
        workingTreeAnalysis: {
          summary: 'Working-tree recovery is being added.',
          groups: [
            {
              title: 'Working-tree recovery',
              summary: 'Connect Git state to the project workspace.',
              currentState: 'The current diff adds working-tree recovery UI and state.',
              suggestedNextStep: 'Review the current handoff output.',
              reason: 'The handoff is the next user-visible boundary introduced by the diff.',
              doneWhen:
                'A new session receives enough direction to continue without broad reconstruction.',
              openItems: ['Review the continuation handoff.'],
              files: ['apps/web/src/App.tsx'],
            },
          ],
        },
      }),
    );
    expect(view).toMatchObject({
      kind: 'normal',
      branch: 'main',
      head: 'abcdef123456',
      lastCommit: 'previous work',
      fileCount: 1,
      additions: 10,
      deletions: 2,
      untrackedCount: 1,
      groups: [expect.objectContaining({ title: 'Working-tree recovery' })],
      summary: 'Working-tree recovery is being added.',
    });
    expect(view.groups[0]).toMatchObject({
      suggestedNextStep: 'Review the current handoff output.',
      reason: 'The handoff is the next user-visible boundary introduced by the diff.',
      doneWhen: 'A new session receives enough direction to continue without broad reconstruction.',
    });
  });
});
