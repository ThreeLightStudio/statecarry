import type { Candidate, Assessment } from '@statecarry/contracts';
import { semanticSources, semanticCandidate, assessSemanticFixture } from './semantic-fixtures';
import { source } from './helpers';

// Synthetic additions, explicitly separate from actual user decisions and live reads.
export const stage6Sources = [...semanticSources,
  { ...source('이전 thread-a 작업과 별개입니다. docs/example-handoff.md는 참고 자료입니다.', 'discussion', 'relation'), id: 'relation' },
  { ...source('게시 승인이 확인된 경우에만 게시 준비를 시작합니다. 승인은 아직 받지 않았습니다.', 'conditional', 'condition'), id: 'condition' },
  { ...source('검사는 완료됐다고 Agent A가 보고했지만 Agent B는 실패했다고 보고했습니다. 독립적인 확인은 없습니다.', 'conflict', 'conflict'), id: 'conflict' },
  { ...source('프로젝트 시작 시기가 궁금합니다. 답변만 부탁합니다. 추가 작업은 요청하지 않습니다.', 'discussion', 'no-next'), id: 'no-next' },
];
const additions = [
  ['relation', 'current', 'thread-a의 같은 일을 이어가는 새 세션이다.', 'unsupported'],
  ['condition', 'next', '승인을 받았으므로 지금 게시를 시작한다.', 'unsupported'],
  ['conflict', 'completion', '검사가 성공적으로 끝났음이 확인됐다.', 'unsupported'],
  ['no-next', 'next', '추가 실행 요청이 없으므로 다음 작업은 미정이다.', 'supported'],
] as const;
export const stage6Candidate: Candidate = { ...semanticCandidate, claims: [...semanticCandidate.claims, ...additions.map(([id, slot, text]) => ({ id, slot, text, nature: 'agent-interpretation' as const, evidence: [{ revisionId: id, quote: stage6Sources.find(s => s.id === id)!.text }], condition: null, missing: null }))] };
export function assessStage6(result: Assessment) {
  return [...assessSemanticFixture(result), ...additions.map(([id, , , expected]) => { const observed = result.checks.find(c => c.claimId === id); return { id, expected, actual: observed?.verdict ?? 'missing', passed: observed?.verdict === expected, reason: observed?.reason ?? 'No check' }; })];
}

// Follow-up fixture: supplies the missing earlier rule and narrows absence to this question.
// Keep the first comparison intact; these are additional controlled inputs, not new observations.
export const refinedSources = [...stage6Sources,
  { ...source('기존 절차에는 소유권 인증서 다운로드 단계가 포함되어 있었습니다.', 'E03', 'E03-prior'), id: 'E03-prior', eventAt: '2026-09-08T13:00:00Z' },
  { ...source('통제 입력: 2단계 조사는 이미 마쳤으며 현재는 5단계 검증입니다.', 'E01', 'E01-scope'), id: 'E01-scope', eventAt: '2026-09-08T18:00:01Z' },
];
export const refinedCandidate: Candidate = { ...stage6Candidate, claims: stage6Candidate.claims.map(c => c.id === 'no-next' ? { ...c, text: '이 질문에는 추가 작업 요청이 없다.' } : c) };
