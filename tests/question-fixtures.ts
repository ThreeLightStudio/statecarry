import { harness, source, candidate } from './helpers';
import type { QuestionContext, QuestionAnswer } from '@statecarry/contracts';
export const questionRecords = [
  [
    'user',
    '내보내기 요청이 30초 제한 때문에 중간에 끊겼습니다. 작은 파일부터 원인을 확인해 주세요.',
  ],
  ['agent', '시간 제한 원인을 분리하려고 작은 파일로 재현하는 방안을 제안합니다.'],
  ['user', '작은 파일부터 확인하기로 결정합니다.'],
  ['user', '고객 데이터가 포함돼 있으니 앞선 결정을 바꿉니다. 합성 파일로만 재현해 주세요.'],
  ['agent', '합성 파일 재현 작업을 완료했다고 보고합니다. 독립적인 검증은 아직 없습니다.'],
  ['user', '이제 합성 파일의 재현 결과를 검토해 주세요.'],
].map(([actor, text], i) => ({
  ...source(text, 'thread-a', `item-${i}`),
  actor: actor as 'user' | 'agent',
  turnId: `turn-${i}`,
  kind: actor === 'user' ? 'userMessage' : 'agentMessage',
}));
export function fixtureAnswer(context: QuestionContext): QuestionAnswer {
  const e = context.excerpts.find((e) => e.text.includes('30초'))!;
  return {
    items: [
      {
        id: 'background',
        kind: 'record',
        nature: 'user-request',
        text: '사용자는 내보내기가 30초 제한으로 끊겨 작은 파일부터 원인을 확인해 달라고 요청했습니다.',
        uncertainty: '',
        evidence: [{ revisionId: e.revisionId, start: e.start, quote: e.text }],
      },
    ],
    unknowns: ['실제 작업 완료 여부는 선정된 기록만으로 독립적으로 확인하지 못했습니다.'],
  };
}
export async function questionHarness(records = questionRecords) {
  const h = harness();
  h.records(records);
  h.summary.generate = async () => ({
    candidate: {
      ...candidate(records.at(-1)!),
      claims: candidate(records.at(-1)!).claims.map((c) => ({
        ...c,
        nature:
          records.at(-1)!.actor === 'user' ? ('user-request' as const) : ('agent-report' as const),
      })),
    },
    model: 'synthetic-question-fixture',
  });
  h.summary.answerQuestion = async (context) => fixtureAnswer(context);
  h.summary.checkQuestion = async (_, answer) => ({
    checks: answer.items.map((i) => ({
      itemId: i.id,
      verdict: 'supported',
      reason: '합성 검사 대역: 사용자 요청과 원문 일치',
    })),
    unknownsSafe: true,
  });
  const id = h.connect();
  await h.core.collect(id);
  await h.core.process(id);
  const create = () =>
    h.core.questions.create(id, {
      requestId: crypto.randomUUID(),
      summaryId: h.core.work(id).latestSummaryId,
      claimId: 'next',
    });
  return { h, id, create };
}

export const transitionQuestion =
  '여기서 전체 전환은 무엇을 무엇으로 바꾸려던 작업인가요? 처음 어떤 요청에서 시작했고, 무엇을 완료하려던 것인지 기록에 근거해 설명해주세요.';
export const transitionRecords = [
  [
    'user',
    '메모를 로컬 JSON 파일에 저장하는 방식을 SQLite 저장소로 옮겨 주세요. 기존 메모를 보존하고 읽기와 쓰기를 새 저장소에서 처리하면 끝입니다.',
  ],
  ['agent', '화면 색상을 확인했습니다.'],
  ['agent', '버튼 간격을 확인했습니다.'],
  ['agent', '글꼴 크기를 확인했습니다.'],
  ...Array.from({ length: 18 }, (_, i) => [
    'agent',
    `진행 메모 ${i}: ${transitionQuestion} 이 질문에 답할 배경을 조사 중이며 전체 전환이 미완료입니다.`,
  ]),
  [
    'agent',
    '사용자는 JSON 파일 저장에서 SQLite로 옮기고 기존 메모와 읽기·쓰기를 유지하길 요청했다고 정리합니다.',
  ],
  ['agent', '추가로 클라우드 동기화까지 구현하는 방안을 제안합니다.'],
  ['user', 'SQLite 이전은 진행하기로 결정합니다. 클라우드 동기화 제안은 승인하지 않습니다.'],
  [
    'user',
    '완료 목표를 바꿉니다. 이번에는 기존 메모 보존과 읽기만 이전하고 쓰기 전환은 다음 단계로 미뤄 주세요.',
  ],
  ['agent', '전체 전환이 미완료라고 보고합니다. 실제 실행 결과의 독립 검증은 없습니다.'],
].map(([actor, text], i) => ({
  ...source(text, 'thread-a', `transition-${i}`),
  actor: actor as 'user' | 'agent',
  turnId: `transition-turn-${i}`,
  kind: actor === 'user' ? 'userMessage' : 'agentMessage',
}));
