import type { BrowserMemory, LocalWorkState } from '@statecarry/presentation';
export class LocalBrowserMemory implements BrowserMemory {
  constructor(private storage: () => Storage) {}
  private key(id: string) { return `statecarry.work.v1.${id}`; }
  read(id: string): LocalWorkState | null {
    try { const value = JSON.parse(this.storage().getItem(this.key(id)) ?? 'null');
      if (!value || typeof value.draft !== 'string' || !Array.isArray(value.evidenceIds) || !Array.isArray(value.expandedIds) || typeof value.targetThreadId !== 'string' || typeof value.editVersion !== 'number') return null;
      if (value.openRequest != null) {
        const request = value.openRequest;
        if (typeof request.requestId !== 'string' || typeof request.threadId !== 'string' || typeof request.title !== 'string' || !['dispatching', 'dispatched', 'failed', 'result-unknown'].includes(request.state) || !(request.error === null || typeof request.error === 'string')) {
          // Keep edits, but never forget an unreadable request and accidentally enable another dispatch.
          value.openRequest = { requestId: typeof request.requestId === 'string' ? request.requestId : 'invalid-local-request', threadId: value.targetThreadId,
            title: 'Existing open request', state: 'result-unknown', error: 'The saved open request format could not be read. It will not run again automatically.' };
        }
      }
      return value;
    } catch { return null; }
  }
  write(id: string, value: LocalWorkState) { this.storage().setItem(this.key(id), JSON.stringify(value)); }
}
