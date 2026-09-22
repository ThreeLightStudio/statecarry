import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNavigationArrival } from '../apps/server/src/adapters/navigation-onboarding';
import { directNavigationEvidenceFile } from '../apps/server/src/adapters/navigation-verification';

const dirs: string[] = [];
const id = '00000000-0000-4000-8000-000000000001';
function setup(answer = '') {
  const dataDir = mkdtempSync(join(tmpdir(), 'statecarry-arrival-'));
  dirs.push(dataDir);
  return {
    dataDir,
    threadId: id,
    platform: 'darwin',
    osBuild: 'test',
    runtimeVersion: 'test',
    dispatch: vi.fn(async () => {}),
    confirm: vi.fn(async () => answer),
    now: () => '2026-09-12T00:00:00.000Z',
  };
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
describe('first-install arrival confirmation', () => {
  it.each(['', 'yes', 'arrived another-thread'])(
    'does not promote OS acceptance or a wrong confirmation: %s',
    async (answer) => {
      const options = setup(answer);
      expect((await verifyNavigationArrival(options)).action).toBe('arrival-unconfirmed');
      expect(options.dispatch).toHaveBeenCalledWith(id);
      expect(existsSync(join(options.dataDir, directNavigationEvidenceFile))).toBe(false);
    },
  );
  it('records explicit human confirmation without a source checkout or old report', async () => {
    const options = setup(`arrived ${id}`);
    expect((await verifyNavigationArrival(options)).action).toBe('user-confirmed-arrival');
    const evidence = JSON.parse(
      readFileSync(join(options.dataDir, directNavigationEvidenceFile), 'utf8'),
    );
    expect(evidence).toMatchObject({
      targetId: id,
      observer: 'user',
      observedAt: options.now(),
      source: { report: 'interactive-cli' },
    });
    expect(evidence.environment.appVersion).toBeNull();
  });
  it('preserves invalid existing evidence without dispatching', async () => {
    const options = setup();
    const path = join(options.dataDir, directNavigationEvidenceFile);
    writeFileSync(path, 'broken');
    expect((await verifyNavigationArrival(options)).action).toBe('existing-preserved');
    expect(options.dispatch).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe('broken');
  });
  it('records direct-open evidence without changing a retired verification record', async () => {
    const options = setup(`arrived ${id}`);
    const legacyPath = join(options.dataDir, 'navigation-verification.json');
    const legacy = '{"dispatch":"rtk proxy open","historical":true}\n';
    writeFileSync(legacyPath, legacy);

    expect((await verifyNavigationArrival(options)).action).toBe('user-confirmed-arrival');
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacy);
    expect(
      JSON.parse(readFileSync(join(options.dataDir, directNavigationEvidenceFile), 'utf8')),
    ).toMatchObject({ dispatch: 'open', targetId: id });
  });
  it('never asks for confirmation after dispatch failure', async () => {
    const options = setup();
    options.dispatch.mockRejectedValue(new Error('OS failed'));
    await expect(verifyNavigationArrival(options)).rejects.toThrow('OS failed');
    expect(options.confirm).not.toHaveBeenCalled();
  });
  it('rejects unsupported environments before dispatch', async () => {
    const options = { ...setup(), platform: 'linux' };
    await expect(verifyNavigationArrival(options)).rejects.toThrow('macOS');
    expect(options.dispatch).not.toHaveBeenCalled();
  });
});
