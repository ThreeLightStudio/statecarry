import {
  DomainError,
  candidateSchema,
  assessmentSchema,
  type Candidate,
  type SourceRevision,
  type ReasoningEffort,
} from '@statecarry/contracts';
import { z } from 'zod';

export const referencedCandidateSchema = z
  .object({
    claims: z
      .array(
        candidateSchema.shape.claims.element
          .omit({ evidence: true })
          .extend({ evidenceIds: z.array(z.string()).max(12) })
          .strict(),
      )
      .min(1)
      .max(25),
    limitations: candidateSchema.shape.limitations,
  })
  .strict();
export function evidenceCatalog(chunks: unknown[][], sources: SourceRevision[]) {
  const references = new Map<string, { revisionId: string; quote: string }>();
  const reverse = new Map<string, string>();
  const prepared = chunks.map((chunk) =>
    chunk.map((raw) => {
      const entry = raw as { revisionId: string; text: string } & Record<string, unknown>;
      const { text, ...metadata } = entry;
      const source = sources.find((s) => s.id === entry.revisionId)!;
      const fragments: { evidenceId: string | null; text: string }[] = [];
      let start = 0;
      while (start < text.length) {
        let end = Math.min(start + 360, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        const newline = text.lastIndexOf('\n', end - 1);
        if (newline > start + 80) end = newline + 1;
        const quote = text.slice(start, end);
        start = end;
        const valid = source.text.includes(quote) && !quote.includes('[CREDENTIAL OMITTED]');
        const key = JSON.stringify([source.id, quote]);
        let evidenceId: string | null = null;
        if (valid) {
          evidenceId = reverse.get(key) ?? `q${references.size + 1}`;
          references.set(evidenceId, { revisionId: source.id, quote });
          reverse.set(key, evidenceId);
        }
        fragments.push({ evidenceId, text: quote });
      }
      return { ...metadata, fragments };
    }),
  );
  const decode = (value: unknown): Candidate => {
    const parsed = referencedCandidateSchema.parse(value);
    return {
      ...parsed,
      claims: parsed.claims.map(({ evidenceIds, ...claim }) => ({
        ...claim,
        evidence: evidenceIds.map((id) => {
          const reference = references.get(id);
          if (!reference)
            throw new DomainError('SUMMARY_UNAVAILABLE', `Unknown evidence reference: ${id}`);
          return { ...reference };
        }),
      })),
    };
  };
  const encode = (candidate: Candidate) => ({
    ...candidate,
    claims: candidate.claims.map(({ evidence, ...claim }) => ({
      ...claim,
      evidenceIds: evidence.map((e) => {
        const id = reverse.get(JSON.stringify([e.revisionId, e.quote]));
        if (!id)
          throw new DomainError(
            'SUMMARY_UNAVAILABLE',
            'Cached evidence is outside current analysis coverage',
          );
        return id;
      }),
    })),
  });
  return { chunks: prepared, decode, encode };
}

// Shared by all analysis providers, independently of source collection.
let running = 0;
const waiting: (() => void)[] = [];
export async function acquireAnalysisSlot() {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  return () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
}
export type AnalysisMetric = {
  id: string;
  phase: string;
  model: string;
  effort: ReasoningEffort;
  startedAt: string;
  elapsedMs: number;
  queueMs: number;
  outcome: 'completed' | 'failed' | 'cache-hit';
  usage: Record<string, number> | null;
  threadId: string | null;
  turnId: string | null;
  effortVerification: string;
  timing?: Record<string, number>;
  inputSize?: { promptUtf16: number; schemaUtf16: number };
  idleSleepProtected?: boolean;
};
export function redactAnalysisText(text: string) {
  return text
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~-]{16,})/gi, '[CREDENTIAL OMITTED]')
    .replace(
      /("(?:access_token|refresh_token|id_token|api_key|password)"\s*:\s*")[^"]+("?)/gi,
      '$1[CREDENTIAL OMITTED]$2',
    );
}
export function citationContext(candidate: Candidate, sources: SourceRevision[]) {
  const contexts = candidate.claims.flatMap((c) =>
    c.evidence.map((e) => {
      const source = sources.find((s) => s.id === e.revisionId),
        at = source?.text.indexOf(e.quote) ?? -1;
      if (!source || at < 0)
        throw new DomainError('SUMMARY_UNAVAILABLE', 'Cross-chunk citation is outside input');
      return {
        claimId: c.id,
        revisionId: source.id,
        threadId: source.threadId,
        actor: source.actor,
        eventAt: source.eventAt,
        text: redactAnalysisText(
          source.text.slice(Math.max(0, at - 800), at + e.quote.length + 800),
        ),
        scope: 'citation and adjacent context; remaining source checked in raw chunks',
      };
    }),
  );
  if (JSON.stringify(contexts).length > 250_000)
    throw new DomainError(
      'SUMMARY_UNAVAILABLE',
      'Combined citation context exceeds analysis budget',
    );
  return contexts;
}

// Require every candidate ID, including rejected and null claims. This prevents a
// structurally valid short array from silently omitting a semantic assessment.
export function summaryCheckCatalog(candidate: Candidate) {
  const item = assessmentSchema.shape.checks.element.omit({ claimId: true }).strict();
  const schema = z
    .object({
      checks: z.object(Object.fromEntries(candidate.claims.map((c) => [c.id, item]))).strict(),
    })
    .strict();
  return {
    schema,
    decode(raw: unknown) {
      const parsed = schema.parse(raw);
      return assessmentSchema.parse({
        checks: candidate.claims.map((c) => ({ claimId: c.id, ...parsed.checks[c.id] })),
      });
    },
  };
}
