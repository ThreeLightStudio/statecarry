import { z } from 'zod';
import { effortSchema, type AnalysisSettings, DomainError } from '@statecarry/contracts';

export const PROMPT_VERSION = 'statecarry-06.23';
const settingsSchema = z
  .object({
    model: z.string().min(1).default('gpt-5.6-luna'),
    summaryEffort: effortSchema.default('medium'),
    checkEffort: effortSchema.default('medium'),
  })
  .strict();

export function summarySettings(input: unknown = {}): AnalysisSettings {
  return { ...settingsSchema.parse(input), promptVersion: PROMPT_VERSION };
}
export function settingsFromEnvironment(
  env: Record<string, string | undefined>,
): Omit<AnalysisSettings, 'promptVersion'> {
  return settingsSchema.parse({
    model: env.STATECARRY_MODEL,
    summaryEffort: env.STATECARRY_SUMMARY_EFFORT,
    checkEffort: env.STATECARRY_CHECK_EFFORT,
  });
}
export function requireSupportedSettings(
  settings: AnalysisSettings,
  models: { model: string; supportedReasoningEfforts: { reasoningEffort: string }[] }[],
) {
  const entry = models.find((m) => m.model === settings.model);
  if (!entry)
    throw new DomainError(
      'CAPABILITY_UNSUPPORTED',
      `Requested analysis model is unavailable: ${settings.model}; no model fallback`,
    );
  for (const effort of [settings.summaryEffort, settings.checkEffort]) {
    if (!entry.supportedReasoningEfforts?.some((e) => e.reasoningEffort === effort))
      throw new DomainError(
        'CAPABILITY_UNSUPPORTED',
        `Requested effort is unavailable: ${settings.model}/${effort}; no effort fallback`,
      );
  }
}
