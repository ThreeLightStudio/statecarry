import type { Candidate, Claim, SourceRevision } from '@statecarry/contracts';
import { harness, source } from './helpers';

// Entirely synthetic records; never copied from a user's conversation or local database.
export function flowRecords() {
  const request = source('원문을 열기 전에 판단 근거를 짧게 보여 주세요.', 'thread-a', 'request');
  const proposal = { ...source('근거 제목과 대화 흐름을 먼저 보여주는 방식을 제안합니다.', 'thread-a', 'proposal'), actor: 'agent' as const, kind: 'agentMessage' };
  const decision = source('이 방식으로 진행하고 원문은 선택해서 보겠습니다.', 'thread-a', 'decision');
  return { request, proposal, decision };
}
export function flowCandidate(records: SourceRevision[]): Candidate {
  const [request, proposal, decision] = records;
  const claim = (id: string, slot: Claim['slot'], nature: Claim['nature'], text: string, refs: SourceRevision[]): Claim => ({ id, slot, nature, text,
    evidence: refs.map(s => ({ revisionId: s.id, quote: s.text })), condition: null, missing: null });
  return { claims: [claim('request', 'purpose', 'user-request', request.text, [request]),
    claim('proposal', 'milestone', 'agent-proposal', proposal.text, [proposal]),
    ...(decision ? [claim('decision', 'milestone', 'user-decision', decision.text, [decision])] : []),
    claim('current', 'current', 'agent-interpretation', decision ? '근거 제목과 대화 흐름을 먼저 보여주기로 했습니다.' : '대화 흐름 표시 방식이 제안됐으며 사용자 결정은 확인되지 않았습니다.', records),
    claim('next', 'next', 'agent-proposal', proposal.text, [proposal]),
    ...(['direction', 'reason'] as const).map(slot => ({ id: slot, slot, nature: 'agent-interpretation' as const, text: null, evidence: [], condition: null, missing: 'not-in-record' as const }))], limitations: [] };
}
export async function flowHarness() {
  const h = harness(), id = h.connect(), records = Object.values(flowRecords());
  h.records(records);
  h.summary.generate = async sources => ({ candidate: flowCandidate(sources), model: 'synthetic-flow-fixture' });
  await h.core.collect(id); await h.core.process(id);
  return { h, id, records };
}
