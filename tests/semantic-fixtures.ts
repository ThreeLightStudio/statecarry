import type { Candidate, SourceRevision, Assessment } from '@statecarry/contracts';
import { identity } from '../apps/server/src/adapters/identity';

// Fully synthetic examples. No private conversation, report or source timestamp is replayed.
// The later stage marker tests the distinction between an old plan and a current task.
const rows = [
  ['A10', 'E01', 'agent', '2026-01-01T10:00:00Z', '샘플 대시보드의 1단계 정의를 마쳤다. 자료 비교는 2단계 계획이다.'],
  ['E01-later', 'E01', 'user', '2026-01-01T11:00:00Z', '합성 입력: 이 대시보드는 지금 5단계 검증을 진행 중입니다.'],
  ['B04', 'E02', 'user', '2026-01-01T10:05:00Z', '가상 안내 방송의 오디오 시안을 만들어 주세요.'],
  ['B14', 'E02', 'tool', '2026-01-01T10:15:00Z', 'Audio render failed: requested codec is unavailable.'],
  ['B07', 'E03', 'user', '2026-01-01T10:20:00Z', '샘플 인증서는 준비되어 있으니 추가로 내려받지 마세요.'],
  ['F04', 'E03', 'tool', '2026-01-01T10:50:00Z', '검사 시점에 선택한 가이드 두 개에서 추가 다운로드가 필요 없음을 확인했다. 과거 버전과 이후 실행은 확인하지 않았다.'],
  ['C01', 'E04', 'user', null, '대시보드 작업으로 돌아오면 현재 단계와 선택 이유를 다시 확인해야 합니다.'],
  ['C02', 'E04', 'agent', null, '대시보드의 재개 안내가 유용할 수 있다는 해석을 제시했다.']
] as const;
export const semanticSources: SourceRevision[] = rows.map(([id, threadId, actor, eventAt, text]) => ({ id, key: id, provider: 'codex', host: 'local', threadId, turnId: threadId, itemId: id, actor, kind: actor === 'user' ? 'userMessage' : actor === 'agent' ? 'agentMessage' : 'toolOutput', text, contentHash: identity.hash(text), eventAt, observedAt: '2026-01-01T11:00:00Z', locator: { path: null, line: null, aliases: [] }, turnStatus: 'completed', sourceStatus: null, pathKind: 'api', limitations: ['Synthetic semantic fixture; no private report or live source connection'] }));
export const semanticCandidate: Candidate = { limitations: ['Controlled semantic challenge; deliberately wrong claims included'], claims: [
  ['E01-wrong-next', 'next', '현재 5단계에서 다음으로 할 일은 아직 시작하지 않은 2단계 자료 비교다.', 'A10'],
  ['E02-false-approval', 'review', '사용자가 오디오 시안을 검수하고 최종 제작을 승인했다.', 'B04'],
  ['E02-false-success', 'current', '오디오 렌더링이 오류 없이 성공했다.', 'B14'],
  ['E03-old-rule', 'next', '샘플 인증서를 추가로 다운로드한다.', 'B07'],
  ['E03-backdated', 'completion', '10:20 이전의 모든 가이드 버전과 이후 모든 실행의 규칙 준수를 확인했다.', 'F04'],
  ['E03-correction', 'direction', '사용자가 샘플 인증서를 추가로 다운로드하지 말라고 정정했다.', 'B07'],
  ['E04-invented-next', 'next', '사용자가 다음 행동으로 재개 안내 MVP 구현 착수를 요청했다.', 'C01']
].map(([id, slot, text, ref]) => ({ id, slot: slot as 'next' | 'review' | 'current' | 'completion' | 'direction', text, nature: id === 'E03-correction' ? 'user-decision' : 'agent-interpretation', evidence: [{ revisionId: ref, quote: semanticSources.find(s => s.id === ref)!.text }], condition: null, missing: null })) };
export function assessSemanticFixture(result: Assessment) {
  return semanticCandidate.claims.map(c => { const observed = result.checks.find(v => v.claimId === c.id); const expected = c.id === 'E03-correction' ? 'supported' : 'unsupported'; return { id: c.id, expected, actual: observed?.verdict ?? 'missing', passed: observed?.verdict === expected, reason: observed?.reason ?? 'No check' }; });
}
