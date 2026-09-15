import type { QuestionSession, SourceRevision } from '@statecarry/contracts';
import type { Gateway } from './controller';
export type SavedQuestion = { target: { workId: string; summaryId: string; claimId: string }; explanation: { explanationId: string; nodeId: string } | null; input: string; sessionId: string | null; uncertain: boolean };
export type QuestionView = { anchorType?: 'claim' | 'explanation'; targetKey?: string; savedTargets?: { key: string; label: string }[]; open: boolean; input: string; session: QuestionSession | null; error: string | null; busy: boolean; uncertain: boolean; raw: Record<string, SourceRevision> };
export type QuestionAction = { type: 'questionSelect'; key: string } | { type: 'questionOpen' } | { type: 'questionClose' } | { type: 'questionInput'; value: string } | { type: 'questionSubmit' } | { type: 'questionNew' } | { type: 'questionRefresh' } | { type: 'questionRetry'; turnId: string } | { type: 'questionEvidence'; turnId: string; revisionId: string };
export const emptyQuestionView = (): QuestionView => ({ open: false, input: '', session: null, error: null, busy: false, uncertain: false, raw: {} });
class QuestionChannel {
  private value = emptyQuestionView();
  private target: { workId: string; summaryId: string; claimId: string } | null = null;
  private generation = 0;
  private readSequence = 0;
  private createRequest: string | null = null;
  explanation: { explanationId: string; nodeId: string } | null = null;
  saved(): SavedQuestion | null { return this.target ? { target: this.target, explanation: this.explanation, input: this.value.input, sessionId: this.value.session?.id ?? null, uncertain: this.value.uncertain || this.value.busy } : null; }
  async restore(saved: SavedQuestion) {
    this.explanation = saved.explanation;
    this.open(saved.target.workId, saved.target.summaryId, saved.target.claimId);
    this.set({ input: saved.input, open: false, uncertain: saved.uncertain });
    if (saved.sessionId) {
      const generation = this.generation;
      try { const session = await this.request<QuestionSession>(this.path(saved.sessionId));
        if (generation === this.generation) this.set({ session, raw: {}, uncertain: session.turns.some(t => t.status === 'result-unknown'), ...(session.invalidated ? { error: 'The source scope changed. Your question text is preserved.' } : {}) });
      } catch { if (generation === this.generation) this.set({ error: 'The earlier question session is unavailable. Your input is preserved.', uncertain: false }); }
    }
  }
  clearEvidence() { this.readSequence++; this.generation++; this.set({ uncertain: this.value.uncertain || this.value.busy, busy: false, raw: {}, session: this.value.session ? { ...this.value.session, anchor: 'Earlier explanation — checking access', turns: this.value.session.turns.map(t => ({ ...t, answer: null, assessment: null })) } : null }); }
  get view() { return this.value; }
  constructor(private gateway: Gateway, private id: () => string, private changed: (view: QuestionView) => void) {}
  private set(patch: Partial<QuestionView>) { this.value = { ...this.value, ...patch }; this.changed(this.value); }
  private path(sessionId = this.value.session?.id) { return `/work-contexts/${encodeURIComponent(this.target!.workId)}/questions${sessionId ? `/${encodeURIComponent(sessionId)}` : ''}`; }
  private request<T>(path: string, payload?: unknown): Promise<T> {
    if (!this.gateway.question) return Promise.reject(new Error('This connection does not support questions.'));
    return this.gateway.question<T>(path, payload);
  }
  reset(end = true) {
    const s = this.value.session;
    if (end && s) void this.request(this.path(s.id) + '/end', {}).catch(() => {});
    this.generation++; this.target = null; this.createRequest = null; this.value = emptyQuestionView(); this.changed(this.value);
  }
  open(workId: string, summaryId: string, claimId: string) {
    if (this.target && (workId !== this.target.workId || summaryId !== this.target.summaryId || claimId !== this.target.claimId)) this.reset();
    this.target = { workId, summaryId, claimId }; this.set({ open: true });
  }
  hide() { this.set({ open: false }); }
  async refresh() {
    if (!this.target || !this.value.session) return;
    const generation = this.generation, path = this.path(), readSequence = ++this.readSequence;
    try {
      const session = await this.request<QuestionSession>(path);
      if (generation === this.generation && readSequence === this.readSequence && (!this.value.session?.invalidated || session.invalidated)) this.set({ session, uncertain: false, ...(session.invalidated ? { raw: {}, error: 'The connection scope changed. Start a new question.' } : {}) });
    } catch (e) {
      if (generation === this.generation && readSequence === this.readSequence) {
        const expired = !!e && typeof e === 'object' && 'code' in e && e.code === 'NOT_FOUND';
        if (expired) this.createRequest = null;
        this.set({ error: e instanceof Error ? e.message : 'Could not check question status', ...(expired ? { session: null, raw: {}, uncertain: false } : {}) });
      }
    }
  }
  async action(action: QuestionAction) {
    if (action.type === 'questionInput') { this.set({ input: action.value }); return; }
    if (action.type === 'questionClose') { this.hide(); return; }
    if (action.type === 'questionRefresh') { await this.refresh(); return; }
    if (action.type === 'questionNew') { const target = this.target; this.reset(); if (target) this.open(target.workId, target.summaryId, target.claimId); return; }
    if (!this.target || this.value.busy) return;
    const generation = this.generation;
    this.set({ busy: true, error: null });
    try {
      if (action.type === 'questionEvidence') {
        const raw = await this.request<SourceRevision>(`${this.path()}/turns/${encodeURIComponent(action.turnId)}/evidence/${encodeURIComponent(action.revisionId)}`);
        if (generation === this.generation && !this.value.session?.invalidated) this.set({ raw: { ...this.value.raw, [action.revisionId]: raw } });
        return;
      }
      if (this.value.uncertain) throw new Error('Check status before trying again. Nothing is resent automatically.');
      if (action.type === 'questionSubmit') {
        const input = this.value.input.trim(); if (!input) return;
        if (!this.value.session) {
          this.createRequest ??= this.id();
          const session = await this.request<QuestionSession>(this.path(), { requestId: this.createRequest, summaryId: this.target.summaryId, ...(this.explanation ?? { claimId: this.target.claimId }) });
          if (generation !== this.generation) { void this.request(`/work-contexts/${encodeURIComponent(session.workId)}/questions/${encodeURIComponent(session.id)}/end`, {}).catch(() => {}); return; }
          this.set({ session });
        }
        const session = await this.request<QuestionSession>(`${this.path()}/turns`, { requestId: this.id(), text: input });
        if (generation === this.generation) { this.readSequence++; this.set({ session, input: this.value.input.trim() === input ? '' : this.value.input }); }
      } else if (action.type === 'questionRetry') {
        const session = await this.request<QuestionSession>(`${this.path()}/turns/${encodeURIComponent(action.turnId)}/retry`, { requestId: this.id() });
        if (generation === this.generation) { this.readSequence++; this.set({ session }); }
      }
    } catch (e) {
      if (generation === this.generation) {
        const uncertain = !!e && typeof e === 'object' && 'code' in e && e.code === 'RESULT_UNKNOWN';
        this.set({ error: e instanceof Error ? e.message : 'Question failed', uncertain: uncertain && !!this.value.session });
      }
    } finally { if (generation === this.generation) this.set({ busy: false }); }
  }
}


