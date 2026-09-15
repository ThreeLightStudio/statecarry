import { DomainError, EXPLANATION_POLICY, EXPLANATION_LIMITS, explanationPrepareSchema, explanationRetrySchema, type ExplanationInput, type ExplanationJob, type ExplanationRevision, type ExplanationView, type SourceRevision } from '@statecarry/contracts';
import type { StateCarry } from './service';
import { ExplanationCandidateError } from '@statecarry/contracts';
import { selectExplanationRanges, explanationContext, validateExplanation, assessExplanation } from './explanation-context';

export class Explanations {
  private task: Promise<void> | null = null;
  private closing = false;
  private recovering: Promise<void> | null = null;
  private storageUnknown = false;
  constructor(private core: StateCarry) {}
  private now() { return this.core.clock.now(); }
  private save(job: ExplanationJob) { this.core.repo.put('explanationJob', { ...job, updatedAt: this.now() }); }
  available() { return !!this.core.summary.generateExplanation && !!this.core.summary.checkExplanation; }
  hasUnresolvedExecution() { return this.storageUnknown || this.core.repo.list('explanationJob').some(j => j.status === 'result-unknown'); }
  private scope(input: ExplanationInput, current = false): SourceRevision[] {
    const w = this.core.work(input.workId), c = this.core.repo.get('connection', w.projectId), summary = this.core.repo.get('summary', input.summaryId);
    if (JSON.stringify(input.goal?.intent) !== JSON.stringify(w.goal)) throw new DomainError('SOURCE_UNAVAILABLE', 'Goal changed; prepare a new explanation.', 409);
    const keys = new Set(this.core.sources(w.id).map(s => s.key));
    const linked = new Set(this.core.links(w.id).filter(l => l.status === 'linked').map(l => l.threadId));
    const sources = input.sourceRevisionIds.map(id => this.core.repo.get('source', id));
    if (!c || summary?.workId !== w.id || summary.linkVersion !== input.linkVersion || JSON.stringify(summary.sourceRevisionIds) !== JSON.stringify(input.sourceRevisionIds) || sources.some(s => !s || !keys.has(s.key) || !linked.has(s.threadId))) throw new DomainError('SOURCE_UNAVAILABLE', 'The explanation source access scope changed.', 409);
    if (current && (c.revision !== input.connectionRevision || w.linkVersion !== input.linkVersion || w.latestSummaryId !== input.summaryId || input.policyVersion !== EXPLANATION_POLICY || this.core.ids.hash(input.analysis) !== this.core.ids.hash(this.core.summary.configuration()))) throw new DomainError('REVISION_CONFLICT', 'The explanation summary or settings basis changed.', 409);
    return sources as SourceRevision[];
  }
  get(workId: string, id: string) {
    const r = this.core.repo.get('explanation', id);
    if (!r || r.workId !== workId) throw new DomainError('NOT_FOUND', 'The explanation was not found.', 404);
    if (r.jobId !== this.core.ids.hash({ ...r.input, capturedAt: undefined })) throw new DomainError('SOURCE_UNAVAILABLE', 'The fixed explanation input identifier does not match.', 409);
    this.scope(r.input); return r;
  }
  evidence(workId: string, id: string, revisionId: string) {
    const r = this.get(workId, id);
    if (![...r.candidate.nodes, ...r.candidate.links].some(n => n.evidence.some(e => e.revisionId === revisionId))) throw new DomainError('NOT_FOUND', 'This is not a citation in this explanation.', 404);
    return this.scope(r.input).find(s => s.id === revisionId)!;
  }
  view(workId: string): ExplanationView {
    const w = this.core.work(workId);
    const accessible = this.core.repo.list('explanation').filter(r => r.workId === workId).filter(r => { try { this.scope(r.input); return true; } catch { return false; } });
    const jobs = this.core.repo.list('explanationJob').filter(j => j.workId === workId && j.summaryId === w.latestSummaryId);
    const job = jobs.filter(j => { try { this.scope(j.input, true); return true; } catch { return false; } }).at(-1);
    const revision = accessible.find(r => r.id === job?.resultId) ?? accessible.at(-1) ?? null;
    return { available: this.available(), revision, policyVersion: EXPLANATION_POLICY, accessibleIds: accessible.map(r => r.id), job: job ? { canRetry: job.status === 'failed' && job.retries < EXPLANATION_LIMITS.retries && job.calls + (job.candidate ? 1 : 2) <= EXPLANATION_LIMITS.calls, id: job.id, status: job.status, calls: job.calls, repairs: job.repairs, retries: job.retries, error: job.error, queuedAt: job.queuedAt, updatedAt: job.updatedAt, phases: job.phases } : null };
  }
  prepare(workId: string, value: unknown) {
    const request = explanationPrepareSchema.parse(value);
    if (!this.available()) throw new DomainError('CAPABILITY_UNSUPPORTED', 'Explanation generation is unavailable.');
    const hash = this.core.ids.hash({ action: 'explanation-prepare', workId, request });
    const old = this.core.repo.get('receipt', request.requestId);
    if (old && old.bodyHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'This request ID was used for another explanation.', 409);
    if (old) return this.view(workId);
    const w = this.core.work(workId), summary = this.core.repo.get('summary', request.summaryId), connection = this.core.repo.get('connection', w.projectId)!;
    if (!summary || summary.workId !== workId || summary.id !== w.latestSummaryId) throw new DomainError('REVISION_CONFLICT', 'The displayed summary changed.', 409);
    if (w.goal?.evidenceId && !summary.sourceRevisionIds.includes(w.goal.evidenceId)) throw new DomainError('SOURCE_UNAVAILABLE', 'The confirmed goal source is outside this input. Review the goal scope.', 409);
    const sources = summary.sourceRevisionIds.map(id => this.core.repo.get('source', id));
    if (sources.some(s => !s)) throw new DomainError('SOURCE_UNAVAILABLE', 'Explanation sources are unavailable.', 409);
    const selected = selectExplanationRanges(summary, sources as SourceRevision[]);
    const input: ExplanationInput = { ...(w.goal ? { goal: { intent: w.goal, recordRanges: connection.recordRanges ?? {}, relations: this.core.links(workId).filter(l => l.status === 'linked').map(l => ({ threadId: l.threadId, kind: l.relation ?? (/병렬|parallel/i.test(l.rationale) ? 'parallel' as const : /재검증|recheck/i.test(l.rationale) ? 'recheck' as const : l.evidence.length ? 'followup' as const : 'unclear' as const), evidenceIds: l.evidence.filter(id => summary.sourceRevisionIds.includes(id)), rationale: l.evidence.every(id => summary.sourceRevisionIds.includes(id)) ? l.rationale : 'Relationship evidence is outside this input; review the connection' })) } } : {}), workId, summaryId: summary.id, sourceRevisionIds: [...summary.sourceRevisionIds], connectionRevision: connection.revision, linkVersion: w.linkVersion, policyVersion: EXPLANATION_POLICY, analysis: this.core.summary.configuration(), capturedAt: this.now(), ...selected,
      limitations: [...new Set([...summary.limitations, ...this.core.repo.list('checkpoint').filter(cp => cp.workId === workId && cp.status !== 'checked').map(cp => `Included session ${cp.threadId} was not fully read: ${cp.limitations.join('; ')}`), ...sources.flatMap(s => s!.limitations), ...(!selected.selectionComplete ? ['Only some source excerpts were selected. Distinguish unselected content from absence in the records.'] : []), ...(Object.keys(connection.startTurnIds).length ? ['Turns before your chosen starting turn are outside the input scope.'] : []), ...(!summary.inputCapturedAt ? ['The earlier summary lacks collection boundary information. The presence of the original request is unknown.'] : [])])] };
    this.scope(input, true);
    const id = this.core.ids.hash({ ...input, capturedAt: undefined });
    this.core.repo.transaction(() => {
      if (!this.core.repo.get('explanationJob', id)) this.save({ id, workId, summaryId: summary.id, input, status: 'waiting', calls: 0, repairs: 0, retries: 0, attemptToken: null, remote: null, candidate: null, resultId: null, error: null, queuedAt: this.now(), updatedAt: this.now(), phases: [] });
      this.core.repo.put('receipt', { id: request.requestId, command: 'explanation-prepare', bodyHash: hash, workId, committedRevision: w.revision, resultId: id, createdAt: this.now() });
    });
    this.core.events.changed(workId); this.tick(); return this.view(workId);
  }
  preparePublished(workId: string) {
    if (!this.available()) return;
    const summaryId = this.core.work(workId).latestSummaryId;
    if (summaryId) this.prepare(workId, { requestId: this.core.ids.hash(['explanation-published', workId, summaryId, EXPLANATION_POLICY]), summaryId });
  }
  retry(workId: string, jobId: string, value: unknown) {
    const request = explanationRetrySchema.parse(value), hash = this.core.ids.hash({ workId, jobId, action: 'explanation-retry', request });
    const prior = this.core.repo.get('receipt', request.requestId);
    if (prior && prior.bodyHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'The retry request ID does not match.', 409);
    if (prior) return this.view(workId);
    const job = this.core.repo.get('explanationJob', jobId);
    if (!job || job.workId !== workId) throw new DomainError('NOT_FOUND', 'The explanation job was not found.', 404);
    this.scope(job.input, true);
    if (job.status !== 'failed' || job.retries >= EXPLANATION_LIMITS.retries || job.calls + (job.candidate ? 1 : 2) > EXPLANATION_LIMITS.calls) throw new DomainError('VALIDATION', 'No explanation retries remain.');
    this.core.repo.transaction(() => {
      this.save({ ...job, retries: job.retries + 1, status: 'waiting', error: null });
      this.core.repo.put('receipt', { id: request.requestId, command: 'explanation-retry', bodyHash: hash, workId, committedRevision: this.core.work(workId).revision, resultId: jobId, createdAt: this.now() });
    });
    this.tick(); return this.view(workId);
  }
  tick() {
    if (!this.closing && !this.task && this.hasUnresolvedExecution() && !this.recovering) this.recovering = this.recover().catch(() => {}).finally(() => { this.recovering = null; });
    if (this.closing || this.task || this.hasUnresolvedExecution() || this.core.questions.hasUnresolvedExecution() || this.core.repo.list('job').some(j => j.status === 'result-unknown')) return;
    const pending = this.core.repo.list('explanationJob').filter(j => ['waiting', 'queued'].includes(j.status));
    for (const j of pending) {
      try { this.scope(j.input, true); } catch (e) { this.save({ ...j, status: 'superseded', error: (e as Error).message }); }
    }
    const valid = pending.filter(j => this.core.repo.get('explanationJob', j.id)?.status !== 'superseded').slice(0, EXPLANATION_LIMITS.pending);
    for (const j of valid) if (j.status === 'waiting') this.save({ ...j, status: 'queued' });
    const job = valid[0]; if (!job) return;
    this.task = this.run(this.core.repo.get('explanationJob', job.id)!).catch(() => { this.storageUnknown = true; }).finally(() => { this.task = null; this.core.events.changed(job.workId); });
  }
  private async run(original: ExplanationJob) {
    const token = this.core.ids.next();
    let job: ExplanationJob = { ...original, attemptToken: token };
    const update = (patch: Partial<ExplanationJob>) => {
      if (this.core.repo.get('explanationJob', job.id)?.attemptToken !== token) throw new DomainError('RESULT_UNKNOWN', 'Replaced by another explanation run.');
      job = { ...job, ...patch, updatedAt: this.now() }; this.save(job); this.core.events.changed(job.workId);
    };
    this.save(job);
    const validate = () => {
      if (this.closing || this.core.repo.get('explanationJob', job.id)?.attemptToken !== token) throw new DomainError('RESULT_UNKNOWN', 'The explanation run ended.');
      if (this.hasUnresolvedExecution() || this.core.questions.hasUnresolvedExecution() || this.core.repo.list('job').some(j => j.status === 'result-unknown')) throw new DomainError('RESULT_UNKNOWN', 'The previous analysis completion is unknown.');
      if (job.id !== this.core.ids.hash({ ...job.input, capturedAt: undefined })) throw new DomainError('SOURCE_UNAVAILABLE', 'The explanation input storage boundary does not match.', 409);
      this.scope(job.input, true);
    };
    const phase = async (name: 'generating' | 'repairing' | 'checking', run: () => Promise<unknown>) => {
      validate();
      if (job.calls >= EXPLANATION_LIMITS.calls) throw new DomainError('SUMMARY_UNAVAILABLE', 'The explanation call budget is exhausted.');
      update({ status: name, calls: job.calls + 1, remote: null, phases: [...job.phases, { phase: name, startedAt: this.now(), endedAt: null }] });
      try { return await run(); } finally { update({ phases: job.phases.map((p, i) => i === job.phases.length - 1 ? { ...p, endedAt: this.now() } : p) }); }
    };
    const remote = (meta: ExplanationJob['remote']) => { update({ remote: meta }); validate(); };
    try {
      validate();
      const sources = this.scope(job.input, true), summary = this.core.repo.get('summary', job.summaryId)!;
      const context = explanationContext(job.input, summary, sources);
      if (!context.excerpts.length) throw new DomainError('SOURCE_UNAVAILABLE', 'No sources are available to prepare an explanation.');
      let repair: { candidate: unknown; reason: string } | undefined;
      for (;;) {
        let raw: unknown = job.candidate;
        try {
          if (!raw) raw = await phase(repair ? 'repairing' : 'generating', () => this.core.summary.generateExplanation!(context, remote, validate, repair));
          validate(); const candidate = validateExplanation(raw, context); update({ candidate });
          const assessment = assessExplanation(candidate, await phase('checking', () => this.core.summary.checkExplanation!(context, candidate, remote, validate)));
          validate();
          this.core.repo.transaction(() => {
            validate();
            const result: ExplanationRevision = { id: this.core.ids.next(), workId: job.workId, summaryId: job.summaryId, input: job.input, candidate, assessment, generatedAt: this.now(), jobId: job.id, attemptToken: token };
            this.core.repo.put('explanation', result); update({ status: 'ready', resultId: result.id, error: null, candidate: null, remote: null });
          });
          break;
        } catch (e) {
          if (e instanceof ExplanationCandidateError) raw = e.candidate;
          if (!(e instanceof ExplanationCandidateError) && (!(e instanceof DomainError) || e.code !== 'SUMMARY_UNAVAILABLE') || job.repairs >= EXPLANATION_LIMITS.repairs || job.calls + 2 > EXPLANATION_LIMITS.calls) throw e;
          if (await this.core.summary.resolve(job.remote) !== 'terminated') throw new DomainError('RESULT_UNKNOWN', 'The explanation run has not been confirmed to have ended.');
          validate(); repair = { candidate: raw, reason: e.message }; update({ candidate: null, repairs: job.repairs + 1 });
        }
      }
    } catch (e) {
      if (this.core.repo.get('explanationJob', job.id)?.attemptToken !== token) return;
      let terminated = false; try { terminated = await this.core.summary.resolve(job.remote) === 'terminated'; } catch {}
      let changed = false; try { this.scope(job.input, true); } catch { changed = true; }
      update({ status: !terminated ? 'result-unknown' : changed ? 'superseded' : 'failed', error: e instanceof Error ? e.message : 'Explanation preparation failed' });
    }
  }
  async recover() {
    for (const job of this.core.repo.list('explanationJob').filter(j => ['generating', 'repairing', 'checking', 'result-unknown'].includes(j.status))) {
      const result = this.core.repo.list('explanation').find(r => r.jobId === job.id && r.attemptToken === job.attemptToken);
      if (result) { this.save({ ...job, status: 'ready', resultId: result.id }); continue; }
      let terminated = false; try { if (job.remote?.pid) terminated = await this.core.summary.resolve(job.remote) === 'terminated'; } catch {}
      let valid = true; try { this.scope(job.input, true); } catch { valid = false; }
      this.save({ ...job, status: !terminated ? 'result-unknown' : !valid ? 'superseded' : job.calls + (job.candidate ? 1 : 2) <= EXPLANATION_LIMITS.calls ? 'waiting' : 'failed', error: !terminated ? 'Previous explanation process completion unknown' : 'Recovering fixed input after the previous run ended' });
    }
  }
  beginClose() { this.closing = true; }
  async settled() { await this.task; await this.recovering; }
}
