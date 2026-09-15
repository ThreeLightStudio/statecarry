import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { inspectNavigationEvidence, navigationEvidenceSchema } from './navigation-verification';

/** An OS dispatch is only a request. A person must independently inspect the destination. */
export async function verifyNavigationArrival(options: {
  dataDir: string;
  threadId: string;
  platform: string;
  osBuild: string;
  runtimeVersion: string;
  dispatch: (threadId: string) => Promise<void>;
  confirm: (prompt: string) => Promise<string>;
  now?: () => string;
}) {
  const id = z.string().uuid().parse(options.threadId);
  if (options.platform !== 'darwin') throw new Error('Navigation verification requires macOS.');
  const path = join(options.dataDir, 'navigation-verification.json');
  try {
    readFileSync(path, 'utf8');
    return { action: 'existing-preserved', path, capability: inspectNavigationEvidence(options.dataDir, options.platform) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await options.dispatch(id);
  const expected = `arrived ${id}`;
  const answer = await options.confirm(`The OS accepted the open request. Inspect Codex and independently compare the intended conversation's title and content. A blank screen or a different conversation is NOT success. Only if the exact conversation arrived, type "${expected}"; otherwise press Enter: `);
  if (answer.trim() !== expected) return { action: 'arrival-unconfirmed', path };
  const at = (options.now ?? (() => new Date().toISOString()))();
  const observation = `User confirmed the intended conversation's title and content after dispatch: ${id}`;
  const evidence = navigationEvidenceSchema.parse({
    version: 1, scheme: 'codex://threads/', dispatch: 'rtk proxy open', platform: 'darwin',
    targetId: id, targetMatched: true, observer: 'user', observation,
    source: { report: 'interactive-cli', sha256: createHash('sha256').update(observation).digest('hex'), section: 'independent-user-arrival-confirmation' },
    recordedAt: at, observedAt: at,
    environment: { appVersion: null, osBuild: options.osBuild, runtimeVersion: options.runtimeVersion },
    limitations: ['User-confirmed title/content match, not automated foreground ID verification.', 'App version not captured. One target does not prove every target or future version works.', 'No message-position navigation or message submission verified.'],
  });
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  // Do not replace existing evidence, including one created while the person was inspecting Codex.
  writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { action: 'user-confirmed-arrival', path, capability: inspectNavigationEvidence(options.dataDir, options.platform) };
}
