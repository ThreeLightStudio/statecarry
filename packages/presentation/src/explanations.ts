import type {
  ExplanationRevision,
  ExplanationView,
  ReturnContextSnapshot,
  SourceRevision,
} from '@statecarry/contracts';
import type { Gateway } from './controller';
import { presentEvidence, type EvidenceViewModel } from './presenter';
export type {
  ExplanationRevision,
  ExplanationNode,
  ExplanationCandidate,
} from '@statecarry/contracts';
export type ExplanationAction =
  | { type: 'explanationPrepare' }
  | { type: 'explanationRetry' }
  | { type: 'explanationAdopt' }
  | { type: 'explanationEvidence'; revisionId: string }
  | { type: 'explanationQuestion'; nodeId: string };
export type ExplanationPanelView = {
  revision: ExplanationRevision | null;
  latest: ExplanationView | null;
  stale: boolean;
  newAvailable: boolean;
  busy: boolean;
  error: string | null;
  raw: Record<string, EvidenceViewModel>;
};
export const emptyExplanationView = (): ExplanationPanelView => ({
  revision: null,
  latest: null,
  stale: false,
  newAvailable: false,
  busy: false,
  error: null,
  raw: {},
});
export class ExplanationController {
  private value = emptyExplanationView();
  private workId: string | null = null;
  private generation = 0;
  private requestId: string | null = null;
  private snapshot: ReturnContextSnapshot | null = null;
  constructor(
    private gateway: Gateway,
    private id: () => string,
    private changed: (view: ExplanationPanelView) => void,
    private read: (revisionId: string, summaryId: string) => void,
  ) {}
  get view() {
    return this.value;
  }
  private set(patch: Partial<ExplanationPanelView>) {
    this.value = { ...this.value, ...patch };
    this.changed(this.value);
  }
  restore(revision: ExplanationRevision) {
    this.set({ revision, raw: {} });
  }
  reset() {
    this.generation++;
    this.workId = null;
    this.snapshot = null;
    this.requestId = null;
    this.set(emptyExplanationView());
  }
  sync(s: ReturnContextSnapshot, first: boolean) {
    const before = this.snapshot;
    if (
      before &&
      (before.work.id !== s.work.id ||
        before.summary?.id !== s.summary?.id ||
        before.work.linkVersion !== s.work.linkVersion ||
        before.connection.revision !== s.connection.revision ||
        before.explanation?.policyVersion !== s.explanation?.policyVersion)
    ) {
      this.generation++;
      this.requestId = null;
      this.set({ busy: false });
    }
    this.workId = s.work.id;
    this.snapshot = s;
    const latest = s.explanation ?? null;
    let revision = this.value.revision;
    const revoked = revision && !latest?.accessibleIds.includes(revision.id);
    if (revoked) {
      revision = null;
      this.generation++;
    }
    if (!revision) revision = latest?.revision ?? null;
    this.set({
      revision,
      latest,
      ...(revoked ? { raw: {}, error: 'The explanation access scope has changed.' } : {}),
      stale:
        !!revision &&
        (revision.summaryId !== s.summary?.id ||
          revision.input.policyVersion !== latest?.policyVersion ||
          s.freshness?.summary !== 'current' ||
          s.freshness.collection !== 'checked'),
      newAvailable: !!revision && !!latest?.revision && revision.id !== latest.revision.id,
    });
    // Only the route-entry event prepares legacy summaries; SSE and polling never do.
    if (
      first &&
      s.summary &&
      s.summary.inputVersion === s.work.inputVersion &&
      latest?.available &&
      !latest.job &&
      !latest.revision
    )
      void this.prepare();
  }
  private path() {
    return `/work-contexts/${encodeURIComponent(this.workId!)}/explanations`;
  }
  private async prepare(retry = false) {
    const s = this.snapshot;
    if (!s?.summary || !this.gateway.explanation || this.value.busy) return;
    const generation = this.generation;
    this.set({ busy: true, error: null });
    try {
      this.requestId ??= this.id();
      const latest = await this.gateway.explanation<ExplanationView>(
        retry
          ? `${this.path()}/${encodeURIComponent(this.value.latest!.job!.id)}/retry`
          : `${this.path()}/prepare`,
        retry
          ? { requestId: this.requestId }
          : { requestId: this.requestId, summaryId: s.summary.id },
      );
      if (generation === this.generation) {
        this.requestId = null;
        this.sync({ ...this.snapshot!, explanation: latest }, false);
      }
    } catch (e) {
      if (generation === this.generation)
        this.set({
          error:
            e instanceof Error
              ? e.message
              : 'The preparation response is unknown. Check status or request the same preparation again.',
        });
    } finally {
      if (generation === this.generation) this.set({ busy: false });
    }
  }
  async action(action: ExplanationAction) {
    if (action.type === 'explanationPrepare') return this.prepare();
    if (action.type === 'explanationRetry') return this.prepare(true);
    if (action.type === 'explanationAdopt' && this.value.latest?.revision && this.snapshot) {
      this.set({ revision: this.value.latest.revision, raw: {}, error: null });
      this.sync(this.snapshot, false);
      return;
    }
    if (action.type === 'explanationEvidence') {
      const r = this.value.revision,
        generation = this.generation;
      if (!r || !this.gateway.explanation) return;
      try {
        // Always use the scoped endpoint, including cached/reopened citations.
        const source = await this.gateway.explanation<SourceRevision>(
          `${this.path()}/${encodeURIComponent(r.id)}/evidence/${encodeURIComponent(action.revisionId)}`,
        );
        if (generation !== this.generation || r.id !== this.value.revision?.id) return;
        this.set({ raw: { ...this.value.raw, [source.id]: presentEvidence(source) }, error: null });
        this.read(source.id, r.summaryId);
      } catch (e) {
        if (generation === this.generation)
          this.set({ raw: {}, error: e instanceof Error ? e.message : 'Source access failed' });
      }
    }
  }
}
