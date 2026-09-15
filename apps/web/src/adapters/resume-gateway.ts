import type { ResumeGateway, ResumeWork, ResumeCorrection } from '@statecarry/presentation';
import type { Command, Continuation, Receipt } from '@statecarry/contracts';
export class HttpResumeGateway implements ResumeGateway {
  subscribe(
    listener: () => void,
    onConnection?: (state: 'connected' | 'disconnected') => void,
  ): () => void {
    if (typeof EventSource === 'undefined') return () => {};
    const source = new EventSource('/api/v1/events');
    const onChange = () => listener();
    const onConnected = () => {
      onConnection?.('connected');
      listener();
    };
    const onError = () => onConnection?.('disconnected');
    source.addEventListener('change', onChange);
    source.addEventListener('connected', onConnected);
    source.addEventListener('error', onError);
    return () => {
      source.removeEventListener('change', onChange);
      source.removeEventListener('connected', onConnected);
      source.removeEventListener('error', onError);
      source.close();
    };
  }
  private async request(path: string, data?: unknown) {
    const response = await fetch(`/api/v1/resume${path}`, {
      cache: 'no-store',
      ...(data === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          }),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error?.message ?? 'Cannot reach StateCarry. Check the local server.');
    return value;
  }
  list(): Promise<ResumeWork[]> {
    return this.request('');
  }
  async setGoal(id: string, text: string, version: string) {
    await this.request(`/${encodeURIComponent(id)}/goal`, { text, version });
  }
  async refresh(id: string) {
    await this.request(`/${encodeURIComponent(id)}/refresh`, {});
  }
  async correct(id: string, input: ResumeCorrection) {
    await this.request(`/${encodeURIComponent(id)}/correct`, input);
  }
  async setCoordination(id: string, threadId: string | null, version: string) {
    await this.request(`/${encodeURIComponent(id)}/coordination`, { threadId, version });
  }
  private async command(path: string, revision: number, payload: Record<string, unknown>) {
    const input: Command = { requestId: crypto.randomUUID(), expectedRevision: revision, payload };
    const response = await fetch(`/api/v1${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error?.message ?? 'Cannot reach StateCarry. Check the local server.');
    return value;
  }
  async prepareContinuation(
    workId: string,
    revision: number,
    input: Parameters<NonNullable<ResumeGateway['prepareContinuation']>>[2],
  ): Promise<Continuation> {
    return this.command(
      `/work-contexts/${encodeURIComponent(workId)}/continuations`,
      revision,
      input,
    ) as Promise<Continuation>;
  }
  async sendContinuation(
    workId: string,
    revision: number,
    continuationId: string,
  ): Promise<Receipt> {
    return this.command(
      `/work-contexts/${encodeURIComponent(workId)}/continuations/${encodeURIComponent(continuationId)}/send`,
      revision,
      { continuationId },
    ) as Promise<Receipt>;
  }
  async openContinuation(
    workId: string,
    revision: number,
    continuationId: string,
  ): Promise<Receipt> {
    return this.command(
      `/work-contexts/${encodeURIComponent(workId)}/continuations/${encodeURIComponent(continuationId)}/open`,
      revision,
      { continuationId },
    ) as Promise<Receipt>;
  }
  async continuation(workId: string, id: string): Promise<Continuation> {
    const response = await fetch(
      `/api/v1/work-contexts/${encodeURIComponent(workId)}/continuations/${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error?.message ?? 'Cannot read the continuation status.');
    return value as Continuation;
  }
}
