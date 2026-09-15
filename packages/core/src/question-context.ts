import {
  DomainError,
  QuestionCandidateError,
  QUESTION_LIMITS,
  questionAnswerSchema,
  questionAssessmentSchema,
  type QuestionDiagnostic,
  type QuestionAnswer,
  type QuestionContext,
  type QuestionSession,
  type SourceRevision,
  type Claim,
} from '@statecarry/contracts';

export function questionHistory(session: QuestionSession) {
  return session.turns
    .filter((t) => t.status === 'completed' && t.answer)
    .map((t) => ({ question: t.text, answer: t.answer! }));
}
export function selectQuestionContext(
  session: QuestionSession,
  question: string,
  claim: Pick<Claim, 'text' | 'evidence'> & Partial<Pick<Claim, 'condition'>>,
  sources: SourceRevision[],
): QuestionContext {
  const history = questionHistory(session);
  const query = [
    question,
    claim.text ?? '',
    claim.condition ?? '',
    ...history.map((h) => h.question),
  ]
    .join(' ')
    .toLocaleLowerCase();
  const words = [...new Set(query.match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  const tokens = new Set(
    words.flatMap((w) =>
      /[가-힣]/.test(w)
        ? [w, ...Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2))]
        : [w],
    ),
  );
  const refs = [
    ...claim.evidence,
    ...history.flatMap((h) => h.answer.items.flatMap((i) => i.evidence)),
  ];
  const groups = new Map<string, SourceRevision[]>();
  // Source snapshot order is the reader's original order, not lexical turn IDs or collection timestamps.
  for (const s of sources) {
    const key = JSON.stringify([s.threadId, s.turnId]);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const turns = [...groups.values()];
  const scores = turns.map((turn) =>
    turn.reduce((score, s) => {
      const text = s.text.toLocaleLowerCase();
      return (
        score +
        (claim.evidence.some((r) => r.revisionId === s.id)
          ? 20000
          : refs.some((r) => r.revisionId === s.id)
            ? 10000
            : 0) +
        [...tokens].reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0)
      );
    }, 0),
  );
  const ranked = turns
    .map((_, i) => i)
    .filter((i) => scores[i] > 0)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  const backgroundQuestion = /처음|최초|배경|무엇.*무엇|어떤 요청|origin|background/i.test(
    [question, ...history.map((h) => h.question)].join(' '),
  );
  const anchorThreads = new Set(
    sources.filter((s) => claim.evidence.some((e) => e.revisionId === s.id)).map((s) => s.threadId),
  );
  const userTurns = turns
    .map((_, i) => i)
    .filter((i) => turns[i].some((s) => s.actor === 'user' && anchorThreads.has(s.threadId)));
  // Context candidates only: a user message is not necessarily a request or decision.
  const background = new Set(
    backgroundQuestion ? [...userTurns.slice(0, 2), ...userTurns.slice(-2)] : [],
  );
  const selected = new Set<number>();
  for (const i of ranked
    .filter((i) => turns[i].some((s) => claim.evidence.some((r) => r.revisionId === s.id)))
    .slice(0, 4))
    selected.add(i);
  // Reserve context for subsequent reports before lexical matches fill the budget.
  // Reader order is a collection ordering, not independent proof of current reality.
  const recent = new Set<number>();
  if (!backgroundQuestion)
    for (const thread of anchorThreads) {
      for (const i of turns
        .map((_, i) => i)
        .filter((i) =>
          turns[i].some(
            (s) => s.threadId === thread && (s.actor === 'user' || s.actor === 'agent'),
          ),
        )
        .slice(-2)) {
        if (selected.size < QUESTION_LIMITS.contextTurns) {
          selected.add(i);
          recent.add(i);
        }
      }
    }
  for (const i of background) selected.add(i);
  for (const i of ranked) {
    for (const n of [i, i - 1, i + 1])
      if (
        n >= 0 &&
        n < turns.length &&
        turns[n][0].threadId === turns[i][0].threadId &&
        selected.size < QUESTION_LIMITS.contextTurns
      )
        selected.add(n);
  }
  const excerpts: QuestionContext['excerpts'] = [],
    limitations: string[] = [];
  let remaining = QUESTION_LIMITS.context;
  // Allocate to high relevance first, then restore original turn/item order for the model.
  const priority = (i: number) =>
    scores[i] + (background.has(i) ? 15000 : 0) + (recent.has(i) ? 12000 : 0);
  const orderedSources = [...selected]
    .sort((a, b) => priority(b) - priority(a) || a - b)
    .flatMap((i) =>
      [...turns[i]]
        .sort(
          (a, b) =>
            Number(claim.evidence.some((r) => r.revisionId === b.id)) -
              Number(claim.evidence.some((r) => r.revisionId === a.id)) ||
            Number(b.actor === 'user' || b.actor === 'agent') -
              Number(a.actor === 'user' || a.actor === 'agent'),
        )
        .map((s) => ({ s, i })),
    );
  const sourcePriority = ({ s, i }: { s: SourceRevision; i: number }) =>
    (claim.evidence.some((r) => r.revisionId === s.id)
      ? 100000
      : refs.some((r) => r.revisionId === s.id)
        ? 90000
        : recent.has(i) && (s.actor === 'user' || s.actor === 'agent')
          ? 80000
          : background.has(i) && s.actor === 'user'
            ? 70000
            : s.actor === 'user' || s.actor === 'agent'
              ? 40000
              : 0) + Math.min(scores[i], 1000);
  orderedSources.sort((a, b) => sourcePriority(b) - sourcePriority(a));
  // One large early tool item must not consume the space reserved for later reports.
  const perSource = Math.min(
    backgroundQuestion ? 3000 : 4000,
    Math.max(1200, Math.floor(QUESTION_LIMITS.context / Math.min(16, orderedSources.length || 1))),
  );
  for (const { s, i } of orderedSources) {
    if (!remaining) break;
    const ref = refs.find((r) => r.revisionId === s.id);
    const lower = s.text.toLocaleLowerCase();
    const hit = ref
      ? s.text.indexOf(ref.quote)
      : Math.max(
          0,
          ...[...tokens]
            .map((t) => lower.indexOf(t))
            .filter((n) => n >= 0)
            .slice(0, 1),
        );
    const budget = Math.min(remaining, perSource);
    let start = Math.max(0, hit - Math.min(600, Math.floor(budget / 3)));
    if (!ref && recent.has(i) && s.text.length > budget) start = s.text.length - budget;
    if (s.text.length <= budget) start = 0;
    if (start > 0 && /[\uDC00-\uDFFF]/.test(s.text[start])) start--;
    let end = Math.min(s.text.length, start + budget);
    if (end < s.text.length && /[\uD800-\uDBFF]/.test(s.text[end - 1])) end--;
    const text = s.text.slice(start, end);
    remaining -= text.length;
    excerpts.push({
      revisionId: s.id,
      threadId: s.threadId,
      turnId: s.turnId,
      itemId: s.itemId,
      actor: s.actor,
      kind: s.kind,
      eventAt: s.eventAt,
      start,
      text,
    });
    if (start || end < s.text.length)
      limitations.push('Only excerpts from long sources were read.');
    limitations.push(...s.limitations);
  }
  excerpts.sort(
    (a, b) =>
      sources.findIndex((s) => s.id === a.revisionId) -
      sources.findIndex((s) => s.id === b.revisionId),
  );
  if (excerpts.length < sources.length)
    limitations.push(
      'Only selected relevant records were read. This does not establish that information is absent from all records.',
    );
  if (backgroundQuestion) {
    if (!userTurns.length)
      limitations.push(
        'No user statement is present in the allowed fixed records from the cited conversation. Distinguish an AI restatement from direct confirmation of a user request.',
      );
    else if (
      userTurns.some((i) =>
        turns[i].some((s) => s.actor === 'user' && !excerpts.some((e) => e.revisionId === s.id)),
      )
    )
      limitations.push(
        'Some allowed user statements were not selected. Do not treat a selection gap as absence of the original request.',
      );
  }
  limitations.push(
    'This uses the fixed records for the summary; the latest situation has not been checked.',
  );
  return {
    anchorSourceRevisionIds: [...new Set(claim.evidence.map((e) => e.revisionId))],
    recordOrder: sources.map((s) => s.id),
    anchor: claim.text ?? 'Anchor claim content unknown',
    anchorCondition: claim.condition ?? '',
    question,
    history,
    excerpts,
    limitations: [...new Set(limitations)],
  };
}