// Each target owns its in-flight callbacks, draft question and session. Switching is not ending.
export class QuestionController {
  private channels = new Map<string, { channel: QuestionChannel; kind: 'claim' | 'explanation'; label: string }>();
  private active: string | null = null;
  constructor(private gateway: Gateway, private id: () => string, private changed: (view: QuestionView) => void) {}
  private publish() {
    const entry = this.active ? this.channels.get(this.active) : null;
    this.changed(entry ? { ...entry.channel.view, anchorType: entry.kind, targetKey: this.active!, savedTargets: [...this.channels].map(([key, e]) => ({ key, label: e.channel.view.session?.invalidated ? 'Earlier question · scope changed' : e.channel.view.session?.anchor ?? e.label })) } : emptyQuestionView());
  }
  private activate(workId: string, summaryId: string, anchor: { claimId: string } | { explanationId: string; nodeId: string }, label: string) {
    const key = JSON.stringify([workId, summaryId, anchor]);
    if (!this.channels.has(key)) {
      if (this.channels.size >= 64) { this.publish(); return; }
      const channel = new QuestionChannel(this.gateway, this.id, () => { if (this.active === key) this.publish(); });
      if ('explanationId' in anchor) channel.explanation = anchor;
      this.channels.set(key, { channel, kind: 'explanationId' in anchor ? 'explanation' : 'claim', label });
    }
    this.active = key;
    this.channels.get(key)!.channel.open(workId, summaryId, 'claimId' in anchor ? anchor.claimId : '');
  }
  open(workId: string, summaryId: string, claimId: string) { this.activate(workId, summaryId, { claimId }, 'Questions about an earlier summary'); }
  openExplanation(workId: string, summaryId: string, explanationId: string, nodeId: string, label: string) { this.activate(workId, summaryId, { explanationId, nodeId }, label); }
  saved(workId: string): SavedQuestion[] { return [...this.channels.values()].flatMap(e => { const saved = e.channel.saved(); return saved?.target.workId === workId ? [saved] : []; }); }
  restore(saved: SavedQuestion[]) {
    for (const item of saved) {
      const { workId, summaryId, claimId } = item.target;
      this.activate(workId, summaryId, item.explanation ?? { claimId }, 'Questions about an earlier explanation');
      const channel = this.channels.get(this.active!)!.channel;
      void channel.restore(item);
    }
    this.hide();
  }
  clearEvidence() { for (const e of this.channels.values()) { e.label = 'Questions about an earlier explanation'; e.channel.clearEvidence(); } }
  hide() { if (this.active) this.channels.get(this.active)?.channel.hide(); }
  reset(end = true) { const old = [...this.channels.values()]; this.active = null; this.channels.clear(); for (const e of old) e.channel.reset(end); this.publish(); }
  async refresh() { await Promise.all([...this.channels.values()].map(e => e.channel.refresh())); }
  async action(action: QuestionAction) {
    if (action.type === 'questionSelect') {
      if (this.channels.has(action.key)) {
        this.active = action.key;
        const channel = this.channels.get(action.key)!.channel, saved = channel.saved();
        if (saved) channel.open(saved.target.workId, saved.target.summaryId, saved.target.claimId);
        this.publish();
      }
      return;
    }
    if (this.active) await this.channels.get(this.active)?.channel.action(action);
  }
}
