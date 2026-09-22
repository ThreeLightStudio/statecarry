import type { StateCarry } from '@statecarry/core';

export class BackgroundLoop {
  private collected = new Map<string, number>();
  private discovered = new Map<string, number>();
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
  tick(now = Date.now()) {
    this.core.questions.sweep();
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
}