export function validateQuestionAnswer(
  raw: unknown,
  context: QuestionContext,
  sources: SourceRevision[],
): QuestionAnswer {
  const fail = (
    message: string,
    violation: QuestionDiagnostic['violation'] = 'structure',
    item?: QuestionAnswer['items'][number],
    actor?: SourceRevision['actor'],
  ): never => {
    throw new QuestionCandidateError(
      message,
      {
        stage: 'candidate',
        violation,
        itemId: item?.id ?? null,
        nature: item?.nature,
        actor,
        repairs: 0,
      },
      raw,
    );
  };
  const parsed = questionAnswerSchema.safeParse(raw);
  if (!parsed.success) return fail('The answer failed format validation.');
  const answer = parsed.data;
  if (
    answer.items.reduce((n, i) => n + i.text.length + i.uncertainty.length, 0) +
      answer.unknowns.join('').length >
    QUESTION_LIMITS.output
  )
    fail('The answer exceeds the length limit.');
  if (new Set(answer.items.map((i) => i.id)).size !== answer.items.length)
    fail('Answer item IDs are duplicated.');
  for (const item of answer.items) {
    if (item.kind === 'interpretation' && !item.uncertainty.trim())
      fail('The interpretation uncertainty statement is missing.', 'structure', item);
    if (item.kind === 'record' && item.nature === 'agent-interpretation')
      fail('An interpretation cannot be labeled as a record.', 'structure', item);
    for (const ref of item.evidence) {
      const source = sources.find((s) => s.id === ref.revisionId);
      const excerpt = context.excerpts.find(
        (e) =>
          e.revisionId === ref.revisionId &&
          ref.start >= e.start &&
          ref.start + ref.quote.length <= e.start + e.text.length,
      );
      if (
        !source ||
        !excerpt ||
        source.text.slice(ref.start, ref.start + ref.quote.length) !== ref.quote ||
        excerpt.text.slice(
          ref.start - excerpt.start,
          ref.start - excerpt.start + ref.quote.length,
        ) !== ref.quote
      )
        fail(
          'The answer quote does not match the allowed source excerpt.',
          'citation',
          item,
          source?.actor,
        );
      if (['user-request', 'user-decision'].includes(item.nature) && source!.actor !== 'user')
        fail('A non-user statement was cited as a user decision.', 'speaker', item, source!.actor);
      if (item.nature === 'tool-result' && source!.actor !== 'tool')
        fail(
          'The execution result citation has the wrong speaker.',
          'speaker',
          item,
          source!.actor,
        );
    }
  }
  return answer;
}
export function questionNotice(question: string, kind: 'empty' | 'unverified' | 'excluded') {
  const ko = /[가-힣]/.test(question);
  return {
    empty: ko
      ? '선택할 수 있는 관련 기록이 없습니다.'
      : 'No related records are available for selection.',
    unverified: ko
      ? '선택된 기록에서 근거를 확인할 수 있는 답변을 찾지 못했습니다.'
      : 'No verifiable answer was found in the selected records.',
    excluded: ko
      ? '근거 검사를 통과하지 못한 설명은 제외했습니다.'
      : 'Explanations that failed evidence checks were excluded.',
  }[kind];
}
export function assessQuestionAnswer(answer: QuestionAnswer, raw: unknown, question = '') {
  const parsed = questionAssessmentSchema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError(
      'SUMMARY_UNAVAILABLE',
      'The question meaning check has an invalid format.',
    );
  const assessment = parsed.data;
  if (
    assessment.checks.length !== answer.items.length ||
    new Set(assessment.checks.map((c) => c.itemId)).size !== answer.items.length ||
    assessment.checks.some((c) => !answer.items.some((i) => i.id === c.itemId))
  )
    throw new DomainError('SUMMARY_UNAVAILABLE', 'The answer meaning check is incomplete.');
  const items = answer.items.filter((i) =>
    assessment.checks.some((c) => c.itemId === i.id && c.verdict === 'supported'),
  );
  const unknowns = assessment.unknownsSafe ? answer.unknowns : [];
  if (!items.length && !unknowns.length) unknowns.push(questionNotice(question, 'unverified'));
  if (items.length < answer.items.length) unknowns.push(questionNotice(question, 'excluded'));
  return { answer: { items, unknowns }, assessment };
}
