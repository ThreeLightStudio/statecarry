import type { StateCarry } from '@statecarry/core';

export class BackgroundLoop {
  private collected = new Map<string, number>();
  private discovered = new Map<string, number>();
  private executionSyncing = new Set<string>();
  private executionSyncAt = new Map<string, number>();
  private executionSyncFailures = new Map<string, number>();
  private stopped = false;
  constructor(
    private core: StateCarry,
    private report: (error: unknown) => void = console.error,
    private analysisOnly = false,
  ) {}
  deferExisting(now = Date.now()) {
    let index = 0;
    for (const connection of this.core.listConnections()) {
      this.collected.set(connection.projectId, now + index * 1000);
      this.discovered.set(connection.id, now + index * 5000);
      index++;
    }
  }
  stop() {
    this.stopped = true;
    this.core.executions.cancelPendingExecutionSyncs();
  }
  tick(now = Date.now()) {
    if (this.stopped) return;
    this.core.questions.sweep();
    this.syncExecutions(now);
    if (this.analysisOnly) return;
    this.core.explanations.tick();
    for (const connection of this.core.listConnections()) {
      const projectId = connection.projectId;
      if (
        !this.discovered.has(connection.id) ||
        now - this.discovered.get(connection.id)! >= 60000
      ) {
        this.discovered.set(connection.id, now);
        void this.core.discover(connection).catch(this.report);
      }
      if (!this.collected.has(projectId) || now - this.collected.get(projectId)! >= 15000) {
        this.collected.set(projectId, now);
        void this.core
          .collect(projectId)
          .then(() => {
            if (!this.analysisOnly) return this.core.process(projectId);
          })
          .catch(this.report);
      } else if (!this.analysisOnly && this.core.needsProcessing(projectId)) {
        void this.core.process(projectId).catch(this.report);
      }
    }
  }

  private syncExecutions(now: number) {
    const requests = this.core.repo.list('continuation').filter((request) => {
      const terminal = ['completed', 'failed', 'interrupted'].includes(
        request.execution?.status ?? '',
      );
      return (
        !!request.threadId &&
        !terminal &&
        ['dispatching', 'sent', 'result-unknown'].includes(request.state)
      );
    });
    const pendingKeys = new Set<string>();
    for (const request of requests) {
      const key = JSON.stringify([request.projectId, request.id]);
      pendingKeys.add(key);
      if (this.executionSyncing.has(key)) continue;
      const failures = this.executionSyncFailures.get(key) ?? 0;
      const interval =
        failures === 0 ? 3000 : Math.min(60_000, 6000 * 2 ** Math.min(failures - 1, 4));
      const last = this.executionSyncAt.get(key);
      if (last !== undefined && now - last < interval) continue;

      this.executionSyncAt.set(key, now);
      this.executionSyncing.add(key);
      void this.core.executions
        .sync(request.projectId, request.id)
        .then((execution) => {
          if (execution?.status === 'unknown')
            this.executionSyncFailures.set(key, (this.executionSyncFailures.get(key) ?? 0) + 1);
          else this.executionSyncFailures.delete(key);
        })
        .catch(() => {
          this.executionSyncFailures.set(key, (this.executionSyncFailures.get(key) ?? 0) + 1);
        })
        .finally(() => this.executionSyncing.delete(key));
    }
    for (const key of this.executionSyncAt.keys()) {
      if (pendingKeys.has(key) || this.executionSyncing.has(key)) continue;
      this.executionSyncAt.delete(key);
      this.executionSyncFailures.delete(key);
    }
  }
}
