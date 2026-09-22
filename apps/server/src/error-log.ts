import { DomainError } from '@statecarry/contracts';
import type { ErrorContext } from '@statecarry/core';
import { z } from 'zod';
import { redactAnalysisText } from './adapters/analysis-support';

export type ServerErrorContext = ErrorContext & { method?: string; path?: string; status?: number };

/** Diagnostics stay in the local process; never include request bodies or headers. */
export function reportServerError(error: unknown, context: ServerErrorContext): void {
  try {
    const color =
      process.env.NO_COLOR === undefined &&
      process.env.FORCE_COLOR !== '0' &&
      (process.env.FORCE_COLOR !== undefined ||
        (process.stderr.isTTY && process.env.TERM !== 'dumb'));
    const validation = error instanceof z.ZodError;
    const code =
      error instanceof DomainError
        ? error.code
        : validation
          ? 'VALIDATION'
          : error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'INTERNAL_ERROR';
    const clean = (text: string) =>
      redactAnalysisText(text)
        .replace(
          /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*)[^\s,;]+/gi,
          '$1[CREDENTIAL OMITTED]',
        )
        .slice(0, 4000);
    const details = validation
      ? {
          message: 'Input does not match contract',
          issues: error.issues
            .slice(0, 20)
            .map((issue) => ({
              path: issue.path.map(String),
              code: issue.code,
              message: clean(issue.message),
            })),
        }
      : {
          message: clean(error instanceof Error ? error.message : String(error)),
          ...(error instanceof Error && error.stack ? { stack: clean(error.stack) } : {}),
        };
    console.error(
      color ? '\x1b[38;5;174m[statecarry:error]' : '[statecarry:error]',
      JSON.stringify({ at: new Date().toISOString(), ...context, code: clean(code), ...details }) +
        (color ? '\x1b[0m' : ''),
    );
  } catch {
    // A diagnostic failure must not change an HTTP response or analysis state.
  }
}
