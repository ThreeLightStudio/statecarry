import { describe, expect, it } from 'vitest';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import {
  normalizeWorkspaceInspectionHints,
  workspaceInspectionHintsSchema,
} from '@statecarry/contracts';
import type {
  AnalysisCandidate,
  WorkspaceSnapshot,
  WorkspaceInspectionHints,
} from '@statecarry/contracts';
import { harness, source } from './helpers';

const candidate = (record: ReturnType<typeof source>): AnalysisCandidate => ({
  key: 'related',
  goal: 'Ship the export',
  currentState: 'The export is implemented and its check remains open.',
  status: 'active',
  reason: 'The check remains open.',
  nextAction: 'Run the export check',
  actionSource: 'recorded',
  doneWhen: 'The check result is recorded.',
  threadId: record.threadId,
  prerequisites: [],
  evidence: [{ revisionId: record.id, quote: record.text.slice(0, 100) }],
});

describe('resume inspection hints', () => {
  it.each(['', ` ${'x'.repeat(2200)}.ts ${'y'.repeat(200)}() ${'z'.repeat(200)}`])(
    'passes valid connected clues to inspection even with oversized record tokens (%#)',
    async (extra) => {
      const h = harness();
      let received: WorkspaceInspectionHints | undefined;
      const snapshot: WorkspaceSnapshot = {
        cwd: '/tmp/example',
        root: '/tmp/example',
        branch: null,
        commit: null,
        dirty: null,
        status: 'unknown',
        checkedAt: '2026-09-15T00:00:00.000Z',
        limitations: ['Git state unavailable'],
        files: [],
      };
      const inspector: ProjectInspector = {
        inspect: (_cwd, hints) => {
          received = hints;
          return snapshot;
        },
      };
      const core = new StateCarry(
        h.repo,
        h.reader,
        h.summary,
        h.navigator,
        h.core.clock,
        h.core.ids,
        h.core.events,
        undefined,
        inspector,
      );
      const id = core.connect({
        requestId: h.core.ids.next(),
        expectedRevision: 0,
        payload: {
          title: 'Project',
          cwd: '/tmp/example',
          threadIds: ['thread-a'],
          discover: false,
        },
      }).projectId;
      const record = source(
        'The implementation is in src/later.ts and calls importantFunction().' + extra,
      );
      h.records([record]);
      h.summary.generateAnalysis = async () => ({ candidates: [candidate(record)] });
      await core.analyses.refresh(id);
      expect(received?.paths).toContain('src/later.ts');
      expect(received?.symbols).toContain('importantFunction');
      expect(workspaceInspectionHintsSchema.safeParse(received).success).toBe(true);
      expect(core.analyses.view(id).error).toBeNull();
    },
  );
});

it('drops oversized clues before count limits without truncating their identity', () => {
  const boundaryPath = `${'a'.repeat(1997)}.ts`;
  const hints = normalizeWorkspaceInspectionHints({
    paths: [
      ...Array.from({ length: 130 }, (_, i) => `${'x'.repeat(2001)}${i}.ts`),
      boundaryPath,
      ' src/valid.ts ',
      'src/valid.ts',
    ],
    symbols: ['s'.repeat(161), 's'.repeat(160), 'validFunction'],
    terms: ['t'.repeat(121), 't'.repeat(120), 'validTerm'],
  });
  expect(hints.paths).toEqual([boundaryPath, 'src/valid.ts']);
  expect(hints.symbols).toEqual(['s'.repeat(160), 'validFunction']);
  expect(hints.terms).toEqual(['t'.repeat(120), 'validTerm']);
  expect(workspaceInspectionHintsSchema.safeParse(hints).success).toBe(true);
});
