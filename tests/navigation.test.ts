import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  inspectNavigationEvidence,
  navigationEvidenceSchema,
} from '../apps/server/src/adapters/navigation-verification';
import { dispatchCodex } from '../apps/server/src/adapters/navigator';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
const dirs: string[] = [];
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'statecarry-navigation-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  vi.clearAllMocks();
});

// Entirely synthetic evidence: it never grants a real user's installation a verified route.
const evidence = () =>
  navigationEvidenceSchema.parse({
    version: 1,
    scheme: 'codex://threads/',
    dispatch: 'rtk proxy open',
    platform: 'darwin',
    targetId: '00000000-0000-4000-8000-000000000001',
    targetMatched: true,
    observer: 'user',
    observation: 'Synthetic test observer confirmed a synthetic target.',
    source: { report: 'synthetic-unit-test', sha256: 'a'.repeat(64), section: 'fixture' },
    recordedAt: '2026-01-01T00:00:00.000Z',
    observedAt: null,
    environment: { appVersion: null, osBuild: null, runtimeVersion: null },
    limitations: ['Synthetic unit-test evidence only.'],
  });

describe('local navigation evidence', () => {
  it('starts without evidence and reads synthetic evidence without opening or altering it', () => {
    const dir = directory();
    expect(inspectNavigationEvidence(dir, 'darwin').state).toBe('missing');
    const path = join(dir, 'navigation-verification.json'),
      content = JSON.stringify(evidence());
    writeFileSync(path, content);
    expect(inspectNavigationEvidence(dir, 'darwin')).toMatchObject({
      precision: 'thread',
      verifiedAt: null,
      state: 'verified-route',
    });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      observedAt: null,
      environment: { appVersion: null, osBuild: null, runtimeVersion: null },
    });
    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([
    '{broken',
    JSON.stringify({ scheme: 'codex://threads/', targetMatched: true, verifiedAt: 'yesterday' }),
    JSON.stringify({ ...evidence(), targetMatched: false }),
  ])('does not activate or overwrite damaged/insufficient evidence', (existing) => {
    const dir = directory(),
      path = join(dir, 'navigation-verification.json');
    writeFileSync(path, existing);
    expect(inspectNavigationEvidence(dir, 'darwin')).toMatchObject({
      precision: 'unsupported',
      state: 'invalid',
    });
    expect(readFileSync(path, 'utf8')).toBe(existing);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('keeps environments outside macOS unsupported even with otherwise valid evidence', () => {
    const dir = directory();
    writeFileSync(join(dir, 'navigation-verification.json'), JSON.stringify(evidence()));
    expect(inspectNavigationEvidence(dir, 'linux').state).toBe('unsupported-environment');
  });
});

describe('safe OS dispatch', () => {
  it('uses the existing single URI argument and distinguishes OS acceptance from arrival', async () => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);
    const pending = dispatchCodex('00000000-0000-4000-8000-000000000001');
    child.emit('exit', 0, null);
    await pending;
    expect(spawn).toHaveBeenCalledWith(
      'rtk',
      ['proxy', 'open', 'codex://threads/00000000-0000-4000-8000-000000000001'],
      { stdio: 'ignore' },
    );
  });
  it.each(['../escape', 'id;touch /tmp/no', '$(echo test)', 'x?message=send'])(
    'rejects unsafe IDs without spawning',
    (id) => {
      expect(() => dispatchCodex(id)).toThrow();
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it('separates failed exit, spawn failure and unknown termination', async () => {
    for (const mode of ['failed', 'spawn', 'signal', 'unknown']) {
      const child = new EventEmitter();
      spawn.mockReturnValue(child);
      const pending = dispatchCodex('thread-a');
      const check =
        mode === 'signal' || mode === 'unknown'
          ? expect(pending).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })
          : expect(pending).rejects.toThrow();
      if (mode === 'spawn') child.emit('error', new Error('ENOENT'));
      else child.emit('exit', mode === 'failed' ? 1 : null, mode === 'signal' ? 'SIGTERM' : null);
      await check;
    }
  });
});
