import { spawn } from 'node:child_process';
import { inspectNavigationEvidence } from './navigation-verification';
import type { Navigator } from '@statecarry/core';
import { DomainError, type Capabilities } from '@statecarry/contracts';
import { safeId } from './codex-reader';

export class CodexNavigator implements Navigator {
  constructor(private dataDir: string) {}
  capability(): Capabilities['navigation'] {
    return inspectNavigationEvidence(this.dataDir);
  }
  async open(threadId: string) {
    safeId(threadId);
    if (this.capability().precision === 'unsupported') throw new Error('Independent navigation is not verified');
    await dispatchCodex(threadId);
  }
}
export function dispatchCodex(threadId: string): Promise<void> {
  safeId(threadId);
  return new Promise((resolve, reject) => {
    const child = spawn('rtk', ['proxy', 'open', `codex://threads/${encodeURIComponent(threadId)}`], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else if (code === null || signal) reject(new DomainError('RESULT_UNKNOWN', `OS Run completion unknown (${signal ?? 'no exit code'}); It will not retry automatically.`));
      else reject(new Error(`OS dispatch failed (${code})`));
    });
  });
}
