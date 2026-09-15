import { expect, it } from 'vitest';
import {
  explanationHarness,
  contextFromInput,
  fixtureExplanation,
  fixtureAssessment,
} from './explanation-fixtures';
import { validateExplanation, assessExplanation } from '../packages/core/src/explanation-context';
import {
  explanationEvidenceCatalog,
  explanationGenerationSchema,
} from '../apps/server/src/adapters/explanation-prompts';
import { ExplanationCandidateError } from '@statecarry/contracts';

it('rejects user words inside a tool document and identifies the citation for repair', async () => {
  const run = await explanationHarness();
  try {
    run.prepare();
    const view = await run.settled();
    const context = contextFromInput(view.revision!.input);
    context.excerpts[0].actor = 'tool';
    context.excerpts[0].kind = 'commandExecution';
    const candidate = fixtureExplanation(context);
    expect(() => validateExplanation(candidate, context)).toThrow(
      `node=${candidate.nodes[0].id}; nature=${candidate.nodes[0].nature}; actualActor=tool`,
    );
    const input = explanationEvidenceCatalog(context).input;
    expect(input.excerpts[0].directUserEvidence).toBe(false);
    expect(input.excerpts[0].fragments.every((f) => f.actor === 'tool')).toBe(true);
    expect(input.excerpts[2].directUserEvidence).toBe(true);
    // Relabeling does not waive the independent semantic check.
    candidate.nodes[0].nature = 'file-observation';
    const assessment = fixtureAssessment(candidate);
    assessment.nodes[0] = {
      id: candidate.nodes[0].id,
      verdict: 'unsupported',
      reason: 'A tool document does not establish a direct user statement.',
    };
    expect(() => assessExplanation(candidate, assessment)).toThrow(
      'Explanation meaning check rejected',
    );
  } finally {
    await run.h.core.close();
  }
});

it('constrains generated IDs and provenance at every reason depth', () => {
  const schema = explanationGenerationSchema([
    { actor: 'user', fragments: [{ evidenceId: 'u' }] },
    { actor: 'tool', fragments: [{ evidenceId: 't' }] },
  ]);
  const leaf = {
    role: 'state',
    kind: 'record',
    nature: 'user-report',
    text: 'User report',
    uncertainty: '',
    condition: '',
    unknowns: [],
    evidenceIds: ['u'],
  };
  const input = {
    sections: [{ title: 'State', body: [{ ...leaf, reasons: [] as any[] }] }],
    unknowns: [],
  };
  expect(schema.safeParse(input).success).toBe(true);
  input.sections[0].body[0].evidenceIds = ['t'];
  expect(schema.safeParse(input).success).toBe(false);
  input.sections[0].body[0].evidenceIds = ['missing'];
  expect(schema.safeParse(input).success).toBe(false);
  input.sections[0].body[0].evidenceIds = ['u'];
  input.sections[0].body[0].reasons = [
    {
      question: 'Why?',
      kind: 'record',
      uncertainty: '',
      evidenceIds: ['u'],
      node: {
        ...leaf,
        reasons: [
          {
            question: 'Why?',
            kind: 'record',
            uncertainty: '',
            evidenceIds: ['u'],
            node: { ...leaf, evidenceIds: ['t'] },
          },
        ],
      },
    },
  ];
  expect(schema.safeParse(input).success).toBe(false);
});

it('passes a rejected transport candidate to the single bounded repair without publishing it', async () => {
  const run = await explanationHarness();
  const rejected = { sections: [{ body: [{ evidenceIds: ['missing-id'] }] }] };
  let calls = 0;
  run.h.summary.generateExplanation = async (context, _remote, _validate, repair) => {
    calls++;
    if (calls === 1) throw new ExplanationCandidateError('unknown evidence ID', rejected);
    expect(repair?.candidate).toEqual(rejected);
    expect(run.h.repo.list('explanation')).toHaveLength(0);
    return fixtureExplanation(context);
  };
  try {
    run.prepare();
    const view = await run.settled();
    expect(view.revision).not.toBeNull();
    expect(view.job?.repairs).toBe(1);
    expect(view.job?.calls).toBe(3);
  } finally {
    await run.h.core.close();
  }
});
