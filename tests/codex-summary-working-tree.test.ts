import { expect, it } from 'vitest';
import type { WorkspaceSnapshot } from '@statecarry/contracts';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';
import { harness } from './helpers';

const AT = '2026-09-20T00:00:00.000Z';

function snapshot(): WorkspaceSnapshot {
  return {
    cwd: '/tmp/working-tree-project',
    root: '/tmp/working-tree-project',
    branch: 'main',
    commit: 'head-a',
    dirty: true,
    changedPaths: ['src/work.ts'],
    changedFiles: [{ path: 'src/work.ts', status: 'modified' }],
    status: 'checked',
    checkedAt: AT,
    limitations: [],
    files: [
      {
        path: 'src/work.ts',
        hash: 'file-a',
        preview: 'Inspection quote is present.',
        status: 'checked',
      },
    ],
  };
}

function record(revisionId: string, text: string) {
  return {
    revisionId,
    threadId: 'project-inspection',
    actor: 'tool' as const,
    kind: 'fileObservation',
    at: AT,
    text,
    limitations: [],
  };
}

function group(context: unknown[] = []) {
  return {
    title: 'Current work',
    summary: 'A changed file contains the current work.',
    currentState: 'The changed file has a bounded inspection.',
    openItems: [],
    suggestedNextStep: 'Review the changed file.',
    reason: 'The file is part of the current change.',
    doneWhen: 'The file has been reviewed.',
    files: ['src/work.ts'],
    context,
  };
}

function context(nature: string, text: string, revisionId: string, quote: string) {
  return { kind: 'progress', nature, text, sources: [{ revisionId, quote }] };
}

function executionResult(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'exec-agent',
    source: 'agent-report',
    report: 'Agent reports the implementation is present.',
    doneWhen: 'The implementation is present.',
    checks: [],
    current: true,
    accepted: false,
    ...overrides,
  };
}

function input(
  records = [record('inspection-a', 'File observation: Inspection quote is present.')],
  executionResults: Record<string, unknown>[] = [],
  extras: Record<string, unknown> = {},
) {
  return {
    projectTitle: 'Working tree project',
    snapshot: snapshot(),
    records,
    executionResults,
    ...extras,
  };
}

function providerWithModelOutput(
  contextItems: unknown[] = [],
  groupFields: Record<string, unknown> = {},
) {
  const summary = new CodexSummary('/tmp/statecarry-working-tree-test');
  let prompt = '';
  let instructions = '';
  (summary as any).preflight = async () => {};
  (summary as any).run = async (
    value: string,
    _schema: unknown,
    _onRemote: unknown,
    _phase: string,
    valueInstructions: string,
  ) => {
    prompt = value;
    instructions = valueInstructions;
    return {
      value: {
        summary: 'One changed file needs review.',
        groups: [{ ...group(contextItems), ...groupFields }],
      },
    };
  };
  return { summary, prompt: () => prompt, instructions: () => instructions };
}

it('checks context IDs and quotes against their own inspection or execution record', async () => {
  const acceptedResult = executionResult({
    requestId: 'exec-user',
    source: 'user-report',
    report: 'User accepted the reviewed result.',
    accepted: true,
  });
  const items = [
    context('file-observation', 'File evidence.', 'inspection-a', 'Inspection quote is present.'),
    context(
      'agent-interpretation',
      'A bounded interpretation.',
      'inspection-a',
      'Inspection quote',
    ),
    context(
      'agent-report',
      'The agent reported progress.',
      'exec-agent',
      'implementation is present.',
    ),
    context('agent-report', 'Wrong quote.', 'exec-agent', 'Inspection quote is present.'),
    context('agent-report', 'Wrong ID.', 'inspection-a', 'Inspection quote is present.'),
    context(
      'user-decision',
      'The result was accepted.',
      'exec-user',
      'accepted the reviewed result.',
    ),
    context('user-decision', 'Not accepted.', 'exec-agent', 'implementation is present.'),
    context('user-decision', 'Wrong quote.', 'exec-user', 'implementation is present.'),
    context(
      'user-request',
      'No user request was supplied.',
      'inspection-a',
      'Inspection quote is present.',
    ),
    context('file-observation', 'Wrong source kind.', 'exec-agent', 'implementation is present.'),
  ];
  const provider = providerWithModelOutput(items);
  const result = await provider.summary.analyzeWorkingTree(
    input(undefined, [executionResult(), acceptedResult]),
  );

  expect(result.groups[0].context?.map((item) => item.text)).toEqual([
    'File evidence.',
    'A bounded interpretation.',
    'The agent reported progress.',
    'The result was accepted.',
  ]);
  expect(provider.prompt()).toContain('"revisionId":"inspection-a"');
  expect(provider.instructions()).toContain('{revisionId,quote}');
  expect(provider.instructions()).toContain('requestId and a substring of the report');
  expect(provider.instructions()).toContain('accepted=true');
  expect(provider.instructions()).toContain(
    'a common quote, file, topic, or status alone is insufficient',
  );
});

