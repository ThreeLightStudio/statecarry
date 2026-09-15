import { DomainError, QuestionCandidateError, QUESTION_LIMITS, questionCreateSchema, questionSubmitSchema, questionRequestSchema, type QuestionDiagnostic, type QuestionSession, type QuestionTurn, type QuestionExecution, type SourceRevision } from '@statecarry/contracts';
import type { StateCarry } from './service';
import { questionNotice, questionHistory, selectQuestionContext, validateQuestionAnswer, assessQuestionAnswer } from './question-context';

const active = (s: string) => ['queued', 'generating', 'repairing', 'checking', 'result-unknown'].includes(s);
export class ContextQuestions {
  private sessions = new Map<string, QuestionSession>();
  private tasks = new Set<Promise<void>>();
  private closing = false;
  private storageUnknown = false;
  constructor(private core: StateCarry) {}
  private now() { return this.core.clock.now(); }
  private fail(message: string): never { throw new DomainError('SOURCE_UNAVAILABLE', message, 409); }
  private execution(id: string) { return this.core.repo.get('questionExecution', id); }
  private save(e: QuestionExecution) { this.core.repo.put('questionExecution', { ...e, updatedAt: this.now() }); }
  private replay(id: string, hash: string) {
    const prior = this.execution(id);
    if (prior && prior.bodyHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'This request ID already has a different question.', 409);
    return prior;
  }
  private session(workId: string, id: string) {
    this.sweep();
    const s = this.sessions.get(id);
    if (!s || s.workId !== workId) throw new DomainError('NOT_FOUND', 'The question session ended. Start a new question.', 404);
    s.updatedAt = this.now(); return s;
  }
  private anchor(s: QuestionSession) {
    if (s.target) {
      const explanation = this.core.explanations.get(s.workId, s.target.explanationId);
      if (explanation.summaryId !== s.summaryId) this.fail('The explanation and question use different summary bases.');
      const node = explanation.candidate.nodes.find(n => n.id === s.target!.nodeId);
      if (!node) this.fail('The sentence for this question was not found.');
      return node;
    }
    const claim = this.core.repo.get('summary', s.summaryId)?.claims.find(c => c.id === s.claimId);
    if (!claim) this.fail('The question anchor sentence is missing.');
    return claim;
  }
  private scope(s: QuestionSession): SourceRevision[] {
    if (s.invalidated) this.fail('The connection scope changed. Start a new question.');
    const w = this.core.work(s.workId), c = this.core.repo.get('connection', w.projectId);
    const summary = this.core.repo.get('summary', s.summaryId);
    const linked = new Set(this.core.links(w.id).filter(l => l.status === 'linked').map(l => l.threadId));
    let anchorValid = false; try { this.anchor(s); anchorValid = true; } catch {}
    const valid = c && c.workId === w.id && summary?.workId === w.id && anchorValid && JSON.stringify(summary.sourceRevisionIds) === JSON.stringify(s.sourceRevisionIds);
    const sources = s.sourceRevisionIds.map(id => this.core.repo.get('source', id));
    if (!valid || sources.some(source => !source || !linked.has(source.threadId) || !this.core.accessibleSource(w.id, source.id))) {
      s.invalidated = true; s.anchor = 'Source scope changed';
      for (const turn of s.turns) { turn.answer = null; turn.assessment = null; if (active(turn.status)) turn.status = 'invalidated'; turn.retryable = false; }
      this.fail('The question source access scope changed. Start a new question.');
    }
    s.stale = w.latestSummaryId !== s.summaryId;
    return sources as SourceRevision[];
  }
  invalidateGoal(workId: string) {
    for (const s of this.sessions.values()) if (s.workId === workId) {
      s.invalidated = true; s.anchor = 'Goal changed';
      for (const turn of s.turns) { turn.answer = null; turn.assessment = null; turn.status = 'invalidated'; turn.retryable = false; }
    }
  }
  create(workId: string, value: unknown) {
    const input = questionCreateSchema.parse(value), hash = this.core.ids.hash({ workId, action: 'question-session', input });
    const prior = this.replay(input.requestId, hash);
    if (prior) return this.get(workId, prior.sessionId);
    this.sweep();
    if (this.sessions.size >= 64) this.fail('Too many question sessions are open. Close an existing session.');
    const w = this.core.work(workId), c = this.core.repo.get('connection', w.projectId)!;
    const summary = this.core.repo.get('summary', input.summaryId);
    const explanation = 'explanationId' in input ? this.core.explanations.get(workId, input.explanationId) : null;
    const claim = 'claimId' in input ? summary?.claims.find(i => i.id === input.claimId) : explanation?.candidate.nodes.find(n => n.id === input.nodeId);
    if (explanation && explanation.summaryId !== input.summaryId) this.fail('The explanation and summary basis do not match.');
    if (!summary || summary.workId !== workId || !claim) this.fail('The question target does not match the work or summary.');
    if (summary.linkVersion !== w.linkVersion) this.fail('The connection scope changed after this summary. Use a new summary.');
    // Establish start-turn/project scope using this work's current collected keys; old immutable versions of those keys remain valid.
    const allowedKeys = new Set(this.core.sources(workId).map(s => s.key));
    if (summary.sourceRevisionIds.some(id => { const source = this.core.repo.get('source', id); return !source || !allowedKeys.has(source.key); })) this.fail('Summary sources are outside the current collection scope. Check the connection scope and use a new summary.');
    const s: QuestionSession = { id: this.core.ids.next(), workId, summaryId: summary.id, claimId: 'claimId' in input ? input.claimId : null, ...('explanationId' in input ? { target: { kind: 'explanation' as const, explanationId: input.explanationId, nodeId: input.nodeId } } : {}), anchor: claim.text ?? 'Content unknown', sourceRevisionIds: [...summary.sourceRevisionIds], connectionRevision: c.revision, linkVersion: w.linkVersion, stale: w.latestSummaryId !== summary.id, invalidated: false, turns: [], updatedAt: this.now() };
    this.scope(s);
    this.save({ id: input.requestId, workId, sessionId: s.id, turnId: '', bodyHash: hash, attempt: 0, status: 'session', remote: null, analysis: this.core.summary.configuration(), updatedAt: this.now() });
    this.sessions.set(s.id, s); return structuredClone(s);
  }
  get(workId: string, id: string) {
    const s = this.session(workId, id);
    try { this.scope(s); } catch (e) { if (!s.invalidated) throw e; }
    return structuredClone(s);
  }
  submit(workId: string, id: string, value: unknown) {
    const input = questionSubmitSchema.parse(value), hash = this.core.ids.hash({ workId, id, input, action: 'question' });
    const prior = this.replay(input.requestId, hash);
    if (prior) return this.get(workId, prior.sessionId);
    const s = this.session(workId, id); this.scope(s); this.canRun(s);
    if (s.turns.length >= QUESTION_LIMITS.turns || JSON.stringify(questionHistory(s)).length + input.text.length > QUESTION_LIMITS.history) this.fail('This question session reached its exchange limit. Start a new session.');
    const turn: QuestionTurn = { id: this.core.ids.next(), text: input.text, status: 'queued', attempts: 1, answer: null, assessment: null, limitations: [], error: null, retryable: false };
    const execution: QuestionExecution = { id: input.requestId, workId, sessionId: id, turnId: turn.id, bodyHash: hash, attempt: 1, status: 'queued', remote: null, analysis: this.core.summary.configuration(), updatedAt: this.now() };
    this.save(execution); s.turns.push(turn); this.launch(s, turn, execution); return structuredClone(s);
  }
  retry(workId: string, id: string, turnId: string, value: unknown) {
    const input = questionRequestSchema.parse(value), hash = this.core.ids.hash({ workId, id, turnId, input, action: 'question-retry' });
    const prior = this.replay(input.requestId, hash); if (prior) return this.get(workId, prior.sessionId);
    const s = this.session(workId, id); this.scope(s); this.canRun(s);
    const t = s.turns.at(-1);
    if (!t || t.id !== turnId || !t.retryable || t.attempts >= 2 || t.status !== 'failed') this.fail('This question cannot be retried.');
    const e: QuestionExecution = { id: input.requestId, workId, sessionId: id, turnId, bodyHash: hash, attempt: 2, status: 'queued', remote: null, analysis: this.core.summary.configuration(), updatedAt: this.now() };
    this.save(e); t.status = 'queued'; t.attempts = 2; t.error = null; t.retryable = false;
    this.launch(s, t, e); return structuredClone(s);
  }
  private canRun(s: QuestionSession) {
    if (this.closing || !this.core.summary.answerQuestion || !this.core.summary.checkQuestion) throw new DomainError('CAPABILITY_UNSUPPORTED', 'The question model is unavailable.');
    if (s.turns.some(t => active(t.status))) this.fail('Confirm that the previous question has finished first.');
    if (this.hasUnresolvedExecution() || this.core.explanations.hasUnresolvedExecution() || this.core.repo.list('job').some(j => j.status === 'result-unknown')) throw new DomainError('RESULT_UNKNOWN', 'A new model call was blocked because the previous analysis has not been confirmed to have ended.', 409);
    if (this.tasks.size >= QUESTION_LIMITS.pending) this.fail('The question queue is full. Try again shortly.');
  }
  private launch(s: QuestionSession, t: QuestionTurn, e: QuestionExecution) {
    const promise = this.run(s, t, e).catch(() => {
      this.storageUnknown = true;
      // A failed metadata write must never release the UI into a retryable state.
      t.status = 'result-unknown'; t.retryable = false; t.answer = null; t.error = 'Execution status could not be saved. Automatic retry has stopped.';
    }).finally(() => { this.tasks.delete(promise); this.core.events.changed(s.workId); });
    this.tasks.add(promise);
  }
  private async run(s: QuestionSession, t: QuestionTurn, e: QuestionExecution) {
    // Shared across the original request and its one manual retry; old rows default to zero.
    e.repairs = Math.max(0, ...this.core.repo.list('questionExecution').filter(x => x.sessionId === s.id && x.turnId === t.id).map(x => x.repairs ?? 0));
    let terminationUnknown = false;
    let diagnosedError: unknown;
    const diagnose = (d: QuestionDiagnostic) => {
      e.diagnostics = [...(e.diagnostics ?? []), { ...d, itemId: d.itemId === null ? null : this.core.ids.hash(d.itemId), repairs: e.repairs ?? 0 }].slice(-16);
      this.save(e);
    };
    const validate = () => {
      if (this.closing || this.sessions.get(s.id) !== s || t.attempts !== e.attempt || t.status === 'invalidated') this.fail('The question session ended.');
      if (this.hasUnresolvedExecution() || this.core.explanations.hasUnresolvedExecution() || this.core.repo.list('job').some(j => j.status === 'result-unknown')) throw new DomainError('RESULT_UNKNOWN', 'Another analysis has not been confirmed to have ended.');
      this.scope(s);
    };
    const phase = (status: QuestionTurn['status']) => { t.status = status; e.status = status; this.save(e); this.core.events.changed(s.workId); };
    const onRemote = (remote: QuestionExecution['remote']) => { e.remote = remote; if (t.status === 'queued') { t.status = 'generating'; e.status = 'generating'; } this.save(e); this.core.events.changed(s.workId); };
    try {
      validate();
      const sources = this.scope(s), summary = this.core.repo.get('summary', s.summaryId)!;
      const anchor = this.anchor(s);
      const context = selectQuestionContext(s, t.text, anchor, sources);
      if ('kind' in anchor) context.anchorStatus = { kind: anchor.kind, nature: anchor.nature, uncertainty: anchor.uncertainty, condition: anchor.condition };
      t.limitations = [...new Set([...context.limitations, ...summary.limitations])];
      if (!context.excerpts.length) { t.answer = { items: [], unknowns: [questionNotice(t.text, 'empty')] }; phase('completed'); return; }
      phase('queued');
      let candidate;
      try {
        const raw = await this.core.summary.answerQuestion!(context, onRemote, validate);
        validate(); candidate = validateQuestionAnswer(raw, context, sources);
      } catch (error) {
        if (!(error instanceof QuestionCandidateError)) throw error;
        diagnose(error.diagnostic);
        diagnosedError = error;
        validate();
        if ((e.repairs ?? 0) >= 1) throw error;
        let terminated = false;
        try { terminated = await this.core.summary.resolve(e.remote) === 'terminated'; } catch {}
        if (!terminated) { terminationUnknown = true; throw new DomainError('RESULT_UNKNOWN', 'Repair stopped because the previous answer run has not been confirmed to have ended.'); }
        validate();
        e.repairs = 1;
        phase('repairing');
        const raw = await this.core.summary.answerQuestion!(context, onRemote, validate, { candidate: error.candidate, diagnostic: { ...error.diagnostic, repairs: 1 }, reason: error.message });
        validate(); candidate = validateQuestionAnswer(raw, context, sources);
      }
      phase('checking');
      const check = await this.core.summary.checkQuestion!(context, candidate, onRemote, validate);
      validate(); const result = assessQuestionAnswer(candidate, check, t.text);
      for (const c of result.assessment.checks) if (c.verdict !== 'supported') diagnose({ stage: 'meaning', violation: c.verdict, itemId: c.itemId, repairs: e.repairs ?? 0 });
      t.answer = result.answer;
      // Do not expose rejected candidate text through check reasons.
      t.assessment = { ...result.assessment, checks: result.assessment.checks.filter(c => result.answer.items.some(i => i.id === c.itemId)) };
      phase('completed');
    } catch (error) {
      if (error instanceof QuestionCandidateError && error !== diagnosedError) diagnose(error.diagnostic);
      else if (t.status === 'checking') diagnose({ stage: 'meaning', violation: 'assessment', itemId: null, repairs: e.repairs ?? 0 });
      let terminated: 'terminated' | 'unknown' = 'unknown';
      if (!terminationUnknown) try { terminated = await this.core.summary.resolve(e.remote); } catch {}
      const invalid = this.sessions.get(s.id) !== s || s.invalidated || this.closing;
      t.answer = null; t.assessment = null;
      t.error = invalid ? 'The question session or connection scope ended.' : error instanceof DomainError || error instanceof QuestionCandidateError ? error.message : 'The model answer or its check could not be completed.';
      t.retryable = !invalid && terminated === 'terminated' && t.attempts < 2 && !(error instanceof DomainError && error.code === 'CAPABILITY_UNSUPPORTED');
      phase(terminated === 'unknown' ? 'result-unknown' : invalid ? 'invalidated' : 'failed');
    }
  }
  evidence(workId: string, id: string, turnId: string, revisionId: string) {
    const s = this.session(workId, id), sources = this.scope(s), t = s.turns.find(t => t.id === turnId && t.status === 'completed');
    if (!t?.answer?.items.some(i => i.evidence.some(e => e.revisionId === revisionId))) this.fail('This is not a validated source for this answer.');
    const source = sources.find(s => s.id === revisionId); if (!source) this.fail('That source cannot be accessed.'); return structuredClone(source);
  }
  end(workId: string, id: string) {
    const s = this.sessions.get(id); if (!s || s.workId !== workId) return;
    this.sessions.delete(id);
    for (const t of s.turns) { t.text = ''; t.answer = null; t.assessment = null; t.retryable = false; }
  }
  sweep() { for (const s of this.sessions.values()) if (Date.parse(this.now()) - Date.parse(s.updatedAt) >= QUESTION_LIMITS.idleMs) this.end(s.workId, s.id); }
  hasUnresolvedExecution() { return this.storageUnknown || this.core.repo.list('questionExecution').some(e => e.status === 'result-unknown'); }
  async recover() {
    for (const e of this.core.repo.list('questionExecution').filter(e => active(e.status))) {
      // A crash can occur between spawning the process and saving its PID. Absence of metadata is not proof of termination.
      let terminated = false; try { if (e.remote?.pid) terminated = await this.core.summary.resolve(e.remote) === 'terminated'; } catch {}
      this.save({ ...e, status: terminated ? 'invalidated' : 'result-unknown' });
    }
  }
  beginClose() { this.closing = true; for (const s of this.sessions.values()) this.end(s.workId, s.id); }
  async settled() { await Promise.allSettled([...this.tasks]); }
}
