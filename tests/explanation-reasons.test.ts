import { expect, it } from 'vitest';
import { explanationGenerationSchema } from '../apps/server/src/adapters/explanation-prompts';
import { validateExplanation } from '../packages/core/src/explanation-context';
import { explanationHarness, fixtureExplanation } from './explanation-fixtures';

const schema = explanationGenerationSchema([{ actor: 'user', fragments: [{ evidenceId: 'u' }] }]);
const leaf = { role: 'premise', kind: 'record', nature: 'user-report', text: '기록된 제약', uncertainty: '', condition: '', unknowns: [], evidenceIds: ['u'] };
const reason = { question: '왜 선택했나요?', kind: 'record', uncertainty: '', evidenceIds: ['u'], node: { ...leaf, reasons: [{ question: '어떤 목표 때문인가요?', kind: 'record', uncertainty: '', evidenceIds: ['u'], node: { ...leaf, role: 'goal' } }] } };

it.each(['background', 'goal', 'progress', 'premise'])('forbids reasons on a root %s while retaining its content', role => {
  const input = { sections: [{ title: '기록', body: [{ ...leaf, role, reasons: [reason] }] }], unknowns: [] };
  expect(schema.safeParse(input).success).toBe(false);
  expect(schema.safeParse({ ...input, sections: [{ title: '기록', body: [{ ...leaf, role, reasons: [] }] }] }).success).toBe(true);
});

it.each(['choice', 'state', 'action', 'followup'])('preserves two reason levels below a root %s', role => {
  const input = { sections: [{ title: '기록', body: [{ ...leaf, role, reasons: [reason] }] }], unknowns: [] };
  expect(schema.parse(input)).toEqual(input);
});

it('exports a strict generation schema without an unsupported never schema', () => {
  const json = schema.toJSONSchema({ reused: 'ref' });
  expect(JSON.stringify(json)).not.toContain('"not":');
  expect(JSON.stringify(json)).toContain('"maxItems":0');
});

it('identifies the invalid parent for the bounded repair and never publishes repeated invalid candidates', async () => {
  const run = await explanationHarness();
  try {
    run.h.summary.generateExplanation = async (context, _remote, _validate, repair) => {
      const candidate = fixtureExplanation(context);
      candidate.nodes.find(n => n.id === 'choice')!.role = 'goal';
      expect(() => validateExplanation(candidate, context)).toThrow('parent=choice; role=goal');
      if (repair) expect(repair.reason).toContain('parent=choice; role=goal');
      return candidate;
    };
    run.prepare();
    const view = await run.settled();
    expect(view.revision).toBeNull();
    expect(view.job?.status).toBe('failed');
    expect(view.job?.repairs).toBe(1);
    expect(view.job?.calls).toBe(2);
    expect(run.h.repo.list('explanation')).toHaveLength(0);
  } finally { await run.h.core.close(); }
});
