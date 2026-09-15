import type { Gateway } from '@statecarry/presentation';
import type {
  Observation,
  Command,
  Connection,
  HandoffTarget,
  ProjectListItem,
  Receipt,
  ReturnContextSnapshot,
  SourceRevision,
} from '@statecarry/contracts';
class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class HttpGateway implements Gateway {
  listTurns(threadId: string) {
    return this.request<{ turns: { id: string; at: string | null }[] }>(
      `/turns/${encodeURIComponent(threadId)}`,
    );
  }
  explanation<T>(path: string, payload?: unknown): Promise<T> {
    return this.contextRequest<T>(path, payload, 'Explanation');
  }
  question<T>(path: string, payload?: unknown): Promise<T> {
    return this.contextRequest<T>(path, payload, 'Question');
  }
  private async contextRequest<T>(path: string, payload: unknown, label: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `/api/v1${path}`,
        payload === undefined
          ? { cache: 'no-store' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
      );
    } catch {
      throw new RequestError(
        payload === undefined ? 'SOURCE_UNAVAILABLE' : 'RESULT_UNKNOWN',
        `${label} Disconnected. Checking status; nothing is resent automatically.`,
      );
    }
    let value: any;
    try {
      value = await response.json();
    } catch {
      throw new RequestError(
        payload === undefined ? 'SOURCE_UNAVAILABLE' : 'RESULT_UNKNOWN',
        `${label} The response could not be confirmed. Check status.`,
      );
    }
    if (!response.ok)
      throw new RequestError(
        value.error?.code ?? 'UNKNOWN',
        value.error?.message ?? `${label} Request failed`,
      );
    return value as T;
  }
  private async request<T>(path: string, command?: Command): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `/api/v1${path}`,
        command
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(command),
            }
          : { cache: 'no-store' },
      );
    } catch {
      throw new RequestError(
        command ? 'RESULT_UNKNOWN' : 'SOURCE_UNAVAILABLE',
        'The server connection could not be confirmed. Your last view and input are preserved.',
      );
    }
    const value = await response.json();
    if (!response.ok)
      throw new RequestError(
        value.error?.code ?? 'UNKNOWN',
        value.error?.message ?? 'Request failed',
      );
    return value as T;
  }
  projects() {
    return this.request<ProjectListItem[]>('/projects');
  }
  connections() {
    return this.request<Connection[]>('/connections');
  }
  snapshot(id: string) {
    return this.request<ReturnContextSnapshot>(`/work-contexts/${encodeURIComponent(id)}`);
  }
  evidence(id: string, workId?: string) {
    return this.request<SourceRevision>(
      workId
        ? `/work-contexts/${encodeURIComponent(workId)}/evidence/${encodeURIComponent(id)}`
        : `/evidence/${encodeURIComponent(id)}`,
    );
  }
  discover(cwd: string) {
    return this.request<{
      threads: { id: string; title: string; cwd: string }[];
      complete: boolean;
      limitations: string[];
    }>(`/discover?cwd=${encodeURIComponent(cwd)}`);
  }
  command(path: string, input: Command) {
    return this.request<Receipt | HandoffTarget>(path, input);
  }
  receipt(id: string) {
    return this.request<Receipt & { handoff?: { state: string; error: string | null } | null }>(
      `/commands/${encodeURIComponent(id)}`,
    );
  }
  async observe(event: Observation) {
    await fetch('/api/v1/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  }
  subscribe(
    listener: (workId: string | null) => void,
    onConnection?: (state: 'connected' | 'disconnected') => void,
  ) {
    const stream = new EventSource('/api/v1/events');
    stream.addEventListener('connected', () => {
      onConnection?.('connected');
      listener(null);
    });
    stream.addEventListener('change', (e) => {
      try {
        listener(JSON.parse((e as MessageEvent).data).workId);
      } catch {
        listener(null);
      }
    });
    stream.addEventListener('error', () => {
      onConnection?.('disconnected');
      listener(null);
    });
    return () => stream.close();
  }
}
