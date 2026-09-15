import type { StateCarry } from '@statecarry/core';

export class BackgroundLoop {
  private collected = new Map<string, number>();
  private discovered = new Map<string, number>();
  constructor(private core: StateCarry, private report: (error: unknown) => void = console.error, private resumeOnly = false) {}
  tick(now = Date.now()) {
    this.core.questions.sweep();
    if (!this.resumeOnly) this.core.explanations.tick();
    for (const connection of this.core.listConnections()) {
      const workId = connection.workId;
      if (!this.discovered.has(connection.id) || now - this.discovered.get(connection.id)! >= 60000) {
        this.discovered.set(connection.id, now);
        void this.core.discover(connection).catch(this.report);
      }
      if (!this.collected.has(workId) || now - this.collected.get(workId)! >= 15000) {
        this.collected.set(workId, now);
        void this.core.collect(workId).then(() => { if (!this.resumeOnly) return this.core.process(workId); }).catch(this.report);
      }
      if (!this.resumeOnly) void this.core.process(workId).catch(this.report);
    }
  }
}
