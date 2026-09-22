import { spawn } from 'node:child_process';
import { inspectNavigationEvidence } from './navigation-verification';
import type { Navigator } from '@statecarry/core';
import { DomainError, type Capabilities } from '@statecarry/contracts';
import { safeId } from './codex-reader';
import { executableEnvironment, resolveExecutable } from './executable-resolver';

export class CodexNavigator implements Navigator {
  constructor(private dataDir: string) {}
  capability(): Capabilities['navigation'] {
    return inspectNavigationEvidence(this.dataDir);
  }
  async open(threadId: string) {
    safeId(threadId);
    if (this.capability().precision === 'unsupported')
      throw new Error('Independent navigation is not verified');
    await dispatchCodex(threadId);
  }
}
export function dispatchCodex(threadId: string): Promise<void> {
  safeId(threadId);
  return new Promise((resolve, reject) => {
    const open = resolveExecutable('open');
    if (!open) {
      reject(
        new Error(
          'macOS Open was not found in the locations StateCarry can use from the desktop app.',
        ),
      );
      return;
    }
    const child = spawn(open, [`codex://threads/${encodeURIComponent(threadId)}`], {
      stdio: 'ignore',
      env: executableEnvironment(['open']),
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else if (code === null || signal)
        reject(
          new DomainError(
            'RESULT_UNKNOWN',
            `OS Run completion unknown (${signal ?? 'no exit code'}); It will not retry automatically.`,
          ),
        );
      else reject(new Error(`OS dispatch failed (${code})`));
    });
  });
}
