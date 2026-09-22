import type {
  AnalysisGateway,
  AnalysisWork,
  AnalysisCorrection,
  AnalysisChangeNotice,
} from '@statecarry/presentation';
import type {
  OutputLanguage,
  TaskDiscussionRequest,
  TaskDiscussionResponse,
} from '@statecarry/contracts';
import { ProjectRequestError } from './project-gateway';
export class HttpAnalysisGateway implements AnalysisGateway {
  subscribe(
    listener: (change?: AnalysisChangeNotice) => void,
    onConnection?: (state: 'connected' | 'disconnected') => void,
  ): () => void {
    if (typeof EventSource === 'undefined') return () => {};
    const source = new EventSource('/api/v1/events');
    const notify = (event: MessageEvent, kind?: 'collection-settled') => {
      try {
        const value: unknown = JSON.parse(event.data);
        if (
          value &&
          typeof value === 'object' &&
          'projectId' in value &&
          (value.projectId === null ||
            (typeof value.projectId === 'string' && value.projectId.length > 0))
        ) {
          const topic =
            'topic' in value &&
            ['profile', 'sources', 'observation', 'working-tree-analysis', 'overview'].includes(
              String(value.topic),
            )
              ? (value.topic as
                  | 'profile'
                  | 'sources'
                  | 'observation'
                  | 'working-tree-analysis'
                  | 'overview')
              : undefined;
          listener({
            projectId: value.projectId,
            ...(kind ? { kind } : {}),
            ...(topic ? { topic } : {}),
          });
          return;
        }
      } catch {
        /* Unknown notices conservatively invalidate the workspace. */
      }
      if (!kind) listener();
    };
    const onChange = (event: MessageEvent) => notify(event);
    const onSettled = (event: MessageEvent) => notify(event, 'collection-settled');
    const onConnected = () => {
      // A connection is one event, not also a second data-change notification.
      if (onConnection) onConnection('connected');
      else listener();
    };
    const onError = () => onConnection?.('disconnected');
    source.addEventListener('change', onChange);
    source.addEventListener('collection-settled', onSettled);
    source.addEventListener('connected', onConnected);
    source.addEventListener('error', onError);
    return () => {
      source.removeEventListener('change', onChange);
      source.removeEventListener('collection-settled', onSettled);
      source.removeEventListener('connected', onConnected);
      source.removeEventListener('error', onError);
      source.close();
    };
  }
  private async request(path: string, data?: unknown) {
    const response = await fetch(`/api/v1/projects${path}`, {
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
      throw new ProjectRequestError(
        value.error?.code ?? 'UNAVAILABLE',
        value.error?.message ?? 'Cannot reach StateCarry. Check the local server.',
      );
    return value;
  }
  list(): Promise<AnalysisWork[]> {
    return this.request('/analysis');
  }
  async setGoal(id: string, text: string, version: string) {
    await this.request(`/${encodeURIComponent(id)}/analysis/goal`, { text, version });
  }
  async refresh(id: string, outputLanguage?: OutputLanguage) {
    await this.request(`/${encodeURIComponent(id)}/analysis/refresh`, {
      ...(outputLanguage ? { outputLanguage } : {}),
    });
  }
  async localize(id: string, outputLanguage: OutputLanguage) {
    await this.request(`/${encodeURIComponent(id)}/analysis/localize`, { outputLanguage });
  }
  async correct(id: string, input: AnalysisCorrection) {
    await this.request(`/${encodeURIComponent(id)}/analysis/correct`, input);
  }
  async discussTask(id: string, input: TaskDiscussionRequest): Promise<TaskDiscussionResponse> {
    return this.request(
      `/${encodeURIComponent(id)}/analysis/discussion`,
      input,
    ) as Promise<TaskDiscussionResponse>;
  }
  async setCoordination(id: string, threadId: string | null, version: string) {
    await this.request(`/${encodeURIComponent(id)}/analysis/coordination`, { threadId, version });
  }
}
