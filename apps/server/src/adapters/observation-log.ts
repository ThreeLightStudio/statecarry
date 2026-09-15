import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Observation } from '@statecarry/contracts';

export function observationLog(dataDir: string) {
  return async (event: Observation) => {
    try {
      await appendFile(join(dataDir, 'observations.jsonl'), JSON.stringify({ ...event, receivedAt: new Date().toISOString(), provenance: 'browser-event; human-or-agent-not-inferred' }) + '\n', { mode: 0o600 });
      return true;
    } catch { return false; }
  };
}
