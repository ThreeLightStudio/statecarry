import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Capabilities } from '@statecarry/contracts';

export const navigationEvidenceSchema = z
  .object({
    version: z.literal(1),
    scheme: z.literal('codex://threads/'),
    dispatch: z.literal('rtk proxy open'),
    platform: z.literal('darwin'),
    targetId: z.string().uuid(),
    targetMatched: z.literal(true),
    observer: z.literal('user'),
    observation: z.string().min(1),
    source: z
      .object({
        report: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        section: z.string().min(1),
      })
      .strict(),
    recordedAt: z.string().datetime(),
    observedAt: z.string().datetime().nullable(),
    environment: z
      .object({
        appVersion: z.string().nullable(),
        osBuild: z.string().nullable(),
        runtimeVersion: z.string().nullable(),
      })
      .strict(),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();

export function inspectNavigationEvidence(
  dataDir: string,
  platform = process.platform,
): Capabilities['navigation'] {
  const base = { precision: 'unsupported' as const, verifiedAt: null };
  if (platform !== 'darwin')
    return {
      ...base,
      state: 'unsupported-environment',
      detail:
        'This environment is not verified. Existing observations apply only to the local macOS environment.',
    };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dataDir, 'navigation-verification.json'), 'utf8'));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ...base,
      state: missing ? 'missing' : 'invalid',
      detail: missing
        ? 'Navigation evidence is not registered. Follow the local CLI setup instructions.'
        : 'The navigation evidence file could not be read. Check it using the local CLI. It will not be overwritten automatically.',
    };
  }
  const parsed = navigationEvidenceSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ...base,
      state: 'invalid',
      detail:
        'Navigation evidence is incomplete or invalid. Check the existing file using the local CLI.',
    };
  return {
    precision: 'thread',
    verifiedAt: parsed.data.observedAt,
    state: 'verified-route',
    detail:
      'Arrival was observed for a target on the local macOS environment. Arrival at other targets or versions, message-level navigation and sending are not guaranteed.',
  };
}