it('keeps only model-declared links backed by a shared verified quote and prior group', async () => {
  const quote = 'Reply language is configurable.';
  const source = context(
    'file-observation',
    '응답 언어를 설정할 수 있습니다.',
    'inspection-a',
    quote,
  );
  const previous = { ...group([source]), id: 'previous-group' };
  const provider = providerWithModelOutput([source], {
    relatedProposalKeys: ['analysis:reply-language', 'analysis:unrelated', 'unknown'],
    continuesGroupId: 'previous-group',
  });
  const result = await provider.summary.analyzeWorkingTree(
    input([record('inspection-a', `File observation: ${quote}`)], [], {
      outputLanguage: 'ko',
      previousOutputLanguage: 'en',
      analysisProposals: [
        {
          key: 'analysis:reply-language',
          title: '응답 언어 설정',
          currentState: '응답 언어를 설정할 수 있습니다.',
          uncertainty: null,
          evidenceQuotes: [{ revisionId: 'inspection-a', quote }],
        },
        {
          key: 'analysis:unrelated',
          title: '데이터베이스 지연 조사',
          currentState: '데이터베이스 지연을 조사해야 합니다.',
          uncertainty: null,
          evidenceQuotes: [{ revisionId: 'inspection-a', quote: 'No errors detected.' }],
        },
      ],
      previousGroups: [previous],
    }),
  );

  expect(result.groups[0].relatedProposalKeys).toEqual(['analysis:reply-language']);
  expect(result.groups[0].continuesGroupId).toBe('previous-group');
  const prompted = JSON.parse(provider.prompt());
  expect(prompted.previousOutputLanguage).toBe('en');
  expect(prompted.analysisProposals).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'analysis:reply-language' })]),
  );
  expect(prompted.previousGroups).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'previous-group' })]),
  );
});

it('accepts exactly 12,000 inspection characters and rejects content beyond that budget', async () => {
  const provider = providerWithModelOutput();
  const atLimit = input([record('inspection-limit', 'x'.repeat(12_000))]);
  await expect(provider.summary.analyzeWorkingTree(atLimit)).resolves.toMatchObject({
    groups: [expect.objectContaining({ title: 'Current work' })],
  });
  expect(JSON.parse(provider.prompt()).records[0].text).toHaveLength(12_000);

  await expect(
    provider.summary.analyzeWorkingTree(
      input([record('inspection-a', 'x'.repeat(6_001)), record('inspection-b', 'y'.repeat(6_000))]),
    ),
  ).rejects.toMatchObject({ code: 'SUMMARY_UNAVAILABLE' });
});

it('bounds Git inspection to 6,000 characters and the complete inspection to 12,000', () => {
  const h = harness();
  const records = h.core.analyses.workspaceRecords({
    ...snapshot(),
    recentCommits: Array.from({ length: 8 }, (_, index) => ({
      hash: `commit-${index}`,
      subject: 's'.repeat(400),
      committedAt: AT,
      changedPaths: Array.from(
        { length: 10 },
        (_, pathIndex) => `src/${'p'.repeat(100)}-${pathIndex}.ts`,
      ),
    })),
    files: [
      { path: 'src/work.ts', hash: 'file-a', preview: 'f'.repeat(4_000), status: 'checked' },
      { path: 'src/unavailable.ts', hash: 'unavailable', preview: null, status: 'unavailable' },
    ],
  } as WorkspaceSnapshot);

  expect(records[0].kind).toBe('gitObservation');
  expect(records[0].text).toHaveLength(6_000);
  expect(records.some((item) => item.text.includes('src/unavailable.ts'))).toBe(false);
  expect(records.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(12_000);
});
