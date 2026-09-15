import { source, read, harness } from './helpers';
import type { SourceRevision } from '@statecarry/contracts';

const record = (id: string, thread: string, actor: SourceRevision['actor'], text: string) => ({ ...source(text, thread, id), actor, kind: actor === 'user' ? 'userMessage' : actor === 'agent' ? 'agentMessage' : 'toolResult' });
export const contextRecords = {
  A: [record('A1', 'session-a', 'user', '주문 CSV를 확인해줘. 합성 주문 10,000건에서 한글과 행 수가 맞고 Chrome에서 파일을 내려받을 수 있는지 확인하는 것이 목표야.'), record('A2', 'session-a', 'user', '고객 원본은 외부 분석에 쓸 수 없어. 합성 주문으로 진행해.'), record('A3', 'session-a', 'agent', 'CSV 구현을 추가했습니다. 10,000건 처리 실패 원인은 아직 확인하지 못했습니다.'), record('A4', 'session-a', 'tool', 'v1 / synthetic-orders-10k: export aborted. Expected rows: 10000. Output file: none. Cause: undetermined.')],
  B: [record('B1', 'session-b', 'user', 'session-a의 합성 주문 CSV 목표를 이어가. 먼저 10,000건 처리를 고쳐서 확인해줘.'), record('B2', 'session-b', 'agent', '스트리밍 출력을 적용한 v2를 만들었습니다. v1 실패가 메모리 때문이었는지는 확인하지 못했습니다.'), record('B3', 'session-b', 'tool', 'v2 / synthetic-orders-10k / local CSV comparison: 10000 rows; Korean fields match fixture; PASS. Browser download not tested by this command.'), record('B4', 'session-b', 'tool', 'v2 / synthetic-orders-10k / Chrome 140 / run D1: download timeout; FAIL. Cause: undetermined.')],
  C: [record('C1', 'session-c', 'user', 'session-b의 다운로드 문제와 병렬로 같은 CSV 목표의 오류 안내를 정리해줘.'), record('C2', 'session-c', 'agent', '오류 안내 컴포넌트를 구현했습니다.'), record('C3', 'session-c', 'tool', 'Error notification component tests: PASS. Real browser download not exercised.'), record('C4', 'session-c', 'agent', 'Safari 지원을 추가하는 것을 제안합니다.')],
  D: [record('D1', 'session-d', 'user', '청구서 화면 여백을 정리해줘.'), record('D2', 'session-d', 'user', '지금은 session-b의 CSV 목표로 돌아가서 Chrome 다운로드를 재검증해줘.'), record('D3a', 'session-d', 'agent', 'v2 합성 주문 10,000건의 Chrome 140 다운로드를 다시 실행했고 성공했다고 보고합니다.'), record('D3b', 'session-d', 'tool', 'v2 / synthetic-orders-10k / Chrome 140 / run D2: downloaded orders.csv; 10000 rows; Korean fields match fixture; PASS.'), record('D4', 'session-d', 'user', '이제 청구서 여백 목표로 복귀해.')],
  X: [record('X1', 'session-x', 'user', '이미지 내보내기는 CSV와 별개인 실험이야. 실험을 중단해.')],
  E: [record('E1', 'session-e', 'user', 'session-b의 합성 주문 CSV 목표 후속 작업입니다. Chrome 다운로드를 재검증해줘.'), record('E2', 'session-e', 'tool', 'v2 / synthetic-orders-10k / Chrome 140 / run D2: downloaded orders.csv; 10000 rows; Korean fields match fixture; PASS.')],
  J: [record('J1', 'session-j', 'user', 'session-b의 CSV 목표 후속 작업입니다. Chrome 다운로드는 보류하고 이번 목표는 합성 주문의 내용 검증까지만 하기로 결정했어. 다운로드 실패 원인은 확인하지 못했어.')],
};
export function contextHarness(repo?: import('@statecarry/core').StateRepository) {
  const h = harness(repo);
  const records = new Map<string, SourceRevision[]>(Object.values(contextRecords).slice(0, 5).map(rows => [rows[0].threadId, rows]));
  h.reader.read = async id => { const rows = records.get(id); if (!rows) throw new Error('Included session could not be read'); return { ...read(rows), title: id }; };
  h.reader.discover = async () => ({ threads: [...records.keys()].map(id => ({ id, title: id, cwd: '/tmp/example' })), complete: true, limitations: [] });
  const project = h.core.connect({ requestId: h.core.ids.next(), expectedRevision: 0, payload: { title: 'Export Desk', cwd: '/tmp/example', threadIds: ['session-a', 'session-b', 'session-c', 'session-d', 'session-x'], discover: true } }).workId;
  return { ...h, records, project };
}
