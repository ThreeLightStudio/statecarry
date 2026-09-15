import { candidateSchema, assessmentSchema, DomainError, type Assessment, type Candidate, type CheckedClaim, type SourceRevision } from '@statecarry/contracts';

export function checkCandidate(value: unknown, sources: SourceRevision[]): Candidate {
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('SUMMARY_UNAVAILABLE', 'Candidate schema does not match the contract');
  const result = parsed.data;
  const byId = new Map(sources.map(s => [s.id, s]));
  const seen = new Set<string>();
  for (const c of result.claims) {
    if (seen.has(c.id)) throw new DomainError('SUMMARY_UNAVAILABLE', 'Duplicate claim id');
    seen.add(c.id);
    if (c.text === null && !c.missing) throw new DomainError('SUMMARY_UNAVAILABLE', 'Absent claim needs a reason');
    if (c.text !== null && !c.evidence.length) throw new DomainError('SUMMARY_UNAVAILABLE', 'Claim has no evidence');
    for (const ref of c.evidence) {
      const source = byId.get(ref.revisionId);
      if (!source || !source.text.includes(ref.quote)) throw new DomainError('SUMMARY_UNAVAILABLE', `Citation mismatch: claim=${c.id}, revision=${ref.revisionId}, reason=${source ? 'quote-not-in-source' : 'source-not-in-input'}`);
      if (c.nature === 'user-decision' && source.actor !== 'user') throw new DomainError('SUMMARY_UNAVAILABLE', 'User decision cites a non-user source');
    }
  }
  for (const slot of ['purpose', 'current', 'direction', 'next', 'reason']) {
    if (!result.claims.some(c => c.slot === slot)) throw new DomainError('SUMMARY_UNAVAILABLE', `Missing meaning slot: ${slot}`);
  }
  return result;
}

export function checkAssessment(candidate: Candidate, value: unknown): { checks: Assessment; claims: CheckedClaim[] } {
  const parsed = assessmentSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('SUMMARY_UNAVAILABLE', 'Meaning check schema is invalid');
  const checks = parsed.data;
  if (checks.checks.length !== candidate.claims.length || new Set(checks.checks.map(c => c.claimId)).size !== checks.checks.length) throw new DomainError('SUMMARY_UNAVAILABLE', 'Meaning check coverage is incomplete');
  const claims = candidate.claims.map(c => {
    const check = checks.checks.find(x => x.claimId === c.id);
    if (!check) throw new DomainError('SUMMARY_UNAVAILABLE', 'Unknown meaning check target');
    return { ...c, verdict: check.verdict, checkReason: check.reason };
  });
  return { checks, claims };
}

// An explicit reference is necessary; folder/title similarity is never enough.
export function relationshipEvidence(sources: SourceRevision[], knownThreadIds: string[]): SourceRevision[] {
  return sources.filter(s => {
    if (s.actor !== 'user') return false;
    // Quoted instructions, questions, and negations never authorize an automatic merge.
    const text = s.text.replace(/```[\s\S]*?```/g, '').split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
    if (/[?？]|무관|별개|연결하지|인용|예시|가정|unrelated|do not link|quoted|example|hypothetical/i.test(text)) return false;
    const references = knownThreadIds.filter(id => id !== s.threadId && text.includes(id));
    if (references.length !== 1) return false;
    const id = references[0], at = text.indexOf(id), context = text.slice(Math.max(0, at - 80), at + id.length + 120);
    return /이어가|병렬|재검증|parallel|recheck|이어갑니다|이어서 진행|이어 진행|계속 진행|후속 작업입니다|인계받아|continue(?:s|d)? (?:from|the|work)|continuing from|resume (?:the|work)|handoff from/i.test(context);
  });
}
