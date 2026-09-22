import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SQLiteRepository } from '../apps/server/src/adapters/sqlite';
import { AT, harness } from './helpers';
import { deletionCommand, projectCandidate, registerProject } from './project-fixtures';

describe('product model migration boundary', () => {
  it('reads native project direction without mutating or re-materializing legacy state', () => {
    const h = harness();
    const { receipt } = registerProject(h, {
      title: 'StateCarry',
      purpose: 'Reduce the cost of returning to interrupted work.',
      goal: 'Make project return lead to one clear next action.',
    });
    const id = receipt.projectId;
    const legacy = h.core.project(id);
    h.repo.put('project', { ...legacy });
    h.core.storeAnalysis({
      id: legacy.id,
      projectId: legacy.id,
      result: {
        scope: 'legacy-scope',
        version: 'legacy-version',
        generatedAt: AT,
        candidates: [projectCandidate()],
      },
    });
    h.repo.put('projectObservation', {
      id,
      projectId: id,
      checkedAt: AT,
      probeKey: 'probe-a',
      inspectionKey: 'inspection-a',
      semanticKey: 'semantic-a',
      snapshot: {
        cwd: '/tmp/example',
        branch: null,
        commit: null,
        dirty: false,
        status: 'checked',
        checkedAt: AT,
        limitations: [],
      },
    });

    const before = structuredClone((h.repo as import('./helpers').MemoryRepository).data);
    expect(h.core.projectModel.view(id)).toMatchObject({
      project: {
        id,
        title: 'StateCarry',
        purposes: [
          {
            text: 'Reduce the cost of returning to interrupted work.',
            origin: 'user',
            confirmed: true,
          },
        ],
        lifecycle: 'active',
      },
      directions: [
        {
          projectId: id,
          text: 'Make project return lead to one clear next action.',
          origin: 'user',
          confirmed: true,
          primary: true,
        },
      ],
      workItems: [],
      latestObservation: { id, semanticKey: 'semantic-a' },
    });
    expect((h.repo as import('./helpers').MemoryRepository).data).toEqual(before);
    expect(h.repo.list('direction')).toHaveLength(1);
    expect(h.repo.list('workItem')).toEqual([]);

    h.core.projectModel.view(id);
    expect(h.repo.list('direction')).toHaveLength(1);
    expect(h.repo.list('workItem')).toEqual([]);
  });

  it('does not import an inferred legacy goal into native direction state', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: undefined });
    const legacy = h.core.project(receipt.projectId);
    h.repo.put('direction', {
      id: 'suggested-direction',
      projectId: legacy.id,
      text: 'Improve the project return flow.',
      origin: 'suggested',
      confirmed: false,
      state: 'active',
      primary: false,
      createdAt: AT,
    });

    expect(h.core.projectModel.directions(receipt.projectId).every((item) => !item.confirmed)).toBe(
      true,
    );
    h.core.projectModel.view(receipt.projectId);
    expect(h.repo.list('direction').every((item) => !item.confirmed)).toBe(true);
  });

  it('keeps a selected legacy completion proposal active and migration idempotent', () => {
    const h = harness();
    const changed = vi.spyOn(h.core.events, 'changed');
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    h.repo.put('project', { ...h.core.project(projectId) });
    h.core.storeAnalysis({
      id: h.core.project(projectId).id,
      projectId: h.core.project(projectId).id,
      result: {
        scope: 'legacy-scope',
        version: 'legacy-version',
        generatedAt: AT,
        candidates: [{ ...projectCandidate(), status: 'done' }],
      },
    });
    changed.mockClear();

    h.core.projectModel.selectProposal(projectId, 'analysis:export-check');
    h.core.projectModel.selectProposal(projectId, 'analysis:export-check');

    expect(changed).toHaveBeenCalledTimes(1);

    expect(h.repo.list('workItem')).toEqual([
      expect.objectContaining({
        projectId,
        title: 'Finish export validation',
        origin: 'reconstructed',
        state: 'active',
      }),
    ]);
    expect(
      h.repo
        .list('workDecision')
        .filter((decision) => decision.kind === 'link-work-proposal' && decision.state === 'valid'),
    ).toHaveLength(1);
    expect(
      h.repo
        .list('workDecision')
        .filter(
          (decision) => decision.kind === 'select-current-work' && decision.state === 'valid',
        ),
    ).toHaveLength(1);
    expect(
      h.repo
        .list('workDecision')
        .filter(
          (decision) => decision.kind === 'select-current-work' && decision.state === 'valid',
        )[0],
    ).toMatchObject({
      workItemId: h.repo.list('workItem')[0].id,
      value: { workItemId: h.repo.list('workItem')[0].id },
    });
    expect(h.core.now.resolve(projectId).currentWorkId).toBe(h.repo.list('workItem')[0].id);
  });

  it('repairs a malformed historical selection when the user selects the work again', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;
    const model = h.core.projectModel.createWork(
      projectId,
      { title: 'Keep the return state stable', completionCondition: null },
      'create-stable-work',
    );
    const workItemId = model.workItems[0].id;
    const original = h.repo
      .list('workDecision')
      .find((decision) => decision.kind === 'select-current-work')!;
    h.repo.put('workDecision', { ...original, value: { workItemId: 'different-work' } });

    h.core.projectModel.selectCurrentWork(projectId, workItemId);

    const selections = h.repo
      .list('workDecision')
      .filter((decision) => decision.kind === 'select-current-work');
    expect(selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, state: 'superseded' }),
        expect.objectContaining({ state: 'valid', workItemId, value: { workItemId } }),
      ]),
    );
    expect(h.core.now.resolve(projectId).currentWorkId).toBe(workItemId);
  });

  it('creates user-defined durable work without generated proposal identity', () => {
    const h = harness();
    const { receipt } = registerProject(h, { goal: 'Improve project return.' });
    const projectId = receipt.projectId;

    h.core.projectModel.createWork(
      projectId,
      {
        title: 'Define the next return experiment',
        completionCondition: 'One bounded experiment has a recorded result.',
      },
      'create-work-request',
    );
    h.core.projectModel.createWork(
      projectId,
      {
        title: 'Define the next return experiment',
        completionCondition: 'One bounded experiment has a recorded result.',
      },
      'create-work-request',
    );

    expect(h.repo.list('workItem')).toEqual([
      expect.objectContaining({
        projectId,
        title: 'Define the next return experiment',
        origin: 'user',
        completionCondition: 'One bounded experiment has a recorded result.',
        completionConditionOrigin: 'user',
      }),
    ]);
    expect(h.core.now.resolve(projectId)).toMatchObject({
      currentWorkId: h.repo.list('workItem')[0].id,
      currentWorkSelection: 'user',
      next: { kind: 'continue-work' },
    });
    expect(
      h.repo.list('workDecision').filter((decision) => decision.kind === 'link-work-proposal'),
    ).toEqual([]);
  });

  it('persists new project-owned entities across restart and removes them with project data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-product-model-'));
    let repo = new SQLiteRepository(directory);
    try {
      let h = harness(repo);
      const { receipt } = registerProject(h, {
        title: 'Migrating project',
        goal: 'Adopt durable work identity.',
      });
      const projectId = receipt.projectId;
      h.core.projectModel.view(projectId);
      repo.put('workItem', {
        id: 'work-item-a',
        projectId,
        title: 'Build project Now resolver',
        state: 'active',
        origin: 'user',
        completionCondition: 'The current work resolves without generated candidate identity.',
        completionConditionOrigin: 'user',
        createdAt: AT,
        updatedAt: AT,
      });
      repo.put('workItem', {
        id: 'work-item-b',
        projectId,
        title: 'Replace the project surface',
        state: 'waiting',
        origin: 'user',
        completionCondition: null,
        completionConditionOrigin: null,
        createdAt: AT,
        updatedAt: AT,
      });
      repo.put('workRelation', {
        id: 'relation-a-b',
        projectId,
        fromWorkId: 'work-item-a',
        toWorkId: 'work-item-b',
        kind: 'next-after',
        state: 'active',
        basis: 'user-approved-order',
        confirmedByUser: true,
        createdAt: AT,
      });
      repo.put('workDecision', {
        id: 'decision-current',
        projectId,
        workItemId: 'work-item-a',
        kind: 'select-current-work',
        value: { workItemId: 'work-item-a' },
        basis: [],
        state: 'valid',
        decidedAt: AT,
      });
      repo.put('returnPoint', {
        id: 'return-point-a',
        projectId,
        workItemId: 'work-item-a',
        basis: 'observation-a',
        current: 'The migration domain contracts are in place.',
        remaining: 'Add the resolver.',
        next: 'Implement the first Now resolver case.',
        createdAt: AT,
      });
      const discussion = {
        workItemId: 'work-item-a',
        basis: 'observation-a',
        turns: [
          {
            question: 'What remains before this is safe to continue?',
            answer: {
              items: [
                {
                  id: 'discussion-item-a',
                  kind: 'record' as const,
                  nature: 'file-observation' as const,
                  text: 'The resolver still needs the Project UI cutover.',
                  uncertainty: '',
                  evidence: [],
                },
              ],
              unknowns: [],
              limitations: [],
            },
            basis: 'observation-a',
          },
        ],
      };
      h.core.projectModel.syncDiscussion(projectId, discussion);
      h.core.projectModel.syncDiscussion(projectId, discussion);
      expect(repo.list('workDiscussion')[0].turns).toHaveLength(1);

      repo.close();
      repo = new SQLiteRepository(directory);
      h = harness(repo);
      expect(h.core.projectModel.view(projectId)).toMatchObject({
        directions: [expect.objectContaining({ text: 'Adopt durable work identity.' })],
        workItems: [
          expect.objectContaining({ id: 'work-item-a' }),
          expect.objectContaining({ id: 'work-item-b' }),
        ],
        relations: [expect.objectContaining({ id: 'relation-a-b', kind: 'next-after' })],
        decisions: [expect.objectContaining({ id: 'decision-current' })],
        returnPoints: [expect.objectContaining({ id: 'return-point-a' })],
        discussions: [
          expect.objectContaining({
            workItemId: 'work-item-a',
            basis: 'observation-a',
            turns: [
              expect.objectContaining({
                question: 'What remains before this is safe to continue?',
              }),
            ],
          }),
        ],
      });
      expect(
        repo.db.prepare('SELECT DISTINCT owner_id FROM entities WHERE kind=?').all('workItem'),
      ).toEqual([{ owner_id: projectId }]);

      h.core.projects.delete(projectId, deletionCommand(h, projectId));
      expect(repo.list('direction')).toEqual([]);
      expect(repo.list('workItem')).toEqual([]);
      expect(repo.list('workRelation')).toEqual([]);
      expect(repo.list('workDecision')).toEqual([]);
      expect(repo.list('returnPoint')).toEqual([]);
      expect(repo.list('workDiscussion')).toEqual([]);
      expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records a return point before switching durable current work and restores it after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'statecarry-return-point-'));
    let repo = new SQLiteRepository(directory);
    try {
      let h = harness(repo);
      const { receipt } = registerProject(h, { goal: 'Keep interrupted work cheap to resume.' });
      const projectId = receipt.projectId;
      h.core.projectModel.view(projectId);
      for (const [id, title] of [
        ['work-a', 'Finish the return screen'],
        ['work-b', 'Check the release path'],
      ] as const)
        repo.put('workItem', {
          id,
          projectId,
          title,
          state: 'active',
          origin: 'user',
          completionCondition: null,
          completionConditionOrigin: null,
          createdAt: AT,
          updatedAt: AT,
        });
      h.core.projectModel.selectCurrentWork(projectId, 'work-a');
      repo.put('projectObservation', {
        id: projectId,
        projectId: projectId,
        checkedAt: AT,
        probeKey: 'probe-a',
        inspectionKey: 'inspection-a',
        semanticKey: 'semantic-a',
        snapshot: {
          cwd: '/tmp/example',
          branch: 'main',
          commit: 'abc',
          dirty: false,
          status: 'checked',
          checkedAt: AT,
          limitations: [],
        },
      });

      h.core.projectModel.selectCurrentWork(projectId, 'work-b');
      expect(repo.list('returnPoint')).toEqual([
        expect.objectContaining({
          projectId,
          workItemId: 'work-a',
          basis: 'semantic-a',
          current: 'This work is ready to continue.',
          next: 'Continue Finish the return screen.',
        }),
      ]);
      expect(h.core.now.resolve(projectId).currentWorkId).toBe('work-b');

      repo.close();
      repo = new SQLiteRepository(directory);
      h = harness(repo);
      expect(h.core.now.resolve(projectId).currentWorkId).toBe('work-b');
      expect(h.core.projectModel.view(projectId).returnPoints).toEqual([
        expect.objectContaining({ workItemId: 'work-a', basis: 'semantic-a' }),
      ]);
    } finally {
      repo.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
