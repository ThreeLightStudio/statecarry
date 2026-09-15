import {
  DomainError,
  EXPLANATION_LIMITS,
  explanationCandidateSchema,
  explanationAssessmentSchema,
  type ExplanationInput,
  type ExplanationContext,
  type ExplanationCandidate,
  type SourceRevision,
  type SummaryRevision,
} from '@statecarry/contracts';

export function selectExplanationRanges(summary: SummaryRevision, sources: SourceRevision[]) {
  const complete = sources.reduce((n, s) => n + s.text.length, 0) <= EXPLANATION_LIMITS.context;
  const refs = summary.claims.flatMap((c) => c.evidence);
  const words = [
    ...new Set(
      summary.claims.flatMap((c) => (c.text ?? '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []),
    ),
  ];
  const priorities = sources.map((s) =>
    refs.some((r) => r.revisionId === s.id)
      ? 5000
      : words.reduce((n, w) => n + Number(s.text.toLowerCase().includes(w)), 0),
  );
  // Preserve explicit decisions, constraints and observed failures/results before
  // lexical relevance. The remaining budget is still disclosed as partial input.
  for (let i = 0; i < sources.length; i++) {
    if (
      (sources[i].actor === 'user' || sources[i].actor === 'tool') &&
      /실패|원인|보류|제약|쓸 수 없|병렬|목표|FAIL|PASS|undetermined|timeout|hold|constraint|goal|parallel/i.test(
        sources[i].text,
      )
    )
      priorities[i] += 20000;
  }
  for (const thread of new Set(sources.map((s) => s.threadId))) {
    const indexes = sources.flatMap((s, i) => (s.threadId === thread ? [i] : []));
    for (const i of indexes.filter((i) => sources[i].actor === 'user').slice(0, 2)) {
      priorities[i] += 10000;
      for (const j of [i - 1, i + 1]) if (sources[j]?.threadId === thread) priorities[j] += 4000;
    }
    for (const i of indexes.slice(-2)) priorities[i] += 6000;
  }
  for (let i = 0; i < sources.length; i++)
    if (refs.some((r) => r.revisionId === sources[i].id)) {
      for (const j of [i - 1, i + 1])
        if (sources[j]?.threadId === sources[i].threadId) priorities[j] += 3000;
    }
  const order = sources.map((_, i) => i).sort((a, b) => priorities[b] - priorities[a] || a - b);
  const ranges: ExplanationInput['ranges'] = [];
  let left = EXPLANATION_LIMITS.context as number;
  for (const i of order) {
    const s = sources[i];
    if (!left || !s.text.length) continue;
    const count = Math.min(left, complete ? s.text.length : 4000);
    const ref = refs.find((r) => r.revisionId === s.id);
    let start =
      !complete && priorities[i] < 10000 && ref ? Math.max(0, s.text.indexOf(ref.quote) - 1000) : 0;
    if (start && /[\uDC00-\uDFFF]/.test(s.text[start])) start--;
    let end = Math.min(s.text.length, start + count);
    if (end < s.text.length && /[\uD800-\uDBFF]/.test(s.text[end - 1])) end--;
    ranges.push({ revisionId: s.id, start, end });
    left -= end - start;
  }
  ranges.sort(
    (a, b) =>
      sources.findIndex((s) => s.id === a.revisionId) -
      sources.findIndex((s) => s.id === b.revisionId),
  );
  return { ranges, selectionComplete: complete };
}

export function explanationContext(
  input: ExplanationInput,
  summary: SummaryRevision,
  sources: SourceRevision[],
): ExplanationContext {
  const excerpts = input.ranges.map((r) => {
    const s = sources.find((s) => s.id === r.revisionId);
    if (!s || r.start < 0 || r.end > s.text.length || r.end <= r.start)
      throw new DomainError(
        'SOURCE_UNAVAILABLE',
        'The fixed explanation source excerpt is unavailable.',
        409,
      );
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
  });
  return {
    input,
    excerpts,
    guide: summary.claims
      .filter((c) => c.text && c.verdict === 'supported')
      .map((c) => ({
        role: c.slot,
        text: c.text!,
        sourceRevisionIds: [...new Set(c.evidence.map((e) => e.revisionId))],
      })),
  };
}

export function validateExplanation(
  raw: unknown,
  context: ExplanationContext,
): ExplanationCandidate {
  const fail = (message: string): never => {
    throw new DomainError('SUMMARY_UNAVAILABLE', message);
  };
  const result = explanationCandidateSchema.safeParse(raw);
  if (!result.success) return fail('The explanation format or length check failed.');
  const c = result.data;
  if (context.input.goal) {
    const states = c.nodes.filter(
      (n) => n.role === 'state' && c.sections.some((s) => s.bodyIds.includes(n.id)),
    );
    if (states.length !== 1 || !c.sections.at(-1)?.bodyIds.includes(states[0].id))
      fail(
        'A confirmed goal needs one integrated current judgment in the final default-body section. Historical results belong in progress, not separate current states.',
      );
  }
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(c.nodes.map((n) => n.id)) ||
    !unique(c.links.map((l) => l.id)) ||
    !unique(c.sections.map((s) => s.id))
  )
    fail('Explanation IDs are duplicated.');
  const strings = [
    c.sections.map((s) => s.title).join(''),
    ...c.nodes.map(
      (n) =>
        n.text + n.uncertainty + n.condition + n.unknowns.map((u) => u.text + u.impact).join(''),
    ),
    ...c.links.map((l) => l.question + l.uncertainty),
    ...c.unknowns.map((u) => u.text + u.impact),
  ];
  if (strings.join('').length > EXPLANATION_LIMITS.output)
    fail('The explanation exceeds 8,000 characters.');
  const nodes = new Map(c.nodes.map((n) => [n.id, n]));
  const roots = c.sections.flatMap((s) => s.bodyIds);
  if (!unique(roots) || roots.some((id) => !nodes.has(id)))
    fail('A body sentence reference is invalid.');
  for (const item of [...c.nodes, ...c.links]) {
    if (item.kind === 'interpretation' && !item.uncertainty.trim())
      fail('AI Interpretations need a specific uncertainty statement.');
    for (const ref of item.evidence) {
      const e = context.excerpts.find(
        (e) =>
          e.revisionId === ref.revisionId &&
          ref.start >= e.start &&
          ref.start + ref.quote.length <= e.start + e.text.length,
      );
      if (
        !e ||
        e.text.slice(ref.start - e.start, ref.start - e.start + ref.quote.length) !== ref.quote
      )
        fail('The explanation quote does not match its fixed input excerpt.');
      if ('nature' in item) {
        const actor = e!.actor;
        if (
          ['user-report', 'user-request', 'user-decision'].includes(item.nature) &&
          actor !== 'user'
        )
          fail(
            `A non-user statement was cited as a user request or decision. node=${item.id}; nature=${item.nature}; actualActor=${actor}; revisionId=${ref.revisionId}; start=${ref.start}. User words relayed by tools, documents or AI are not direct user evidence. Cite an actual user statement or rewrite the claim to match the report and speaker established by the source; do not merely relabel it.`,
          );
        if (item.nature === 'tool-result' && actor !== 'tool')
          fail('The tool result citation has the wrong speaker.');
        if (
          ['agent-report', 'agent-proposal'].includes(item.nature) &&
          item.kind === 'record' &&
          actor !== 'agent'
        )
          fail('AI The report or proposal citation has the wrong speaker.');
      }
    }
  }
  for (const l of c.links) {
    if (
      !nodes.has(l.parentId) ||
      !nodes.has(l.childId) ||
      l.parentId === l.childId ||
      roots.includes(l.childId)
    )
      fail(
        `Reason link ${l.id} (${l.parentId} → ${l.childId}) is invalid. Parent and child must be distinct existing nodes; children must be reason-only nodes outside sections.bodyIds.`,
      );
    if (
      !['choice', 'state', 'action', 'followup'].includes(nodes.get(l.parentId)!.role) &&
      roots.includes(l.parentId)
    )
      fail(
        `Reasons can only be linked to choices, changes or judgments. link=${l.id}; parent=${l.parentId}; role=${nodes.get(l.parentId)!.role}. Only top-level choice/state/action/followup nodes may have reasons. Check whether reasons for background/goal/progress/premise belong in the body; do not change roles or remove valid reasons merely to pass checking.`,
      );
  }
  if (!unique(c.links.map((l) => JSON.stringify([l.parentId, l.childId]))))
    fail('Reason links are duplicated.');
  const seen = new Set<string>();
  const walk = (id: string, depth: number, path: Set<string>) => {
    if (depth > 2 || path.has(id)) fail('Reasons must be acyclic and at most two levels deep.');
    seen.add(id);
    const next = new Set(path).add(id);
    for (const l of c.links.filter((l) => l.parentId === id)) walk(l.childId, depth + 1, next);
  };
  for (const root of roots) walk(root, 0, new Set());
  if (seen.size !== nodes.size) fail('Reasons contain a cycle or cannot be reached from the body.');
  for (const u of [...c.unknowns, ...c.nodes.flatMap((n) => n.unknowns)]) {
    if (u.cause === 'not-in-record' && !context.input.selectionComplete)
      fail('Partial input cannot establish absence from the complete record.');
  }
  return c;
}

export function assessExplanation(candidate: ExplanationCandidate, raw: unknown) {
  const parsed = explanationAssessmentSchema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError(
      'SUMMARY_UNAVAILABLE',
      'The explanation meaning check has an invalid format.',
    );
  const a = parsed.data;
  for (const [items, checks] of [
    [candidate.nodes, a.nodes],
    [candidate.links, a.links],
  ] as const) {
    if (
      items.length !== checks.length ||
      new Set(checks.map((c) => c.id)).size !== items.length ||
      checks.some((c) => !items.some((i) => i.id === c.id))
    )
      throw new DomainError(
        'SUMMARY_UNAVAILABLE',
        'Not all sentences and reason links were checked.',
      );
  }
  const rejected = [...a.nodes, ...a.links].filter((x) => x.verdict !== 'supported');
  if (rejected.length || !a.unknownsSafe || !a.narrativeComplete)
    throw new DomainError(
      'SUMMARY_UNAVAILABLE',
      `Explanation meaning check rejected: ${[a.reason, ...rejected.map((x) => `${x.id}: ${x.reason}`)].join('; ').slice(0, 2000)}`,
    );
  return a;
}
