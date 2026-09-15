import { harness, candidate, source } from './helpers';
import type {
  ExplanationCandidate,
  ExplanationContext,
  ExplanationAssessment,
  ExplanationInput,
} from '@statecarry/contracts';
export const explanationRecords = [
  [
    'user',
    '고객 자료를 안전하게 내보내는 것이 목표입니다. 내보내기가 30초에 끊겨 업무를 재개할 수 없습니다. 작은 파일부터 원인을 확인해 주세요.',
  ],
  [
    'agent',
    '원인을 분리하려고 작은 고객 파일로 재현하는 방법을 제안했습니다. 실제 실행은 아직 하지 않았습니다.',
  ],
  [
    'user',
    '고객 자료는 외부 분석에 사용할 수 없다는 제약이 있습니다. 이 제약 때문에 앞선 방법 대신 합성 파일로만 확인하기로 결정합니다.',
  ],
  [
    'agent',
    '합성 파일에서도 30초에 끊기는 현상을 재현했다고 보고합니다. 크기만의 문제는 아닌 것으로 해석합니다. 실제 결과의 독립 검증은 아직 없습니다.',
  ],
  [
    'user',
    '이제 합성 파일 재현 결과를 검토해 주세요. 원인이 확인되면 수정 범위를 정하고, 확인되지 않으면 추가 조사 범위를 논의하겠습니다.',
  ],
].map(([actor, text], i) => ({
  ...source(text, 'thread-a', `explanation-${i}`),
  actor: actor as 'user' | 'agent',
  turnId: `explanation-turn-${i}`,
  kind: actor === 'user' ? 'userMessage' : 'agentMessage',
}));
export function fixtureExplanation(context: ExplanationContext): ExplanationCandidate {
  const ref = (i: number) => {
    const e = context.excerpts[i];
    return [{ revisionId: e.revisionId, start: e.start, quote: e.text }];
  };
  const node = (
    id: string,
    role: ExplanationCandidate['nodes'][number]['role'],
    text: string,
    i: number,
    nature: ExplanationCandidate['nodes'][number]['nature'] = 'user-request',
  ) => ({
    id,
    role,
    kind: 'record' as const,
    nature,
    text,
    uncertainty: '',
    condition: '',
    evidence: ref(i),
    unknowns: [],
  });
  return {
    sections: [
      { id: 'context', title: '어떤 일을 이어가려 했나', bodyIds: ['origin'] },
      { id: 'history', title: '무엇을 시도하고 바꿨나', bodyIds: ['proposal', 'choice', 'result'] },
      { id: 'now', title: '지금 무엇을 판단하나', bodyIds: ['action'] },
    ],
    nodes: [
      node(
        'origin',
        'background',
        '사용자는 고객 자료를 안전하게 내보내려 했으나 30초 제한으로 작업이 끊겨 원인 확인을 요청했습니다.',
        0,
      ),
      node(
        'proposal',
        'progress',
        'AI는 작은 고객 파일로 재현하는 방법을 제안했으며 아직 실행하지 않았다고 기록했습니다.',
        1,
        'agent-proposal',
      ),
      node(
        'choice',
        'choice',
        '사용자는 고객 파일 대신 합성 파일로 확인하기로 결정했습니다.',
        2,
        'user-decision',
      ),
      node(
        'result',
        'state',
        'AI는 합성 파일에서도 현상을 재현했다고 보고했습니다. 독립 검증은 아직 없다고 밝혔습니다.',
        3,
        'agent-report',
      ),
      node('action', 'action', '사용자는 합성 파일의 재현 결과 검토를 요청했습니다.', 4),
      node(
        'why',
        'premise',
        '고객 자료를 외부 분석에 사용할 수 없어서 합성 파일을 선택했습니다.',
        2,
        'user-decision',
      ),
      node(
        'constraint',
        'premise',
        '고객 자료를 외부 분석에 사용할 수 없다는 제약이 기록돼 있습니다.',
        2,
        'user-report',
      ),
    ],
    links: [
      {
        id: 'reason',
        parentId: 'choice',
        childId: 'why',
        question: '왜 합성 파일로 바꿨나요?',
        kind: 'record',
        uncertainty: '',
        evidence: ref(2),
      },
      {
        id: 'premise',
        parentId: 'why',
        childId: 'constraint',
        question: '어떤 제약이 있었나요?',
        kind: 'record',
        uncertainty: '',
        evidence: ref(2),
      },
    ],
    unknowns: [
      {
        text: '독립 검증 결과는 제공한 기록에서 확인하지 못했습니다.',
        impact: 'AI의 재현 보고와 실제 검증 완료를 구분합니다.',
        cause: 'not-in-record',
      },
    ],
  };
}
export const fixtureAssessment = (c: ExplanationCandidate): ExplanationAssessment => ({
  nodes: c.nodes.map((n) => ({ id: n.id, verdict: 'supported', reason: '합성 검사 대역' })),
  links: c.links.map((l) => ({ id: l.id, verdict: 'supported', reason: '합성 검사 대역' })),
  narrativeComplete: true,
  unknownsSafe: true,
  reason: '합성 검사 대역',
});
export async function explanationHarness() {
  const h = harness();
  h.records(explanationRecords);
  h.summary.generate = async () => ({
    candidate: candidate(explanationRecords.at(-1)!),
    model: 'fixture',
  });
  const id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  let generated = 0,
    checked = 0;
  h.summary.generateExplanation = async (context) => {
    generated++;
    return fixtureExplanation(context);
  };
  h.summary.checkExplanation = async (_, c) => {
    checked++;
    return fixtureAssessment(c);
  };
  const prepare = () =>
    h.core.explanations.prepare(id, {
      requestId: crypto.randomUUID(),
      summaryId: h.core.work(id).latestSummaryId,
    });
  const settled = async () => {
    await h.core.explanations.settled();
    return h.core.explanations.view(id);
  };
  return { h, id, prepare, settled, counts: () => ({ generated, checked }) };
}
export function contextFromInput(input: ExplanationInput): ExplanationContext {
  return {
    input,
    guide: [],
    excerpts: input.ranges.map((r) => {
      const s = explanationRecords.find((s) => s.id === r.revisionId)!;
      return {
        revisionId: s.id,
        threadId: s.threadId,
        turnId: s.turnId,
        itemId: s.itemId,
        actor: s.actor,
        kind: s.kind,
        eventAt: s.eventAt,
        start: r.start,
        text: s.text.slice(r.start, r.end),
      };
    }),
  };
}
